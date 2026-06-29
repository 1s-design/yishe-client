import type { PlatformModule } from '../types'
import axios from 'axios'

const toutiao: PlatformModule = {
  config: {
    key: 'toutiao',
    name: '今日头条',
    enabled: true,
    environment: 'direct',
    maxItems: 20,
    timeout: 10000,
    retryCount: 2,
  },

  async fetch(ctx) {
    const { data } = await axios.get(
      'https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc&_signature=_02B4Z6wo00d01uZ8GWAAAIDDz3iHH3KJrErmWB3AANEo4eBSpe-2Jfe9R-.N8hsm2L3TJLUZ0SWUoOwDqNk3r3Kdk4SHDvLuX9UB8I.YXoCkKBDJl9GGqFQRg1CtjnvMjNw0q1W2jBz4V3JF48',
      {
        timeout: ctx.timeout,
        headers: {
          'User-Agent': ctx.userAgent,
          'Referer': 'https://www.toutiao.com/',
          'Sec-Fetch-Dest': 'empty',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Site': 'same-origin',
        },
      },
    )

    const list = Array.isArray(data?.data) ? data.data : []
    return list.slice(0, this.config.maxItems).map((item: any, index: number) => ({
      rank: index + 1,
      title: item.Title || '未知',
      hot: item.HotValue || '',
      url: item.Url || undefined,
      tag: item.LabelDesc || undefined,
    }))
  },
}

export default toutiao
