/** 通用 RSS/Atom 解析器 */
import { net } from 'electron';

export interface RssItem {
  title: string; link: string; description: string; pubDate: string;
  guid?: string; category?: string[]; author?: string; thumbnail?: string;
}

export interface RssResult {
  success: boolean; url: string; title: string; description: string;
  count: number; items: RssItem[]; error?: string;
}

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

async function getFetchImpl() {
  if (net && typeof net.fetch === 'function') return net.fetch.bind(net);
  return fetch;
}

function getXmlText(xml: string, tag: string, ns?: string): string {
  const pattern = ns ? new RegExp(`<${ns}:${tag}[^>]*>([\\s\\S]*?)<\\/${ns}:${tag}>`) : new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`);
  const m = xml.match(pattern);
  return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '').trim() : '';
}

export async function fetchAndParseRss(url: string): Promise<RssResult> {
  try {
    const fetchFn = await getFetchImpl();
    const res = await fetchFn(url, { headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const feedTitle = getXmlText(xml, 'title');
    const feedDesc = getXmlText(xml, 'subtitle') || getXmlText(xml, 'description');
    const items: RssItem[] = [];
    // Try RSS <item>
    const rssItems = xml.split('<item>').slice(1);
    if (rssItems.length > 0) {
      for (const item of rssItems) {
        const title = getXmlText(item, 'title');
        const link = getXmlText(item, 'link');
        const description = getXmlText(item, 'description');
        const pubDate = getXmlText(item, 'pubDate');
        const guid = getXmlText(item, 'guid');
        const author = getXmlText(item, 'author') || getXmlText(item, 'creator', 'dc');
        const categories: string[] = [];
        const catMatches = item.match(/<category[^>]*>([\s\S]*?)<\/category>/g) || [];
        catMatches.forEach(c => { const t = c.match(/<category[^>]*>([\s\S]*?)<\/category>/); if (t) categories.push(t[1].trim()); });
        const thumbMatch = item.match(/<media:content[^>]*url="([^"]*)"/) || item.match(/<enclosure[^>]*url="([^"]*)"/) || item.match(/<media:thumbnail[^>]*url="([^"]*)"/);
        items.push({ title, link, description, pubDate, guid, category: categories, author, thumbnail: thumbMatch?.[1] });
      }
    } else {
      // Try Atom <entry>
      const atomEntries = xml.split('<entry>').slice(1);
      for (const entry of atomEntries) {
        const title = getXmlText(entry, 'title');
        const linkMatch = entry.match(/<link[^>]*href="([^"]*)"/);
        const link = linkMatch?.[1] || '';
        const description = getXmlText(entry, 'summary') || getXmlText(entry, 'content');
        const pubDate = getXmlText(entry, 'published') || getXmlText(entry, 'updated');
        const guid = getXmlText(entry, 'id');
        const author = getXmlText(entry, 'name', 'atom');
        items.push({ title, link, description, pubDate, guid, author });
      }
    }
    return { success: true, url, title: feedTitle, description: feedDesc, count: items.length, items };
  } catch (error: any) {
    return { success: false, url, title: '', description: '', count: 0, items: [], error: error?.message || '获取RSS失败' };
  }
}
