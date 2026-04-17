import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const pluginRootDir = path.resolve(
  process.env.YISHE_PLUGIN_DOWNLOAD_DIR ||
    path.join(rootDir, "resources", "plugin"),
);
const runtimePlatform = String(
  process.env.YISHE_PLUGIN_DOWNLOAD_PLATFORM || process.platform,
).trim();
const runtimeArch = String(
  process.env.YISHE_PLUGIN_DOWNLOAD_ARCH || process.arch,
).trim();
const cleanOnly = process.argv.includes("--clean");

// Mirrors the stable latest-download links shown in managed plugin releases.
const LATEST_PLUGIN_DOWNLOADS = {
  win32: [
    {
      id: "ps-automation",
      type: "file",
      fileName: "yishe-ps-windows.exe",
      url: "https://github.com/1s-design/yishe-ps/releases/latest/download/yishe-ps-windows.exe",
    },
  ],
};

function getDownloadsForPlatform(platform, arch) {
  return (Array.isArray(LATEST_PLUGIN_DOWNLOADS[platform])
    ? LATEST_PLUGIN_DOWNLOADS[platform]
    : []
  )
    .filter((item) => !item.arch || item.arch === arch)
    .map((item) => ({ ...item, platform }));
}

function getAllDownloads() {
  return Object.entries(LATEST_PLUGIN_DOWNLOADS).flatMap(([platform, items]) =>
    items.map((item) => ({ ...item, platform })),
  );
}

function getPlatformPluginDir(platform) {
  return path.join(pluginRootDir, platform);
}

function getPlatformPluginPath(platform, relativePath) {
  return path.join(getPlatformPluginDir(platform), relativePath);
}

function getLegacyPluginPath(relativePath) {
  return path.join(pluginRootDir, relativePath);
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function downloadFile(url, destinationPath) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent": "yishe-client-plugin-downloader/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(
      `download failed: ${response.status} ${response.statusText}`,
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const tempPath = `${destinationPath}.tmp`;
  await fs.writeFile(tempPath, buffer);
  await fs.rename(tempPath, destinationPath);
}

async function removeIfExists(targetPath) {
  await fs.rm(targetPath, { recursive: true, force: true });
}

async function ensurePathExists(targetPath, label) {
  try {
    await fs.access(targetPath);
  } catch {
    throw new Error(`${label} not found: ${targetPath}`);
  }
}

async function resolveExistingExecutablePath(platform, executableEntry) {
  const candidates = Array.isArray(executableEntry)
    ? executableEntry
    : [executableEntry];

  for (const candidate of candidates) {
    const candidatePath = getPlatformPluginPath(platform, candidate);
    try {
      await fs.access(candidatePath);
      return candidatePath;
    } catch {
      continue;
    }
  }

  throw new Error(
    `executable not found: ${candidates.join(" | ")}`,
  );
}

async function extractArchive(archivePath, destinationDir) {
  await ensureDir(destinationDir);

  if (process.platform === "win32") {
    await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destinationDir.replace(/'/g, "''")}' -Force`,
    ]);
    return;
  }

  await execFileAsync("ditto", ["-x", "-k", archivePath, destinationDir]);
}

async function cleanDownload(item) {
  if (item.type === "archive") {
    if (item.extractDir) {
      await removeIfExists(getPlatformPluginPath(item.platform, item.extractDir));
      await removeIfExists(getLegacyPluginPath(item.extractDir));
    }
    if (item.archiveFileName) {
      await removeIfExists(
        getPlatformPluginPath(item.platform, item.archiveFileName),
      );
    }
  }

  if (item.type === "file" && item.fileName) {
    await removeIfExists(getPlatformPluginPath(item.platform, item.fileName));
    await removeIfExists(getLegacyPluginPath(item.fileName));
  }

  for (const cleanupPath of item.cleanupPaths || []) {
    if (!item.extractDir || cleanupPath !== item.extractDir) {
      await removeIfExists(getPlatformPluginPath(item.platform, cleanupPath));
    }
    await removeIfExists(getLegacyPluginPath(cleanupPath));
  }
}

async function installFileDownload(item) {
  const destinationPath = getPlatformPluginPath(item.platform, item.fileName);
  const legacyPath = getLegacyPluginPath(item.fileName);

  await ensureDir(path.dirname(destinationPath));

  console.log(`[prepare:plugins] downloading ${item.id} -> ${destinationPath}`);
  await downloadFile(item.url, destinationPath);
  await removeIfExists(legacyPath);

  if (typeof item.chmod === "number") {
    await fs.chmod(destinationPath, item.chmod);
  }
}

async function installArchiveDownload(item) {
  const archivePath = getPlatformPluginPath(item.platform, item.archiveFileName);
  const platformDir = getPlatformPluginDir(item.platform);

  await ensureDir(platformDir);
  if (item.extractDir) {
    await removeIfExists(getPlatformPluginPath(item.platform, item.extractDir));
    await removeIfExists(getLegacyPluginPath(item.extractDir));
  }

  console.log(`[prepare:plugins] downloading ${item.id} -> ${archivePath}`);
  await downloadFile(item.url, archivePath);
  await extractArchive(archivePath, platformDir);
  await removeIfExists(archivePath);

  if (item.extractDir) {
    await ensurePathExists(
      getPlatformPluginPath(item.platform, item.extractDir),
      `${item.id} extracted directory`,
    );
  }

  for (const executableEntry of item.executables || []) {
    const executablePath = await resolveExistingExecutablePath(
      item.platform,
      executableEntry,
    );

    if (process.platform !== "win32") {
      await fs.chmod(executablePath, 0o755);
    }
  }

  for (const cleanupPath of item.cleanupPaths || []) {
    await removeIfExists(getPlatformPluginPath(item.platform, cleanupPath));
    await removeIfExists(getLegacyPluginPath(cleanupPath));
  }
}

async function installDownload(item) {
  if (item.type === "archive") {
    await installArchiveDownload(item);
    return;
  }

  await installFileDownload(item);
}

async function main() {
  const downloads = cleanOnly
    ? getAllDownloads()
    : getDownloadsForPlatform(runtimePlatform, runtimeArch);

  if (!downloads.length) {
    console.log(
      `[prepare:plugins] skip platform ${runtimePlatform}/${runtimeArch}, no plugin downloads configured`,
    );
    return;
  }

  for (const item of downloads) {
    if (cleanOnly) {
      await cleanDownload(item);
      console.log(`[prepare:plugins] removed ${item.id}`);
      continue;
    }

    try {
      await installDownload(item);
      console.log(`[prepare:plugins] ready ${item.id}`);
    } catch (error) {
      if (item.optional) {
        console.warn(
          `[prepare:plugins] skipped optional ${item.id}: ${error?.message || error}`,
        );
        continue;
      }
      throw error;
    }
  }
}

main().catch((error) => {
  console.error("[prepare:plugins] failed:", error?.message || error);
  process.exit(1);
});
