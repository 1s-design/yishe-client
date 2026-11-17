/*
 * 裁剪审核任务 · 客户端执行引擎
 *
 * 重活（下载原图 / sharp 裁剪 / COS 直传 / 素材入库）全部在客户端完成，
 * 服务端只保存任务状态与 Redis 认领锁。执行进度落本地 SQLite 台账，
 * 进程重启后未完成的配置项自动续跑。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import https from "node:https";
import http from "node:http";
import sharp from "sharp";
import { execFile } from "node:child_process";
import {
  getBackendApiBase,
  getCurrentAccessToken,
} from "./cos";
import { uploadToMaterialLibrary } from "./materialLibrary";
import { getTokenValue } from "./server";
import {
  CropPlan,
  upsertLedgerTask,
  getDoneConfigKeys,
  addLedgerResult,
  setLedgerStatus,
  listPendingLedgerTasks,
  pruneLedger,
  getLedgerResults,
} from "./crop-task-store";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";

interface ServerTask {
  taskId: string;
  batchId?: string;
  originalId: string;
  originalUrl: string;
  originalName?: string;
  configs: CropPlan[];
  progress?: {
    done: number;
    total: number;
    results: Array<{ configKey: string; materialId: string; materialUrl?: string }>;
  };
}

export interface CropEngineStatus {
  running: boolean;
  clientId: string;
  busy: boolean;
  lastPollAt?: string;
  lastError?: string;
  activeTaskId?: string;
  processedCount: number;
}

// ── HTTP 客户端（带 JWT，与 cos.ts 同源 API Base） ─────────────────────────
interface ApiEnvelope<T> {
  code?: number;
  status?: boolean;
  data?: T;
  message?: string;
}

function requestJson<T>(
  method: "GET" | "POST",
  pathname: string,
  body: Record<string, any> | undefined,
  token: string,
): Promise<T> {
  return new Promise(async (resolve, reject) => {
    let apiBase = "http://localhost:1520/api";
    try {
      apiBase = (await getBackendApiBase()).replace(/\/+$/, "");
    } catch {
      /* 用默认 */
    }
    const url = new URL(`${apiBase}${pathname}`);
    const payload = body ? JSON.stringify(body) : "";
    const transport = url.protocol === "http:" ? http : https;
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      rejectUnauthorized: false,
    } as any;
    const req = transport.request(options, (res: any) => {
      let raw = "";
      res.on("data", (chunk: Buffer) => (raw += chunk.toString()));
      res.on("end", () => {
        if ((res.statusCode || 500) >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 300)}`));
          return;
        }
        try {
          const parsed = JSON.parse(raw) as ApiEnvelope<T>;
          const data = parsed.data !== undefined ? parsed.data : (parsed as any);
          if (parsed.code !== undefined && parsed.code !== 0) {
            reject(new Error(parsed.message || `服务端返回 code=${parsed.code}`));
            return;
          }
          resolve(data as T);
        } catch (e: any) {
          reject(new Error(`响应解析失败: ${e?.message || e}`));
        }
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function resolveToken(): Promise<string> {
  return getTokenValue() || (await getCurrentAccessToken()) || "";
}

// ── 下载原图（fetch → curl 降级） ──────────────────────────────────────────
async function downloadOriginal(url: string): Promise<Buffer> {
  const headers = { "User-Agent": UA, Referer: new URL(url).origin };
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(120000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } catch (e1: any) {
    try {
      return await new Promise<Buffer>((resolve, reject) => {
        const args = ["-sSLf", "--max-time", "120"];
        for (const [k, v] of Object.entries(headers)) args.push("-H", `${k}: ${v}`);
        args.push(url);
        execFile(
          "curl",
          args,
          { encoding: "buffer", maxBuffer: 200 * 1024 * 1024 },
          (err, stdout) => {
            if (err) reject(new Error(`curl 失败: ${err.message}`));
            else if (!stdout?.length) reject(new Error("curl 空响应"));
            else resolve(stdout);
          },
        );
      });
    } catch (e2: any) {
      throw new Error(`下载原图失败: ${e1?.message} / ${e2?.message}`);
    }
  }
}

/** 计算 cover 裁剪区域（居中），输出目标比例 */
function computeCropRegion(
  width: number,
  height: number,
  aspectRatio: number,
  targetWidth?: number,
  targetHeight?: number,
) {
  // 目标比例取显式 width/height（若都给），否则用 aspectRatio
  const targetRatio =
    targetWidth && targetHeight
      ? targetWidth / targetHeight
      : Number(aspectRatio) || 1;
  const currentRatio = width / height;
  let left = 0;
  let top = 0;
  let cropWidth = width;
  let cropHeight = height;
  if (currentRatio > targetRatio) {
    // 原图更宽 → 按高度裁，左右居中切掉
    cropWidth = Math.round(height * targetRatio);
    left = Math.floor((width - cropWidth) / 2);
  } else if (currentRatio < targetRatio) {
    // 原图更高 → 按宽度裁，上下居中切掉
    cropHeight = Math.round(width / targetRatio);
    top = Math.floor((height - cropHeight) / 2);
  }
  return { left, top, width: cropWidth, height: cropHeight };
}

/** 单个方案：sharp 裁剪到临时文件 */
async function cropOne(
  sourceBuffer: Buffer,
  plan: CropPlan,
  originalExt: string,
): Promise<{ filePath: string; width: number; height: number }> {
  const meta = await sharp(sourceBuffer, { limitInputPixels: false, failOn: "none" })
    .metadata();
  const srcWidth = meta.width || 0;
  const srcHeight = meta.height || 0;
  if (!srcWidth || !srcHeight) throw new Error("无法读取原图尺寸");

  const region = computeCropRegion(
    srcWidth,
    srcHeight,
    plan.aspectRatio,
    plan.width,
    plan.height,
  );
  const ext = originalExt || "jpg";
  const outPath = path.join(
    os.tmpdir(),
    `crop-audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`,
  );

  let pipeline = sharp(sourceBuffer, { limitInputPixels: false, failOn: "none" })
    .extract(region)
    .rotate();
  // 指定目标像素时缩放到目标尺寸（cover 保证不留白）
  if (plan.width && plan.height) {
    pipeline = pipeline.resize(plan.width, plan.height, { fit: "cover", position: "centre" });
  } else if (plan.width && !plan.height) {
    pipeline = pipeline.resize({ width: plan.width, withoutEnlargement: true });
  }

  if (ext === "png") pipeline = pipeline.png({ compressionLevel: 8 });
  else if (ext === "webp") pipeline = pipeline.webp({ quality: 92 });
  else pipeline = pipeline.jpeg({ quality: 92, mozjpeg: true });

  const info = await pipeline.toFile(outPath);
  return { filePath: outPath, width: info.width, height: info.height };
}

// ── 引擎主体 ───────────────────────────────────────────────────────────────
class CropTaskEngine {
  private readonly clientId = `crop-client-${process.pid}-${Date.now()}`;
  private running = false;
  private busy = false;
  private queue: Promise<unknown> = Promise.resolve();
  private pollTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private activeTaskId: string | null = null;
  private lastPollAt?: string;
  private lastError?: string;
  private processedCount = 0;

  start() {
    if (this.running) return;
    this.running = true;
    console.log(`[CropTask] 执行引擎启动 clientId=${this.clientId}`);
    // 启动即拉一次（断点续跑）+ 低频兜底轮询（socket 推送丢失时补拉）
    void this.pollOnce();
    this.pollTimer = setInterval(() => void this.pollOnce(), 60_000);
    // 心跳续租：processing 任务每 90s 续一次（租约 300s）
    this.heartbeatTimer = setInterval(() => void this.renewActiveLease(), 90_000);
  }

  stop() {
    this.running = false;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.pollTimer = null;
    this.heartbeatTimer = null;
  }

  getStatus(): CropEngineStatus {
    return {
      running: this.running,
      clientId: this.clientId,
      busy: this.busy,
      lastPollAt: this.lastPollAt,
      lastError: this.lastError,
      activeTaskId: this.activeTaskId || undefined,
      processedCount: this.processedCount,
    };
  }

  /** 供 renderer/socket 触发的主动拉取（不等待，串行入队） */
  triggerPoll() {
    void this.pollOnce();
  }

  private enqueue(fn: () => Promise<void>) {
    this.queue = this.queue.then(fn).catch((error) => {
      console.error("[CropTask] 队列任务异常:", error?.message || error);
      this.lastError = error?.message || String(error);
    });
  }

  private async pollOnce() {
    if (!this.running) return;
    this.lastPollAt = new Date().toISOString();
    let token = "";
    try {
      token = await resolveToken();
      if (!token) {
        this.lastError = "未登录，跳过领取裁剪任务";
        return;
      }
      const result = await requestJson<{ tasks: ServerTask[] }>(
        "POST",
        "/crop-task/claim",
        { clientId: this.clientId, limit: 5 },
        token,
      );
      const tasks = Array.isArray(result?.tasks) ? result.tasks : [];
      if (!tasks.length) return;
      console.log(`[CropTask] 认领到 ${tasks.length} 条裁剪任务`);
      for (const task of tasks) {
        this.enqueue(() => this.processTask(task, token));
      }
    } catch (error: any) {
      this.lastError = error?.message || String(error);
      console.warn(`[CropTask] 拉取任务失败: ${this.lastError}`);
    }
  }

  private async renewActiveLease() {
    if (!this.activeTaskId) return;
    try {
      const token = await resolveToken();
      if (!token) return;
      await requestJson(
        "POST",
        "/crop-task/heartbeat",
        { taskId: this.activeTaskId, clientId: this.clientId },
        token,
      );
    } catch (error: any) {
      console.warn(`[CropTask] 续租失败: ${error?.message || error}`);
    }
  }

  private async processTask(task: ServerTask, token: string) {
    this.busy = true;
    this.activeTaskId = task.taskId;
    const configKeys = new Set((task.configs || []).map((c) => c.key));
    // 服务端已完成的 + 本地台账已完成的，都跳过（幂等）
    const serverDone = new Set(
      (task.progress?.results || []).map((r) => r.configKey),
    );
    const localDone = getDoneConfigKeys(task.taskId);
    try {
      upsertLedgerTask({
        taskId: task.taskId,
        batchId: task.batchId,
        originalId: task.originalId,
        originalUrl: task.originalUrl,
        originalName: task.originalName,
        configs: task.configs || [],
      });

      const pendingPlans = (task.configs || []).filter(
        (plan) =>
          configKeys.has(plan.key) &&
          !serverDone.has(plan.key) &&
          !localDone.has(plan.key),
      );
      if (!pendingPlans.length) {
        console.log(`[CropTask] 任务 ${task.taskId} 所有方案已完成，补报结果让服务端结单`);
        // 断线续跑场景：本地已完成但服务端可能仍是 processing，
        // 用本地台账的完整结果补报一次，服务端合并后重新判定 completed。
        await requestJson(
          "POST",
          "/crop-task/report",
          {
            taskId: task.taskId,
            clientId: this.clientId,
            results: getLedgerResults(task.taskId),
          },
          token,
        );
        setLedgerStatus(task.taskId, "completed");
      } else {
        const sourceBuffer = await downloadOriginal(task.originalUrl);
        const originalExt = (() => {
          const m = (task.originalUrl.split("?")[0].split(".").pop() || "").toLowerCase();
          return ["png", "webp", "jpeg", "jpg"].includes(m)
            ? m === "jpeg"
              ? "jpg"
              : m
            : "jpg";
        })();

        for (const plan of pendingPlans) {
          let croppedPath = "";
          try {
            const cropped = await cropOne(sourceBuffer, plan, originalExt);
            croppedPath = cropped.filePath;
            const fileName = `crop_${task.taskId.slice(0, 8)}_${plan.key}_${cropped.width}x${cropped.height}.${originalExt}`;
            const uploaded = await uploadToMaterialLibrary(croppedPath, fileName, {
              // 关键：裁剪产物必须是图库贴纸（sticker 表），否则进 crawler_material 表
              // 在图库页看不到，且 addRelatedImages 关联也会指向不存在的 sticker id。
              materialTarget: "sticker",
              category: "crop-audit",
              group: "crop-audit",
              source: "裁剪审核",
              originUrl: task.originalUrl,
              name: `${task.originalName || "裁剪图"}_${plan.label || plan.key}`,
              meta: {
                cropSource: "crop-audit",
                cropTaskId: task.taskId,
                cropBatchId: task.batchId,
                cropConfigKey: plan.key,
                cropConfigSnapshot: plan,
                originalId: task.originalId,
                originalUrl: task.originalUrl,
                sourceAspectRatio: plan.aspectRatio,
                generatedWidth: cropped.width,
                generatedHeight: cropped.height,
              },
            });
            if (!uploaded.ok || !uploaded.materialId) {
              throw new Error(uploaded.msg || "裁剪图入库失败");
            }
            // 先写本地台账（崩溃恢复凭据），再上报服务端
            addLedgerResult(task.taskId, {
              configKey: plan.key,
              materialId: uploaded.materialId,
              materialUrl: uploaded.materialUrl,
            });
            await requestJson(
              "POST",
              "/crop-task/report",
              {
                taskId: task.taskId,
                clientId: this.clientId,
                results: [
                  {
                    configKey: plan.key,
                    materialId: uploaded.materialId,
                    materialUrl: uploaded.materialUrl,
                  },
                ],
              },
              token,
            );
            this.processedCount += 1;
            console.log(
              `[CropTask] 任务 ${task.taskId} 方案 ${plan.key} 完成 → 素材 ${uploaded.materialId}`,
            );
          } finally {
            if (croppedPath) {
              try {
                fs.unlinkSync(croppedPath);
              } catch {
                /* 忽略清理失败 */
              }
            }
          }
        }
        setLedgerStatus(task.taskId, "completed");
      }
    } catch (error: any) {
      const message = error?.message || String(error);
      this.lastError = message;
      console.error(`[CropTask] 任务 ${task.taskId} 处理失败: ${message}`);
      setLedgerStatus(task.taskId, "failed");
      try {
        await requestJson(
          "POST",
          "/crop-task/fail",
          { taskId: task.taskId, clientId: this.clientId, message },
          token,
        );
      } catch {
        /* fail 上报失败不影响本地 */
      }
    } finally {
      this.activeTaskId = null;
      this.busy = false;
      try {
        pruneLedger();
      } catch {
        /* 忽略 */
      }
    }
  }
}

let engine: CropTaskEngine | null = null;

export function getCropTaskEngine(): CropTaskEngine {
  if (!engine) engine = new CropTaskEngine();
  return engine;
}

/** 进程启动时把本地未完成的任务重新入队（依据服务端 progress 幂等续跑） */
export function resumePendingTasks() {
  const pending = listPendingLedgerTasks();
  if (!pending.length) return;
  console.log(`[CropTask] 本地台账有 ${pending.length} 条未完成任务，将由轮询重新认领续跑`);
}
