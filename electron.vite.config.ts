import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
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
    plugins: [externalizeDepsPlugin()]
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
      hmr: {
        port: 5173, // 指定HMR端口
        overlay: true // 显示错误覆盖层
      },
      watch: {
        usePolling: true, // 使用轮询监听文件变化
        interval: 1000 // 轮询间隔
      }
    },
    build: {
      sourcemap: true // 生成sourcemap
    }
  }
})
