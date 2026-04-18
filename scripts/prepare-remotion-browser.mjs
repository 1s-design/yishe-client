import AdmZip from "adm-zip";
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);

function resolveChromeMode() {
  const configuredMode = String(
    process.env.YISHE_BROWSER_CHROME_MODE ||
      process.env.YISHE_REMOTION_CHROME_MODE ||
      "",
  ).trim();

  if (configuredMode === "headless-shell") {
    return configuredMode;
  }

  return "chrome-for-testing";
}

function resolveTargetPlatform() {
  return String(
    process.env.YISHE_REMOTION_TARGET_PLATFORM || process.platform,
  ).trim();
}

function resolveTargetArch() {
  return String(process.env.YISHE_REMOTION_TARGET_ARCH || process.arch).trim();
}

function resolveDownloadPlatform(platform, arch) {
  if (platform === "win32" && arch === "x64") {
    return "win64";
  }

  if (platform === "darwin" && arch === "arm64") {
    return "mac-arm64";
  }

  if (platform === "darwin" && arch === "x64") {
    return "mac-x64";
  }

  if (platform === "linux" && arch === "arm64") {
    return "linux-arm64";
  }

  if (platform === "linux" && arch === "x64") {
    return "linux64";
  }

  return null;
}

function resolveExpectedExecutableRelativePath(downloadPlatform, chromeMode) {
  if (chromeMode === "chrome-for-testing") {
    if (downloadPlatform === "win64") {
      return path.join("chrome-win64", "chrome.exe");
    }

    if (downloadPlatform === "mac-arm64") {
      return path.join(
        "chrome-mac-arm64",
        "Google Chrome for Testing.app",
        "Contents",
        "MacOS",
        "Google Chrome for Testing",
      );
    }

    if (downloadPlatform === "mac-x64") {
      return path.join(
        "chrome-mac-x64",
        "Google Chrome for Testing.app",
        "Contents",
        "MacOS",
        "Google Chrome for Testing",
      );
    }

    if (downloadPlatform === "linux64" || downloadPlatform === "linux-arm64") {
      return path.join("chrome-linux64", "chrome");
    }

    return null;
  }

  if (downloadPlatform === "win64") {
    return path.join("chrome-headless-shell-win64", "chrome-headless-shell.exe");
  }

  if (downloadPlatform === "mac-arm64") {
    return path.join(
      "chrome-headless-shell-mac-arm64",
      "chrome-headless-shell",
    );
  }

  if (downloadPlatform === "mac-x64") {
    return path.join("chrome-headless-shell-mac-x64", "chrome-headless-shell");
  }

  if (downloadPlatform === "linux-arm64") {
    return path.join("chrome-headless-shell-linux-arm64", "headless_shell");
  }

  if (downloadPlatform === "linux64") {
    return path.join("chrome-headless-shell-linux64", "chrome-headless-shell");
  }

  return null;
}

async function downloadFile(url, outputPath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `[remotion-browser] Failed to download browser archive: ${response.status} ${response.statusText}`,
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  fs.writeFileSync(outputPath, Buffer.from(arrayBuffer));
}

function ensureExecutable(filePath) {
  if (process.platform !== "win32" && fs.existsSync(filePath)) {
    fs.chmodSync(filePath, 0o755);
  }
}

async function main() {
  const { TESTED_VERSION, getChromeDownloadUrl } = require(path.join(
    rootDir,
    "node_modules",
    "@remotion",
    "renderer",
    "dist",
    "browser",
    "get-chrome-download-url.js",
  ));

  const chromeMode = resolveChromeMode();
  const platform = resolveTargetPlatform();
  const arch = resolveTargetArch();
  const downloadPlatform = resolveDownloadPlatform(platform, arch);

  if (!downloadPlatform) {
    console.info(
      `[remotion-browser] Skip unsupported target ${platform}/${arch}`,
    );
    return;
  }

  const expectedExecutableRelativePath = resolveExpectedExecutableRelativePath(
    downloadPlatform,
    chromeMode,
  );

  if (!expectedExecutableRelativePath) {
    throw new Error(
      `[remotion-browser] Unsupported browser target for ${platform}/${arch} (${chromeMode})`,
    );
  }

  const downloadUrl = getChromeDownloadUrl({
    platform: downloadPlatform,
    version: TESTED_VERSION,
    chromeMode,
  });
  const outputDir = path.join(
    rootDir,
    "resources",
    "remotion-browser",
    chromeMode,
  );
  const executablePath = path.join(outputDir, expectedExecutableRelativePath);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yishe-remotion-browser-"));
  const archivePath = path.join(tempRoot, "browser.zip");

  try {
    fs.rmSync(outputDir, { recursive: true, force: true });
    fs.mkdirSync(outputDir, { recursive: true });

    console.info(
      `[remotion-browser] Downloading ${chromeMode} ${TESTED_VERSION} for ${downloadPlatform}`,
    );
    console.info(`[remotion-browser] Source: ${downloadUrl}`);

    await downloadFile(downloadUrl, archivePath);

    const zip = new AdmZip(archivePath);
    zip.extractAllTo(outputDir, true);

    if (!fs.existsSync(executablePath)) {
      throw new Error(
        `[remotion-browser] Expected executable not found after extract: ${executablePath}`,
      );
    }

    ensureExecutable(executablePath);

    fs.writeFileSync(
      path.join(outputDir, "metadata.json"),
      JSON.stringify(
        {
          chromeMode,
          version: TESTED_VERSION,
          platform,
          arch,
          downloadPlatform,
          executableRelativePath: expectedExecutableRelativePath,
          downloadUrl,
        },
        null,
        2,
      ),
    );

    console.info(
      `[remotion-browser] Prepared ${chromeMode}@${TESTED_VERSION} -> ${executablePath}`,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
