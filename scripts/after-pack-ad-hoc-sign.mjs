import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

function hasUsableBundleSignature(appPath) {
  try {
    execFileSync(
      "codesign",
      ["--verify", "--deep", "--strict", "--verbose=1", appPath],
      { stdio: "ignore" },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * 确保 macOS 打包后的二进制文件保留可执行权限。
 * electron-builder 复制 extraResources 时可能因 umask 丢失 +x，
 * 这里显式修复，避免运行时 spawn EACCES。
 */
function ensureExecutablePermissions(resourcesDir, productFilename) {
  const appPath = path.join(resourcesDir, `${productFilename}.app`);
  const contentsResourcesPath = path.join(appPath, "Contents", "Resources");

  if (!fs.existsSync(contentsResourcesPath)) {
    return;
  }

  // 需要保证可执行权限的二进制路径（相对于 Contents/Resources）
  const binaryRelPaths = [
    "resources/google-art/darwin/dezoomify-rs-mac",
  ];

  for (const relPath of binaryRelPaths) {
    const absPath = path.join(contentsResourcesPath, relPath);
    if (fs.existsSync(absPath)) {
      try {
        fs.chmodSync(absPath, 0o755);
        console.log(`[after-pack] chmod +x ${relPath}`);
      } catch (err) {
        console.warn(`[after-pack] chmod 失败 ${relPath}: ${err.message}`);
      }
    }
  }
}

export default async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") {
    return;
  }

  const productFilename = context.packager?.appInfo?.productFilename;
  if (!productFilename) {
    return;
  }

  const appPath = path.join(context.appOutDir, `${productFilename}.app`);

  // 先修复二进制可执行权限，再进行签名
  ensureExecutablePermissions(context.appOutDir, productFilename);

  if (hasUsableBundleSignature(appPath)) {
    return;
  }

  execFileSync(
    "codesign",
    ["--force", "--deep", "--sign", "-", appPath],
    { stdio: "inherit" },
  );
}
