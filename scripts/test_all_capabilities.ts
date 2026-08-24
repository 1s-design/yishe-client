import { CapabilityRegistry } from '../src/main/capabilities/registry';
import { registerAllCapabilities } from '../src/main/capabilities/index';

interface TestResult {
  namespace: string;
  action: string;
  success: boolean;
  count: number;
  sample: string | null;
  error?: string;
  durationMs: number;
  category: string;
}

async function runTests() {
  registerAllCapabilities();
  console.log(`[Capability Tester] Initialized with ${CapabilityRegistry.size} capabilities.\n`);

  const results: TestResult[] = [];

  // 1. 10大图片搜索引擎
  const searchEngines = [
    { ns: 'baidu', query: '猫咪', cat: '10大图片搜索引擎' },
    { ns: 'bing', query: 'landscape', cat: '10大图片搜索引擎' },
    { ns: 'duckduckgo', query: 'coffee', cat: '10大图片搜索引擎' },
    { ns: 'sogou', query: '插画', cat: '10大图片搜索引擎' },
    { ns: 'so', query: '风景壁纸', cat: '10大图片搜索引擎' },
    { ns: 'wallhaven', query: 'nature', cat: '10大图片搜索引擎' },
    { ns: 'unsplash', query: 'architecture', cat: '10大图片搜索引擎' },
    { ns: 'flickr', query: 'street', cat: '10大图片搜索引擎' },
    { ns: 'googleimages', query: 'wallpaper', cat: '10大图片搜索引擎' },
    { ns: 'yandex', query: 'cyberpunk', cat: '10大图片搜索引擎' },
  ];

  // 2. 主流设计与素材图库
  const materialLibraries = [
    { ns: 'pexels', query: 'flower', cat: '设计/免版权素材图库' },
    { ns: 'pixabay', query: 'nature', cat: '设计/免版权素材图库' },
    { ns: 'stocksnap', query: 'people', cat: '设计/免版权素材图库' },
    { ns: 'openverse', query: 'dog', cat: '设计/免版权素材图库' },
    { ns: 'kaboompics', query: 'interior', cat: '设计/免版权素材图库' },
    { ns: 'rawpixel', query: 'art', cat: '设计/免版权素材图库' },
    { ns: 'openclipart', query: 'car', cat: '设计/免版权素材图库' },
    { ns: 'undraw', query: 'chat', cat: '设计/免版权素材图库' },
    { ns: 'vecteezy', query: 'pattern', cat: '设计/免版权素材图库' },
    { ns: 'nounproject', query: 'home', cat: '设计/免版权素材图库' },
    { ns: 'iconify', query: 'user', cat: '设计/免版权素材图库' },
    { ns: 'openmoji', query: 'smile', cat: '设计/免版权素材图库' },
    { ns: 'googleicons', query: 'settings', cat: '设计/免版权素材图库' },
    { ns: 'emojipedia', query: 'rocket', cat: '设计/免版权素材图库' },
    { ns: 'svgrepo', query: 'arrow', cat: '设计/免版权素材图库' },
    { ns: 'wikimedia', query: 'monet', cat: '设计/免版权素材图库' },
    { ns: 'googleArt', query: 'van gogh', cat: '设计/免版权素材图库' },
    { ns: 'pinterest', query: 'poster', cat: '设计/免版权素材图库' },
  ];

  // 3. 资讯与热搜榜单
  const newsAndHotsearch = [
    { ns: 'hotsearch_weibo', query: '', cat: '实时热榜与资讯' },
    { ns: 'hotsearch_douyin', query: '', cat: '实时热榜与资讯' },
    { ns: 'hotsearch_bilibili', query: '', cat: '实时热榜与资讯' },
    { ns: 'hotsearch_zhihu', query: '', cat: '实时热榜与资讯' },
    { ns: 'hotsearch_toutiao', query: '', cat: '实时热榜与资讯' },
    { ns: 'hotsearch_baidu', query: '', cat: '实时热榜与资讯' },
    { ns: 'hotsearch_v2ex', query: '', cat: '实时热榜与资讯' },
    { ns: 'hotsearch_36kr', query: '', cat: '实时热榜与资讯' },
    { ns: 'hotsearch_ithome', query: '', cat: '实时热榜与资讯' },
    { ns: 'hotsearch_github', query: '', cat: '实时热榜与资讯' },
    { ns: 'hotsearch_hackernews', query: '', cat: '实时热榜与资讯' },
    { ns: 'thepaper', query: '科技', cat: '实时热榜与资讯' },
    { ns: '36kr', query: 'AI', cat: '实时热榜与资讯' },
    { ns: 'huxiu', query: '商业', cat: '实时热榜与资讯' },
    { ns: 'chinadaily', query: 'china', cat: '实时热榜与资讯' },
    { ns: 'hackernews', query: 'ai', cat: '实时热榜与资讯' },
    { ns: 'arxiv', query: 'quantum', cat: '实时热榜与资讯' },
    { ns: 'github', query: 'vue', cat: '实时热榜与资讯' },
    { ns: 'googlenews', query: 'tech', cat: '实时热榜与资讯' },
    { ns: 'techcrunch', query: 'startup', cat: '实时热榜与资讯' },
    { ns: 'theverge', query: 'apple', cat: '实时热榜与资讯' },
  ];

  const allTests = [...searchEngines, ...materialLibraries, ...newsAndHotsearch];

  for (const item of allTests) {
    const start = Date.now();
    try {
      const payload: any = { limit: 5, pageSize: 5 };
      if (item.query) {
        payload.query = item.query;
        payload.keyword = item.query;
      }
      const res = await CapabilityRegistry.call(item.ns, 'search', payload);
      const durationMs = Date.now() - start;
      const rawData = res.data;
      const items = rawData?.items || rawData?.list || (Array.isArray(rawData) ? rawData : []);
      const count = items.length || rawData?.count || 0;
      
      let sample: string | null = null;
      if (items.length > 0) {
        const first = items[0];
        sample = first.image || first.url || first.link || first.title || first.name || JSON.stringify(first).slice(0, 100);
      }

      const success = res.success && count > 0;
      results.push({
        namespace: item.ns,
        action: 'search',
        success,
        count,
        sample,
        error: success ? undefined : (res.error || (count === 0 ? '返回结果列表为空 (count=0)' : undefined)),
        durationMs,
        category: item.cat,
      });

      const icon = success ? '✅' : '❌';
      console.log(`${icon} [${item.cat}] ${item.ns.padEnd(20)} success=${success} count=${String(count).padStart(2)} (${durationMs}ms) ${sample ? `sample=${String(sample).slice(0, 80)}` : `error=${res.error || 'empty'}`}`);
    } catch (err: any) {
      const durationMs = Date.now() - start;
      results.push({
        namespace: item.ns,
        action: 'search',
        success: false,
        count: 0,
        sample: null,
        error: err?.message || String(err),
        durationMs,
        category: item.cat,
      });
      console.log(`❌ [${item.cat}] ${item.ns.padEnd(20)} EXCEPTION: ${err?.message || err}`);
    }
  }

  console.log('\n================ SUMMARY ================');
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  console.log(`Total Tested: ${results.length}`);
  console.log(`Success:      ${successful.length} (${((successful.length / results.length) * 100).toFixed(1)}%)`);
  console.log(`Failed:       ${failed.length}`);

  console.log('\n--- FAILED ITEMS ---');
  for (const f of failed) {
    console.log(`- [${f.category}] ${f.namespace}: ${f.error}`);
  }
}

runTests().catch(console.error);
