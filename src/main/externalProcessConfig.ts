import { existsSync } from "fs";
import { join, resolve } from "path";
import { app } from "electron";
import { is } from "@electron-toolkit/utils";
import { ProcessConfig } from "./externalProcessManager";

const PS_AUTOMATION_PORT = "1595";

function resolveBundledResourcePath(relativePath: string): string {
  if (is.dev) {
    return resolve(__dirname, "../../", relativePath);
  }

  const resourcesPath = process.resourcesPath;
  const asarUnpackedPath = join(resourcesPath, "app.asar.unpacked");
  const candidates = [
    join(asarUnpackedPath, relativePath),
    join(resourcesPath, relativePath),
    relativePath.startsWith("resources/")
      ? null
      : join(asarUnpackedPath, "resources", relativePath),
    join(__dirname, "../..", relativePath),
    join(app.getAppPath(), relativePath),
  ].filter((value): value is string => !!value);

  return candidates.find((item) => existsSync(item)) || candidates[0];
}

function hasBundledResource(relativePath: string): boolean {
  return existsSync(resolveBundledResourcePath(relativePath));
}

function getPlatformPluginCandidates(...relativePaths: string[]): string[] {
  return relativePaths.flatMap((relativePath) => [
    `resources/plugin/${process.platform}/${relativePath}`,
    `resources/plugin/${relativePath}`,
  ]);
}

function resolvePlatformPluginPath(...relativePaths: string[]): string {
  const candidates = getPlatformPluginCandidates(...relativePaths);
  return candidates.find((item) => hasBundledResource(item)) || candidates[0];
}

function resolveExistingPlatformPluginPath(
  ...relativePaths: string[]
): string | null {
  const relativePath = getPlatformPluginCandidates(...relativePaths).find((item) =>
    hasBundledResource(item),
  );
  return relativePath ? resolveBundledResourcePath(relativePath) : null;
}

function prependPathEnv(
  existingValue: string | undefined,
  ...entries: Array<string | null | undefined>
): string | undefined {
  const pathDelimiter = process.platform === "win32" ? ";" : ":";
  const normalizedEntries = entries.filter(
    (entry): entry is string => !!entry && existsSync(entry),
  );

  if (!normalizedEntries.length) {
    return existingValue;
  }

  return [
    ...normalizedEntries,
    ...(existingValue ? [existingValue] : []),
  ].join(pathDelimiter);
}

function resolveOptionalDir(...relativePaths: string[]): string | null {
  return resolveExistingPlatformPluginPath(...relativePaths);
}

function buildImageProcessingRuntimeConfig(): ProcessConfig | null {
  const standaloneExecutable =
    process.platform === "win32"
      ? resolveExistingPlatformPluginPath(
          "yishe-images/yishe-image-tool.exe",
          "yishe-image-tool.exe",
          "yishe-images/yishe-images.exe",
          "yishe-images.exe",
        )
      : resolveExistingPlatformPluginPath(
          "yishe-images/yishe-image-tool",
          "yishe-image-tool",
          "yishe-images/yishe-images",
          "yishe-images",
        );

  if (standaloneExecutable) {
    return {
      id: "image-processing",
      name: "Yishe Images 图片处理引擎",
      executable: standaloneExecutable,
      platforms: ["win32", "darwin"],
      autoStart: true,
      autoRestart: true,
      restartDelay: 3000,
      healthCheck: {
        type: "http",
        url: "http://127.0.0.1:1513/api/health",
        interval: 5000,
        timeout: 2500,
        failureThreshold: 2,
      },
    };
  }

  const runtimeExecutable =
    process.platform === "win32"
      ? resolveExistingPlatformPluginPath(
          "yishe-images/runtime/yishe-image-tool.exe",
          "yishe-images/runtime/node.exe",
          "yishe-images/runtime/node/node.exe",
        )
      : resolveExistingPlatformPluginPath(
          "yishe-images/runtime/yishe-image-tool",
          "yishe-images/runtime/node",
          "yishe-images/runtime/node/bin/node",
        );
  const appRoot = resolveOptionalDir("yishe-images/app");
  const appEntry = appRoot ? join(appRoot, "server.js") : null;
  const imageMagickRoot = resolveOptionalDir("yishe-images/imagemagick");
  const imageMagickBin = imageMagickRoot
    ? [join(imageMagickRoot, "bin"), imageMagickRoot].find((item) =>
        existsSync(item),
      ) || imageMagickRoot
    : null;
  const imageMagickLib = imageMagickRoot
    ? resolve(
        imageMagickRoot,
        existsSync(join(imageMagickRoot, "lib")) ? "lib" : ".",
      )
    : null;
  const imageMagickConfig = imageMagickRoot
    ? [
        join(imageMagickRoot, "etc", "ImageMagick-7"),
        join(imageMagickRoot, "share", "ImageMagick-7"),
        join(imageMagickRoot, "share", "ImageMagick-7", "config-Q16HDRI"),
      ].find((item) => existsSync(item)) || null
    : null;
  const env: Record<string, string> = {
    PORT: "1513",
  };

  if (imageMagickRoot) {
    env.YISHE_IMAGEMAGICK_DIR = imageMagickRoot;
    env.MAGICK_HOME = imageMagickRoot;

    const pathValue = prependPathEnv(process.env.PATH, imageMagickBin);
    if (pathValue) {
      env.PATH = pathValue;
    }

    const dylibValue = prependPathEnv(
      process.env.DYLD_LIBRARY_PATH,
      imageMagickLib,
    );
    if (dylibValue) {
      env.DYLD_LIBRARY_PATH = dylibValue;
    }

    const configureValue = prependPathEnv(
      process.env.MAGICK_CONFIGURE_PATH,
      imageMagickConfig,
    );
    if (configureValue) {
      env.MAGICK_CONFIGURE_PATH = configureValue;
    }
  }

  if (!runtimeExecutable || !appEntry || !existsSync(appEntry)) {
    return null;
  }

  return {
    id: "image-processing",
    name: "Yishe Images 图片处理引擎",
    executable: runtimeExecutable,
    args: [appEntry],
    cwd: appRoot || undefined,
    env,
    platforms: ["win32", "darwin"],
    autoStart: true,
    autoRestart: true,
    restartDelay: 3000,
    healthCheck: {
      type: "http",
      url: "http://127.0.0.1:1513/api/health",
      interval: 5000,
      timeout: 2500,
      failureThreshold: 2,
    },
  };
}

