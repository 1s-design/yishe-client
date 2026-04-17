import { makeCancelSignal, renderMedia, selectComposition } from "@remotion/renderer";
import { randomUUID } from "node:crypto";
import path from "node:path";

export interface VideoTemplateJobData {
  templateId: string;
  compositionId: string;
  inputProps: Record<string, unknown>;
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
    }
  | {
      status: "in-progress";
      progress: number;
      data: VideoTemplateJobData;
      createdAt: number;
      startedAt: number;
      updatedAt: number;
      cancel: () => void;
      completedAt?: number;
    }
  | {
      status: "completed";
      videoUrl: string;
      localPath: string;
      data: VideoTemplateJobData;
      createdAt: number;
      startedAt: number;
      completedAt: number;
      updatedAt: number;
    }
  | {
      status: "failed";
      error: Error;
      data: VideoTemplateJobData;
      createdAt: number;
      startedAt?: number;
      completedAt: number;
      updatedAt: number;
    };

function resolveRenderTimeout(inputProps: Record<string, unknown>) {
  const defaultTimeoutMs = Number(process.env.RENDER_TIMEOUT_MS) || 120_000;
  const audioDuration = Number(inputProps.audioDuration ?? 0);
  const timeoutFromAudio =
    audioDuration > 0 ? Math.round(audioDuration * 1000 + 30_000) : 0;
  return Math.max(defaultTimeoutMs, timeoutFromAudio || 0);
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

    jobs.set(jobId, {
      progress: 0,
      status: "in-progress",
      cancel,
      data: job.data,
      createdAt: job.createdAt,
      startedAt,
      updatedAt: startedAt,
    });

    try {
      const inputProps = job.data.inputProps;
      const composition = await selectComposition({
        serveUrl,
        id: job.data.compositionId,
        inputProps,
        browserExecutable,
        binariesDirectory,
      });

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
        onProgress: (progress) => {
          const updatedAt = Date.now();
          jobs.set(jobId, {
            progress: progress.progress,
            status: "in-progress",
            cancel,
            data: job.data,
            createdAt: job.createdAt,
            startedAt,
            updatedAt,
          });
        },
        outputLocation,
      });

      const completedAt = Date.now();
      jobs.set(jobId, {
        status: "completed",
        videoUrl: outputLocation,
        localPath: outputLocation,
        data: job.data,
        createdAt: job.createdAt,
        startedAt,
        completedAt,
        updatedAt: completedAt,
      });
    } catch (error) {
      const completedAt = Date.now();
      jobs.set(jobId, {
        status: "failed",
        error: error as Error,
        data: job.data,
        createdAt: job.createdAt,
        startedAt,
        completedAt,
        updatedAt: completedAt,
      });
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
    jobs.set(jobId, {
      status: "queued",
      data,
      createdAt,
      updatedAt: createdAt,
      cancel: () => {
        jobs.delete(jobId);
      },
    });

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
