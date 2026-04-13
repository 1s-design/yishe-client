import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const pluginDir = path.resolve(
  process.env.YISHE_PLUGIN_DOWNLOAD_DIR ||
    path.join(rootDir, "resources", "plugin"),
);
const runtimePlatform = String(
  process.env.YISHE_PLUGIN_DOWNLOAD_PLATFORM || process.platform,
).trim();
const cleanOnly = process.argv.includes("--clean");

// Mirrors the stable latest-download links shown in:
// yishe-admin/src/views/Home/Tools/Index.vue
const LATEST_PLUGIN_DOWNLOADS = {
  win32: [
    {
      id: "browser-automation",
      fileName: "yishe-auto-browser-windows.exe",
      url: "https://github.com/1s-design/yishe-auto-browser/releases/latest/download/yishe-auto-browser-windows.exe",
    },
    {
      id: "ps-automation",
      fileName: "yishe-ps-windows.exe",
      url: "https://github.com/1s-design/yishe-ps/releases/latest/download/yishe-ps-windows.exe",
    },
  ],
  darwin: [
    {
      id: "browser-automation",
      fileName: "yishe-auto-browser-mac",
      url: "https://github.com/1s-design/yishe-auto-browser/releases/latest/download/yishe-auto-browser-mac",
      chmod: 0o755,
    },
  ],
};

function getDownloadsForPlatform(platform) {
  return Array.isArray(LATEST_PLUGIN_DOWNLOADS[platform])
    ? LATEST_PLUGIN_DOWNLOADS[platform]
    : [];
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

async function main() {
  const downloads = cleanOnly
    ? Object.values(LATEST_PLUGIN_DOWNLOADS).flat()
    : getDownloadsForPlatform(runtimePlatform);
  if (!downloads.length) {
    console.log(
      `[prepare:plugins] skip platform ${runtimePlatform}, no plugin downloads configured`,
    );
    return;
  }

  await ensureDir(pluginDir);

  for (const item of downloads) {
    const destinationPath = path.join(pluginDir, item.fileName);
    if (cleanOnly) {
      await fs.rm(destinationPath, { force: true });
      console.log(`[prepare:plugins] removed ${item.fileName}`);
      continue;
    }

    console.log(
      `[prepare:plugins] downloading ${item.id} -> ${destinationPath}`,
    );
    await downloadFile(item.url, destinationPath);

    if (typeof item.chmod === "number") {
      await fs.chmod(destinationPath, item.chmod);
    }

    console.log(`[prepare:plugins] ready ${item.fileName}`);
  }
}

main().catch((error) => {
  console.error("[prepare:plugins] failed:", error?.message || error);
  process.exit(1);
});
