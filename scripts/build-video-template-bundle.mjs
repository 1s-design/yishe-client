// 在独立进程里构建 Remotion 预打包产物。
//
// 背景：@remotion/bundler 的 bundle() 会把 webpack 跑在调用方进程内，
// 整套 Remotion + React 打包在内存较小的 Windows 机器上会触发
// V8 原生 Zone OOM（Fatal process out of memory: Zone）并直接 abort 进程。
// 因此这里把构建放到单独的子进程，并放大堆上限：
// 子进程即使失败/崩溃也只影响本次产物更新，不会带走 dev CLI 和主进程。
import { bundle } from '@remotion/bundler'

const [, , entryPoint, outDir] = process.argv

if (!entryPoint || !outDir) {
  console.error('[video-template] usage: node build-video-template-bundle.mjs <entryPoint> <outDir>')
  process.exit(2)
}

try {
  await bundle({
    entryPoint,
    outDir,
    enableCaching: false,
  })
  console.info(`[video-template] prebuilt bundle written: ${outDir}`)
} catch (error) {
  console.error('[video-template] prebuilt bundle failed:', error)
  process.exit(1)
}
