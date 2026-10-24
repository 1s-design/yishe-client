// 在独立进程里构建 Remotion 预打包产物，并原子替换目标目录。
//
// 背景：@remotion/bundler 的 bundle() 会把 webpack 跑在调用方进程内，
// 整套 Remotion + React 打包在内存较小的 Windows 机器上会触发
// V8 原生 Zone OOM（Fatal process out of memory: Zone）并直接 abort 进程。
// 因此这里把构建放到单独的子进程，并放大堆上限：
// 子进程即使失败/崩溃也只影响本次产物更新，不会带走 dev CLI 和主进程。
//
// 用法：node build-video-template-bundle.mjs <entryPoint> <targetDir> [...更多成对参数]
// 多个 bundle 串行构建（并行会让内存峰值翻倍）。
// 每个 bundle 先构建到 <targetDir>.tmp-<pid>，成功后再替换 targetDir，避免半成品。
import { bundle } from '@remotion/bundler'
import fs from 'fs'

const args = process.argv.slice(2)

if (args.length < 2 || args.length % 2 !== 0) {
  console.error('[video-template] usage: node build-video-template-bundle.mjs <entryPoint> <targetDir> [...]')
  process.exit(2)
}

function removeDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

let failed = false

for (let index = 0; index < args.length; index += 2) {
  const entryPoint = args[index]
  const targetDir = args[index + 1]
  const stagingDir = `${targetDir}.tmp-${process.pid}`

  removeDir(stagingDir)
  fs.mkdirSync(stagingDir, { recursive: true })

  try {
    await bundle({
      entryPoint,
      outDir: stagingDir,
      enableCaching: false,
    })

    removeDir(targetDir)
    fs.renameSync(stagingDir, targetDir)
    console.info(`[video-template] prebuilt bundle written: ${targetDir}`)
  } catch (error) {
    failed = true
    removeDir(stagingDir)
    console.error(`[video-template] prebuilt bundle failed: ${targetDir}`, error)
  }
}

process.exit(failed ? 1 : 0)
