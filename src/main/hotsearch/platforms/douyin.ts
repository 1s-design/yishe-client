import type { PlatformModule } from '../types'
import axios from 'axios'

const douyin: PlatformModule = {
  config: {
    key: 'douyin',
    name: '抖音',
    enabled: true,
    environment: 'direct',
    maxItems: 20,
    timeout: 10000,
    retryCount: 2,
  },

  async fetch(ctx) {
    const { data } = await axios.get('https://www.douyin.com/aweme/v1/web/hot/search/list/', {
      timeout: ctx.timeout,
      headers: {
        'User-Agent': ctx.userAgent,
        'Referer': 'https://www.douyin.com/',
        'Origin': 'https://www.douyin.com',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
      },
    })

    const wordList = Array.isArray(data?.data?.word_list) ? data.data.word_list : []
    const trendingList = Array.isArray(data?.data?.trending_list) ? data.data.trending_list : []
    const allList = wordList.concat(trendingList)

    return allList.slice(0, this.config.maxItems).map((item: any, index: number) => ({
      rank: Number(item.position || index) + 1,
      title: item.word || '未知',
      hot: item.hot_value || '',
      tag: item.label !== undefined ? String(item.label) : undefined,
    }))
  },
}

export default douyin
