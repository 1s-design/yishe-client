/**
 * Internet Archive 媒体采集
 * 搜索: https://archive.org/advancedsearch.php
 * 元数据: https://archive.org/metadata/{identifier}
 * 无需 API Key，支持图片/视频/音频
 */

const SEARCH_API = 'https://archive.org/advancedsearch.php'
const METADATA_API = 'https://archive.org/metadata'

const USER_AGENT = 'YisheMediaCollect/1.0 (yishe; contact: admin@1s.design)'

export interface InternetArchiveFile {
  id: string
  title: string
  description: string
  image: string
  thumbnail: string
  link: string
  url: string
  width?: number
  height?: number
  mime?: string
  duration?: number
  author?: string
  license?: string
  date?: string
  mediatype?: string
}

export interface InternetArchiveSearchResult {
  success: boolean
  query: string
  total: number
  count: number
  items: InternetArchiveFile[]
  nextPage: number | null
  error?: string
}

interface InternetArchiveSearchOptions {
  mediaType?: 'image' | 'video' | 'audio'
  page?: number
  pageSize?: number
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 搜索 Internet Archive
 */
export async function searchInternetArchive(
  query: string,
  options: InternetArchiveSearchOptions = {}
): Promise<InternetArchiveSearchResult> {
  const keyword = (query || '').trim()
  if (!keyword) {
    return { success: false, query: '', total: 0, count: 0, items: [], nextPage: null, error: '缺少搜索关键词' }
  }

  const page = options.page || 1
  const pageSize = Math.min(options.pageSize || 20, 50)

  // 构建查询
  const queryParts = [keyword]
  if (options.mediaType === 'video') {
    queryParts.push('mediatype:movies')
  } else if (options.mediaType === 'audio') {
    queryParts.push('mediatype:audio')
  } else if (options.mediaType === 'image') {
    queryParts.push('mediatype:image')
  }
  const searchQuery = queryParts.join(' AND ')

  const params = new URLSearchParams({
    q: searchQuery,
    fl: 'identifier,title,mediatype,description,license,subject,creator,date',
    rows: String(pageSize),
    page: String(page),
    output: 'json',
  })

  try {
    const url = `${SEARCH_API}?${params.toString()}`
    const r = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
    })

    if (!r.ok) {
      throw new Error(`Internet Archive 搜索返回 HTTP ${r.status}`)
    }

    const data = await r.json()
    const response = data.response || {}
    const docs = response.docs || []
    const total = response.numFound || 0

    // 批量获取元数据（获取直接下载 URL）
    const items: InternetArchiveFile[] = []
    const batchSize = 5
    for (let i = 0; i < docs.length; i += batchSize) {
      const batch = docs.slice(i, i + batchSize)
      const results = await Promise.allSettled(
        batch.map(async (doc: any) => {
          const meta = await getMetadata(doc.identifier)
          return buildFile(doc, meta)
        })
      )
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          items.push(result.value)
        }
      }
      await sleep(300)
    }

    const nextPage = page * pageSize < total ? page + 1 : null

    return {
      success: true,
      query: keyword,
      total,
      count: items.length,
      items,
      nextPage,
    }
  } catch (error: any) {
    return {
      success: false,
      query: keyword,
      total: 0,
      count: 0,
      items: [],
      nextPage: null,
      error: error?.message || String(error),
    }
  }
}

/** 获取单个 identifier 的元数据 */
async function getMetadata(identifier: string): Promise<any> {
  try {
    const url = `${METADATA_API}/${identifier}`
    const r = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
    })
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  }
}

/** 从文件列表找到最佳媒体文件 */
function findBestFile(files: any[], mediaType: string): any {
  if (!files?.length) return null

  const extPatterns: Record<string, RegExp> = {
    image: /\.(jpg|jpeg|png|gif|tiff|svg)$/i,
    video: /\.(mp4|webm|ogg|avi|mov|mkv)$/i,
    audio: /\.(mp3|ogg|wav|flac|aac|m4a)$/i,
  }

  const pattern = extPatterns[mediaType]
  if (!pattern) return null

  const candidates = files.filter((f: any) => f.name && pattern.test(f.name))
  if (!candidates.length) return null

  // 优先 original
  const originals = candidates.filter((f: any) => f.source === 'original')
  if (originals.length) {
    return originals.sort((a: any, b: any) => (parseInt(b.size, 10) || 0) - (parseInt(a.size, 10) || 0))[0]
  }

  return candidates.sort((a: any, b: any) => (parseInt(b.size, 10) || 0) - (parseInt(a.size, 10) || 0))[0]
}

