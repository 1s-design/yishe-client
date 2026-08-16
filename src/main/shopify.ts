/**
 * Shopify 商店产品搜索能力
 * API: https://{store}.com/products.json (公开，无需Key)
 * 适用于所有 Shopify 搭建的商店
 */
import { net } from 'electron';
import { checkSiteAvailability } from './siteAvailability';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

export interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
  body_html: string;
  vendor: string;
  product_type: string;
  tags: string[];
  images: { src: string }[];
  variants: { id: number; title: string; price: string; compare_at_price: string | null }[];
  published_at: string;
}

export interface ShopifyResult {
  success: boolean;
  query: string;
  count: number;
  total: number;
  items: ShopifyProduct[];
  error?: string;
}

async function getFetchImpl() {
  if (net && typeof net.fetch === 'function') return net.fetch.bind(net);
  return fetch;
}

export async function getShopifyStatus() {
  const site = await checkSiteAvailability('https://shopify.com', { timeoutMs: 8000 });
  return { key: 'shopify', pluginKey: 'shopify', label: 'Shopify 商店', connected: site.ok, available: site.ok, status: site.ok ? 'connected' : 'error', state: site.ok ? 'idle' : 'offline', message: site.ok ? 'Shopify 可用' : `无法连接: ${site.error || '超时'}`, lastCheckedAt: new Date().toISOString(), supportedCommands: ['search', 'fetch', 'status'] };
}

/**
 * 搜索 Shopify 商店产品
 * @param store 商店域名 (如: allbirds.com)
 * @param options 搜索选项
 */
export async function searchShopify(store: string, options: { limit?: number; query?: string; collection?: string; page?: number } = {}): Promise<ShopifyResult> {
  const limit = Math.min(options.limit || 20, 250);
  const page = options.page || 1;

  try {
    const fetchFn = await getFetchImpl();
    const cleanStore = store.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    let url: string;

    if (options.collection) {
      url = `https://${cleanStore}/collections/${options.collection}/products.json?limit=${limit}&page=${page}`;
    } else {
      url = `https://${cleanStore}/products.json?limit=${limit}&page=${page}`;
    }


    const res = await fetchFn(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) {
      return { success: false, query: store, count: 0, total: 0, items: [], error: `HTTP ${res.status}` };
    }

    const data = await res.json() as { products: ShopifyProduct[] };
    let products = data.products || [];

    // 关键词过滤
    if (options.query) {
      const kw = options.query.toLowerCase();
      products = products.filter(p =>
        p.title?.toLowerCase().includes(kw) ||
        p.body_html?.toLowerCase().includes(kw) ||
        p.tags?.some(t => t.toLowerCase().includes(kw))
      );
    }

    return { success: true, query: store, count: products.length, total: products.length, items: products };
  } catch (error: any) {
    return { success: false, query: store, count: 0, total: 0, items: [], error: error?.message || '搜索失败' };
  }
}

export async function syncShopifyToLibrary(_clientId: string, data: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...data.metadata, source: 'shopify', syncedAt: new Date().toISOString() } };
}
