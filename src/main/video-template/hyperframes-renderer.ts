/**
 * HyperFrames 渲染引擎适配层
 *
 * 与 Remotion 引擎并存，作为 video-template 的第二种渲染引擎：
 * - Remotion：React 组件 + bundle，服务固定模板与 ai-universal SceneGraph
 * - HyperFrames：纯 HTML + data-* 时间轴，无需 bundle，适合 AI 直接生成单文件合成
 *
 * 渲染管线：HTML 写入项目目录 → @hyperframes/producer 驱动 headless Chrome 逐帧
 * seek 截图 → FFmpeg 编码 MP4。Chrome / FFmpeg 复用 Remotion 已解析出的本地二进制。
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
import type { EngineConfig } from "@hyperframes/engine";
import type { ProducerLogger } from "@hyperframes/producer";

/**
 * @hyperframes/* 是纯 ESM 包（exports 仅声明 import 条件），而主进程构建产物
 * 为 CJS 且依赖被 externalize —— 静态 import 会被转成 require()，运行时直接抛
 * `No "exports" main defined`。这里用变量说明符的原生动态 import()（构建工具
 * 无法静态分析会保持原样），交给 Node 原生 ESM 加载器解析，并缓存加载结果。
 */
interface HyperframesDeps {
  engine: typeof import("@hyperframes/engine");
  core: typeof import("@hyperframes/core");
  producer: typeof import("@hyperframes/producer");
}

let hyperframesDepsPromise: Promise<HyperframesDeps> | null = null;

function loadHyperframesDeps(): Promise<HyperframesDeps> {
  if (!hyperframesDepsPromise) {
    const engineSpecifier = "@hyperframes/engine";
    const coreSpecifier = "@hyperframes/core";
    const producerSpecifier = "@hyperframes/producer";
    hyperframesDepsPromise = Promise.all([
      import(engineSpecifier),
      import(coreSpecifier),
      import(producerSpecifier),
    ]).then(([engine, core, producer]) => ({ engine, core, producer }));
  }
  return hyperframesDepsPromise;
}

export type HyperframesLogLevel = "info" | "warn" | "error";

export interface HyperframesProgressInfo {
  progress: number;
  stage: string;
  message: string;
  framesRendered: number | null;
  totalFrames: number | null;
}

export interface HyperframesProjectAsset {
  /** 项目内相对路径，如 assets/voice.mp3 */
  path: string;
  /** 远程资产直链（http/https），如 COS / 文件资源 URL */
  url: string;
}

export interface HyperframesRenderInput {
  jobId: string;
  html: string;
  /** 多文件工程：相对路径 → 文本文件内容（compositions 等），可选 */
  projectFiles?: Record<string, string>;
  /** 多文件工程：相对路径 → 远程资产 URL（字体/音频/图片/视频），可选 */
  assets?: HyperframesProjectAsset[];
  variables?: Record<string, unknown>;
  fps?: number;
  quality?: "draft" | "standard" | "high";
  outputLocation: string;
  /** 工作目录（每个任务会在其下建 {jobId}/ 项目目录） */
  workDir: string;
  browserExecutable: string | null;
  /** Remotion 二进制目录（内含 ffmpeg / ffprobe），用于给 HyperFrames 提供编码器 */
  binariesDirectory: string | null;
  abortSignal: AbortSignal;
  onProgress: (info: HyperframesProgressInfo) => void;
  onLog: (level: HyperframesLogLevel, stage: string, message: string) => void;
}

