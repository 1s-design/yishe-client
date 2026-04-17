// @ts-nocheck
import { bundle } from "@remotion/bundler";
import { app } from "electron";
import fs from "fs";
import path from "path";
import { makeRenderQueue, type VideoTemplateJobState } from "./render-queue";
import { publicTemplateCatalog, templateCatalog } from "./templates/registry";

type WorkspaceResolver = () => string;

let resolveWorkspaceDirectory: WorkspaceResolver = () => "";
let bundlePromise: Promise<string> | null = null;
let queueInstance: ReturnType<typeof makeRenderQueue> | null = null;

function configureVideoTemplate(options: { getWorkspaceDirectory?: WorkspaceResolver }) {
  if (typeof options?.getWorkspaceDirectory === "function") {
    resolveWorkspaceDirectory = options.getWorkspaceDirectory;
  }
}

function getVideoTemplateRootDirectory() {
  const configuredWorkspace = String(resolveWorkspaceDirectory?.() || "").trim();
  const baseDirectory =
    configuredWorkspace || path.join(app.getPath("userData"), "workspace");
  return path.join(baseDirectory, "video-template");
}

function ensureVideoTemplateDirectories() {
  const root = getVideoTemplateRootDirectory();
  const directories = {
    root,
    renders: path.join(root, "renders"),
    downloads: path.join(root, "downloads"),
    temp: path.join(root, "temp"),
    bundles: path.join(root, "bundles"),
  };

  for (const dir of Object.values(directories)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return directories;
}

function getVideoTemplateEntryPointCandidates() {
  const packagedCandidates = [
    // Prefer app.asar first so webpack can resolve dependencies from the same
    // bundled app tree in production.
    path.join(
      app.getAppPath(),
      "out",
      "video-template-source",
      "remotion",
      "index.ts",
    ),
    path.join(
      process.resourcesPath,
      "app.asar.unpacked",
      "out",
      "video-template-source",
      "remotion",
      "index.ts",
    ),
  ].filter((candidate, index, list) => list.indexOf(candidate) === index);

  const existingPackagedCandidates = packagedCandidates.filter((candidate) =>
    fs.existsSync(candidate),
  );
  if (existingPackagedCandidates.length) {
    return existingPackagedCandidates;
  }

  const devEntry = path.resolve(
    process.cwd(),
    "src",
    "main",
    "video-template",
    "remotion",
    "index.ts",
  );
  if (fs.existsSync(devEntry)) {
    return [devEntry];
  }

  throw new Error(
    [
      "[video-template] Entry point not found.",
      `Checked packaged paths: ${packagedCandidates.join(", ")}`,
      `Checked dev path: ${devEntry}`,
    ].join(" "),
  );
}

async function bundleVideoTemplateFromEntry(entryPoint: string, outputDirectory: string) {
  console.info(`[video-template] bundling from entry: ${entryPoint}`);
  return bundle({
    entryPoint,
    webpackOverride: (config) => {
      config.output = config.output || {};
      config.output.path = outputDirectory;
      return config;
    },
    onProgress(progress) {
      console.info(`[video-template] bundling: ${progress}%`);
    },
  });
}

function formatJob(jobId: string, job: VideoTemplateJobState | undefined | null) {
  if (!job) {
    return null;
  }

  const now = Date.now();
  const startedAt = job.startedAt ?? job.createdAt;
  const completedAt = "completedAt" in job ? (job.completedAt ?? null) : null;
  const elapsedMs = completedAt
    ? completedAt - (startedAt ?? completedAt)
    : startedAt
      ? now - startedAt
      : 0;

  const baseJob = {
    id: jobId,
    status: job.status,
    data: {
      templateId: String(job.data?.templateId || "").trim(),
      compositionId: String(job.data?.compositionId || "").trim(),
      inputProps:
        job.data?.inputProps &&
        typeof job.data.inputProps === "object" &&
        !Array.isArray(job.data.inputProps)
          ? { ...job.data.inputProps }
          : {},
    },
    createdAt: job.createdAt ?? now,
    startedAt: job.startedAt ?? null,
    completedAt,
    updatedAt: job.updatedAt ?? now,
    elapsedMs,
  };

  if (job.status === "queued") {
    return {
      ...baseJob,
      progress: null,
      videoUrl: null,
      localPath: null,
      error: null,
    };
  }

  if (job.status === "in-progress") {
    return {
      ...baseJob,
      progress: typeof job.progress === "number" ? job.progress : 0,
      videoUrl: null,
      localPath: null,
      error: null,
    };
  }

  if (job.status === "completed") {
    return {
      ...baseJob,
      progress: 1,
      videoUrl: String(job.videoUrl || "").trim() || null,
      localPath: String(job.localPath || "").trim() || null,
      error: null,
    };
  }

  return {
    ...baseJob,
    progress: null,
    videoUrl: null,
    localPath: null,
    error: {
      message: job.error?.message || String(job.error || "render_failed"),
    },
  };
}

async function ensureVideoTemplateServeUrl() {
  if (!bundlePromise) {
    bundlePromise = (async () => {
      const directories = ensureVideoTemplateDirectories();
      const entryCandidates = getVideoTemplateEntryPointCandidates();
      let lastError: unknown = null;

      for (const entryPoint of entryCandidates) {
        try {
          return await bundleVideoTemplateFromEntry(entryPoint, directories.bundles);
        } catch (error) {
          lastError = error;
          console.error(
            `[video-template] Failed to bundle entry ${entryPoint}:`,
            error,
          );
        }
      }

      throw lastError instanceof Error
        ? lastError
        : new Error("[video-template] Failed to bundle any entry candidate");
    })();
  }

  return bundlePromise;
}

async function ensureVideoTemplateQueue() {
  if (queueInstance) {
    return queueInstance;
  }

  const directories = ensureVideoTemplateDirectories();
  const serveUrl = await ensureVideoTemplateServeUrl();

  queueInstance = makeRenderQueue({
    serveUrl,
    rendersDir: directories.renders,
    browserExecutable: null,
    binariesDirectory: null,
  });

  return queueInstance;
}

function sanitizeInputProps(
  templateId: string,
  inputProps: Record<string, unknown> = {},
) {
  const template = templateCatalog.find((item) => item.id === templateId);
  if (!template) {
    throw new Error(`Template ${templateId} not found`);
  }

  const sanitizedInputProps = {
    ...template.defaultInputProps,
  } as Record<string, unknown>;

  for (const field of template.editableFields) {
    if (field in inputProps) {
      sanitizedInputProps[field] = inputProps[field];
    }
  }

  return {
    template,
    inputProps: sanitizedInputProps,
  };
}

async function getVideoTemplateStatus() {
  const directories = ensureVideoTemplateDirectories();
  const queue = await ensureVideoTemplateQueue();
  const jobs = Array.from(queue.jobs.entries()).map(([jobId, job]) =>
    formatJob(jobId, job),
  );
  const activeJobs = jobs.filter(
    (job) => job && (job.status === "queued" || job.status === "in-progress"),
  );

  return {
    success: true,
    service: "video-template",
    status: "ok",
    templateCount: publicTemplateCatalog.length,
    templates: publicTemplateCatalog,
    directories,
    queue: {
      total: jobs.length,
      activeCount: activeJobs.length,
      queuedCount: activeJobs.filter((job) => job?.status === "queued").length,
      processingCount: activeJobs.filter((job) => job?.status === "in-progress")
        .length,
      currentJob:
        activeJobs.find((job) => job?.status === "in-progress") ||
        activeJobs[0] ||
        null,
      jobs,
    },
  };
}

async function getVideoTemplateCatalog() {
  await ensureVideoTemplateQueue();
  return {
    success: true,
    templates: publicTemplateCatalog,
    total: publicTemplateCatalog.length,
  };
}

async function listVideoTemplateRenders() {
  const queue = await ensureVideoTemplateQueue();
  const jobs = Array.from(queue.jobs.entries())
    .map(([jobId, job]) => formatJob(jobId, job))
    .filter((job) => !!job);

  return {
    success: true,
    data: jobs,
  };
}

async function getVideoTemplateRender(jobId: string) {
  const queue = await ensureVideoTemplateQueue();
  const job = formatJob(jobId, queue.jobs.get(jobId));
  if (!job) {
    throw new Error(`Render job ${jobId} not found`);
  }

  return {
    success: true,
    data: job,
  };
}

async function enqueueVideoTemplateRender(payload: Record<string, any> = {}) {
  const templateId = String(payload.templateId || "").trim();
  if (!templateId) {
    throw new Error("templateId is required");
  }

  const queue = await ensureVideoTemplateQueue();
  const { template, inputProps } = sanitizeInputProps(
    templateId,
    payload.inputProps && typeof payload.inputProps === "object"
      ? payload.inputProps
      : {},
  );

  const jobId = queue.createJob({
    templateId,
    compositionId: template.compositionId,
    inputProps,
  });

  return {
    success: true,
    data: {
      jobId,
    },
  };
}

async function cancelVideoTemplateRender(jobId: string) {
  const queue = await ensureVideoTemplateQueue();
  const job = queue.jobs.get(jobId);
  if (!job) {
    throw new Error(`Render job ${jobId} not found`);
  }
  if (job.status !== "queued" && job.status !== "in-progress") {
    throw new Error("Job is not cancellable");
  }
  job.cancel();
  return {
    success: true,
    data: {
      jobId,
    },
  };
}

export {
  cancelVideoTemplateRender,
  configureVideoTemplate,
  enqueueVideoTemplateRender,
  getVideoTemplateCatalog,
  getVideoTemplateRender,
  getVideoTemplateStatus,
  listVideoTemplateRenders,
};
