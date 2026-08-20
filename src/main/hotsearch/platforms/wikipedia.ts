/**
 * Wikipedia 热门页面
 * 数据源：Wikimedia REST API（国内可访问）
 */

import type { PlatformModule } from "../types";
import axios from "axios";

const wikipedia: PlatformModule = {
  config: {
    key: "wikipedia",
    name: "维基百科",
    enabled: true,
    environment: "direct",
    maxItems: 20,
    timeout: 15000,
    retryCount: 2,
  },

  async fetch(ctx) {
    // Wikimedia 当天/前一天数据可能延迟，最多向前回退 7 天，避免把
    // 一次日期 404 误判为平台不可用。
    for (let offset = 1; offset <= 7; offset += 1) {
      const date = new Date();
      date.setDate(date.getDate() - offset);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/all-access/${year}/${month}/${day}`;
      try {
        const { data } = await axios.get(url, {
          timeout: ctx.timeout,
          headers: {
            "User-Agent":
              "YisheHotSearch/1.0 (https://1s.design; admin@1s.design)",
            Accept: "application/json",
          },
        });
        const articles = data?.items?.[0]?.articles || [];
        if (!articles.length) continue;
        return articles
          .filter(
            (item: any) =>
              item.article && !item.article.startsWith("Main_Page"),
          )
          .slice(0, this.config.maxItems)
          .map((item: any, index: number) => ({
            rank: index + 1,
            title: decodeURIComponent(item.article.replace(/_/g, " ")),
            hot: item.views || "",
            url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.article)}`,
            dataDate: `${year}-${month}-${day}`,
          }));
      } catch (error: any) {
        if (error?.response?.status !== 404) throw error;
      }
    }
    throw new Error("Wikimedia Pageviews 最近 7 天暂无可用数据");
  },
};

export default wikipedia;
