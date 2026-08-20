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
    "resources/plugin/darwin/image-tool/imagemagick/bin/magick",
    "resources/plugin/darwin/image-tool/imagemagick/bin/identify",
    "resources/plugin/darwin/image-tool/imagemagick/bin/convert",
    "resources/plugin/darwin/image-tool/imagemagick/bin/mogrify",
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

  // ImageMagick coder/filter 模块是 dlopen 加载的 .so，同样需要可执行权限
  const imageMagickModulesPath = path.join(
    contentsResourcesPath,
    "resources/plugin/darwin/image-tool/imagemagick/lib/ImageMagick",
  );
  if (fs.existsSync(imageMagickModulesPath)) {
    const soFiles = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(entryPath);
        } else if (entry.name.endsWith(".so")) {
          soFiles.push(entryPath);
        }
      }
    };
    walk(imageMagickModulesPath);
    for (const soPath of soFiles) {
      try {
        fs.chmodSync(soPath, 0o755);
      } catch (err) {
        console.warn(`[after-pack] chmod 失败 ${soPath}: ${err.message}`);
      }
    }
    console.log(`[after-pack] chmod +x ${soFiles.length} 个 ImageMagick 模块`);
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
