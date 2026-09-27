import {
  makeCancelSignal,
  renderMedia,
  selectComposition,
  type BrowserLog,
} from "@remotion/renderer";
import { randomUUID } from "node:crypto";
import path from "node:path";
import ts from "typescript";
import type { RemotionChromeMode } from "./remotion-browser";

export interface VideoTemplateJobData {
  templateId: string;
  compositionId: string;
  inputProps: Record<string, unknown>;
}

export type VideoTemplateServeUrlResolver = (
  jobData: VideoTemplateJobData,
) => string | Promise<string>;

export interface VideoTemplateJobLogEntry {
  timestamp: number;
  level: "info" | "warn" | "error";
  stage: string | null;
  message: string;
}

export interface VideoTemplateJobProgressDetails {
  renderedFrames: number;
  encodedFrames: number;
  stitchStage: "encoding" | "muxing";
  renderEstimatedTime: number;
  renderedDoneIn: number | null;
  encodedDoneIn: number | null;
}

interface VideoTemplateJobShared {
  stage?: string | null;
  message?: string | null;
  lastHeartbeatAt?: number | null;
  logs?: VideoTemplateJobLogEntry[];
  progressDetails?: VideoTemplateJobProgressDetails | null;
  timeoutMs?: number | null;
}

export type VideoTemplateJobState =
  | {
      status: "queued";
      data: VideoTemplateJobData;
      createdAt: number;
      updatedAt: number;
      cancel: () => void;
      startedAt?: number;
      completedAt?: number;
    } & VideoTemplateJobShared
  | {
      status: "in-progress";
      progress: number;
      data: VideoTemplateJobData;
      createdAt: number;
      startedAt: number;
      updatedAt: number;
      cancel: () => void;
      completedAt?: number;
    } & VideoTemplateJobShared
  | {
      status: "completed";
      videoUrl: string;
      localPath: string;
      data: VideoTemplateJobData;
      createdAt: number;
      startedAt: number;
      completedAt: number;
      updatedAt: number;
    } & VideoTemplateJobShared
  | {
      status: "failed";
      error: Error;
      data: VideoTemplateJobData;
      createdAt: number;
      startedAt?: number;
      completedAt: number;
      updatedAt: number;
    } & VideoTemplateJobShared;

function resolveRenderTimeout(inputProps: Record<string, unknown>) {
  const defaultTimeoutMs = Number(process.env.REMOTION_TIMEOUT_MS || process.env.RENDER_TIMEOUT_MS) || 300_000;
  const audioDuration = Number(inputProps.audioDuration ?? 0);
  const timeoutFromAudio =
    audioDuration > 0 ? Math.round(audioDuration * 1000 + 30_000) : 0;
  return Math.max(defaultTimeoutMs, timeoutFromAudio || 0);
}

function resolveProgressLogIntervalMs() {
  return Number(process.env.RENDER_PROGRESS_LOG_INTERVAL_MS) || 15_000;
}

function resolveProgressLogStep() {
  const configuredStep = Number(process.env.RENDER_PROGRESS_LOG_STEP_PERCENT);
  if (!Number.isFinite(configuredStep) || configuredStep <= 0) {
    return 10;
  }

  return Math.max(1, Math.round(configuredStep));
}

function resolveRenderConcurrency() {
  const configuredConcurrency = Number(process.env.REMOTION_RENDER_CONCURRENCY);
  if (!Number.isFinite(configuredConcurrency) || configuredConcurrency <= 0) {
    return 1;
  }

  return Math.max(1, Math.round(configuredConcurrency));
}

function clampProgress(progress: number) {
  if (!Number.isFinite(progress)) {
    return 0;
  }

  return Math.max(0, Math.min(1, progress));
}

function createLogEntry(
  level: "info" | "warn" | "error",
  stage: string | null | undefined,
  message: string,
): VideoTemplateJobLogEntry {
  return {
    timestamp: Date.now(),
    level,
    stage: stage ? String(stage) : null,
    message: String(message || "").trim(),
  };
}

function formatErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error || "render_failed");
}

