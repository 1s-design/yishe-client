import { makeCancelSignal, renderMedia, selectComposition } from "@remotion/renderer";
import { randomUUID } from "node:crypto";
import path from "node:path";

export interface VideoTemplateJobData {
  templateId: string;
  compositionId: string;
  inputProps: Record<string, unknown>;
}

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
  const defaultTimeoutMs = Number(process.env.RENDER_TIMEOUT_MS) || 120_000;
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
  serveUrl,
  rendersDir,
  browserExecutable,
  binariesDirectory,
}: {
  serveUrl: string;
  rendersDir: string;
  browserExecutable: string | null;
  binariesDirectory: string | null;
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
        stage: "select-composition",
        message: "正在准备渲染环境",
        timeoutMs,
        logLevel: "info",
        logMessage: `任务进入渲染队列，准备解析合成配置，超时阈值 ${timeoutMs}ms`,
      },
    );

    try {
      const inputProps = job.data.inputProps;
      const composition = await selectComposition({
        serveUrl,
        id: job.data.compositionId,
        inputProps,
        browserExecutable,
        binariesDirectory,
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
        browserExecutable,
        binariesDirectory,
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
                  ? `开始调用 Remotion 渲染，共 ${totalFrames} 帧`
                  : "开始调用 Remotion 渲染",
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
        outputLocation,
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