void buildImageProcessingRuntimeConfig;

const psAutomationExecutable = resolvePlatformPluginPath(
  "ps-automation/yishe-ps-windows.exe",
  "yishe-ps-windows.exe",
);
const pluginProcessConfigsInternal: ProcessConfig[] = [];
const imageProcessingRuntimeConfig = null;

function resolvePsAutomationProjectRoot(): string {
  if (is.dev) {
    return resolve(__dirname, "../../src/main/ps-automation");
  }

  return resolveBundledResourcePath("resources/plugin/win32/ps-automation");
}

function resolveDevPythonExecutable(psProjectRoot: string): string {
  const candidates = [
    process.env.YISHE_PS_PYTHON,
    join(psProjectRoot, ".venv", "Scripts", "python.exe"),
    join(psProjectRoot, ".venv", "bin", "python"),
    "python",
  ].filter((value): value is string => !!value);

  return candidates.find((candidate) => {
    if (candidate === "python") {
      return true;
    }

    return existsSync(candidate);
  }) || "python";
}

function buildPsAutomationConfig(): ProcessConfig | null {
  if (process.platform !== "win32") {
    return null;
  }

  const psProjectRoot = resolvePsAutomationProjectRoot();

  if (is.dev) {
    const entryFile = join(psProjectRoot, "ps.py");
    if (!existsSync(entryFile)) {
      return null;
    }

    return {
      id: "ps-automation",
      name: "PS 自动化端",
      executable: resolveDevPythonExecutable(psProjectRoot),
      cwd: psProjectRoot,
      args: [entryFile, "--host", "127.0.0.1", "--port", PS_AUTOMATION_PORT],
      stopExecutable: resolveDevPythonExecutable(psProjectRoot),
      stopArgs: [entryFile, "--stop"],
      env: {
        PYTHONIOENCODING: "utf-8",
        PORT: PS_AUTOMATION_PORT,
      },
      platforms: ["win32"],
      autoStart: true,
      autoRestart: true,
      restartDelay: 3000,
      healthCheck: {
        type: "http",
        url: `http://127.0.0.1:${PS_AUTOMATION_PORT}/health`,
        interval: 5000,
        timeout: 2500,
        failureThreshold: 2,
      },
    };
  }

  if (!hasBundledResource(psAutomationExecutable)) {
    return null;
  }

  return {
    id: "ps-automation",
    name: "PS 自动化端",
    executable: psAutomationExecutable,
    env: {
      PORT: PS_AUTOMATION_PORT,
    },
    platforms: ["win32"],
    autoStart: true,
    autoRestart: true,
    restartDelay: 3000,
    healthCheck: {
      type: "http",
      url: `http://127.0.0.1:${PS_AUTOMATION_PORT}/health`,
      interval: 5000,
      timeout: 2500,
      failureThreshold: 2,
    },
  };
}

const psAutomationConfig = buildPsAutomationConfig();

if (psAutomationConfig) {
  pluginProcessConfigsInternal.push(psAutomationConfig);
}

if (
  (process.platform === "win32" || process.platform === "darwin") &&
  imageProcessingRuntimeConfig
) {
  pluginProcessConfigsInternal.push(imageProcessingRuntimeConfig);
}

export const pluginProcessConfigs: ProcessConfig[] =
  pluginProcessConfigsInternal;