function appendJobLog(
  previousLogs: VideoTemplateJobLogEntry[] | undefined,
  entry: VideoTemplateJobLogEntry | null,
) {
  const logs = Array.isArray(previousLogs) ? [...previousLogs] : [];
  if (!entry || !entry.message) {
    return logs;
  }

  logs.push(entry);
  return logs.slice(-50);
}

function formatBrowserLog(log: BrowserLog) {
  const type = String(log.type || "log").trim() || "log";
  const text = String(log.text || "").trim();
  const location = Array.isArray(log.stackTrace) && log.stackTrace[0]
    ? [
        log.stackTrace[0].url,
        log.stackTrace[0].lineNumber,
        log.stackTrace[0].columnNumber,
      ]
        .filter((item) => item !== undefined && item !== null && item !== "")
        .join(":")
    : "";

  return `[browser:${type}] ${text}${location ? ` (${location})` : ""}`;
}

function withDiagnostics<T extends VideoTemplateJobState>(
  previousJob: VideoTemplateJobState | undefined,
  nextJob: T,
  diagnostics?: {
    stage?: string | null;
    message?: string | null;
    logLevel?: "info" | "warn" | "error";
    logMessage?: string | null;
    progressDetails?: VideoTemplateJobProgressDetails | null;
    timeoutMs?: number | null;
    heartbeatAt?: number | null;
  },
): T {
  const heartbeatAt =
    diagnostics && Object.prototype.hasOwnProperty.call(diagnostics, "heartbeatAt")
      ? diagnostics.heartbeatAt ?? null
      : Date.now();
  const stage =
    diagnostics && Object.prototype.hasOwnProperty.call(diagnostics, "stage")
      ? diagnostics.stage ?? null
      : previousJob?.stage ?? null;
  const message =
    diagnostics && Object.prototype.hasOwnProperty.call(diagnostics, "message")
      ? diagnostics.message ?? null
      : previousJob?.message ?? null;
  const progressDetails =
    diagnostics && Object.prototype.hasOwnProperty.call(diagnostics, "progressDetails")
      ? diagnostics.progressDetails ?? null
      : previousJob?.progressDetails ?? null;
  const timeoutMs =
    diagnostics && Object.prototype.hasOwnProperty.call(diagnostics, "timeoutMs")
      ? diagnostics.timeoutMs ?? null
      : previousJob?.timeoutMs ?? null;
  const logs = appendJobLog(
    previousJob?.logs,
    diagnostics?.logMessage
      ? createLogEntry(
          diagnostics.logLevel || "info",
          stage,
          diagnostics.logMessage,
        )
      : null,
  );

  return {
    ...nextJob,
    stage,
    message,
    lastHeartbeatAt: heartbeatAt,
    logs,
    progressDetails,
    timeoutMs,
  };
}

function renderProgressMessage(
  progress: VideoTemplateJobProgressDetails,
  totalFrames: number,
) {
  const renderedFrames = Math.max(0, Number(progress.renderedFrames) || 0);
  const encodedFrames = Math.max(0, Number(progress.encodedFrames) || 0);
  const safeTotalFrames = Math.max(0, Number(totalFrames) || 0);
  const estimatedSeconds =
    progress.renderEstimatedTime > 0
      ? Math.max(1, Math.round(progress.renderEstimatedTime / 1000))
      : null;

  if (progress.stitchStage === "muxing") {
    return estimatedSeconds
      ? `正在合成音视频，预计剩余 ${estimatedSeconds}s`
      : "正在合成音视频";
  }

  if (safeTotalFrames > 0 && renderedFrames < safeTotalFrames) {
    return estimatedSeconds
      ? `正在渲染帧 ${renderedFrames}/${safeTotalFrames}，预计剩余 ${estimatedSeconds}s`
      : `正在渲染帧 ${renderedFrames}/${safeTotalFrames}`;
  }

  if (safeTotalFrames > 0) {
    return estimatedSeconds
      ? `正在编码视频 ${encodedFrames}/${safeTotalFrames}，预计剩余 ${estimatedSeconds}s`
      : `正在编码视频 ${encodedFrames}/${safeTotalFrames}`;
  }

  return "本地渲染中";
}

