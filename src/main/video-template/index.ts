// @ts-nocheck
import { bundle } from "@remotion/bundler";
import { app } from "electron";
import fs from "fs";
import path from "path";
import { makeRenderQueue, type VideoTemplateJobState } from "./render-queue";
import { publicTemplateCatalog, templateCatalog } from "./templates/registry";

type WorkspaceResolver = () => string;
type VideoTemplateQueue = ReturnType<typeof makeRenderQueue>;

let resolveWorkspaceDirectory: WorkspaceResolver = () => "";
let bundlePromise: Promise<string> | null = null;
let queueWarmupPromise: Promise<VideoTemplateQueue> | null = null;
let queueInstance: VideoTemplateQueue | null = null;

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
    bundlerRoot: path.join(root, "bundler-root"),
  };

  for (const dir of Object.values(directories)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return directories;
}

function getRemotionBinaryFileNames() {
  if (process.platform === "win32") {
    return {
      compositor: "remotion.exe",
      ffmpeg: "ffmpeg.exe",
      ffprobe: "ffprobe.exe",
    };
  }

  return {
    compositor: "remotion",
    ffmpeg: "ffmpeg",
    ffprobe: "ffprobe",
  };
}

function getRemotionPackageDirectoryName() {
  if (process.platform === "win32" && process.arch === "x64") {
    return "compositor-win32-x64-msvc";
  }

  if (process.platform === "darwin" && process.arch === "arm64") {
    return "compositor-darwin-arm64";
  }

  if (process.platform === "darwin" && process.arch === "x64") {
    return "compositor-darwin-x64";
  }

  if (process.platform === "linux" && process.arch === "x64") {
    return "compositor-linux-x64-gnu";
  }

  if (process.platform === "linux" && process.arch === "arm64") {
    return "compositor-linux-arm64-gnu";
  }

  return null;
}

function isCompleteRemotionBinariesDirectory(directory: string) {
  const binaries = getRemotionBinaryFileNames();
  return (
    fs.existsSync(path.join(directory, binaries.compositor)) &&
    fs.existsSync(path.join(directory, binaries.ffmpeg)) &&
    fs.existsSync(path.join(directory, binaries.ffprobe))
  );
}

function getRemotionBinariesDirectoryCandidates() {
  const packageDirName = getRemotionPackageDirectoryName();
  if (!packageDirName) {
    return [];
  }

  const packageRelativePath = path.join(
    "node_modules",
    "@remotion",
    packageDirName,
  );
  const resourceRelativePath = path.join("resources", "remotion", packageDirName);
  const appPath = app.getAppPath();
  const appAsarUnpackedPath = appPath.replace(/app\.asar$/, "app.asar.unpacked");

  return [
    path.join(process.resourcesPath, resourceRelativePath),
    path.join(process.resourcesPath, "remotion", packageDirName),
    path.join(process.resourcesPath, "app.asar.unpacked", resourceRelativePath),
    path.join(process.resourcesPath, "app.asar.unpacked", packageRelativePath),
    path.join(process.resourcesPath, packageRelativePath),
    path.join(appAsarUnpackedPath, resourceRelativePath),
    path.join(appAsarUnpackedPath, packageRelativePath),
    path.join(appPath, packageRelativePath),
    path.resolve(process.cwd(), packageRelativePath),
  ].filter((candidate, index, list) => list.indexOf(candidate) === index);
}

function resolveRemotionBinariesDirectory() {
  for (const candidate of getRemotionBinariesDirectoryCandidates()) {
    if (isCompleteRemotionBinariesDirectory(candidate)) {
      return candidate;
    }
  }

  return null;
}

