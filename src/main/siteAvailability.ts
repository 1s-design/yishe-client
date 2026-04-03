interface SiteAvailabilityOptions {
  timeoutMs?: number
}

export interface SiteAvailabilityResult {
  ok: boolean
  url: string
  status?: number | null
  latencyMs?: number | null
  checkedAt: string
  error?: string | null
}

function createTimeoutSignal(timeoutMs: number) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timer)
  }
}

async function requestSite(url: string, method: 'HEAD' | 'GET', timeoutMs: number) {
  const startedAt = Date.now()
  const { signal, cleanup } = createTimeoutSignal(timeoutMs)

  try {
    const response = await fetch(url, {
      method,
      redirect: 'follow',
      cache: 'no-store',
      signal
    })

    return {
      ok: response.status > 0 && response.status < 500,
      status: response.status,
      latencyMs: Date.now() - startedAt,
      error: null
    }
  } catch (error: any) {
    return {
      ok: false,
      status: null,
      latencyMs: Date.now() - startedAt,
      error: error?.name === 'AbortError' ? `请求超时(${timeoutMs}ms)` : error?.message || '请求失败'
    }
  } finally {
    cleanup()
  }
}

export async function checkSiteAvailability(url: string, options: SiteAvailabilityOptions = {}): Promise<SiteAvailabilityResult> {
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 5000)
  const checkedAt = new Date().toISOString()

  const headResult = await requestSite(url, 'HEAD', timeoutMs)
  if (headResult.ok) {
    return {
      ok: true,
      url,
      status: headResult.status,
      latencyMs: headResult.latencyMs,
      checkedAt,
      error: null
    }
  }

  const getResult = await requestSite(url, 'GET', timeoutMs)
  return {
    ok: getResult.ok,
    url,
    status: getResult.status,
    latencyMs: getResult.latencyMs,
    checkedAt,
    error: getResult.error || headResult.error || null
  }
}
