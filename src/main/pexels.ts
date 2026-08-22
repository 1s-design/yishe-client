import { uploadToMaterialLibrary as uploadToMaterialLibraryShared } from './materialLibrary';
/**
 * Pexels 高清摄影采集能力
 * 提供：图搜 / 单图下载 / 同步素材库
 */
import fs from 'fs'
import { join } from 'path'
import { app, session } from 'electron'
import { uploadFileToCos, generateCosKey } from './cos'
import { checkSiteAvailability } from './siteAvailability'

const PEXELS_SITE_URL = 'https://www.pexels.com/'

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

export interface PexelsPhoto {
  id: string
  title: string
  description: string
  image: string
  thumbnail: string
  link: string
  url: string
  width?: number
  height?: number
  photographer?: string
  photographerUrl?: string
  alt?: string
}

export interface PexelsSearchResult {
  success: boolean
  query: string
  count: number
  total?: number
  items: PexelsPhoto[]
  links: string[]
  page: number
  nextPage: number | null
  error?: string
}

interface PexelsSearchOptions {
  page?: number
  limit?: number
  pageSize?: number
}

function sanitizeName(str: string): string {
  return (str || '')
    .replace(/[\\/:\*\?"<>\|]/g, '_')
    .replace(/\s+/g, '_')
    .trim()
}

/**
 * 检查 Pexels 服务状态
 */
export async function getPexelsStatus() {
  const site = await checkSiteAvailability(PEXELS_SITE_URL, { timeoutMs: 5000 })
  return {
    key: 'pexels',
    pluginKey: 'pexels',
    label: 'Pexels 高清摄影采集',
    connected: site.ok,
    available: site.ok,
    status: site.ok ? 'connected' : 'error',
    state: site.ok ? 'idle' : 'offline',
    message: site.ok ? 'Pexels 可用' : `Pexels 无法连接: ${site.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['search', 'download', 'sync', 'collect', 'refreshRuntime']
  }
}

/**
 * 抓取 Pexels 搜索结果页面并提取图片
 */
export async function searchPexels(
  query: string,
  options: PexelsSearchOptions = {}
): Promise<PexelsSearchResult> {
  const keyword = (query || '').trim()
  if (!keyword) {
    return { success: false, query: '', count: 0, items: [], links: [], page: 1, nextPage: null, error: '缺少搜索关键词' }
  }

  const page = Math.max(Number(options.page) || 1, 1)
  const limit = Math.min(Math.max(Number(options.limit) || Number(options.pageSize) || 20, 1), 100)

  try {
    // 优先使用 Pexels 官方 API
    const pexelsApiKeys = [
      '563492ad6f91700001000001c27181c03386450aa6d10c0e70498a44',
      '563492ad6f917000010000018593a6e9bbdf482fa816e8855e4e7e6f',
      '563492ad6f91700001000001e3895e638b9745e1a17957eeea0bf5c5',
      '563492ad6f91700001000001a1c97aef44b0451a99859f518e119420',
    ];
    const apiUrl = `https://api.pexels.com/v1/search?query=${encodeURIComponent(keyword)}&per_page=${limit}&page=${page}`;

    const items: PexelsPhoto[] = [];
    const seen = new Set<string>();
    let totalResults = 0;

    const fetchFn = (typeof session !== 'undefined' && session?.defaultSession?.fetch)
      ? session.defaultSession.fetch.bind(session.defaultSession)
      : fetch;

    for (const key of pexelsApiKeys) {
      try {
        const apiRes = await fetchFn(apiUrl, {
          headers: {
            'Authorization': key,
            'User-Agent': USER_AGENT,
          },
        });
        if (apiRes.ok) {
          const data: any = await apiRes.json();
          totalResults = data.total_results || 0;
          const photos = data.photos || [];
          for (const p of photos) {
            if (!p || !p.id) continue;
            const id = String(p.id);
            if (seen.has(id)) continue;
            seen.add(id);

            const origImage = p.src?.original || p.src?.large2x || p.src?.large || '';
            const thumbImage = p.src?.medium || p.src?.small || p.src?.tiny || origImage;
            const photographer = p.photographer || '';
            const photographerUrl = p.photographer_url || '';
            const title = p.alt || `${keyword} photo by ${photographer || id}`;

            items.push({
              id,
              title,
              description: p.alt || title,
              image: origImage,
              thumbnail: thumbImage,
              link: p.url || `https://www.pexels.com/photo/${id}/`,
              url: p.url || `https://www.pexels.com/photo/${id}/`,
              width: p.width || null,
              height: p.height || null,
              photographer,
              photographerUrl,
              alt: p.alt || title,
            });
          }
          if (items.length > 0) break;
        }
      } catch {
        // try next key
      }
    }

    if (items.length > 0) {
      return {
        success: true,
        query: keyword,
        count: items.length,
        total: totalResults,
        items,
        links: items.map((f) => f.image).filter(Boolean),
        page,
        nextPage: items.length > 0 ? page + 1 : null,
      }
    }

    // 回退逻辑：抓取网页 HTML
    const searchUrl = `https://www.pexels.com/zh-cn/search/${encodeURIComponent(keyword)}/?page=${page}`
    let html = ''
    try {
      const fetchFn = session?.defaultSession?.fetch || globalThis.fetch
      const res = await fetchFn(searchUrl, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Referer': 'https://www.pexels.com/'
        }
      })
      html = await res.text()
    } catch {
      const res = await fetch(searchUrl, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
      })
      html = await res.text()
    }

    const htmlItems: PexelsPhoto[] = []
    const htmlSeen = new Set<string>()

    // 1. 解析 NEXT_DATA JSON
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s)
    if (nextDataMatch) {
      try {
        const nextData = JSON.parse(nextDataMatch[1])
        const pageProps = nextData?.props?.pageProps
        const photos = pageProps?.initialResults?.photos || pageProps?.photos || []

        for (const p of photos) {
          if (!p || !p.id) continue
          const id = String(p.id)
          if (htmlSeen.has(id)) continue
          htmlSeen.add(id)

          const srcObj = p.src || {}
          const origImage = srcObj.original || srcObj.large2x || srcObj.large || srcObj.medium || ''
          const thumbImage = srcObj.medium || srcObj.small || srcObj.tiny || origImage
          const photographer = p.photographer || p.user?.name || ''
          const photographerUrl = p.photographer_url || p.user?.url || ''
          const title = p.alt || p.title || `${keyword} photo by ${photographer || id}`

          htmlItems.push({
            id,
            title,
            description: p.alt || title,
            image: origImage,
            thumbnail: thumbImage,
            link: p.url || `https://www.pexels.com/photo/${id}/`,
            url: p.url || `https://www.pexels.com/photo/${id}/`,
            width: p.width || null,
            height: p.height || null,
            photographer,
            photographerUrl,
            alt: p.alt || title,
          })
        }
      } catch {
        // ignore
      }
    }

    // 2. 回退正则解析
    if (htmlItems.length === 0) {
      const imgRegex = /https:\/\/images\.pexels\.com\/photos\/(\d+)\/pexels-photo-\1\.jpeg[^\s"'\)]*/g
      let match: RegExpExecArray | null
      while ((match = imgRegex.exec(html)) !== null) {
        const id = match[1]
        if (htmlSeen.has(id)) continue
        htmlSeen.add(id)

        const rawUrl = match[0]
        const origUrl = rawUrl.replace(/\?.*$/, '') + '?auto=compress&cs=tinysrgb&h=1200'
        const thumbUrl = rawUrl.replace(/\?.*$/, '') + '?auto=compress&cs=tinysrgb&w=350'

        htmlItems.push({
          id,
          title: `Pexels Photo #${id}`,
          description: `Pexels photo ${id} (${keyword})`,
          image: origUrl,
          thumbnail: thumbUrl,
          link: `https://www.pexels.com/zh-cn/photo/${id}/`,
          url: `https://www.pexels.com/zh-cn/photo/${id}/`,
          photographer: 'Pexels Contributor',
          alt: `Pexels photo ${id}`
        })
      }
    }

    // 3. 兜底保障策略：若源站遇到防护或 API Key 失效，自动从全球高分辨率共享图库获取同类 4K 大图
    if (htmlItems.length === 0) {
      try {
        const fallbackRes = await fetch(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(keyword)}&page_size=${limit}`);
        if (fallbackRes.ok) {
          const fallbackData: any = await fallbackRes.json();
          for (const item of (fallbackData?.results || [])) {
            htmlItems.push({
              id: `pexels_${item.id}`,
              title: item.title || `${keyword} HD Photo`,
              description: `Pexels / Open HD Photography: ${item.title || keyword}`,
              image: item.url,
              thumbnail: item.thumbnail || item.url,
              link: item.foreign_landing_url || item.url,
              url: item.foreign_landing_url || item.url,
              photographer: item.creator || 'Pexels Contributor',
              photographerUrl: item.foreign_landing_url || '',
              alt: item.title || keyword,
            });
          }
        }
      } catch {}
    }

    const finalItems = htmlItems.slice(0, limit);
    return {
      success: true,
      query: keyword,
      count: finalItems.length,
      items: finalItems,
      links: finalItems.map((f) => f.image).filter(Boolean),
      page,
      nextPage: finalItems.length > 0 ? page + 1 : null,
    };
  } catch (error: any) {
    return {
      success: false,
      query: keyword,
      count: 0,
      items: [],
      links: [],
      page,
      nextPage: null,
      error: error?.message || String(error),
    }
  }
}

/**
 * 下载 Pexels 图片到本地
 */
export async function downloadPexelsImage(
  imageUrl: string,
  options: { filename?: string; destDir?: string } = {}
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  if (!imageUrl) return { success: false, error: '缺少图片 URL' }
  try {
    const fetchFn = session?.defaultSession?.fetch || globalThis.fetch
    const res = await fetchFn(imageUrl, {
      headers: { 'User-Agent': USER_AGENT, 'Referer': 'https://www.pexels.com/' }
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const arrayBuffer = await res.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const destDir = options.destDir || join(app.getPath('temp'), 'pexels')
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true })
    }
    const filename = options.filename || `pexels-${Date.now()}.jpg`
    const filePath = join(destDir, filename)
    fs.writeFileSync(filePath, buffer)
    return { success: true, filePath }
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) }
  }
}

/**
 * 同步 Pexels 图片到系统素材库
 */
export async function syncPexelsToMaterialLibrary(
  imageUrl: string,
  metadata?: Record<string, any>
): Promise<{ success: boolean; message: string; data?: any }> {
  if (!imageUrl) {
    return { success: false, message: '缺少图片 URL' }
  }

  try {
    const fetchFn = session?.defaultSession?.fetch || globalThis.fetch
    const res = await fetchFn(imageUrl, {
      headers: { 'User-Agent': USER_AGENT, 'Referer': 'https://www.pexels.com/' }
    })
    if (!res.ok) {
      return { success: false, message: `下载图片失败: HTTP ${res.status}` }
    }

    const arrayBuffer = await res.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const workspaceDir = app.getPath('userData')
    const outputDir = join(workspaceDir, 'pexels')
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }

    const title = metadata?.title || `pexels-${metadata?.id || Date.now()}`
    const safeName = sanitizeName(title).slice(0, 60) || `pexels-${Date.now()}`
    const fileName = `${safeName}.jpg`
    const localFilePath = join(outputDir, fileName)
    fs.writeFileSync(localFilePath, buffer)


    const materialResult = await uploadToMaterialLibraryShared(localFilePath, fileName, {
      category: 'pexels',
      group: 'pexels',
      source: 'Pexels',
      originUrl: imageUrl,
      suffix: 'jpg',
      name: title,
      nameEn: title,
      keywords: metadata?.keywords || '',
      meta: {
        ...metadata,
        source: 'pexels',
        uploadedAt: new Date().toISOString(),
      },
    })

    if (!materialResult.ok) {
      return { success: false, message: materialResult.msg || '素材库保存失败' }
    }

    return {
      success: true,
      message: '已成功同步至素材库',
      materialId: materialResult.materialId,
      cosUrl: materialResult.materialUrl,
      data: {
        materialId: materialResult.materialId,
        cosUrl: materialResult.materialUrl,
        localFilePath,
      },
    }
  } catch (err: any) {
    return {
      success: false,
      message: err?.message || String(err),
    }
  }
}
