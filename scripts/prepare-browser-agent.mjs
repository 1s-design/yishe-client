import fs from "node:fs/promises";
import path from "node:path";
import { accessSync, constants, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const agentRootDir = path.resolve(rootDir, "src", "main", "browser-agent");
const outputDir = path.resolve(rootDir, "resources", "browser-agent");
const outputFile = path.join(outputDir, "yishe-browser-agent");

const venvPython =
  process.platform === "win32"
    ? path.join(agentRootDir, ".venv", "Scripts", "python.exe")
    : path.join(agentRootDir, ".venv", "bin", "python");

function canAccess(filePath) {
  try {
    accessSync(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function resolvePythonExecutable() {
  const candidates = [process.env.YISHE_BROWSER_AGENT_PYTHON, venvPython, "python3", "python"].filter(Boolean);
  for (const p of candidates) {
    if (canAccess(p)) return p;
  }
  return null;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: "inherit",
      cwd: agentRootDir,
      ...options,
    });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} 退出码 ${code}`));
    });
    proc.on("error", reject);
  });
}

async function ensureVenv(python) {
  const venvDir = path.join(agentRootDir, ".venv");
  if (!existsSync(venvDir)) {
    console.log("[browser-agent] 创建 venv...");
    await run(python, ["-m", "venv", ".venv"]);
  }
  const venvPy =
    process.platform === "win32"
      ? path.join(venvDir, "Scripts", "python.exe")
      : path.join(venvDir, "bin", "python");
  if (!canAccess(venvPy)) {
    throw new Error("venv 创建失败，找不到 Python 解释器");
  }
  return venvPy;
}

async function main() {
  console.log("[browser-agent] 开始打包...");

  let python = resolvePythonExecutable();
  if (!python) {
    throw new Error("找不到 Python 解释器，请安装 Python 3.10+");
  }
  console.log(`[browser-agent] 使用 Python: ${python}`);

  // 确保 venv 存在并安装依赖
  const venvPy = await ensureVenv(python);
  console.log("[browser-agent] 安装依赖...");
  await run(venvPy, ["-m", "pip", "install", "-r", "requirements.txt", "pyinstaller", "-q"]);

  // PyInstaller 打包
  console.log("[browser-agent] PyInstaller 打包中...");
  await run(venvPy, ["-m", "PyInstaller", "--clean", "--noconfirm", "browser_agent.spec"]);

  // 确保输出目录存在
  await fs.mkdir(outputDir, { recursive: true });

  // 复制产物到 resources/browser-agent/
  const distExe = path.join(agentRootDir, "dist", "yishe-browser-agent");
  const distExeWin = `${distExe}.exe`;
  const source = existsSync(distExeWin) ? distExeWin : distExe;
  if (!existsSync(source)) {
    throw new Error(`打包产物不存在: ${source}`);
  }
  const targetName = process.platform === "win32" ? "yishe-browser-agent.exe" : "yishe-browser-agent";
  const targetPath = path.join(outputDir, targetName);
  await fs.copyFile(source, targetPath);

  // 确保可执行权限（macOS/Linux）
  if (process.platform !== "win32") {
    await fs.chmod(targetPath, 0o755);
  }

  console.log(`[browser-agent] 打包完成: ${targetPath}`);
}

main().catch((err) => {
  console.error("[browser-agent] 打包失败:", err.message);
  process.exit(1);
});
