/**
 * 热搜采集服务
 * 负责调度各平台采集任务、重试、上报到服务端
 */

import { randomUUID } from "crypto";
import { allPlatforms, getPlatform, getEnabledPlatforms } from "./platforms";
import type { PlatformModule, PlatformResult, FetchContext } from "./types";

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edge/122.0.0.0 Safari/537.36",
];

function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 与服务端通信的基础地址（main 进程直接 HTTP 调用，无需关注 CORS）
const REMOTE_API_BASE =
  process.env.NODE_ENV === "development"
    ? "http://localhost:1520/api"
    : "https://1s.design:1520/api";

// 客户端设备标识（从 server.ts 注入）
let clientDeviceId: string | null = null;

console.log(`[HotSearch] REMOTE_API_BASE = ${REMOTE_API_BASE} (NODE_ENV=${process.env.NODE_ENV})`);

class HotSearchService {
  private running = false;
  private lastFetchAt: string | null = null;
  private schedulePolling = false;
  private schedulePollTimer: NodeJS.Timeout | null = null;
  private progress: Record<
    string,
    {
      status: "idle" | "fetching" | "done" | "error";
      error?: string;
      duration?: number;
    }
  > = {};

  private getToken: (() => string | null) | null = null;

  setTokenGetter(getter: () => string | null) {
    this.getToken = getter;
  }

  setClientDeviceId(id: string) {
    clientDeviceId = id;
  }

  /**
   * 带 fallback 的 API 请求（REMOTE_API_BASE 失败时回退到 localhost:1520）
   */
  private async apiFetch(path: string, init?: RequestInit): Promise<Response> {
    const primaryUrl = `${REMOTE_API_BASE}${path}`;
    const fallbackUrl = `http://localhost:1520/api${path}`;
    try {
      return await fetch(primaryUrl, init);
    } catch (primaryErr: any) {
      console.warn(`[HotSearch] 主地址失败 (${primaryErr?.cause?.code || primaryErr?.message}), fallback → ${fallbackUrl}`);
      return fetch(fallbackUrl, init);
    }
  }

  /**
   * 获取所有平台配置
   */
  getPlatforms() {
    return allPlatforms.map((p) => ({
      key: p.config.key,
      name: p.config.name,
      enabled: p.config.enabled,
      environment: p.config.environment,
      maxItems: p.config.maxItems,
      status: this.progress[p.config.key]?.status || "idle",
      error: this.progress[p.config.key]?.error,
      duration: this.progress[p.config.key]?.duration,
    }));
  }

  /**
   * 采集单个平台（带重试）
   */
  async fetchPlatform(platformModule: PlatformModule): Promise<PlatformResult> {
    const { key, name, retryCount, timeout } = platformModule.config;
    const startTime = Date.now();
    this.progress[key] = { status: "fetching" };

    const ctx: FetchContext = { userAgent: randomUA(), timeout };
    let lastError: string = "未知错误";

    for (let attempt = 0; attempt <= retryCount; attempt++) {
      try {
        const items = await platformModule.fetch(ctx);
        const duration = Date.now() - startTime;
        this.progress[key] = { status: "done", duration };
        console.log(
          `✅ [HotSearch] ${name} 采集成功: ${items.length} 条, ${duration}ms`,
        );
        return {
          platform: key,
          name,
          success: true,
          items,
          timestamp: new Date().toISOString(),
          duration,
        };
      } catch (error: any) {
        lastError = error?.message || String(error);
        console.warn(
          `⚠️ [HotSearch] ${name} 第 ${attempt + 1} 次尝试失败: ${lastError}`,
        );
        if (attempt < retryCount) await sleep(1000 * (attempt + 1));
      }
    }

    const duration = Date.now() - startTime;
    this.progress[key] = { status: "error", error: lastError, duration };
    console.error(`❌ [HotSearch] ${name} 采集失败: ${lastError}`);
    return {
      platform: key,
      name,
      success: false,
      items: [],
      timestamp: new Date().toISOString(),
      error: lastError,
      duration,
    };
  }

  /**
   * 采集所有启用的平台（并发）
   */
  async fetchAll(platformKeys?: string[]) {
    if (this.running) throw new Error("采集任务正在运行中");

    this.running = true;
    const startTime = Date.now();
    const snapshotId = randomUUID();
    const fetchedAt = new Date().toISOString();
    this.lastFetchAt = fetchedAt;

    console.log(`🚀 [HotSearch] 开始采集, snapshotId=${snapshotId}`);

    try {
      let targets: PlatformModule[];
      if (platformKeys?.length) {
        targets = platformKeys
          .map((key) => getPlatform(key))
          .filter(Boolean) as PlatformModule[];
      } else {
        targets = getEnabledPlatforms();
      }

      const results = await Promise.all(
        targets.map((p) => this.fetchPlatform(p)),
      );
      const successCount = results.filter((r) => r.success).length;
      const totalDuration = Date.now() - startTime;

      console.log(
        `🎉 [HotSearch] 采集完成: 成功 ${successCount}/${results.length}, 耗时 ${totalDuration}ms`,
      );

      return {
        snapshotId,
        fetchedAt,
        platforms: results,
        summary: {
          total: results.length,
          success: successCount,
          failed: results.length - successCount,
          duration: totalDuration,
        },
      };
    } finally {
      this.running = false;
    }
  }

  /**
   * 采集并上报到服务端
   */
  async fetchAndReport(platformKeys?: string[]) {
    const fetchResult = await this.fetchAll(platformKeys);
    const reportResult = await this.reportToServer(fetchResult);
    return { ...fetchResult, reportResult };
  }

