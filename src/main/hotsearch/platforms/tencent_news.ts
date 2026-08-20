/**
 * 腾讯新闻热搜
 * 数据源：腾讯新闻首页 HTML 解析
 */

import type { PlatformModule } from "../types";
import axios from "axios";

const tencentNews: PlatformModule = {
  config: {
    key: "tencent_news",
    name: "腾讯新闻",
    enabled: true,
    environment: "direct",
    maxItems: 20,
    timeout: 12000,
    retryCount: 2,
  },

  async fetch(ctx) {
    const { data: html } = await axios.get("https://news.qq.com/", {
      timeout: ctx.timeout,
      responseType: "text",
      headers: {
        "User-Agent": ctx.userAgent,
        Referer: "https://news.qq.com/",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    const items: {
      rank: number;
      title: string;
      hot: string;
      url: string;
      subtitle?: string;
    }[] = [];
    const str = String(html);

    // 尝试从页面中的新闻链接提取标题
    // 腾讯新闻链接格式: /rain/a/XXXXXXXX
    const linkRegex =
      /<a[^>]*href="([^"]*rain\/a\/[^"]*)"[^>]*target="[^"]*_blank[^"]*"[^>]*>([^<]{8,120})<\/a>/gi;
    let m: RegExpExecArray | null;
    let rank = 0;
    const seen = new Set<string>();

    while ((m = linkRegex.exec(str))) {
      rank++;
      const url = m[1].startsWith("http") ? m[1] : `https://news.qq.com${m[1]}`;
      const title = m[2].trim();
      if (seen.has(title)) continue;
      seen.add(title);
      items.push({ rank, title, hot: "", url });
      if (rank >= this.config.maxItems) break;
    }

    // 若未命中，尝试更通用的标题链接提取
    if (items.length === 0) {
      const genericRegex =
        /<a[^>]*href="(\/rain\/a\/[^"]+)"[^>]*>([^<]{8,120})<\/a>/gi;
      while ((m = genericRegex.exec(str))) {
        rank++;
        const title = m[2].trim();
        if (seen.has(title)) continue;
        seen.add(title);
        items.push({ rank, title, hot: "", url: `https://news.qq.com${m[1]}` });
        if (rank >= this.config.maxItems) break;
      }
    }

    return items;
  },
};

export default tencentNews;
