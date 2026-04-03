import { ref } from 'vue'

/**
 * 带倒计时的 sleep，用于自动处理/自动制作时在页面上显示「还剩 X 秒重新查询」及进度条
 * @returns countdownSeconds 当前剩余秒数（null 表示未在等待）
 *          countdownTotal 当前这次等待的总秒数（用于计算进度百分比）
 *          sleepWithCountdown(ms, shouldStop?) 等待指定毫秒数，每秒更新，若 shouldStop 返回 true 则提前结束
 */
export function useCountdownSleep() {
  const countdownSeconds = ref<number | null>(null)
  const countdownTotal = ref<number | null>(null)

  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

  const sleepWithCountdown = async (
    ms: number,
    shouldStop?: () => boolean
  ): Promise<void> => {
    const totalSeconds = Math.max(1, Math.ceil(ms / 1000))
    countdownTotal.value = totalSeconds
    for (let remaining = totalSeconds; remaining > 0; remaining--) {
      countdownSeconds.value = remaining
      await sleep(1000)
      if (shouldStop?.()) break
    }
    countdownSeconds.value = null
    countdownTotal.value = null
  }

  return { countdownSeconds, countdownTotal, sleepWithCountdown }
}
