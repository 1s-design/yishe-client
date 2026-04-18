import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sanitizeVersion(version) {
  return String(version || "").trim().replace(/^[^\d]*/, "");
}

function resolvePackageName(platform, arch, libc) {
  if (platform === "win32" && arch === "x64") {
    return "@remotion/compositor-win32-x64-msvc";
  }

  if (platform === "darwin" && arch === "arm64") {
    return "@remotion/compositor-darwin-arm64";
  }

  if (platform === "darwin" && arch === "x64") {
    return "@remotion/compositor-darwin-x64";
  }

  if (platform === "linux" && arch === "x64" && libc === "musl") {
    return "@remotion/compositor-linux-x64-musl";
  }

  if (platform === "linux" && arch === "x64") {
    return "@remotion/compositor-linux-x64-gnu";
  }

  if (platform === "linux" && arch === "arm64" && libc === "musl") {
    return "@remotion/compositor-linux-arm64-musl";
  }

  if (platform === "linux" && arch === "arm64") {
    return "@remotion/compositor-linux-arm64-gnu";
  }

  return null;
}

function resolveExpectedBinaryNames(platform) {
  if (platform === "win32") {
    return ["remotion.exe", "ffmpeg.exe", "ffprobe.exe"];
  }

  return ["remotion", "ffmpeg", "ffprobe"];
}

function assertOk(result, action) {
  if (result.status === 0) {
    return;
  }

  const stderr = String(result.stderr || "").trim();
  const stdout = String(result.stdout || "").trim();
  throw new Error(
    [`[remotion-binaries] Failed to ${action}.`, stderr, stdout]
      .filter(Boolean)
      .join(" "),
  );
}

function ensurePackageContents(packageDir, platform) {
  const missing = resolveExpectedBinaryNames(platform).filter(
    (fileName) => !fs.existsSync(path.join(packageDir, fileName)),
  );

  if (missing.length > 0) {
    throw new Error(
      `[remotion-binaries] Missing expected files in ${packageDir}: ${missing.join(", ")}`,
    );
  }
}

function copyPackageDirectory(fromDir, toDir) {
  fs.rmSync(toDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(toDir), { recursive: true });
  fs.cpSync(fromDir, toDir, { recursive: true });
}

function prepareFromNpm(packageName, version, outputDir) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yishe-remotion-"));
  const npmCacheDir = path.join(tempRoot, ".npm-cache");

  try {
    fs.mkdirSync(npmCacheDir, { recursive: true });

    const packResult = spawnSync(
      "npm",
      ["pack", `${packageName}@${version}`, "--silent"],
      {
        cwd: tempRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          npm_config_cache: npmCacheDir,
          NPM_CONFIG_CACHE: npmCacheDir,
        },
      },
    );
    assertOk(packResult, `download ${packageName}@${version}`);

    const tarballName = String(packResult.stdout || "")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .pop();

    if (!tarballName) {
      throw new Error(
        `[remotion-binaries] npm pack returned no tarball name for ${packageName}@${version}`,
      );
    }

    const extractDir = path.join(tempRoot, "extract");
    fs.mkdirSync(extractDir, { recursive: true });

    const extractResult = spawnSync(
      "tar",
      ["-xzf", path.join(tempRoot, tarballName), "-C", extractDir],
      {
        cwd: tempRoot,
        encoding: "utf8",
      },
    );
    assertOk(extractResult, `extract ${tarballName}`);

    const packageDir = path.join(extractDir, "package");
    if (!fs.existsSync(packageDir)) {
      throw new Error(
        `[remotion-binaries] Extracted package directory not found: ${packageDir}`,
      );
    }

    copyPackageDirectory(packageDir, outputDir);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function main() {
  const rendererPackagePath = path.join(
    rootDir,
    "node_modules",
    "@remotion",
    "renderer",
    "package.json",
  );
  const appPackagePath = path.join(rootDir, "package.json");

  const rendererPackage = fs.existsSync(rendererPackagePath)
    ? readJson(rendererPackagePath)
    : null;
  const appPackage = readJson(appPackagePath);

  const version = sanitizeVersion(
    rendererPackage?.version ||
      appPackage.dependencies?.["@remotion/renderer"] ||
      appPackage.dependencies?.remotion,
  );

  if (!version) {
    throw new Error("[remotion-binaries] Could not resolve Remotion version");
  }

  const platform = String(
    process.env.YISHE_REMOTION_TARGET_PLATFORM || process.platform,
  ).trim();
  const arch = String(
    process.env.YISHE_REMOTION_TARGET_ARCH || process.arch,
  ).trim();
  const libc = String(process.env.YISHE_REMOTION_TARGET_LIBC || "").trim();

  const packageName = resolvePackageName(platform, arch, libc);
  if (!packageName) {
    console.info(
      `[remotion-binaries] Skip unsupported target ${platform}/${arch}${libc ? ` (${libc})` : ""}`,
    );
    return;
  }

  const packageDirName = packageName.replace("@remotion/", "");
  const localPackageDir = path.join(rootDir, "node_modules", "@remotion", packageDirName);
  const outputDir = path.join(rootDir, "resources", "remotion", packageDirName);

  if (fs.existsSync(localPackageDir)) {
    copyPackageDirectory(localPackageDir, outputDir);
  } else {
    prepareFromNpm(packageName, version, outputDir);
  }

  ensurePackageContents(outputDir, platform);

  console.info(
    `[remotion-binaries] Prepared ${packageName}@${version} -> ${outputDir}`,
  );
}

main();
