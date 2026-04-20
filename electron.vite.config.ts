import { resolve } from 'path'
import fs from 'fs'
import { bundle as bundleRemotion } from '@remotion/bundler'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

const videoTemplateBuildRoot = resolve('generated')
const videoTemplateSourceTargetDir = resolve('generated/video-template-source')
const videoTemplateBundleTargetDir = resolve('generated/video-template-bundle')
const mainBuildOutDir = 'generated/main'
const preloadBuildOutDir = 'generated/preload'
const rendererBuildOutDir = 'generated/renderer'

function copyVideoTemplateSourcePlugin() {
  const sourceDir = resolve('src/main/video-template')
  const targetDir = videoTemplateSourceTargetDir

  return {
    name: 'copy-video-template-source',
    closeBundle() {
      if (!fs.existsSync(sourceDir)) {
        return
      }
      fs.mkdirSync(videoTemplateBuildRoot, { recursive: true })
      fs.rmSync(targetDir, { recursive: true, force: true })
      fs.cpSync(sourceDir, targetDir, { recursive: true })
    }
  }
}

function buildVideoTemplateBundlePlugin() {
  const entryPoint = resolve('src/main/video-template/remotion/index.ts')
  const targetDir = videoTemplateBundleTargetDir

  return {
    name: 'build-video-template-bundle',
    async closeBundle() {
      if (!fs.existsSync(entryPoint)) {
        return
      }

      fs.mkdirSync(videoTemplateBuildRoot, { recursive: true })
      fs.rmSync(targetDir, { recursive: true, force: true })
      fs.mkdirSync(targetDir, { recursive: true })

      console.info(`[video-template] building prebuilt bundle: ${targetDir}`)

      await bundleRemotion({
        entryPoint,
        outDir: targetDir,
        enableCaching: false,
        onProgress(progress) {
          if (progress === 100 || progress >= 95) {
            console.info(`[video-template] prebuilt bundle progress: ${progress}%`)
          }
        }
      })
    }
  }
}

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin(),
      copyVideoTemplateSourcePlugin(),
      buildVideoTemplateBundlePlugin()
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
