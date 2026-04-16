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

function resolvePlatformPluginPath(fileName: string): string {
  const candidates = [
    `resources/plugin/${process.platform}/${fileName}`,
    `resources/plugin/${fileName}`,
  ];

  return candidates.find((item) => hasBundledResource(item)) || candidates[0];
}

const psAutomationExecutable = resolvePlatformPluginPath("yishe-ps-windows.exe");
const remotionExecutable =
  process.platform === "win32"
    ? resolvePlatformPluginPath("yishe-remotion.exe")
    : resolvePlatformPluginPath("yishe-remotion");

const pluginProcessConfigsInternal: ProcessConfig[] = [];

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
      interval: 8000,
      timeout: 3000,
    },
  });
}

export const pluginProcessConfigs: ProcessConfig[] =
  pluginProcessConfigsInternal;