/** HyperFrames 渲染产物的映射阶段名（与 Remotion 队列的阶段风格保持一致） */
function mapHyperframesStage(rawStage: string): string {
  const stage = String(rawStage || "").toLowerCase();
  if (
    stage.includes("preprocess") ||
    stage.includes("compil") ||
    stage.includes("extracting") ||
    stage.includes("processing audio") ||
    stage.includes("checking browser") ||
    stage.includes("discovering")
  ) {
    return "prepare";
  }
  if (
    stage.includes("render") ||
    stage.includes("capture") ||
    stage.includes("streaming frame") ||
    stage.includes("starting frame")
  ) {
    return "render-frames";
  }
  if (stage.includes("encod") || stage.includes("mux")) return "encoding";
  if (stage.includes("assembl") || stage.includes("stitch")) return "muxing";
  if (stage.includes("complete")) return "completed";
  return stage || "rendering";
}

function ensureHyperframesEncoderEnv(binariesDirectory: string | null) {
  if (process.env.HYPERFRAMES_FFMPEG_PATH && process.env.HYPERFRAMES_FFPROBE_PATH) {
    return;
  }

  // 优先使用系统 ffmpeg（brew 等）：Homebrew 构建自带完整 dylib 解析，
  // 而 Remotion compositor 附带的 ffmpeg 被独立 spawn 时找不到同目录的
  // libav*.dylib（Remotion 自身渲染走的是 compositor 内嵌调用，不经过该路径）。
  const systemFfmpeg = resolveExecutableOnPath("ffmpeg");
  const systemFfprobe = resolveExecutableOnPath("ffprobe");
  if (!process.env.HYPERFRAMES_FFMPEG_PATH && systemFfmpeg) {
    process.env.HYPERFRAMES_FFMPEG_PATH = systemFfmpeg;
  }
  if (!process.env.HYPERFRAMES_FFPROBE_PATH && systemFfprobe) {
    process.env.HYPERFRAMES_FFPROBE_PATH = systemFfprobe;
  }

  // 兜底：Remotion 二进制目录内的 ffmpeg/ffprobe，
  // 通过 DYLD_LIBRARY_PATH / LD_LIBRARY_PATH 指向同目录的 libav*.dylib。
  if (!binariesDirectory) return;
  const isWin = process.platform === "win32";
  const ffmpeg = path.join(binariesDirectory, isWin ? "ffmpeg.exe" : "ffmpeg");
  const ffprobe = path.join(binariesDirectory, isWin ? "ffprobe.exe" : "ffprobe");
  if (!process.env.HYPERFRAMES_FFMPEG_PATH && fs.existsSync(ffmpeg)) {
    process.env.HYPERFRAMES_FFMPEG_PATH = ffmpeg;
    appendLibraryPath(binariesDirectory);
  }
  if (!process.env.HYPERFRAMES_FFPROBE_PATH && fs.existsSync(ffprobe)) {
    process.env.HYPERFRAMES_FFPROBE_PATH = ffprobe;
    appendLibraryPath(binariesDirectory);
  }
}

