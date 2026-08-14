/**
 * MCP Tool: google_art_collect
 * 一键完成 Google Arts & Culture 作品采集：API 搜索链接 → 逐个下载图片
 * 组合了 google_art_search + google_art_download 的完整链路
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types';
import { googleArtSearchTool } from './google-art-search';
import { googleArtDownloadTool } from './google-art-download';

export const googleArtCollectTool = {
  definition: {
    name: 'google_art_collect',
    description: '【首选/推荐工具】从 Google Arts & Culture 批量搜索并下载艺术画作到素材库。基于纯 HTTP 接口与 5K 解压合成，完全无需打开浏览器。当用户提出搜索、采集、下载 Google 艺术/名画/画作并同步入库时，必须直接调用本工具，严禁使用任何浏览器自动化工具。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        keyword: {
          type: 'string' as const,
          description: '搜索关键词（英文效果更佳，如 "van gogh"、"impressionism"）。',
        },
        maxCount: {
          type: 'number' as const,
          description: '采集张数/数量，默认 2，最大 50。',
        },
        count: {
          type: 'number' as const,
          description: '采集张数（maxCount 别名）。',
        },
        autoMax: {
          type: 'boolean' as const,
          description: '自动选择最高分辨率，默认 true。',
        },
        syncToMaterial: {
          type: 'boolean' as const,
          description: '是否同步到素材库，默认 true。',
        },
      },
      required: [],
    },
  },

  async execute(args: Record<string, unknown>): Promise<CallToolResult> {
    const keyword = ((args.keyword as string) || '').trim() || 'impressionism';
    const countInput = args.maxCount ?? args.limit ?? args.count ?? args.num;
    const maxCount = Math.min(Math.max(Number(countInput) || 2, 1), 50);
    const autoMax = (args.autoMax as boolean) ?? true;
    const syncToMaterial = (args.syncToMaterial as boolean) ?? true;

    const logs: string[] = [];
    const errors: string[] = [];

    // Step 1: API 搜索链接（无需浏览器）
    logs.push(`[1/2] API 搜索: "${keyword}"`);
    const searchResult = await googleArtSearchTool.execute({
      keyword,
      page: 1,
      maxCount,
    });

    // 解析搜索结果
    const searchText = (searchResult.content?.[0] as any)?.text;
    if (!searchText) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: '搜索失败：无返回结果' }, null, 2) }],
        isError: true,
      };
    }

    let searchData: any;
    try {
      searchData = JSON.parse(searchText);
    } catch {
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: '搜索失败：返回结果解析错误' }, null, 2) }],
        isError: true,
      };
    }

    if (!searchData.success || !searchData.links?.length) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: searchData.error || '未搜索到任何结果' }, null, 2) }],
        isError: true,
      };
    }

    const links: string[] = searchData.links;
    const searchItems = searchData.items || [];
    logs.push(`[1/2] 搜索完成，获得 ${links.length} 个链接`);

    // Step 2: 逐个下载
    logs.push(`[2/2] 开始下载 ${links.length} 张图片...`);
    const images: any[] = [];
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < links.length; i++) {
      const link = links[i];
      logs.push(`  [${i + 1}/${links.length}] 下载: ${link}`);

      const matchingItem = searchItems.find((item: any) => item.url === link);
      const itemMetadata = matchingItem ? {
        title: matchingItem.title || undefined,
        artist: matchingItem.artist || undefined,
        date: matchingItem.date || undefined,
        institution: matchingItem.institution || undefined,
        color: matchingItem.color || undefined,
        thumbnail: matchingItem.thumbnail || undefined,
        aspectRatio: matchingItem.aspectRatio ?? undefined,
        hasPixels: matchingItem.hasPixels ?? undefined,
        id: matchingItem.id || undefined,
      } : undefined;

      try {
        const downloadResult = await googleArtDownloadTool.execute({
          url: link,
          autoMax,
          syncToMaterial,
          metadata: itemMetadata,
        });

        const downloadText = (downloadResult.content?.[0] as any)?.text;
        if (downloadText) {
          const downloadData = JSON.parse(downloadText);
          if (downloadData.success) {
            images.push({
              url: downloadData.filePath,
              width: downloadData.width,
              height: downloadData.height,
              fileSize: downloadData.fileSize,
              materialId: downloadData.materialLibraryOk ? downloadData.fileName : '',
              originUrl: link,
            });
            successCount++;
            logs.push(`  ✅ 成功 (${downloadData.width}x${downloadData.height})`);
          } else {
            failCount++;
            errors.push(`${link}: ${downloadData.error}`);
            logs.push(`  ❌ 失败: ${downloadData.error}`);
          }
        }
      } catch (err: any) {
        failCount++;
        errors.push(`${link}: ${err?.message || String(err)}`);
        logs.push(`  ❌ 异常: ${err?.message}`);
      }
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          collected: links.length,
          successCount,
          failCount,
          images,
          logs,
          errors: errors.length > 0 ? errors : undefined,
        }, null, 2),
      }],
    };
  },
};
