// electron.vite.config.ts
import { resolve } from "path";
import fs from "fs";
import { spawnSync, spawn } from "child_process";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import vue from "@vitejs/plugin-vue";
var videoTemplateBuildRoot = resolve("generated");
var videoTemplateSourceTargetDir = resolve("generated/video-template-runtime-source-v3");
var videoTemplateBundleTargetDir = resolve("generated/video-template-standard-bundle-v3");
var videoTemplateAiBundleTargetDir = resolve("generated/video-template-ai-bundle-v3");
var mainBuildOutDir = "generated/main";
var preloadBuildOutDir = "generated/preload";
var rendererBuildOutDir = "generated/renderer";
function formatBuildError(error) {
  return error instanceof Error ? error.message : String(error);
}
function removeOrQuarantineDirectory(targetDir) {
  if (!fs.existsSync(targetDir)) {
    return;
  }
  try {
    fs.rmSync(targetDir, { recursive: true, force: true });
  } catch (error) {
    const quarantineDir = `${targetDir}.stale-${Date.now()}-${process.pid}`;
    try {
      fs.renameSync(targetDir, quarantineDir);
      console.warn(
        `[video-template] could not remove generated directory, moved it aside: ${quarantineDir}`
      );
    } catch (renameError) {
      throw new Error(
        [
          `Failed to prepare generated directory: ${targetDir}`,
          `remove failed: ${formatBuildError(error)}`,
          `rename failed: ${formatBuildError(renameError)}`
        ].join("; ")
      );
    }
  }
  if (fs.existsSync(targetDir)) {
    const quarantineDir = `${targetDir}.stale-${Date.now()}-${process.pid}`;
    fs.renameSync(targetDir, quarantineDir);
    console.warn(
      `[video-template] generated directory was not empty after cleanup, moved it aside: ${quarantineDir}`
    );
  }
}
function prepareCleanDirectory(targetDir) {
  removeOrQuarantineDirectory(targetDir);
  fs.mkdirSync(targetDir, { recursive: true });
}
function replaceGeneratedDirectory(targetDir, stagingDir) {
  removeOrQuarantineDirectory(targetDir);
  fs.renameSync(stagingDir, targetDir);
}
function getDirectoryOwner(directory) {
  try {
    return fs.statSync(directory);
  } catch {
    return null;
  }
}
function restoreGeneratedDirectoryOwner(targetDir, owner) {
  if (!owner || typeof process.getuid !== "function" || process.getuid() !== 0) {
    return;
  }
  try {
    fs.chownSync(targetDir, owner.uid, owner.gid);
    for (const entry of fs.readdirSync(targetDir, { withFileTypes: true })) {
      const entryPath = resolve(targetDir, entry.name);
      fs.chownSync(entryPath, owner.uid, owner.gid);
      if (entry.isDirectory()) {
        restoreGeneratedDirectoryOwner(entryPath, owner);
      }
    }
  } catch (error) {
    console.warn(
      `[video-template] could not restore generated directory ownership for ${targetDir}: ${formatBuildError(error)}`
    );
  }
}
function getLatestMtimeMs(directory) {
  let latest = 0;
  const stack = [directory];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryPath = resolve(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else {
        try {
          const stat = fs.statSync(entryPath);
          if (stat.mtimeMs > latest) latest = stat.mtimeMs;
        } catch {
        }
      }
    }
  }
  return latest;
}
function isBundleUpToDate(targetDir, sourceDir) {
  const entryHtml = resolve(targetDir, "index.html");
  if (!fs.existsSync(entryHtml)) {
    return false;
  }
  try {
    const bundleMtime = fs.statSync(entryHtml).mtimeMs;
    return bundleMtime >= getLatestMtimeMs(sourceDir);
  } catch {
    return false;
  }
}
function buildBundlesInChildProcess(pairs) {
  const scriptPath = resolve("scripts/build-video-template-bundle.mjs");
  const args = pairs.flatMap(({ entryPoint, targetDir }) => [entryPoint, targetDir]);
  const result = spawnSync(process.execPath, ["--max-old-space-size=4096", scriptPath, ...args], {
    stdio: "inherit"
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`bundle child process exited with code ${result.status}`);
  }
}
function buildBundlesInBackground(pairs) {
  const scriptPath = resolve("scripts/build-video-template-bundle.mjs");
  const args = pairs.flatMap(({ entryPoint, targetDir }) => [entryPoint, targetDir]);
  const child = spawn(process.execPath, ["--max-old-space-size=4096", scriptPath, ...args], {
    stdio: "ignore",
    detached: true
  });
  child.on("error", (error) => {
    console.warn(`[video-template] failed to spawn bundle child: ${String(error)}`);
  });
  child.on("exit", (code) => {
    if (code === 0) {
      console.info("[video-template] prebuilt bundles updated in background");
    } else {
      console.warn(`[video-template] prebuilt bundle child exited with code ${code}`);
    }
  });
  child.unref();
}
function cleanupStaleStagingDirectories() {
  try {
    for (const name of fs.readdirSync(videoTemplateBuildRoot)) {
      if (/\.tmp-\d+-\d+$/.test(name) || /\.stale-\d+-\d+$/.test(name)) {
        fs.rmSync(resolve(videoTemplateBuildRoot, name), { recursive: true, force: true });
      }
    }
  } catch {
  }
}
function videoTemplateAssetsPlugin() {
  const sourceDir = resolve("src/main/video-template");
  let isDev = false;
  return {
    name: "build-video-template-assets",
    configResolved(config) {
      isDev = config.mode !== "production";
    },
    async closeBundle() {
      try {
        if (!fs.existsSync(sourceDir)) {
          return;
        }
        fs.mkdirSync(videoTemplateBuildRoot, { recursive: true });
        const generatedOwner = getDirectoryOwner(videoTemplateBuildRoot);
        cleanupStaleStagingDirectories();
        const sourceStagingDir = `${videoTemplateSourceTargetDir}.tmp-${Date.now()}-${process.pid}`;
        prepareCleanDirectory(sourceStagingDir);
        try {
          fs.cpSync(sourceDir, sourceStagingDir, { recursive: true });
          replaceGeneratedDirectory(videoTemplateSourceTargetDir, sourceStagingDir);
          restoreGeneratedDirectoryOwner(videoTemplateSourceTargetDir, generatedOwner);
        } finally {
          if (fs.existsSync(sourceStagingDir)) {
            fs.rmSync(sourceStagingDir, { recursive: true, force: true });
          }
        }
        const bundles = [
          {
            entryPoint: resolve("src/main/video-template/remotion/index.ts"),
            targetDir: videoTemplateBundleTargetDir
          },
          {
            entryPoint: resolve("src/main/video-template/remotion/ai-index.ts"),
            targetDir: videoTemplateAiBundleTargetDir
          }
        ];
        const pending = [];
        for (const { entryPoint, targetDir } of bundles) {
          if (!fs.existsSync(entryPoint)) {
            continue;
          }
          if (isBundleUpToDate(targetDir, sourceDir)) {
            console.info(`[video-template] prebuilt bundle is up to date, skip rebuild: ${targetDir}`);
            continue;
          }
          console.info(`[video-template] building prebuilt bundle: ${targetDir}`);
          pending.push({ entryPoint, targetDir });
        }
        if (pending.length === 0) {
          return;
        }
        if (isDev) {
          buildBundlesInBackground(pending);
        } else {
          try {
            buildBundlesInChildProcess(pending);
          } catch (error) {
            console.warn(`[video-template] prebuilt bundles failed, keep existing bundle: ${formatBuildError(error)}`);
          }
        }
      } catch (error) {
        console.warn(`[video-template] asset preparation skipped: ${formatBuildError(error)}`);
      }
    }
  };
}
var electron_vite_config_default = defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: ["@modelcontextprotocol/sdk"]
      }),
      videoTemplateAssetsPlugin()
    ],
    build: {
      outDir: mainBuildOutDir,
      minify: false,
      // 禁用压缩混淆
      sourcemap: true,
      // 生成sourcemap方便调试
      rollupOptions: {
        treeshake: false,
        // 关掉 tree-shaking，防止配置数组元素被误删
        external: [
          "puppeteer-extra",
          "puppeteer-extra-plugin-stealth",
          "electron-store",
          "swagger-jsdoc",
          "swagger-ui-express",
          "esbuild"
        ]
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: preloadBuildOutDir
    }
  },
  renderer: {
    publicDir: resolve("public"),
    // 指定 public 目录位置
    resolve: {
      alias: {
        "@": resolve("src/renderer/src"),
        "@renderer": resolve("src/renderer/src")
      },
      extensions: [".mjs", ".js", ".ts", ".jsx", ".tsx", ".json", ".vue"]
    },
    plugins: [vue()],
    server: {
      port: 5175,
      hmr: {
        port: 5175,
        // 指定HMR端口
        overlay: true
        // 显示错误覆盖层
      },
      watch: {
        usePolling: true,
        // 使用轮询监听文件变化
        interval: 1e3
        // 轮询间隔
      }
    },
    build: {
      outDir: rendererBuildOutDir,
      sourcemap: true
      // 生成sourcemap
    }
  }
});
export {
  electron_vite_config_default as default
};
