import path from "node:path";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const psRootDir = path.resolve(rootDir, "src", "main", "ps-automation");
const requirementsFile = path.join(psRootDir, "requirements.txt");
const venvPython = process.platform === "win32"
  ? path.join(psRootDir, ".venv", "Scripts", "python.exe")
  : path.join(psRootDir, ".venv", "bin", "python");

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

function resolveBootstrapPython() {
  const candidates = [
    process.env.YISHE_PS_BOOTSTRAP_PYTHON,
    process.env.YISHE_PS_PYTHON,
    "python",
  ].filter(Boolean);

  return candidates[0];
}

async function main() {
  if (!existsSync(psRootDir)) {
    throw new Error(`ps automation root not found: ${psRootDir}`);
  }

  if (!existsSync(requirementsFile)) {
    throw new Error(`requirements not found: ${requirementsFile}`);
  }

  if (!existsSync(venvPython)) {
    const bootstrapPython = resolveBootstrapPython();
    console.log(`[prepare:ps-env] creating venv with ${bootstrapPython}`);
    await run(bootstrapPython, ["-m", "venv", ".venv"], {
      cwd: psRootDir,
    });
  }

  console.log("[prepare:ps-env] installing requirements");
  await run(venvPython, ["-m", "pip", "install", "--upgrade", "pip"], {
    cwd: psRootDir,
    env: {
      ...process.env,
      PYTHONIOENCODING: "utf-8",
    },
  });
  await run(venvPython, ["-m", "pip", "install", "-r", "requirements.txt"], {
    cwd: psRootDir,
    env: {
      ...process.env,
      PYTHONIOENCODING: "utf-8",
    },
  });
}

main().catch((error) => {
  console.error("[prepare:ps-env] failed:", error?.message || error);
  process.exit(1);
});
