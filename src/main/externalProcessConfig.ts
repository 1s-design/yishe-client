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

const browserAutomationExecutable =
  process.platform === "darwin"
    ? "resources/plugin/yishe-auto-browser-mac"
    : "resources/plugin/yishe-auto-browser-windows.exe";

const pluginProcessConfigsInternal: ProcessConfig[] = [];

if (
  (process.platform === "win32" || process.platform === "darwin") &&
  hasBundledResource(browserAutomationExecutable)
) {
  pluginProcessConfigsInternal.push({
    id: "browser-automation",
    name: "浏览器自动化端",
    executable: browserAutomationExecutable,
    platforms: ["win32", "darwin"],
    autoStart: true,
    autoRestart: true,
    restartDelay: 5000,
    env: {
      YISHE_OPEN_BROWSER_ON_START: "0",
    },
    healthCheck: {
      type: "http",
      url: "http://127.0.0.1:7010/api/crawler/health",
      interval: 10000,
      timeout: 4000,
    },
  });
}

if (
  process.platform === "win32" &&
  hasBundledResource("resources/plugin/yishe-ps-windows.exe")
) {
  pluginProcessConfigsInternal.push({
    id: "ps-automation",
    name: "PS 自动化端",
    executable: "resources/plugin/yishe-ps-windows.exe",
    platforms: ["win32"],
    autoStart: false,
    autoRestart: false,
  });
}

export const pluginProcessConfigs: ProcessConfig[] =
  pluginProcessConfigsInternal;
