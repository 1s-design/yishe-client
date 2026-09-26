/**
 * 统一的 fetch 实现
 * 优先使用 Electron net.fetch（能绕过 CORS），降级到原生 fetch
 */

let fetchImplPromise: Promise<typeof fetch> | null = null

export async function getFetchImpl(): Promise<typeof fetch> {
  if (!fetchImplPromise) {
    fetchImplPromise = (async () => {
      try {
        const electron = await import('electron')
        const net = electron.net
        if (net && typeof (net as any).fetch === 'function') {
          return (net as any).fetch.bind(net) as typeof fetch
        }
      } catch {
        // non-electron env
      }
      return fetch
    })()
  }
  return fetchImplPromise
}