function getVideoTemplateEntryPointCandidates() {
  const packagedCandidates = [
    path.join(
      process.resourcesPath,
      "app.asar.unpacked",
      "out",
      "video-template-source",
      "remotion",
      "index.ts",
    ),
    path.join(
      process.resourcesPath,
      "out",
      "video-template-source",
      "remotion",
      "index.ts",
    ),
    path.join(
      app.getAppPath(),
      "out",
      "video-template-source",
      "remotion",
      "index.ts",
    ),
    path.join(
      path.dirname(app.getAppPath()),
      "app.asar.unpacked",
      "out",
      "video-template-source",
      "remotion",
      "index.ts",
    ),
    path.join(__dirname, "../../video-template-source/remotion/index.ts"),
    path.join(__dirname, "../video-template-source/remotion/index.ts"),
  ].filter((candidate, index, list) => list.indexOf(candidate) === index);

  const existingPackagedCandidates = app.isPackaged
    ? packagedCandidates.filter((candidate) => fs.existsSync(candidate))
    : [];
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

function getVideoTemplateBundleCandidates() {
  return [
    path.join(
      process.resourcesPath,
      "app.asar.unpacked",
      "out",
      "video-template-bundle",
    ),
    path.join(
      process.resourcesPath,
      "out",
      "video-template-bundle",
    ),
    path.join(
      app.getAppPath(),
      "out",
      "video-template-bundle",
    ),
    path.join(
      path.dirname(app.getAppPath()),
      "app.asar.unpacked",
      "out",
      "video-template-bundle",
    ),
    path.join(__dirname, "../../video-template-bundle"),
    path.join(__dirname, "../video-template-bundle"),
  ].filter((candidate, index, list) => list.indexOf(candidate) === index);
}

function resolvePrebuiltVideoTemplateBundle() {
  if (!app.isPackaged) {
    return null;
  }

  for (const candidate of getVideoTemplateBundleCandidates()) {
    if (fs.existsSync(path.join(candidate, "index.html"))) {
      return candidate;
    }
  }

  return null;
}

async function bundleVideoTemplateFromEntry(entryPoint: string, outputDirectory: string) {
  // 打包版运行在只读应用目录附近时，Remotion 的 webpack 缓存和工作根目录
  // 不能再落到安装目录，否则容易因为权限导致预热失败。
  const bundlerRoot = app.isPackaged
    ? ensureVideoTemplateDirectories().bundlerRoot
    : undefined;

  console.info(`[video-template] bundling from entry: ${entryPoint}`);
  if (bundlerRoot) {
    console.info(`[video-template] using packaged bundler root: ${bundlerRoot}`);
  }

  return bundle({
    entryPoint,
    rootDir: bundlerRoot,
    enableCaching: !app.isPackaged,
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
  const prebuiltBundle = resolvePrebuiltVideoTemplateBundle();
  if (prebuiltBundle) {
    console.info(`[video-template] using prebuilt bundle: ${prebuiltBundle}`);
    return prebuiltBundle;
  }

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
    })().catch((error) => {
      bundlePromise = null;
      throw error;
    });
  }

  return bundlePromise;
}

async function warmVideoTemplateService() {
  if (queueInstance) {
    return queueInstance;
  }

  if (!queueWarmupPromise) {
    queueWarmupPromise = (async () => {
      const directories = ensureVideoTemplateDirectories();
      const serveUrl = await ensureVideoTemplateServeUrl();
      const binariesDirectory = resolveRemotionBinariesDirectory();

      if (binariesDirectory) {
        console.info(
          `[video-template] using remotion binaries: ${binariesDirectory}`,
        );
      } else if (app.isPackaged) {
        console.warn(
          "[video-template] packaged build could not resolve remotion binaries directory; falling back to renderer defaults",
        );
      }

      const queue = makeRenderQueue({
        serveUrl,
        rendersDir: directories.renders,
        browserExecutable: null,
        binariesDirectory,
      });

      queueInstance = queue;
      return queue;
    })().catch((error) => {
      queueWarmupPromise = null;
      queueInstance = null;
      throw error;
    });
  }

  return queueWarmupPromise;
}

async function ensureVideoTemplateQueue() {
  if (queueInstance) {
    return queueInstance;
  }

  return warmVideoTemplateService();
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
  warmVideoTemplateService,
};
