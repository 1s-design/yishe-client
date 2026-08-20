import { z } from "zod";
import { CapabilityRegistry } from "./registry";
import { getPlatform, allPlatforms } from "../hotsearch/platforms";
import { hotSearchService } from "../hotsearch/hotsearch.service";
import type { CapabilityDefinition } from "./types";

const LEGACY_HOTSEARCH_KEYS = [
  "google_trends",
  "hackernews",
  "github",
  "wikipedia",
  "bbc_news",
  "cnn",
  "nytimes",
  "aljazeera",
  "devto",
  "ebay_trending",
  "shopify_trending",
  "baidu",
  "lobsters",
  "tencent_news",
  "tencent_tech",
];

const searchDef: CapabilityDefinition = {
  name: "search",
  namespace: "hotsearch",
  description: "采集指定热搜平台数据。参数 platform 为平台 key。",
  riskLevel: "read",
  argsSchema: z.object({
    platform: z.string(),
    maxCount: z.number().optional().default(20),
  }),
  handler: async ({ platform, maxCount }) => {
    const item = getPlatform(platform);
    if (!item) return { success: false, error: `热搜平台不存在: ${platform}` };
    const result: any = await hotSearchService.fetchPlatform(item);
    return {
      success: result?.success !== false,
      platform,
      name: item.config.name,
      itemCount: result?.items?.length || 0,
      items: (result?.items || []).slice(0, maxCount),
      duration: result?.duration,
      fetchedAt: new Date().toISOString(),
      error: result?.error || null,
    };
  },
};
const statusDef: CapabilityDefinition = {
  name: "status",
  namespace: "hotsearch",
  description: "获取热搜平台状态。",
  riskLevel: "read",
  argsSchema: z.object({}),
  handler: async () => ({
    success: true,
    available: allPlatforms.length > 0,
    platforms: allPlatforms.map((p) => p.config.key),
  }),
};
export function registerLegacyHotsearchCapabilities(): void {
  CapabilityRegistry.registerAll([searchDef, statusDef]);
  for (const platform of LEGACY_HOTSEARCH_KEYS) {
    CapabilityRegistry.register({
      name: "search",
      namespace: `hotsearch_${platform}`,
      description: `采集 ${platform} 热搜数据。`,
      riskLevel: "read",
      argsSchema: z.object({ maxCount: z.number().optional().default(20) }),
      handler: async ({ maxCount }) =>
        CapabilityRegistry.call("hotsearch", "search", { platform, maxCount }),
    });
  }
}
