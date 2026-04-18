import { app } from "electron";
import fs from "fs";
import path from "path";

export type RemotionChromeMode = "headless-shell" | "chrome-for-testing";

export type RemotionBrowserSource =
  | "env"
  | "bundled"
  | "system"
  | "auto-download";

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

function getBundledBrowserExecutableRelativePath(
  chromeMode: RemotionChromeMode,
) {
  if (chromeMode === "chrome-for-testing") {
    if (process.platform === "win32" && process.arch === "x64") {
      return path.join("chrome-win64", "chrome.exe");
    }

    if (process.platform === "darwin" && process.arch === "arm64") {
      return path.join(
        "chrome-mac-arm64",
        "Google Chrome for Testing.app",
        "Contents",
        "MacOS",
        "Google Chrome for Testing",
      );
    }

    if (process.platform === "darwin" && process.arch === "x64") {
      return path.join(
        "chrome-mac-x64",
        "Google Chrome for Testing.app",
        "Contents",
        "MacOS",
        "Google Chrome for Testing",
      );
    }

    if (process.platform === "linux") {
      return path.join("chrome-linux64", "chrome");
    }

    return null;
  }

  if (process.platform === "win32" && process.arch === "x64") {
    return path.join(
      "chrome-headless-shell-win64",
      "chrome-headless-shell.exe",
    );
  }

  if (process.platform === "darwin" && process.arch === "arm64") {
    return path.join(
      "chrome-headless-shell-mac-arm64",
      "chrome-headless-shell",
    );
  }

  if (process.platform === "darwin" && process.arch === "x64") {
    return path.join(
      "chrome-headless-shell-mac-x64",
      "chrome-headless-shell",
    );
  }

  if (process.platform === "linux" && process.arch === "arm64") {
    return path.join("chrome-headless-shell-linux-arm64", "headless_shell");
  }

  if (process.platform === "linux") {
    return path.join("chrome-headless-shell-linux64", "chrome-headless-shell");
  }

  return null;
}

function getBundledBrowserModeSearchOrder(
  preferredMode: RemotionChromeMode,
): RemotionChromeMode[] {
  return preferredMode === "headless-shell"
    ? ["headless-shell", "chrome-for-testing"]
    : ["chrome-for-testing", "headless-shell"];
}

function getBundledBrowserExecutableCandidates(chromeMode: RemotionChromeMode) {
  const executableRelativePath =
    getBundledBrowserExecutableRelativePath(chromeMode);
  if (!executableRelativePath) {
    return [];
  }

  const resourceRelativePath = path.join(
    "resources",
    "remotion-browser",
    chromeMode,
  );
  const browserRelativePath = path.join("remotion-browser", chromeMode);
  const appPath = app.getAppPath();
  const appAsarUnpackedPath = appPath.replace(/app\.asar$/, "app.asar.unpacked");

  return uniquePaths([
    path.join(process.resourcesPath, resourceRelativePath, executableRelativePath),
    path.join(process.resourcesPath, browserRelativePath, executableRelativePath),
    path.join(
      process.resourcesPath,
      "app.asar.unpacked",
      resourceRelativePath,
      executableRelativePath,
    ),
    path.join(
      process.resourcesPath,
      "app.asar.unpacked",
      browserRelativePath,
      executableRelativePath,
    ),
    path.join(appAsarUnpackedPath, resourceRelativePath, executableRelativePath),
    path.join(appAsarUnpackedPath, browserRelativePath, executableRelativePath),
    path.join(appPath, resourceRelativePath, executableRelativePath),
    path.join(appPath, browserRelativePath, executableRelativePath),
    path.resolve(
      process.cwd(),
      "resources",
      "remotion-browser",
      chromeMode,
      executableRelativePath,
    ),
  ]);
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
        ? path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe")
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
    "/snap/bin/chromium",
  ];
}

function isTruthyEnvFlag(value: string | undefined) {
  return value === "1" || value === "true";
}

function isFalseEnvFlag(value: string | undefined) {
  return value === "0" || value === "false";
}

function shouldDisableBrowserDownload() {
  const configuredValue = String(
    process.env.YISHE_BROWSER_DISABLE_DOWNLOAD ||
      process.env.YISHE_REMOTION_DISABLE_BROWSER_DOWNLOAD ||
      "",
  )
    .trim()
    .toLowerCase();

  if (isTruthyEnvFlag(configuredValue)) {
    return true;
  }

  if (isFalseEnvFlag(configuredValue)) {
    return false;
  }

  return app.isPackaged;
}

function shouldAllowSystemBrowserFallback() {
  const configuredValue = String(
    process.env.YISHE_BROWSER_ALLOW_SYSTEM ||
      process.env.YISHE_REMOTION_ALLOW_SYSTEM_BROWSER ||
      "",
  )
    .trim()
    .toLowerCase();

  if (isTruthyEnvFlag(configuredValue)) {
    return true;
  }

  if (isFalseEnvFlag(configuredValue)) {
    return false;
  }

  return !app.isPackaged;
}

function getPrepareBrowserCommand() {
  if (process.platform === "win32") {
    return "npm run prepare:browser:win";
  }

  if (process.platform === "darwin") {
    return "npm run prepare:browser:mac";
  }

  return "npm run prepare:browser:linux";
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
          "[video-template] Configured Remotion browser executable does not exist.",
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

  for (const chromeMode of getBundledBrowserModeSearchOrder(preferredMode)) {
    const candidates = getBundledBrowserExecutableCandidates(chromeMode);
    searchedPaths.push(...candidates);

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return {
          executablePath: candidate,
          chromeMode,
          source: "bundled" as const,
          searchedPaths: uniquePaths(searchedPaths),
        };
      }
    }
  }

  if (shouldAllowSystemBrowserFallback()) {
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
  }

  if (shouldDisableBrowserDownload()) {
    throw new Error(
      [
        "[video-template] No local browser available for Remotion rendering.",
        `Expected bundled mode: ${preferredMode}.`,
        `Run ${getPrepareBrowserCommand()} before packaging, or set YISHE_BROWSER_EXECUTABLE.`,
        `Searched paths: ${uniquePaths(searchedPaths).join(", ") || "(none)"}`,
      ].join(" "),
    );
  }

  return {
    executablePath: null,
    chromeMode: preferredMode,
    source: "auto-download" as const,
    searchedPaths: uniquePaths(searchedPaths),
  };
}
