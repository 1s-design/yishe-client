import { resolve } from 'path'
import fs from 'fs'
import { spawnSync, spawn } from 'child_process'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

const videoTemplateBuildRoot = resolve('generated')
const videoTemplateSourceTargetDir = resolve('generated/video-template-runtime-source-v3')
const videoTemplateBundleTargetDir = resolve('generated/video-template-standard-bundle-v3')
const videoTemplateAiBundleTargetDir = resolve('generated/video-template-ai-bundle-v3')
const mainBuildOutDir = 'generated/main'
const preloadBuildOutDir = 'generated/preload'
const rendererBuildOutDir = 'generated/renderer'

function formatBuildError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function removeOrQuarantineDirectory(targetDir: string) {
  if (!fs.existsSync(targetDir)) {
    return
  }

  try {
    fs.rmSync(targetDir, { recursive: true, force: true })
  } catch (error) {
    const quarantineDir = `${targetDir}.stale-${Date.now()}-${process.pid}`
    try {
      fs.renameSync(targetDir, quarantineDir)
      console.warn(
        `[video-template] could not remove generated directory, moved it aside: ${quarantineDir}`
      )
    } catch (renameError) {
      throw new Error(
        [
          `Failed to prepare generated directory: ${targetDir}`,
          `remove failed: ${formatBuildError(error)}`,
          `rename failed: ${formatBuildError(renameError)}`
        ].join('; ')
      )
    }
  }

  if (fs.existsSync(targetDir)) {
    const quarantineDir = `${targetDir}.stale-${Date.now()}-${process.pid}`
    fs.renameSync(targetDir, quarantineDir)
    console.warn(
      `[video-template] generated directory was not empty after cleanup, moved it aside: ${quarantineDir}`
    )
  }
}

function prepareCleanDirectory(targetDir: string) {
  removeOrQuarantineDirectory(targetDir)
  fs.mkdirSync(targetDir, { recursive: true })
}

function replaceGeneratedDirectory(targetDir: string, stagingDir: string) {
  removeOrQuarantineDirectory(targetDir)
  fs.renameSync(stagingDir, targetDir)
}

function getDirectoryOwner(directory: string) {
  try {
    return fs.statSync(directory)
  } catch {
    return null
  }
}

function restoreGeneratedDirectoryOwner(targetDir: string, owner: fs.Stats | null) {
  if (!owner || typeof process.getuid !== 'function' || process.getuid() !== 0) {
    return
  }

  try {
    fs.chownSync(targetDir, owner.uid, owner.gid)
    for (const entry of fs.readdirSync(targetDir, { withFileTypes: true })) {
      const entryPath = resolve(targetDir, entry.name)
      fs.chownSync(entryPath, owner.uid, owner.gid)
      if (entry.isDirectory()) {
        restoreGeneratedDirectoryOwner(entryPath, owner)
      }
    }
  } catch (error) {
    console.warn(
      `[video-template] could not restore generated directory ownership for ${targetDir}: ${formatBuildError(error)}`
    )
  }
}

/** 取目录下所有文件的最新修改时间（用于判断产物是否过期） */
function getLatestMtimeMs(directory: string): number {
  let latest = 0
  const stack = [directory]
  while (stack.length) {
    const current = stack.pop() as string
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const entryPath = resolve(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(entryPath)
      } else {
        try {
          const stat = fs.statSync(entryPath)
          if (stat.mtimeMs > latest) latest = stat.mtimeMs
        } catch {
          /* ignore */
        }
      }
    }
  }
  return latest
}

/** 产物存在且不早于源码，则无需重新打包 */
function isBundleUpToDate(targetDir: string, sourceDir: string): boolean {
  const entryHtml = resolve(targetDir, 'index.html')
  if (!fs.existsSync(entryHtml)) {
    return false
  }
  try {
    const bundleMtime = fs.statSync(entryHtml).mtimeMs
    return bundleMtime >= getLatestMtimeMs(sourceDir)
  } catch {
    return false
  }
}

/**
 * 在独立子进程里执行 Remotion 打包（多个 bundle 串行），并放大堆上限。
 * webpack 全量打包峰值内存很高，跑在 dev 进程内会把整个 electron-vite 一起拖死；
 * 放到子进程后，即使子进程崩溃也只丢本次产物更新。
 * 并行构建会让内存峰值翻倍，因此在同一子进程里顺序执行。
 */
function buildBundlesInChildProcess(pairs: Array<{ entryPoint: string; targetDir: string }>): void {
  const scriptPath = resolve('scripts/build-video-template-bundle.mjs')
  const args = pairs.flatMap(({ entryPoint, targetDir }) => [entryPoint, targetDir])
  const result = spawnSync(process.execPath, ['--max-old-space-size=4096', scriptPath, ...args], {
    stdio: 'inherit'
  })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`bundle child process exited with code ${result.status}`)
  }
}

/**
 * dev 模式下异步触发打包：不等待、结果只写日志。
 * dev 启动绝不能被 webpack 打包阻断——打包慢或 OOM 都不影响 Electron 拉起。
 */
