import { app } from "electron";
import fs from "fs";
import path from "path";

export type RemotionChromeMode = "headless-shell" | "chrome-for-testing";

export type RemotionBrowserSource =
  | "env"
  | "system";

export interface ResolvedRemotionBrowser {
  executablePath: string | null;
  chromeMode: RemotionChromeMode;
  source: RemotionBrowserSource;
  searchedPaths: string[];
}

function uniquePaths(candidates: string[]) {
  return candidates.filter(
    (candidate, index, list) => candidate && list.indexOf(candidate) === index,
  );
}

function resolveConfiguredChromeMode() {
  const configuredMode = String(
    process.env.YISHE_BROWSER_CHROME_MODE ||
      process.env.YISHE_REMOTION_CHROME_MODE ||
      "",
  ).trim();

  if (configuredMode === "headless-shell") {
    return configuredMode;
  }

  return "chrome-for-testing" as const;
}

function inferChromeModeFromExecutable(
  executablePath: string,
): RemotionChromeMode | null {
  const normalizedPath = executablePath.replace(/\\/g, "/").toLowerCase();
  if (
    normalizedPath.includes("chrome-headless-shell") ||
    normalizedPath.endsWith("/headless_shell")
  ) {
    return "headless-shell";
  }

  if (
    normalizedPath.includes("chrome-for-testing") ||
    normalizedPath.includes("google chrome for testing") ||
    normalizedPath.endsWith("/chrome.exe") ||
    normalizedPath.endsWith("/chrome")
  ) {
    return "chrome-for-testing";
  }

  return null;
}

function getSystemChromeExecutableCandidates() {
  if (process.platform === "win32") {
    const programFiles = process.env.PROGRAMFILES || "C:\\Program Files";
    const programFilesX86 =
      process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
    const localAppData = process.env.LOCALAPPDATA || "";

    return uniquePaths([
      path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(
        programFilesX86,
        "Google",
        "Chrome",
        "Application",
        "chrome.exe",
      ),
      localAppData
        ? path.join(
            localAppData,
            "Google",
            "Chrome",
            "Application",
            "chrome.exe",
          )
        : "",
    ]);
  }

  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      path.join(
        app.getPath("home"),
        "Applications",
        "Google Chrome.app",
        "Contents",
        "MacOS",
        "Google Chrome",
      ),
    ];
  }

  return [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/snap/bin/chromium",
  ];
}

export function resolveRemotionBrowser() {
  const preferredMode = resolveConfiguredChromeMode();
  const searchedPaths: string[] = [];
  const configuredExecutable = String(
    process.env.YISHE_BROWSER_EXECUTABLE ||
      process.env.YISHE_REMOTION_BROWSER_EXECUTABLE ||
      "",
  ).trim();

  if (configuredExecutable) {
    searchedPaths.push(configuredExecutable);
    if (!fs.existsSync(configuredExecutable)) {
      throw new Error(
        [
          "[video-template] 缺少本地浏览器：配置的浏览器路径不存在。",
          `YISHE_BROWSER_EXECUTABLE=${configuredExecutable}`,
        ].join(" "),
      );
    }

    return {
      executablePath: configuredExecutable,
      chromeMode:
        inferChromeModeFromExecutable(configuredExecutable) ?? preferredMode,
      source: "env" as const,
      searchedPaths,
    };
  }

  const systemCandidates = getSystemChromeExecutableCandidates();
  searchedPaths.push(...systemCandidates);

  for (const candidate of systemCandidates) {
    if (fs.existsSync(candidate)) {
      return {
        executablePath: candidate,
        chromeMode: "chrome-for-testing" as const,
        source: "system" as const,
        searchedPaths: uniquePaths(searchedPaths),
      };
    }
  }

  throw new Error(
    [
      "[video-template] 缺少本地浏览器，请先安装 Chrome/Chromium，或设置 YISHE_BROWSER_EXECUTABLE。",
      `当前偏好模式: ${preferredMode}。`,
      `已检查路径: ${uniquePaths(searchedPaths).join(", ") || "(none)"}`,
    ].join(" "),
  );
}
