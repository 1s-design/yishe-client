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
import axios from "axios";

export function registerLegacyHotsearchCapabilities(): void {
  CapabilityRegistry.registerAll([searchDef, statusDef]);
  for (const item of allPlatforms) {
    const platform = item.config.key;
    CapabilityRegistry.register({
      name: "search",
      namespace: `hotsearch_${platform}`,
      description: `采集 ${item.config.name} 热搜数据。`,
      riskLevel: "read",
      argsSchema: z.object({ maxCount: z.number().optional().default(20), category: z.string().optional(), keyword: z.string().optional() }),
      handler: async ({ maxCount, category, keyword }) =>
        CapabilityRegistry.call("hotsearch", "search", { platform, maxCount, category, keyword }),
    });
  }

  CapabilityRegistry.register({
    name: "search",
    namespace: "xiaohongshu_note_detail",
    description: "解析小红书笔记详情及正文素材",
    riskLevel: "read",
    argsSchema: z.object({
      noteId: z.string().optional(),
      noteUrlOrId: z.string().optional(),
      xsecToken: z.string().optional(),
    }),
    handler: async (args) => {
      const rawInput = (args.noteId || args.noteUrlOrId || "").trim();
      let targetNoteId = rawInput;
      let targetToken = (args.xsecToken || "").trim();

      if (!targetNoteId) {
        return { success: false, error: "缺少必填参数 noteId 或 noteUrlOrId" };
      }

      if (targetNoteId.includes("xiaohongshu.com")) {
        try {
          const parsedUrl = new URL(targetNoteId);
          const parts = parsedUrl.pathname.split("/").filter(Boolean);
          targetNoteId = parts[parts.length - 1] || targetNoteId;
          if (!targetToken && parsedUrl.searchParams.has("xsec_token")) {
            targetToken = parsedUrl.searchParams.get("xsec_token") || "";
          }
        } catch {}
      }

      const targetUrl = `https://www.xiaohongshu.com/explore/${targetNoteId}${targetToken ? `?xsec_token=${encodeURIComponent(targetToken)}&xsec_source=pc_feed` : ""}`;
      const { data: html } = await axios.get(targetUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "zh-CN,zh;q=0.9",
        },
      });

      const match = String(html).match(
        /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})<\/script>/,
      );
      if (!match)
        return {
          success: false,
          error: "未能从小红书笔记解析 __INITIAL_STATE__",
        };

      const state = JSON.parse(match[1].replace(/undefined/g, "null"));
      const noteDetailMap = state.note?.noteDetailMap || {};
      const detailObj =
        (noteDetailMap[targetNoteId] ||
          Object.values(noteDetailMap)[0]) as any;

      if (!detailObj?.note) {
        return { success: false, error: `未找到笔记详情数据 [${targetNoteId}]` };
      }

      const note = detailObj.note || {};
      const interactInfo = note.interactInfo || {};
      const user = note.user || {};

      let images = (note.imageList || []).map((img: any) => ({
        url:
          img.urlDefault ||
          img.urlPre ||
          (Array.isArray(img.infoList) && img.infoList[0]?.url) ||
          "",
        width: img.width,
        height: img.height,
      })).filter((img: any) => Boolean(img.url));

      if (images.length === 0 && note.cover) {
        const c = note.cover;
        const cUrl =
          c.urlDefault ||
          c.urlPre ||
          (Array.isArray(c.infoList) && c.infoList[0]?.url) ||
          "";
        if (cUrl) {
          images = [{ url: cUrl, width: c.width, height: c.height }];
        }
      }

      const videoUrl =
        note.video?.media?.stream?.h264?.[0]?.masterUrl ||
        note.video?.media?.stream?.h265?.[0]?.masterUrl ||
        note.video?.consumer?.originVideoKey ||
        "";

      return {
        success: true,
        noteId: note.noteId || targetNoteId,
        xsecToken: note.xsecToken || targetToken,
        title: note.title || note.displayTitle || "",
        desc: note.desc || "",
        noteType: note.type || (videoUrl ? "video" : "normal"),
        images,
        videoUrl,
        tags: (note.tagList || []).map((tag: any) => tag.name || tag.id),
        interactInfo: {
          likedCount: interactInfo.likedCount || "0",
          collectedCount: interactInfo.collectedCount || "0",
          commentCount: interactInfo.commentCount || "0",
          shareCount: interactInfo.shareCount || "0",
        },
        author: {
          userId: user.userId || "",
          nickname: user.nickname || user.nickName || "",
          avatar: user.avatar || "",
        },
        fetchedAt: new Date().toISOString(),
      };
    },
  });
}
