/**
 * 百度图片搜索与采集能力 (Baidu Images)
 * 基于百度图片异步接口 acjson 实现，无需 API Key，支持高清中英文图搜
 */
import fs from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { checkSiteAvailability } from './siteAvailability'
import { uploadToMaterialLibrary as uploadToMaterialLibraryShared } from './materialLibrary'

const BAIDU_IMAGE_SITE = 'https://image.baidu.com/'
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

export interface BaiduPhoto {
  id: string
  title: string
  description: string
  image: string
  thumbnail: string
  link: string
  url: string
  width?: number | null
  height?: number | null
  author?: string
  tags?: string
}

export interface BaiduSearchResult {
  success: boolean
  query: string
  count: number
  items: BaiduPhoto[]
  links: string[]
  page: number
  nextPage: number | null
  error?: string
}

function sanitizeName(str: string): string {
  return (str || '')
    .replace(/[\\/:\*\?"<>\|]/g, '_')
    .replace(/\s+/g, '_')
    .trim()
}

export async function getBaiduStatus() {
  const site = await checkSiteAvailability(BAIDU_IMAGE_SITE, { timeoutMs: 5000 })
  return {
    key: 'baidu',
    pluginKey: 'baidu',
    label: '百度图片搜索',
    connected: site.ok,
    available: site.ok,
    status: site.ok ? 'connected' : 'error',
    state: site.ok ? 'idle' : 'offline',
    message: site.ok ? '百度图片服务可用' : `百度图片无法连接: ${site.error || '超时'}`,
    lastCheckedAt: new Date().toISOString(),
    supportedCommands: ['search', 'download', 'sync', 'collect']
  }
}

export async function searchBaidu(
  query: string,
  options: { page?: number; limit?: number; pageSize?: number } = {}
): Promise<BaiduSearchResult> {
  const keyword = (query || '').trim()
  if (!keyword) {
    return { success: false, query: '', count: 0, items: [], links: [], page: 1, nextPage: null, error: '缺少搜索关键词' }
  }

  const page = Math.max(Number(options.page) || 1, 1)
  const limit = Math.min(Math.max(Number(options.limit) || Number(options.pageSize) || 20, 1), 60)
  const pn = (page - 1) * limit

  try {
    const url = `https://image.baidu.com/search/acjson?tn=resultjson_com&logid=${Date.now()}&ipn=rj&ct=201326592&is=&fp=result&queryWord=${encodeURIComponent(keyword)}&cl=2&lm=-1&ie=utf-8&oe=utf-8&adpicid=&st=-1&z=&ic=0&hd=&latest=&copyright=&word=${encodeURIComponent(keyword)}&s=&se=&tab=&width=&height=&face=0&istype=2&qc=&nc=1&fr=&expermode=&nojc=&isAsync=&pn=${pn}&rn=${limit}&gsm=${Date.now().toString(16)}`

    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': 'https://image.baidu.com/search/index?tn=baiduimage&word=' + encodeURIComponent(keyword),
        'Accept': 'text/plain, */*; q=0.01',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    })

    if (!res.ok) {
      throw new Error(`百度图片接口响应 HTTP ${res.status}`)
    }

    const jsonText = await res.text()
    let data: any
    try {
      data = JSON.parse(jsonText)
    } catch {
      const sanitized = jsonText.replace(/'/g, '"').replace(/\\'/g, "'")
      data = JSON.parse(sanitized)
    }

    const rawList = Array.isArray(data?.data) ? data.data : []
    const items: BaiduPhoto[] = []
    const seen = new Set<string>()

    for (const item of rawList) {
      const imgUrl = item.middleURL || item.hoverURL || item.thumbURL
      if (!imgUrl || !/^https?:\/\//i.test(imgUrl)) continue
      const id = String(item.di || item.os || item.bdImgkey || items.length + 1)
      if (seen.has(imgUrl)) continue
      seen.add(imgUrl)

      const title = sanitizeName(item.fromPageTitleEnc || item.fromPageTitle || keyword).slice(0, 100) || `${keyword}_${id}`

      items.push({
        id,
        title,
        description: item.fromPageTitleEnc || title,
        image: imgUrl,
        thumbnail: item.thumbURL || imgUrl,
        link: item.fromURL || imgUrl,
        url: item.fromURL || imgUrl,
        width: item.width || null,
        height: item.height || null,
        author: item.fromURLHost || 'Baidu Image',
        tags: keyword,
      })
      if (items.length >= limit) break
    }

    return {
      success: true,
      query: keyword,
      count: items.length,
      items,
      links: items.map((i) => i.image),
      page,
      nextPage: items.length >= limit ? page + 1 : null,
    }
  } catch (error: any) {
    return {
      success: false,
      query: keyword,
      count: 0,
      items: [],
      links: [],
      page,
      nextPage: null,
      error: error?.message || '百度图片搜索失败',
    }
  }
}

export async function downloadBaiduImage(
  imageUrl: string,
  options: { filename?: string; destDir?: string } = {}
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  if (!imageUrl) return { success: false, error: '缺少图片 URL' }
  try {
    const res = await fetch(imageUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': 'https://image.baidu.com/',
      },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buffer = Buffer.from(await res.arrayBuffer())
    const destDir = options.destDir || join(app.getPath('temp'), 'baidu')
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })
    const filename = options.filename || `baidu-${Date.now()}.jpg`
    const filePath = join(destDir, filename)
    fs.writeFileSync(filePath, buffer)
    return { success: true, filePath }
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) }
  }
}

export async function syncBaiduToMaterialLibrary(
  imageUrl: string,
  metadata?: Record<string, any>
): Promise<{ success: boolean; message: string; data?: any }> {
  if (!imageUrl) return { success: false, message: '缺少图片 URL' }
  try {
    const dl = await downloadBaiduImage(imageUrl)
    if (!dl.success || !dl.filePath) {
      return { success: false, message: dl.error || '下载图片失败' }
    }
    const title = metadata?.title || `baidu-${Date.now()}`
    const fileName = `baidu_${sanitizeName(title).slice(0, 50)}_${Date.now()}.jpg`
    const res = await uploadToMaterialLibraryShared(dl.filePath, fileName, {
      category: 'baidu',
      group: 'baidu',
      source: metadata?.author ? `Baidu Images - ${metadata.author}` : 'image.baidu.com',
      originUrl: imageUrl,
      suffix: 'jpg',
      name: title,
      nameEn: title,
      description: metadata?.description || title,
      keywords: metadata?.tags || metadata?.keywords || '',
      meta: {
        ...metadata,
        source: 'baidu',
        uploadedAt: new Date().toISOString(),
      },
    })
    return {
      success: res.ok,
      message: res.ok ? '同步素材库成功' : res.msg || '素材库保存失败',
      data: {
        materialId: res.materialId,
        cosUrl: res.materialUrl,
        localFilePath: dl.filePath,
      },
    }
  } catch (err: any) {
    return { success: false, message: err?.message || String(err) }
  }
}
