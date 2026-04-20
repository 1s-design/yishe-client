import fs from "node:fs/promises";
import path from "node:path";
import { accessSync, constants, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const psRootDir = path.resolve(rootDir, "src", "main", "ps-automation");
const outputDir = path.resolve(rootDir, "resources", "plugin", "win32", "ps-automation");
const outputFile = path.join(outputDir, "yishe-ps-windows.exe");
const venvPython = process.platform === "win32"
  ? path.join(psRootDir, ".venv", "Scripts", "python.exe")
  : path.join(psRootDir, ".venv", "bin", "python");

function canAccess(filePath) {
  try {
    accessSync(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function resolvePythonExecutable() {
  const candidates = [
    process.env.YISHE_PS_PYTHON,
    venvPython,
    path.join(psRootDir, ".venv", "Scripts", "python.exe"),
    path.join(psRootDir, ".venv", "bin", "python"),
    "python",
  ].filter(Boolean);

  return candidates.find((candidate) => candidate === "python" || canAccess(candidate)) || "python";
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: false,
      ...options,
    });

    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code ?? "unknown"}`));
    });
  });
}

async function main() {
  if (process.platform !== "win32") {
    console.log("[prepare:ps] skip non-win32 platform");
    return;
  }

  if (!existsSync(psRootDir)) {
    throw new Error(`ps automation root not found: ${psRootDir}`);
  }

  if (!existsSync(venvPython)) {
    throw new Error(
      `python venv not found: ${venvPython}. Run "npm run prepare:ps:env" first.`,
    );
  }

  const python = resolvePythonExecutable();
  const distCandidates = [
    path.join(psRootDir, "dist", "ps.exe"),
    path.join(psRootDir, "dist", "yishe-ps-windows.exe"),
  ];

  console.log(`[prepare:ps] building from ${psRootDir}`);
  await run(python, ["-m", "PyInstaller", "--clean", "--noconfirm", "ps.spec"], {
    cwd: psRootDir,
    env: {
      ...process.env,
      PYTHONIOENCODING: "utf-8",
    },
  });

  const builtFile = distCandidates.find((candidate) => existsSync(candidate));
  if (!builtFile) {
    throw new Error(`built ps executable not found in ${path.join(psRootDir, "dist")}`);
  }

  await fs.mkdir(outputDir, { recursive: true });
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      await fs.copyFile(builtFile, outputFile);
      break;
    } catch (error) {
      if (attempt === 10) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  console.log(`[prepare:ps] copied ${builtFile} -> ${outputFile}`);
}

main().catch((error) => {
  console.error("[prepare:ps] failed:", error?.message || error);
  process.exit(1);
});