  /**
   * 上报数据到服务端
   */
  private async reportToServer(data: {
    snapshotId: string;
    fetchedAt: string;
    platforms: PlatformResult[];
    summary: { duration: number };
  }) {
    const token = this.getToken?.();
    if (!token) {
      console.warn("⚠️ [HotSearch] 未登录，跳过上报");
      return { success: false, message: "未登录" };
    }

    console.log(
      `📤 [HotSearch] 上报中... platforms=${data.platforms.length}`,
    );

    try {
      const response = await this.apiFetch("/hotsearch-data/report", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          platforms: data.platforms,
          triggeredBy: "client",
          fetchedAt: data.fetchedAt,
          duration: data.summary.duration,
        }),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`HTTP ${response.status}: ${text}`);
      }

      const raw = await response.json();
      const result = raw?.data && typeof raw.data === "object" && "success" in raw.data ? raw.data : raw;
      console.log(`✅ [HotSearch] 已上报, 采集记录ID=${result.id}`);
      return result;
    } catch (error: any) {
      console.error(`❌ [HotSearch] 上报失败: ${error?.message || error}`);
      return { success: false, message: error?.message || String(error) };
    }
  }

  getStatus() {
    return {
      running: this.running,
      lastFetchAt: this.lastFetchAt,
      platforms: this.getPlatforms(),
    };
  }

  getPlatformDetail(key: string) {
    const platform = getPlatform(key);
    if (!platform) return null;
    return {
      ...platform.config,
      status: this.progress[key]?.status || "idle",
      error: this.progress[key]?.error,
      duration: this.progress[key]?.duration,
    };
  }

  // ==================== 定时任务轮询 ====================

  startSchedulePolling(intervalMs: number = 30000) {
    if (this.schedulePolling) return;
    this.schedulePolling = true;
    console.log(
      `⏰ [HotSearch] 定时任务轮询已启动, 间隔 ${intervalMs / 1000}s`,
    );

    const poll = async () => {
      if (!this.schedulePolling) return;
      try {
        await this.pollScheduleOnce();
      } catch {}
      if (this.schedulePolling)
        this.schedulePollTimer = setTimeout(poll, intervalMs);
    };

    this.schedulePollTimer = setTimeout(poll, 3000);
  }

  stopSchedulePolling() {
    this.schedulePolling = false;
    if (this.schedulePollTimer) {
      clearTimeout(this.schedulePollTimer);
      this.schedulePollTimer = null;
    }
    console.log("🛑 [HotSearch] 定时任务轮询已停止");
  }

  private async pollScheduleOnce() {
    const token = this.getToken?.();
    const deviceId = clientDeviceId;
    if (!token || !deviceId) {
      console.log(`[HotSearch] poll 跳过: token=${!!token}, deviceId=${deviceId || "(空)"}`);
      return;
    }

    const pollPath = `/hotsearch-data/schedule/poll?clientId=${encodeURIComponent(deviceId)}`;
    console.log(`[HotSearch] poll → clientId=${deviceId}`);

    let res: Response;
    try {
      res = await this.apiFetch(pollPath, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err: any) {
      console.error(`[HotSearch] poll 所有地址均失败:`, err?.cause?.code || err?.message);
      return;
    }

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      if (res.status === 401) {
        console.warn(`⚠️ [HotSearch] 定时轮询返回 401，token 可能已过期`);
      } else {
        console.warn(`⚠️ [HotSearch] 定时轮询失败: HTTP ${res.status} ${errorText}`);
      }
      return;
    }

    const raw = await res.json();
    // 响应可能被包装: {data: {success, data}, code: 0} 或直接 {success, data}
    const result = raw?.data && typeof raw.data === "object" && "success" in raw.data ? raw.data : raw;
    console.log(`[HotSearch] poll 响应:`, JSON.stringify(result));
    if (!result.success || !result.data) return;

    const task = result.data;
    console.log(`⏰ [HotSearch] 定时任务触发: scheduleId=${task.scheduleId}, platforms=${task.platforms.join(",")}`);

    try {
      console.log(`🚀 [HotSearch] 开始采集 ${task.platforms.length} 个平台...`);
      const fetchResult = await this.fetchAndReport(task.platforms);
      console.log(`📊 [HotSearch] 采集完成: success=${fetchResult.summary?.success}, failed=${fetchResult.summary?.failed}, reportId=${fetchResult.reportResult?.id}`);

      const reportRes = await this.apiFetch("/hotsearch-data/schedule/report", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          scheduleId: task.scheduleId,
          collectId: fetchResult.reportResult?.id,
        }),
      });

      if (!reportRes.ok) {
        console.warn(`⚠️ [HotSearch] 定时任务结果上报失败: HTTP ${reportRes.status}`);
      } else {
        console.log(`✅ [HotSearch] 定时任务完成: scheduleId=${task.scheduleId}`);
      }
    } catch (error: any) {
      console.error(`❌ [HotSearch] 定时任务执行失败: ${error?.message || error}`, error?.stack);
      // 上报失败状态
      await this.apiFetch("/hotsearch-data/schedule/report", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          scheduleId: task.scheduleId,
          error: error?.message || String(error),
        }),
      }).catch((reportErr: any) => {
        console.warn(`⚠️ [HotSearch] 定时任务失败状态上报也失败了: ${reportErr?.message}`);
      });
    }
  }

  getSchedulePollingStatus() {
    return { polling: this.schedulePolling, clientDeviceId };
  }
}

export const hotSearchService = new HotSearchService();
