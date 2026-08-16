/**
 * Favicon 下载器 - 使用 favicon.run 直接图片 URL
 * URL: https://favicon.run/favicon?domain={domain}&sz=256
 * 无需API Key，直接下载图片
 */
import fs from 'fs';
import { join } from 'path';
import { app, net } from 'electron';

const FAVICON_URL_TEMPLATE = 'https://favicon.run/favicon';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

/** 所有新闻平台的域名 */
export const NEWS_DOMAINS: Record<string, string> = {
  hackernews: 'news.ycombinator.com',
  arxiv: 'arxiv.org',
  github: 'github.com',
  gdelt: 'gdeltproject.org',
  googlenews: 'news.google.com',
  reddit: 'reddit.com',
  producthunt: 'producthunt.com',
  theguardian: 'theguardian.com',
  bbcnews: 'bbc.com',
  npr: 'npr.org',
  techcrunch: 'techcrunch.com',
  theverge: 'theverge.com',
  arstechnica: 'arstechnica.com',
  mittechreview: 'technologyreview.com',
  reuters: 'reuters.com',
  chinadaily: 'chinadaily.com.cn',
  govcn: 'gov.cn',
  xinhuanet: 'news.cn',
};

/** 备用直接 favicon.ico URL（用于 favicon.run 失败的站点） */
const DIRECT_FALLBACK: Record<string, string> = {
  govcn: 'https://www.gov.cn/favicon.ico',
};

function getFaviconCacheDir(): string {
  const baseDir = app ? app.getPath('userData') : process.env.HOME || '/tmp';
  const cacheDir = join(baseDir, 'yishe-favicons');
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
  return cacheDir;
}

async function getFetchImpl(): Promise<typeof fetch> {
  if (net && typeof net.fetch === 'function') return net.fetch.bind(net);
  return fetch;
}

/**
 * 下载单个平台的 favicon（sz=256 获取最大尺寸）
 */
export async function downloadFavicon(platform: string): Promise<string | null> {
  const domain = NEWS_DOMAINS[platform];
  if (!domain) return null;

  const cacheDir = getFaviconCacheDir();
  const cachePath = join(cacheDir, `${platform}.png`);

  // 已缓存则直接返回
  if (fs.existsSync(cachePath)) return cachePath;

  const fetchFn = await getFetchImpl();

  // 主方案: favicon.run sz=256（最大尺寸）
  try {
    const url = `${FAVICON_URL_TEMPLATE}?domain=${encodeURIComponent(domain)}&sz=256`;
    const res = await fetchFn(url, { headers: { 'User-Agent': USER_AGENT } });
    if (res.ok) {
      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      if (buffer.length > 100) {
        fs.writeFileSync(cachePath, buffer);
        console.log(`[Favicon] ✓ ${platform} → ${buffer.length}b`);
        return cachePath;
      }
    }
  } catch (e) {
    console.warn(`[Favicon] favicon.run ${platform} 失败，尝试备用方案`);
  }

  // 备用方案: 直接 favicon.ico
  const fallbackUrl = DIRECT_FALLBACK[platform] || `https://${domain}/favicon.ico`;
  try {
    const res = await fetchFn(fallbackUrl, { headers: { 'User-Agent': USER_AGENT } });
    if (res.ok) {
      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      if (buffer.length > 100) {
        fs.writeFileSync(cachePath, buffer);
        console.log(`[Favicon] ✓ ${platform} (备用) → ${buffer.length}b`);
        return cachePath;
      }
    }
  } catch (e) {
    console.error(`[Favicon] ✗ ${platform} 下载失败:`, e);
  }

  return null;
}

/**
 * 批量下载所有新闻平台 favicon
 */
export async function downloadAllFavicons(): Promise<Record<string, string>> {
  const results: Record<string, string> = {};
  await Promise.all(
    Object.keys(NEWS_DOMAINS).map(async (platform) => {
      const path = await downloadFavicon(platform);
      if (path) results[platform] = path;
    })
  );
  console.log(`[Favicon] 下载完成: ${Object.keys(results).length}/${Object.keys(NEWS_DOMAINS).length}`);
  return results;
}

/**
 * 获取 favicon 的 Base64 数据（用于渲染）
 */
export async function getFaviconBase64(platform: string): Promise<string | null> {
  const cacheDir = getFaviconCacheDir();
  const cachePath = join(cacheDir, `${platform}.png`);
  if (fs.existsSync(cachePath)) {
    const buffer = fs.readFileSync(cachePath);
    return `data:image/png;base64,${buffer.toString('base64')}`;
  }
  const path = await downloadFavicon(platform);
  if (!path) return null;
  const buffer = fs.readFileSync(path);
  return `data:image/png;base64,${buffer.toString('base64')}`;
}
