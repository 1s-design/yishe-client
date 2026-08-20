/**
 * Test script for new news services (Batch 3)
 * Verifies each service can fetch data successfully.
 *
 * Usage: node test-new-services.mjs
 *
 * Note: This tests the fetch logic directly. For full IPC testing,
 * run the Electron app and use the renderer's service status panel.
 */

// Lightweight HTTP test to verify the target URLs are reachable and parseable.
// Full IPC/integration testing is done via the Electron app's service status panel.

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Test configurations for each service
const services = [
  { key: 'ign', name: 'IGN', url: 'https://www.ign.com/feed.xml', type: 'rss' },
  { key: 'polygon', name: 'Polygon', url: 'https://www.polygon.com/rss/index.xml', type: 'rss' },
  { key: 'bbc_sport', name: 'BBC Sport', url: 'https://feeds.bbci.co.uk/sport/rss.xml', type: 'rss' },
  { key: 'ourworldindata', name: 'Our World in Data', url: 'https://ourworldindata.org/feed', type: 'rss' },
  { key: 'douban_movie', name: '豆瓣电影', url: 'https://movie.douban.com/', type: 'html' },
  { key: 'douban_book', name: '豆瓣读书', url: 'https://book.douban.com/', type: 'html' },
  { key: 'douban_gallery', name: '豆瓣广场', url: 'https://www.douban.com/gallery/', type: 'html' },
  { key: 'zhibo8', name: '直播吧', url: 'https://www.zhibo8.com/', type: 'html' },
  { key: 'hupu', name: '虎扑', url: 'https://bbs.hupu.com/all-gambia', type: 'html' },
  { key: 'flashscore', name: 'Flashscore', url: 'https://www.flashscore.com/', type: 'html' },
  { key: 'lagou', name: '拉勾', url: 'https://www.lagou.com/', type: 'html' },
  { key: 'zhipin', name: 'BOSS直聘', url: 'https://www.zhipin.com/', type: 'html' },
  { key: '51job', name: '前程无忧', url: 'https://www.51job.com/', type: 'html' },
  { key: 'linkedin_jobs', name: 'LinkedIn Jobs', url: 'https://www.linkedin.com/jobs/', type: 'html' },
  { key: 'stats_gov', name: '国家统计局', url: 'https://www.stats.gov.cn/', type: 'html' },
  { key: 'sse', name: '上交所', url: 'https://www.sse.com.cn/', type: 'html' },
  { key: 'chinamoney', name: '中国货币网', url: 'https://www.chinamoney.com.cn/', type: 'html' },
  { key: 'worldometers', name: 'Worldometers', url: 'https://www.worldometers.info/', type: 'html' },
  { key: 'medrxiv', name: 'medRxiv', url: 'https://www.medrxiv.org/recent', type: 'html' },
];

async function testService(service) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(service.url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html,application/xhtml+xml,application/xml,*/*' },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timer);

    const statusOk = res.status > 0 && res.status < 500;
    const contentType = res.headers.get('content-type') || '';
    const body = await res.text();
    const hasContent = body.length > 100;

    return {
      key: service.key,
      name: service.name,
      url: service.url,
      reachable: statusOk,
      status: res.status,
      contentType: contentType.split(';')[0],
      contentLength: body.length,
      hasContent,
      ok: statusOk && hasContent,
    };
  } catch (error) {
    return {
      key: service.key,
      name: service.name,
      url: service.url,
      reachable: false,
      status: 0,
      contentType: '',
      contentLength: 0,
      hasContent: false,
      ok: false,
      error: error?.message || 'Unknown error',
    };
  }
}

async function main() {
  console.log('=== New News Services Test (Batch 3) ===\n');
  console.log(`Testing ${services.length} services...\n`);

  const results = [];
  for (const service of services) {
    process.stdout.write(`Testing ${service.name}... `);
    const result = await testService(service);
    results.push(result);
    console.log(result.ok ? '✅ OK' : `❌ FAIL (${result.error || `HTTP ${result.status}`})`);
  }

  console.log('\n=== Summary ===\n');
  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;

  console.log(`Total: ${results.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);

  if (failed > 0) {
    console.log('\nFailed services:');
    for (const r of results.filter(r => !r.ok)) {
      console.log(`  - ${r.name} (${r.key}): ${r.error || `HTTP ${r.status}, content: ${r.contentLength}b`}`);
    }
  }

  console.log('\n=== Detailed Results ===\n');
  for (const r of results) {
    console.log(`${r.ok ? '✅' : '❌'} ${r.name}`);
    console.log(`   URL: ${r.url}`);
    console.log(`   Status: ${r.status}, Content-Type: ${r.contentType}, Size: ${r.contentLength}b`);
    if (r.error) console.log(`   Error: ${r.error}`);
    console.log('');
  }

  process.exit(failed > 0 ? 1 : 0);
}

main();
