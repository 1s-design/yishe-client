import { resolve } from 'path'
import fs from 'fs'
import { bundle as bundleRemotion } from '@remotion/bundler'
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

function videoTemplateAssetsPlugin() {
  const sourceDir = resolve('src/main/video-template')

  return {
    name: 'build-video-template-assets',
    async closeBundle() {
      if (!fs.existsSync(sourceDir)) {
        return
      }
      fs.mkdirSync(videoTemplateBuildRoot, { recursive: true })
      const generatedOwner = getDirectoryOwner(videoTemplateBuildRoot)

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

      for (const { entryPoint, targetDir } of bundles) {
        if (!fs.existsSync(entryPoint)) {
          continue
        }

        const stagingDir = `${targetDir}.tmp-${Date.now()}-${process.pid}`
        prepareCleanDirectory(stagingDir)

        console.info(`[video-template] building prebuilt bundle: ${targetDir}`)

        try {
          await bundleRemotion({
            entryPoint,
            outDir: stagingDir,
            enableCaching: false,
            onProgress(progress) {
              if (progress === 100 || progress >= 95) {
                console.info(`[video-template] prebuilt bundle progress: ${progress}%`)
              }
            }
          })
          replaceGeneratedDirectory(targetDir, stagingDir)
          restoreGeneratedDirectoryOwner(targetDir, generatedOwner)
        } finally {
          if (fs.existsSync(stagingDir)) {
            fs.rmSync(stagingDir, { recursive: true, force: true })
          }
        }
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
          external: [
            'puppeteer-extra',
            'puppeteer-extra-plugin-stealth',
            'electron-store',
            'swagger-jsdoc',
            'swagger-ui-express'
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
        '@renderer': resolve('src/renderer/src')
      }
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