export function makeRenderQueue({
  resolveServeUrl,
  rendersDir,
  browserExecutable,
  binariesDirectory,
  chromeMode,
}: {
  resolveServeUrl: VideoTemplateServeUrlResolver;
  rendersDir: string;
  browserExecutable: string | null;
  binariesDirectory: string | null;
  chromeMode: RemotionChromeMode;
}) {
  const jobs = new Map<string, VideoTemplateJobState>();
  let queue: Promise<unknown> = Promise.resolve();

  const processRender = async (jobId: string) => {
    const job = jobs.get(jobId);
    if (!job) {
      throw new Error(`Render job ${jobId} not found`);
    }

    const { cancel, cancelSignal } = makeCancelSignal();
    const startedAt = Date.now();
    const timeoutMs = resolveRenderTimeout(job.data.inputProps);
    const progressLogIntervalMs = resolveProgressLogIntervalMs();
    const progressLogStep = resolveProgressLogStep();
    const renderConcurrency = resolveRenderConcurrency();
    let lastLoggedProgressBucket = -1;
    let lastLoggedStage: string | null = null;
    let lastLoggedAt = 0;

    const setJob = (
      nextJob: VideoTemplateJobState,
      diagnostics?: Parameters<typeof withDiagnostics<VideoTemplateJobState>>[2],
    ) => {
      const previous = jobs.get(jobId);
      const nextWithDiagnostics = withDiagnostics(previous, nextJob, diagnostics);
      jobs.set(jobId, nextWithDiagnostics);

      if (diagnostics?.logMessage) {
        const logPrefix = `[video-template:${jobId}]`;
        const stagePrefix = nextWithDiagnostics.stage
          ? `[${nextWithDiagnostics.stage}] `
          : "";
        const logMessage = `${logPrefix} ${stagePrefix}${diagnostics.logMessage}`;
        if (diagnostics.logLevel === "warn") {
          console.warn(logMessage);
        } else if (diagnostics.logLevel === "error") {
          console.error(logMessage);
        } else {
          console.info(logMessage);
        }
      }
    };
    const appendRuntimeLog = (
      level: "info" | "warn" | "error",
      stage: string,
      message: string,
    ) => {
      const currentJob = jobs.get(jobId);
      if (!currentJob) {
        return;
      }

      jobs.set(jobId, {
        ...currentJob,
        updatedAt: Date.now(),
        logs: appendJobLog(
          currentJob.logs,
          createLogEntry(level, stage, message),
        ),
        lastHeartbeatAt: Date.now(),
      } as VideoTemplateJobState);

      const logMessage = `[video-template:${jobId}] [${stage}] ${message}`;
      if (level === "error") {
        console.error(logMessage);
      } else if (level === "warn") {
        console.warn(logMessage);
      } else {
        console.info(logMessage);
      }
    };
    const onBrowserLog = (log: BrowserLog) => {
      const message = formatBrowserLog(log);
      const level = log.type === "error" ? "error" : log.type === "warning" ? "warn" : "info";
      appendRuntimeLog(level, "browser", message);
    };

    setJob(
      {
        progress: 0,
        status: "in-progress",
        cancel,
        data: job.data,
        createdAt: job.createdAt,
        startedAt,
        updatedAt: startedAt,
      },
      {
        stage: "prepare-bundle",
        message: "正在准备 Remotion bundle",
        timeoutMs,
        logLevel: "info",
        logMessage: `任务进入渲染队列，准备 Remotion bundle，超时阈值 ${timeoutMs}ms`,
      },
    );

function precompileTsxLayers(inputProps: Record<string, unknown>): Record<string, unknown> {
  try {
    const config = (inputProps?.videoConfig || {}) as Record<string, unknown>;
    const scenes = Array.isArray(config?.scenes) ? config.scenes : [];
    for (const scene of scenes) {
      if (Array.isArray(scene?.layers)) {
        for (const layer of scene.layers) {
          if (
            (layer?.type === "custom-code" || layer?.type === "tsx-component") &&
            typeof layer?.code === "string" &&
            layer.code.trim()
          ) {
            try {
              const transpiled = ts.transpileModule(layer.code, {
                compilerOptions: {
                  jsx: ts.JsxEmit.React,
                  target: ts.ScriptTarget.ES2020,
                  module: ts.ModuleKind.CommonJS,
                  esModuleInterop: true,
                },
              }).outputText;
              layer.code = transpiled;
            } catch (err: any) {
              console.warn("[TSX Precompile] Failed to transpile layer code:", err?.message);
            }
          }
        }
      }
    }
  } catch (e) {
    // Ignore error
  }
  return inputProps;
}

async function probeUrl(url: string, mode: "HEAD" | "RANGE"): Promise<Response | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3500);
  try {
    const res =
      mode === "HEAD"
        ? await fetch(url, { method: "HEAD", signal: controller.signal })
        : await fetch(url, {
            method: "GET",
            headers: { Range: "bytes=0-100" },
            signal: controller.signal,
          });
    return res;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function isUrlReachable(url: string): Promise<boolean> {
  const head = await probeUrl(url, "HEAD");
  if (head && head.ok) return true;
  // HEAD 不可用/失败时降级 Range GET；404/4xx/5xx 或网络失败均视为不可达
  const range = await probeUrl(url, "RANGE");
  return !!(range && range.ok);
}

async function sanitizeAndValidateInputMedia(inputProps: Record<string, any>): Promise<Record<string, any>> {
  if (!inputProps || typeof inputProps !== "object") return inputProps;
  const videoConfig = inputProps.videoConfig;
  if (!videoConfig || typeof videoConfig !== "object") return inputProps;

  // 1. 预检 BGM 音频可达性，防止 Remotion Html5Audio 在 404/不可达 URL 上产生 delayRender 死锁
  const bgmUrl = videoConfig.audio?.bgmUrl;
  if (bgmUrl && typeof bgmUrl === "string" && bgmUrl.startsWith("http")) {
    const ok = await isUrlReachable(bgmUrl);
    if (!ok) {
      console.warn(`[video-template] BGM URL 无法访问: ${bgmUrl}，已安全剥离以防 Remotion delayRender 死锁`);
      delete videoConfig.audio.bgmUrl;
    }
  }

  // 2. 预检图层/背景中的图片与视频 URL，死链会导致 <Img>/<OffthreadVideo> 直接抛错使整片失败
  const deadMediaSrcs: string[] = [];
  const mediaUrlRe = /^https?:\/\//i;

  const collectMediaUrls = (node: any, bag: Set<string>) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) collectMediaUrls(item, bag);
      return;
    }
    if (node.media && typeof node.media === "object" && typeof node.media.src === "string") {
      if (mediaUrlRe.test(node.media.src)) bag.add(node.media.src);
    }
    if (node.before && typeof node.before === "object" && typeof node.before.src === "string" && mediaUrlRe.test(node.before.src)) {
      bag.add(node.before.src);
    }
    if (node.after && typeof node.after === "object" && typeof node.after.src === "string" && mediaUrlRe.test(node.after.src)) {
      bag.add(node.after.src);
    }
    if (Array.isArray(node.images)) {
      for (const img of node.images) {
        if (img && typeof img.src === "string" && mediaUrlRe.test(img.src)) bag.add(img.src);
      }
    }
    if (typeof node.src === "string" && mediaUrlRe.test(node.src) && (node.type === "image" || node.type === "video" || node.type === "logo-reveal")) {
      bag.add(node.src);
    }
    for (const v of Object.values(node)) {
      if (v && typeof v === "object") collectMediaUrls(v, bag);
    }
  };

  const mediaUrls = new Set<string>();
  collectMediaUrls(videoConfig.scenes, mediaUrls);
  if (videoConfig.scenes) {
    for (const scene of videoConfig.scenes) {
      const bg = scene?.background;
      if (bg && bg.type === "media" && bg.media?.src && mediaUrlRe.test(bg.media.src)) {
        mediaUrls.add(bg.media.src);
      }
    }
  }

  for (const url of mediaUrls) {
    const ok = await isUrlReachable(url);
    if (!ok) {
      deadMediaSrcs.push(url);
      console.warn(`[video-template] 媒体 URL 无法访问: ${url}，将从场景中剥离以防渲染失败`);
    }
  }

  if (deadMediaSrcs.length > 0) {
    const dead = new Set(deadMediaSrcs);
    // 1x1 透明 PNG，保证 <Img> 可加载且不破坏排版
    const PLACEHOLDER =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";

    const stripDead = (node: any): any => {
      if (!node || typeof node !== "object") return node;
      if (Array.isArray(node)) {
        return node.map(stripDead).filter((item) => {
          if (item && typeof item === "object") {
            // 纯媒体图层死链 → 整层移除
            if (item.media?.src && dead.has(item.media.src) && !item.text && !item.headline && !item.code) {
              return false;
            }
            if (Array.isArray(item.images)) {
              item.images = item.images.map((img: any) =>
                img?.src && dead.has(img.src) ? { ...img, src: PLACEHOLDER, alt: "media-unavailable" } : img,
              );
              if (item.images.length === 0 && item.type === "image-grid") return false;
            }
            if (item.before?.src && dead.has(item.before.src)) item.before.src = PLACEHOLDER;
            if (item.after?.src && dead.has(item.after.src)) item.after.src = PLACEHOLDER;
            if (item.src && dead.has(item.src) && item.type === "logo-reveal") {
              item.src = PLACEHOLDER;
            }
          }
          return true;
        });
      }
      for (const [k, v] of Object.entries(node)) {
        if (k === "media" && v && typeof v === "object" && dead.has((v as any).src)) {
          (node as any).media = { ...(v as any), src: PLACEHOLDER, alt: "media-unavailable" };
          continue;
        }
        if (k === "background" && v && typeof v === "object" && (v as any).type === "media" && dead.has((v as any).media?.src)) {
          (node as any).background = { type: "gradient" };
          continue;
        }
        node[k] = stripDead(v);
      }
      return node;
    };
    videoConfig.scenes = stripDead(videoConfig.scenes);
  }

  return inputProps;
}

    try {
      const transpiledProps = precompileTsxLayers(job.data.inputProps);
      const inputProps = await sanitizeAndValidateInputMedia(transpiledProps);
      const serveUrl = await resolveServeUrl(job.data);
      setJob(
        {
          progress: 0,
          status: "in-progress",
          cancel,
          data: job.data,
          createdAt: job.createdAt,
          startedAt,
          updatedAt: Date.now(),
        },
        {
          stage: "select-composition",
          message: "正在解析合成配置",
          timeoutMs,
          logLevel: "info",
          logMessage: `Remotion bundle 已就绪：${serveUrl}`,
        },
      );
      const composition = await selectComposition({
        serveUrl,
        id: job.data.compositionId,
        inputProps,
        browserExecutable,
        binariesDirectory,
        chromeMode,
        chromiumOptions: {
          disableWebSecurity: true,
          ignoreCertificateErrors: true,
          gl: "swiftshader",
        },
        onBrowserLog,
        logLevel: "verbose",
        timeoutInMilliseconds: timeoutMs,
      });
      const totalFrames = Math.max(0, Number(composition.durationInFrames) || 0);

      setJob(
        {
          progress: 0,
          status: "in-progress",
          cancel,
          data: job.data,
          createdAt: job.createdAt,
          startedAt,
          updatedAt: Date.now(),
        },
        {
          stage: "render-media",
          message: `合成配置已就绪，共 ${totalFrames} 帧`,
          timeoutMs,
          logLevel: "info",
          logMessage: `合成配置解析完成：${composition.width}x${composition.height} @ ${composition.fps}fps，共 ${totalFrames} 帧`,
        },
      );

      const outputLocation = path.join(rendersDir, `${jobId}.mp4`);

      await renderMedia({
        cancelSignal,
        serveUrl,
        composition,
        inputProps,
        codec: "h264",
        outputLocation,
        browserExecutable,
        binariesDirectory,
        chromeMode,
        concurrency: renderConcurrency,
        chromiumOptions: {
          disableWebSecurity: true,
          ignoreCertificateErrors: true,
          gl: "swiftshader",
        },
        hardwareAcceleration: "disable",
        onBrowserLog,
        logLevel: "verbose",
        timeoutInMilliseconds: resolveRenderTimeout(inputProps),
        onStart: () => {
          setJob(
            {
              progress: 0,
              status: "in-progress",
              cancel,
              data: job.data,
              createdAt: job.createdAt,
              startedAt,
              updatedAt: Date.now(),
            },
            {
              stage: "render-frames",
              message:
                totalFrames > 0
                  ? `开始渲染，共 ${totalFrames} 帧`
                  : "开始渲染视频",
              timeoutMs,
              logLevel: "info",
              logMessage:
                totalFrames > 0
                  ? `开始调用 Remotion 渲染，共 ${totalFrames} 帧，并发 ${renderConcurrency}`
                  : `开始调用 Remotion 渲染，并发 ${renderConcurrency}`,
            },
          );
        },
        onProgress: (progress) => {
          const updatedAt = Date.now();
          const normalizedProgress = clampProgress(progress.progress);
          const stage =
            progress.stitchStage === "muxing"
              ? "muxing"
              : progress.renderedFrames < totalFrames
                ? "render-frames"
                : "encoding";
          const progressDetails: VideoTemplateJobProgressDetails = {
            renderedFrames: Math.max(0, Number(progress.renderedFrames) || 0),
            encodedFrames: Math.max(0, Number(progress.encodedFrames) || 0),
            stitchStage: progress.stitchStage,
            renderEstimatedTime: Math.max(
              0,
              Number(progress.renderEstimatedTime) || 0,
            ),
            renderedDoneIn:
              typeof progress.renderedDoneIn === "number"
                ? progress.renderedDoneIn
                : null,
            encodedDoneIn:
              typeof progress.encodedDoneIn === "number"
                ? progress.encodedDoneIn
                : null,
          };
          const message = renderProgressMessage(progressDetails, totalFrames);
          const progressBucket = Math.floor(normalizedProgress * 100 / progressLogStep);
          const shouldLogProgress =
            stage !== lastLoggedStage ||
            progressBucket > lastLoggedProgressBucket ||
            updatedAt - lastLoggedAt >= progressLogIntervalMs;

          if (shouldLogProgress) {
            lastLoggedStage = stage;
            lastLoggedProgressBucket = progressBucket;
            lastLoggedAt = updatedAt;
          }

          setJob(
            {
              progress: normalizedProgress,
              status: "in-progress",
              cancel,
              data: job.data,
              createdAt: job.createdAt,
              startedAt,
              updatedAt,
            },
            {
              stage,
              message,
              progressDetails,
              timeoutMs,
              logLevel: "info",
              logMessage: shouldLogProgress
                ? `${message}，总进度 ${Math.round(normalizedProgress * 100)}%`
                : null,
            },
          );
        },
      });

      const completedAt = Date.now();
      setJob(
        {
          status: "completed",
          videoUrl: outputLocation,
          localPath: outputLocation,
          data: job.data,
          createdAt: job.createdAt,
          startedAt,
          completedAt,
          updatedAt: completedAt,
        },
        {
          stage: "completed",
          message: "视频渲染完成",
          timeoutMs,
          logLevel: "info",
          logMessage: `视频渲染完成，输出文件 ${outputLocation}`,
        },
      );
    } catch (error) {
      const completedAt = Date.now();
      setJob(
        {
          status: "failed",
          error: error as Error,
          data: job.data,
          createdAt: job.createdAt,
          startedAt,
          completedAt,
          updatedAt: completedAt,
        },
        {
          stage: "failed",
          message: formatErrorMessage(error),
          timeoutMs,
          logLevel: "error",
          logMessage: `视频渲染失败：${formatErrorMessage(error)}`,
        },
      );
    }
  };

  const queueRender = async ({
    jobId,
    data,
  }: {
    jobId: string;
    data: VideoTemplateJobData;
  }) => {
    const createdAt = Date.now();
    jobs.set(
      jobId,
      withDiagnostics(
        undefined,
        {
          status: "queued",
          data,
          createdAt,
          updatedAt: createdAt,
          cancel: () => {
            jobs.delete(jobId);
          },
        },
        {
          stage: "queued",
          message: "任务已入队，等待执行",
          logLevel: "info",
          logMessage: "任务已加入本地渲染队列",
        },
      ),
    );

    queue = queue.then(() => processRender(jobId));
  };

  return {
    jobs,
    createJob(data: VideoTemplateJobData) {
      const jobId = randomUUID();
      void queueRender({ jobId, data });
      return jobId;
    },
  };
}
