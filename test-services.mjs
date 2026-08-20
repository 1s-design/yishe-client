/**
 * 测试所有新实现的服务
 * 直接调用 HTTP 接口验证数据可获取性
 */

const services = [
  // 新闻服务 - RSS
  { name: 'TechCrunch RSS', url: 'https://techcrunch.com/feed/', type: 'rss' },
  { name: 'Ars Technica RSS', url: 'https://feeds.arstechnica.com/arstechnica/index', type: 'rss' },
  { name: 'The Verge RSS', url: 'https://www.theverge.com/rss/index.xml', type: 'rss' },
  { name: 'Wired RSS', url: 'https://www.wired.com/feed/rss', type: 'rss' },
  { name: 'MIT Tech Review RSS', url: 'https://www.technologyreview.com/feed/', type: 'rss' },
  { name: 'Engadget RSS', url: 'https://www.engadget.com/rss.xml', type: 'rss' },
  { name: 'BBC Technology RSS', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml', type: 'rss' },
  { name: 'Guardian Technology RSS', url: 'https://www.theguardian.com/technology/rss', type: 'rss' },
  { name: 'TIME RSS', url: 'https://time.com/feed/', type: 'rss' },
  { name: 'NPR Technology RSS', url: 'https://feeds.npr.org/1019/rss.xml', type: 'rss' },
  
  // 新闻服务 - JSON API
  { name: '豆瓣电影', url: 'https://movie.douban.com/j/search_subjects?tag=热门&page_limit=5', type: 'json' },
  { name: '直播吧', url: 'https://www.zhibo8.com/', type: 'html' },
  { name: '虎扑', url: 'https://www.hupu.com/', type: 'html' },
  { name: 'BBC Sport RSS', url: 'https://feeds.bbci.co.uk/sport/rss.xml', type: 'rss' },
  { name: '国家统计局', url: 'https://data.stats.gov.cn/', type: 'html' },
  { name: '上交所', url: 'https://www.sse.com.cn/', type: 'html' },
  { name: '中国货币网', url: 'https://www.chinamoney.com.cn/', type: 'html' },
  { name: 'Worldometers', url: 'https://www.worldometers.info/', type: 'html' },
  { name: 'Our World in Data RSS', url: 'https://ourworldindata.org/feed', type: 'rss' },
  { name: 'medRxiv', url: 'https://www.medrxiv.org/', type: 'html' },
  
  // 娱乐影视
  { name: 'Variety', url: 'https://variety.com/', type: 'html' },
  { name: 'Hollywood Reporter', url: 'https://www.hollywoodreporter.com/', type: 'html' },
  { name: 'Deadline', url: 'https://deadline.com/', type: 'html' },
  { name: 'Billboard', url: 'https://www.billboard.com/', type: 'html' },
  { name: 'TMZ', url: 'https://www.tmz.com/', type: 'html' },
  { name: 'IGN', url: 'https://www.ign.com/', type: 'html' },
  { name: 'Polygon', url: 'https://www.polygon.com/', type: 'html' },
  
  // 招聘
  { name: '拉勾', url: 'https://www.lagou.com/', type: 'html' },
  { name: 'BOSS直聘', url: 'https://www.zhipin.com/', type: 'html' },
  { name: '前程无忧', url: 'https://www.51job.com/', type: 'html' },
  { name: 'LinkedIn Jobs', url: 'https://www.linkedin.com/jobs/', type: 'html' },
  
  // 数据工具
  { name: '中国天气网', url: 'https://www.weather.com.cn/', type: 'html' },
  { name: 'Yahoo Finance API', url: 'https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=1d&interval=1d', type: 'json' },
  { name: '新浪财经 HQ', url: 'https://hq.sinajs.cn/list=s_sh000001', type: 'text' },
  { name: '东方财富', url: 'https://www.eastmoney.com/', type: 'html' },
  { name: 'CoinMarketCap', url: 'https://coinmarketcap.com/', type: 'html' },
  
  // 热搜
  { name: '百度热搜', url: 'https://top.baidu.com/board?tab=realtime', type: 'html' },
  { name: 'Lobsters', url: 'https://lobste.rs/top.json', type: 'json' },
  { name: '腾讯新闻', url: 'https://www.qq.com/', type: 'html' },
]

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

async function testService(service) {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    
    const res = await fetch(service.url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html,application/json,*/*' },
      signal: controller.signal,
      redirect: 'follow',
    })
    clearTimeout(timeout)
    
    const status = res.status
    const contentType = res.headers.get('content-type') || ''
    
    let dataOk = false
    let preview = ''
    
    if (service.type === 'json') {
      try {
        const json = await res.json()
        dataOk = json !== null && json !== undefined
        preview = JSON.stringify(json).slice(0, 100)
      } catch {
        dataOk = false
        preview = 'JSON parse failed'
      }
    } else if (service.type === 'rss') {
      const text = await res.text()
      dataOk = text.includes('<rss') || text.includes('<feed') || text.includes('<item') || text.includes('<entry')
      preview = text.slice(0, 80).replace(/\n/g, ' ')
    } else {
      const text = await res.text()
      dataOk = text.length > 100
      preview = text.slice(0, 80).replace(/\n/g, ' ')
    }
    
    return { name: service.name, status, dataOk, preview }
  } catch (e) {
    return { name: service.name, status: 'ERR', dataOk: false, preview: e.message }
  }
}

console.log('=== 服务数据获取测试 ===\n')

const results = []
for (const svc of services) {
  const result = await testService(svc)
  results.push(result)
  const icon = result.dataOk ? '✅' : '❌'
  console.log(`${icon} ${result.name}: HTTP ${result.status} | ${result.preview.slice(0, 60)}`)
}

const passed = results.filter(r => r.dataOk).length
const failed = results.filter(r => !r.dataOk).length
console.log(`\n=== 结果: ${passed} 成功, ${failed} 失败 (共 ${results.length} 个) ===`)

if (failed > 0) {
  console.log('\n❌ 失败的服务:')
  results.filter(r => !r.dataOk).forEach(r => console.log(`  - ${r.name}: ${r.preview}`))
}