function buildBundlesInBackground(pairs: Array<{ entryPoint: string; targetDir: string }>): void {
  const scriptPath = resolve('scripts/build-video-template-bundle.mjs')
  const args = pairs.flatMap(({ entryPoint, targetDir }) => [entryPoint, targetDir])
  const child = spawn(process.execPath, ['--max-old-space-size=4096', scriptPath, ...args], {
    stdio: 'ignore',
    detached: true
  })
  child.on('error', (error) => {
    console.warn(`[video-template] failed to spawn bundle child: ${String(error)}`)
  })
  child.on('exit', (code) => {
    if (code === 0) {
      console.info('[video-template] prebuilt bundles updated in background')
    } else {
      console.warn(`[video-template] prebuilt bundle child exited with code ${code}`)
    }
  })
  child.unref()
}

/** 清理上次中断留下的 .tmp-* 暂存目录 */
function cleanupStaleStagingDirectories(): void {
  try {
    for (const name of fs.readdirSync(videoTemplateBuildRoot)) {
      if (/\.tmp-\d+-\d+$/.test(name) || /\.stale-\d+-\d+$/.test(name)) {
        fs.rmSync(resolve(videoTemplateBuildRoot, name), { recursive: true, force: true })
      }
    }
  } catch {
    /* ignore */
  }
}

function videoTemplateAssetsPlugin() {
  const sourceDir = resolve('src/main/video-template')

  let isDev = false

  return {
    name: 'build-video-template-assets',
    configResolved(config: { command: string; mode: string }) {
      // electron-vite dev 内部仍以 build(watch) 方式跑主进程，command 是 'build'，
      // 不能用 command 判断；mode 才是区分 dev(development) 与打包(production) 的可靠信号。
      isDev = config.mode !== 'production'
    },
    async closeBundle() {
      // 这个钩子负责产出辅助资源，任何失败都不应该阻止 dev 启动或主构建，
      // 因此整体兜底：只记 warning，异常不外抛。
      try {
        if (!fs.existsSync(sourceDir)) {
          return
        }
        fs.mkdirSync(videoTemplateBuildRoot, { recursive: true })
        const generatedOwner = getDirectoryOwner(videoTemplateBuildRoot)

        cleanupStaleStagingDirectories()

        const sourceStagingDir = `${videoTemplateSourceTargetDir}.tmp-${Date.now()}-${process.pid}`
        prepareCleanDirectory(sourceStagingDir)
        try {
          fs.cpSync(sourceDir, sourceStagingDir, { recursive: true })
          replaceGeneratedDirectory(videoTemplateSourceTargetDir, sourceStagingDir)
          restoreGeneratedDirectoryOwner(videoTemplateSourceTargetDir, generatedOwner)
        } finally {
          if (fs.existsSync(sourceStagingDir)) {
            fs.rmSync(sourceStagingDir, { recursive: true, force: true })
          }
        }

        const bundles = [
          {
            entryPoint: resolve('src/main/video-template/remotion/index.ts'),
            targetDir: videoTemplateBundleTargetDir
          },
          {
            entryPoint: resolve('src/main/video-template/remotion/ai-index.ts'),
            targetDir: videoTemplateAiBundleTargetDir
          }
        ]

        const pending: Array<{ entryPoint: string; targetDir: string }> = []
        for (const { entryPoint, targetDir } of bundles) {
          if (!fs.existsSync(entryPoint)) {
            continue
          }

          // 产物已是最新（比 src/main/video-template 下所有文件都新）就直接复用。
          // webpack 全量打包很吃内存，没必要每次 dev 启动都重跑。
          if (isBundleUpToDate(targetDir, sourceDir)) {
            console.info(`[video-template] prebuilt bundle is up to date, skip rebuild: ${targetDir}`)
            continue
          }

          console.info(`[video-template] building prebuilt bundle: ${targetDir}`)
          pending.push({ entryPoint, targetDir })
        }

        if (pending.length === 0) {
          return
        }

        if (isDev) {
          // dev 下不等待：webpack 打包慢或占内存大都不阻断 Electron 启动
          buildBundlesInBackground(pending)
        } else {
          try {
            buildBundlesInChildProcess(pending)
          } catch (error) {
            // 构建失败保留既有产物继续，不阻断打包流程
            console.warn(`[video-template] prebuilt bundles failed, keep existing bundle: ${formatBuildError(error)}`)
          }
        }
      } catch (error) {
        console.warn(`[video-template] asset preparation skipped: ${formatBuildError(error)}`)
      }
    }
  }
}

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: ['@modelcontextprotocol/sdk']
      }),
      videoTemplateAssetsPlugin()
    ],
    build: {
      outDir: mainBuildOutDir,
      minify: false,  // 禁用压缩混淆
      sourcemap: true,  // 生成sourcemap方便调试
              rollupOptions: {
          treeshake: false,  // 关掉 tree-shaking，防止配置数组元素被误删
          external: [
            'puppeteer-extra',
            'puppeteer-extra-plugin-stealth',
            'electron-store',
            'swagger-jsdoc',
            'swagger-ui-express',
            'esbuild'
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
    publicDir: resolve('public'), // 指定 public 目录位置
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@renderer': resolve('src/renderer/src')
      },
      extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json', '.vue']
    },
    plugins: [vue()],
    server: {
      port: 5175,
      hmr: {
        port: 5175, // 指定HMR端口
        overlay: true // 显示错误覆盖层
      },
      watch: {
        usePolling: true, // 使用轮询监听文件变化
        interval: 1000 // 轮询间隔
      }
    },
    build: {
      outDir: rendererBuildOutDir,
      sourcemap: true // 生成sourcemap
    }
  }
})
