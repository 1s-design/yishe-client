#!/usr/bin/env node
/**
 * Favicon 批量下载脚本
 * 从 https://favicon.run/favicon?domain={domain}&sz=256 下载
 * 用法: node scripts/download-favicons.cjs
 */
const https = require('https');
const fs = require('fs');
const { join } = require('path');

const OUTPUT_DIR = join(__dirname, '..', 'src', 'renderer', 'public', 'favicons');

const DOMAINS = {
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

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
      timeout: 15000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function downloadFavicon(platform, domain) {
  const url = `https://favicon.run/favicon?domain=${encodeURIComponent(domain)}&sz=256`;
  console.log(`  [${platform}] ${domain}...`);
  try {
    const buffer = await fetchUrl(url);
    const outputPath = join(OUTPUT_DIR, `${platform}.png`);
    fs.writeFileSync(outputPath, buffer);
    console.log(`    ✓ ${buffer.length} bytes`);
    return true;
  } catch (e) {
    console.log(`    ✗ ${e.message}`);
    return false;
  }
}

async function main() {
  console.log('🎨 下载新闻平台 favicon...\n');
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  let ok = 0, fail = 0;
  for (const [platform, domain] of Object.entries(DOMAINS)) {
    if (await downloadFavicon(platform, domain)) ok++;
    else fail++;
  }
  console.log(`\n✅ 完成: ${ok} 成功, ${fail} 失败`);
  console.log(`📁 输出: ${OUTPUT_DIR}`);
}

main().catch(console.error);
