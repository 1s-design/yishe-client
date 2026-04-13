import { execFileSync } from "node:child_process";
import path from "node:path";

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

export default async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") {
    return;
  }

  const productFilename = context.packager?.appInfo?.productFilename;
  if (!productFilename) {
    return;
  }

  const appPath = path.join(context.appOutDir, `${productFilename}.app`);
  if (hasUsableBundleSignature(appPath)) {
    return;
  }

  execFileSync(
    "codesign",
    ["--force", "--deep", "--sign", "-", appPath],
    { stdio: "inherit" },
  );
}