/** 构建下载 URL */
function buildDownloadUrl(meta: any, filename: string): string {
  const server = meta.server || meta.d1 || 'ia801503.us.archive.org'
  const dir = meta.dir || meta.item_dir || `/items/${meta.metadata?.identifier}`
  return `https://${server}${dir}/${filename}`
}

/** 构建统一的 InternetArchiveFile */
function buildFile(doc: any, meta: any): InternetArchiveFile | null {
  const mediatype = doc.mediatype || meta?.metadata?.mediatype || 'data'

  let mediaType: 'image' | 'video' | 'audio'
  if (mediatype === 'movies') mediaType = 'video'
  else if (mediatype === 'audio') mediaType = 'audio'
  else if (mediatype === 'image') mediaType = 'image'
  else return null // 跳过 text/data 类型

  const files = meta?.files || []
  const bestFile = findBestFile(files, mediaType)

  const title = Array.isArray(doc.title) ? doc.title[0] : (doc.title || doc.identifier)
  const description = Array.isArray(doc.description)
    ? doc.description[0]
    : (doc.description || meta?.metadata?.description || '')
  const creator = Array.isArray(doc.creator)
    ? doc.creator[0]
    : (doc.creator || meta?.metadata?.creator || '')
  const subject = Array.isArray(doc.subject)
    ? doc.subject
    : (doc.subject ? [doc.subject] : meta?.metadata?.subject || [])

  // 构建缩略图 URL
  let thumbnail = ''
  if (bestFile?.name && mediaType !== 'audio') {
    thumbnail = buildDownloadUrl(meta, bestFile.name.replace(/\.\w+$/, '_thumb.jpg'))
  }

  return {
    id: doc.identifier,
    title: typeof title === 'string' ? title : String(title),
    description: typeof description === 'string' ? description : String(description || ''),
    image: bestFile?.name ? buildDownloadUrl(meta, bestFile.name) : '',
    thumbnail,
    link: `https://archive.org/details/${doc.identifier}`,
    url: `https://archive.org/details/${doc.identifier}`,
    width: undefined,
    height: undefined,
    mime: bestFile?.format || '',
    duration: bestFile?.length ? parseFloat(bestFile.length) : undefined,
    author: typeof creator === 'string' ? creator : '',
    license: doc.license || meta?.metadata?.license || '',
    date: doc.date || meta?.metadata?.date || '',
    mediatype,
  }
}

/** 下载 Internet Archive 文件到本地 */
export async function downloadInternetArchiveFile(
  fileUrl: string,
  destDir: string,
  filename?: string
): Promise<string> {
  const { join } = await import('path')
  const fs = await import('fs')

  if (!/^https?:\/\//.test(fileUrl)) {
    throw new Error(`无效的文件地址: ${fileUrl}`)
  }

  const r = await fetch(fileUrl, {
    headers: { 'User-Agent': USER_AGENT },
  })

  if (!r.ok) {
    throw new Error(`文件下载失败: HTTP ${r.status}`)
  }

  const buf = Buffer.from(await r.arrayBuffer())
  if (buf.length < 100) {
    throw new Error('文件下载异常 (内容过小)')
  }

  // 推断扩展名
  const ext = guessExt(fileUrl)
  const name = filename || `${Date.now()}${ext}`
  const filePath = join(destDir, name)

  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true })
  }
  fs.writeFileSync(filePath, buf)
  return filePath
}

function guessExt(url: string): string {
  const m = url.match(/\.(mp4|webm|ogg|avi|mov|mkv|mp3|wav|flac|aac|m4a|jpg|jpeg|png|gif|svg)(\?|$)/i)
  return m ? `.${m[1].toLowerCase()}` : ''
}
