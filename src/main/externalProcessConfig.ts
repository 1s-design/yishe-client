import { existsSync } from "fs";
import { join, resolve } from "path";
import { app } from "electron";
import { is } from "@electron-toolkit/utils";
import { ProcessConfig } from "./externalProcessManager";

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
const remotionExecutable =
  process.platform === "win32"
    ? resolvePlatformPluginPath(
        "yishe-remotion/yishe-remotion.exe",
        "yishe-remotion.exe",
        "yishe-video-tool.exe",
      )
    : resolvePlatformPluginPath(
        "yishe-remotion/yishe-remotion",
        "yishe-remotion",
        "yishe-video-tool",
      );

const pluginProcessConfigsInternal: ProcessConfig[] = [];
const imageProcessingRuntimeConfig = null;

if (
  process.platform === "win32" &&
  hasBundledResource(psAutomationExecutable)
) {
  pluginProcessConfigsInternal.push({
    id: "ps-automation",
    name: "PS 自动化端",
    executable: psAutomationExecutable,
    platforms: ["win32"],
    autoStart: false,
    autoRestart: false,
  });
}

if (
  (process.platform === "win32" || process.platform === "darwin") &&
  hasBundledResource(remotionExecutable)
) {
  pluginProcessConfigsInternal.push({
    id: "video-template",
    name: "Video Template 视频引擎",
    executable: remotionExecutable,
    platforms: ["win32", "darwin"],
    autoStart: true,
    autoRestart: true,
    restartDelay: 3000,
    healthCheck: {
      type: "http",
      url: "http://127.0.0.1:1572/api/health",
      interval: 5000,
      timeout: 2500,
      failureThreshold: 2,
    },
  });
}

if (
  (process.platform === "win32" || process.platform === "darwin") &&
  imageProcessingRuntimeConfig
) {
  pluginProcessConfigsInternal.push(imageProcessingRuntimeConfig);
}

export const pluginProcessConfigs: ProcessConfig[] =
  pluginProcessConfigsInternal;