function resolveExecutableOnPath(name: string): string | null {
  const pathEnv = process.env.PATH || "";
  const extensions =
    process.platform === "win32" ? [".exe", ".cmd", ""] : [""];
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of extensions) {
      const candidate = path.join(dir, name + ext);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

/**
 * macOS 完整版 Chrome 的 viewport-bound 截图路径存在缺陷：compositor surface
 * 短于页面视口，缺口区域以页面背景填充，成片底部出现固定高度白边（本模块
 * 实测 87px，与分辨率无关）。Remotion 不受影响是因为它的截图硬编码
 * captureBeyondViewport: true。HyperFrames 引擎虽会在 macOS + 完整 Chrome 下
 * 默认开启该路径，但初始化时检测到页面高度未溢出视口又会降级关闭。
 * 这里注入 2px 的 html min-height 让页面恒溢出 1px 以上，使引擎保持
 * captureBeyondViewport（与 Remotion 同一条截图路径）。对布局无影响：
 * body/root 高度声明不变，截图 clip 仍只取顶部 height 区域。
 */
const CAPTURE_BEYOND_VIEWPORT_FIX =
  '<style data-yishe-capture-fix>html{min-height:calc(100% + 2px)}</style>';

function injectCaptureBeyondViewportFix(html: string): string {
  if (html.includes("data-yishe-capture-fix")) return html;
  const headClose = html.indexOf("</head>");
  if (headClose >= 0) {
    return (
      html.slice(0, headClose) + CAPTURE_BEYOND_VIEWPORT_FIX + html.slice(headClose)
    );
  }
  return CAPTURE_BEYOND_VIEWPORT_FIX + html;
}

const MAX_PROJECT_ASSET_BYTES = 200 * 1024 * 1024;

function resolveProjectFilePath(projectDir: string, relPath: string): string {
  const normalized = path.posix.normalize(String(relPath).replace(/\\/g, "/"));
  if (
    !normalized ||
    normalized === "." ||
    path.posix.isAbsolute(normalized) ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    throw new Error(`非法的工程文件路径: ${relPath}`);
  }
  const target = path.resolve(projectDir, normalized);
  if (!target.startsWith(projectDir + path.sep)) {
    throw new Error(`工程文件路径越界: ${relPath}`);
  }
  return target;
}

/** 多文件工程落盘：文本文件内联写入，二进制资产按 URL 下载（带大小/超时/取消约束） */
async function materializeProjectFiles(
  projectDir: string,
  projectFiles: Record<string, string> | undefined,
  assets: HyperframesProjectAsset[] | undefined,
  abortSignal: AbortSignal,
  onLog: (level: HyperframesLogLevel, stage: string, message: string) => void,
): Promise<void> {
  const textEntries = Object.entries(projectFiles || {});
  for (const [relPath, content] of textEntries) {
    const target = resolveProjectFilePath(projectDir, relPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, String(content), "utf8");
  }
  if (textEntries.length) {
    onLog("info", "prepare", `工程文本文件已写入 ${textEntries.length} 个`);
  }

  for (const asset of assets || []) {
    const target = resolveProjectFilePath(projectDir, asset?.path);
    const url = new URL(String(asset?.url || ""));
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(`资产 URL 仅支持 http/https: ${asset.path}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const response = await fetch(url, {
      signal: AbortSignal.any([abortSignal, AbortSignal.timeout(120000)]),
    });
    if (!response.ok || !response.body) {
      throw new Error(`资产下载失败（${response.status}）: ${asset.path}`);
    }
    let received = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        callback(
          received > MAX_PROJECT_ASSET_BYTES
            ? new Error(`资产超过 200MB 上限: ${asset.path}`)
            : null,
          chunk,
        );
      },
    });
    try {
      await pipeline(
        Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
        limiter,
        fs.createWriteStream(target),
        { signal: AbortSignal.any([abortSignal, AbortSignal.timeout(120000)]) },
      );
    } catch (error) {
      fs.rmSync(target, { force: true });
      throw error;
    }
    onLog(
      "info",
      "prepare",
      `资产已就绪: ${asset.path}（${(received / 1024 / 1024).toFixed(1)}MB）`,
    );
  }
}

function appendLibraryPath(directory: string) {
  const envKey =
    process.platform === "darwin"
      ? "DYLD_LIBRARY_PATH"
      : process.platform === "win32"
        ? "PATH"
        : "LD_LIBRARY_PATH";
  const current = process.env[envKey] || "";
  if (!current.split(path.delimiter).includes(directory)) {
    process.env[envKey] = current
      ? `${current}${path.delimiter}${directory}`
      : directory;
  }
}

function buildProducerLogger(
  onLog: (level: HyperframesLogLevel, stage: string, message: string) => void,
): ProducerLogger {
  const emit =
    (level: HyperframesLogLevel) =>
    (message: string, meta?: Record<string, unknown>) => {
      const metaText = meta && Object.keys(meta).length ? ` ${safeJson(meta)}` : "";
      onLog(level, "hyperframes", `${message}${metaText}`);
    };
  return {
    error: emit("error"),
    warn: emit("warn"),
    info: emit("info"),
    debug: () => {},
    isLevelEnabled: (level) => level !== "debug",
  };
}

function safeJson(value: unknown) {
  try {
    const text = JSON.stringify(value);
    return text.length > 300 ? `${text.slice(0, 300)}…` : text;
  } catch {
    return "";
  }
}

/**
 * RenderJob.progress 在流式渲染期间恒为 1，无法直接使用；
 * 用 framesRendered/totalFrames + 阶段权重推算真实进度：
 * 渲染 0→0.8，编码 0.8→0.95，合成 0.95→1。
 */
function estimateProgress(
  stage: string,
  framesRendered: number | null,
  totalFrames: number | null,
  fallback: number,
): number {
  const ratio =
    framesRendered !== null && totalFrames
      ? Math.max(0, Math.min(1, framesRendered / totalFrames))
      : null;

  if (stage === "render-frames" || stage === "rendering") {
    return ratio !== null ? ratio * 0.8 : Math.min(fallback, 0.05);
  }
  if (stage === "encoding") {
    return ratio !== null ? 0.8 + ratio * 0.15 : 0.8;
  }
  if (stage === "muxing") {
    return 0.95;
  }
  if (stage === "prepare") {
    return 0.02;
  }
  return Math.min(fallback, 0.99);
}

/**
 * 自动将客户端本地内置的前端动效库（如 GSAP）拷贝到 HyperFrames 工程目录的 vendor/ 下，
 * 让 HTML 合成可直接 `<script src="vendor/gsap.min.js"></script>`，零外网 CDN 依赖。
 */
function copyBundledVendorLibs(
  projectDir: string,
  onLog: (level: HyperframesLogLevel, stage: string, message: string) => void,
): void {
  const vendorDir = path.join(projectDir, "vendor");
  const targetGsap = path.join(vendorDir, "gsap.min.js");
  if (fs.existsSync(targetGsap)) return;

  const candidates: string[] = [];
  try {
    candidates.push(require.resolve("gsap/dist/gsap.min.js"));
  } catch {
    // ignore
  }
  candidates.push(
    path.resolve(process.cwd(), "node_modules/gsap/dist/gsap.min.js"),
    path.resolve(__dirname, "../../../../node_modules/gsap/dist/gsap.min.js"),
  );

  const source = candidates.find((p) => p && fs.existsSync(p));
  if (!source) {
    onLog("warn", "prepare", "未找到本地内置 gsap.min.js，跳过 vendor 挂载");
    return;
  }

  fs.mkdirSync(vendorDir, { recursive: true });
  fs.copyFileSync(source, targetGsap);
  onLog("info", "prepare", "本地内置动效库已就绪: vendor/gsap.min.js");
}

/**
 * 渲染一个 HyperFrames 合成（HTML 源码）为 MP4。
 * 取消通过 abortSignal；渲染成功时 outputLocation 已写入完成。
 */
export async function renderHyperframesJob(
  input: HyperframesRenderInput,
): Promise<void> {
  const {
    jobId,
    html,
    projectFiles,
    assets,
    variables,
    fps = 30,
    quality = "standard",
    outputLocation,
    workDir,
    browserExecutable,
    binariesDirectory,
    abortSignal,
    onProgress,
    onLog,
  } = input;

  const projectDir = path.join(workDir, jobId);
  fs.rmSync(projectDir, { recursive: true, force: true });
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, "index.html"),
    injectCaptureBeyondViewportFix(html),
    "utf8",
  );
  await materializeProjectFiles(
    projectDir,
    projectFiles,
    assets,
    abortSignal,
    onLog,
  );
  copyBundledVendorLibs(projectDir, onLog);
  fs.mkdirSync(path.dirname(outputLocation), { recursive: true });

  ensureHyperframesEncoderEnv(binariesDirectory);

  const { engine, core, producer } = await loadHyperframesDeps();

  const engineConfig: EngineConfig = {
    ...engine.DEFAULT_CONFIG,
    ...(browserExecutable ? { chromePath: browserExecutable } : {}),
    // 与 Remotion 渲染保持一致：CI / 无 GPU 环境下使用 SwiftShader 软件渲染
    browserGpuMode: "software",
  };

  const logger = buildProducerLogger(onLog);

  const request = producer.createRenderRequest({
    projectDir,
    outputPath: outputLocation,
    engineConfig,
    options: {
      fps: core.toFps(fps),
      quality,
      format: "mp4",
      ...(variables ? { variables } : {}),
    },
  });

  const config = producer.renderConfigFromRequest(request, { logger });
  const job = producer.createRenderJob(config);

  onLog(
    "info",
    "prepare",
    `HyperFrames 项目已就绪：${projectDir}，fps=${fps}，quality=${quality}`,
  );

  try {
    await producer.executeRenderJob(
      job,
      projectDir,
      outputLocation,
      (renderJob, message) => {
          const stage = mapHyperframesStage(
            renderJob.currentStage || renderJob.status,
          );
          const framesRendered =
            typeof renderJob.framesRendered === "number"
              ? renderJob.framesRendered
              : null;
          const totalFrames =
            typeof renderJob.totalFrames === "number"
              ? renderJob.totalFrames
              : null;
          onProgress({
            progress: estimateProgress(
              stage,
              framesRendered,
              totalFrames,
              Number(renderJob.progress) || 0,
            ),
            stage,
            message: String(message || renderJob.currentStage || "渲染中"),
            framesRendered,
            totalFrames,
          });
        },
      abortSignal,
    );
  } catch (error) {
    if (error instanceof producer.RenderCancelledError || abortSignal.aborted) {
      throw new Error("渲染已取消");
    }
    throw error;
  }

  if (!fs.existsSync(outputLocation)) {
    throw new Error(`HyperFrames 渲染结束但未产出文件：${outputLocation}`);
  }

  await probeHyperframesOutput(outputLocation, html, onLog);
}

async function probeHyperframesOutput(
  outputLocation: string,
  html: string,
  onLog: (level: HyperframesLogLevel, stage: string, message: string) => void,
): Promise<void> {
  const ffprobePath = process.env.HYPERFRAMES_FFPROBE_PATH;
  const sizeMB = (fs.statSync(outputLocation).size / 1024 / 1024).toFixed(2);
  if (!ffprobePath) {
    onLog("info", "completed", `成片已落盘（${sizeMB}MB），未检测到 ffprobe 跳过流质检`);
    return;
  }
  try {
    const { stdout } = await execFileAsync(
      ffprobePath,
      [
        "-v",
        "error",
        "-show_entries",
        "stream=codec_type,codec_name,width,height:format=duration",
        "-of",
        "json",
        outputLocation,
      ],
      { timeout: 10000 },
    );
    const parsed = JSON.parse(stdout || "{}") as {
      streams?: Array<{
        codec_type?: string;
        codec_name?: string;
        width?: number;
        height?: number;
      }>;
      format?: { duration?: string };
    };
    const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
    const video = streams.find((s) => s.codec_type === "video");
    const audio = streams.find((s) => s.codec_type === "audio");
    const duration = Number(parsed.format?.duration || 0).toFixed(2);
    const expectsAudio = /<audio\b/i.test(html);
    onLog(
      expectsAudio && !audio ? "warn" : "info",
      "completed",
      `成片质检：${video?.width || "?"}x${video?.height || "?"} ${duration}s ${sizeMB}MB，音轨=${audio ? audio.codec_name : "无"}`,
    );
    if (expectsAudio && !audio) {
      onLog(
        "warn",
        "completed",
        "警告：HTML 包含 <audio> 标签但输出 MP4 无音轨，请检查音频地址或 assets 路径",
      );
    }
  } catch (error) {
    onLog(
      "warn",
      "completed",
      `ffprobe 质检跳过：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
