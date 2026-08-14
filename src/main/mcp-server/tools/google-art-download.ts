/**
 * MCP Tool: google_art_download
 * 从 Google Arts & Culture 下载高清艺术作品图片
 * 复用客户端已有的 getGoogleArtZooms + syncGoogleArtToMaterialLibrary 能力
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types';

// 懒加载 googleArt 模块
let googleArtModulePromise: Promise<typeof import('../../googleArt')> | null = null;

async function getGoogleArtModule() {
  if (!googleArtModulePromise) {
    googleArtModulePromise = import('../../googleArt');
  }
  return googleArtModulePromise;
}

// 懒加载 Electron Store 获取工作目录
let electronStorePromise: Promise<typeof import('electron-store')> | null = null;

async function getWorkspaceDir(): Promise<string> {
  if (!electronStorePromise) {
    electronStorePromise = import('electron-store');
  }
  const ElectronStore = (await electronStorePromise).default;
  const StoreConstructor = (ElectronStore as any).default || ElectronStore;
  const store = new StoreConstructor({
    defaults: {
      workspaceDirectory: '',
    },
  });
  return ((store as any).get('workspaceDirectory', '') as string) || '';
}

export const googleArtDownloadTool = {
  definition: {
    name: 'google_art_download',
    description: '从 Google Arts & Culture 下载高清艺术作品图片。自动获取可用分辨率，可自动选择最高分辨率或指定级别，可选同步到素材库。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        url: {
          type: 'string' as const,
          description: 'Google Arts 作品链接（如 https://artsandculture.google.com/asset/xxx/yyy）。',
        },
        zoomLevel: {
          type: 'number' as const,
          description: '分辨率级别。不传则自动选择最高分辨率（autoMax=true）。',
        },
        autoMax: {
          type: 'boolean' as const,
          description: '自动选择最高分辨率，默认 true。',
        },
        syncToMaterial: {
          type: 'boolean' as const,
          description: '是否同步到素材库，默认 true。',
        },
        metadata: {
          type: 'object' as const,
          description: '作品元数据，搜索时自动传入',
          properties: {
            title: { type: 'string' as const },
            artist: { type: 'string' as const },
            date: { type: 'string' as const },
            institution: { type: 'string' as const },
            color: { type: 'string' as const, description: '主色调 hex' },
            thumbnail: { type: 'string' as const, description: '缩略图 URL' },
            aspectRatio: { type: 'number' as const },
            hasPixels: { type: 'boolean' as const },
            id: { type: 'string' as const, description: 'Google Art 作品 ID' },
          },
          required: [],
        },
      },
      required: ['url'],
    },
  },

  async execute(args: Record<string, unknown>): Promise<CallToolResult> {
    const url = args.url as string;
    const autoMax = (args.autoMax as boolean) ?? true;
    const syncToMaterial = (args.syncToMaterial as boolean) ?? true;

    if (!url) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: '缺少作品链接 url' }, null, 2) }],
        isError: true,
      };
    }

    try {
      const googleArt = await getGoogleArtModule();
      const workspaceDir = await getWorkspaceDir();

      if (!workspaceDir) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: '工作目录未设置，请先在客户端设置工作目录' }, null, 2) }],
          isError: true,
        };
      }

      // 1. 获取可用分辨率
      const zoomsResult = await googleArt.getGoogleArtZooms(url);
      if (!zoomsResult.ok || !zoomsResult.zooms?.length) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: zoomsResult.msg || '获取分辨率失败',
            }, null, 2),
          }],
          isError: true,
        };
      }

      const zooms = zoomsResult.zooms;

      // 2. 确定分辨率级别
      let targetZoom: number;
      if (args.zoomLevel !== undefined && args.zoomLevel !== null) {
        targetZoom = Number(args.zoomLevel);
      } else if (autoMax) {
        // 安全策略：如果是在线/Agent后台自动抓取，切片数 > 200 或 宽度 > 8000 拼接可能极慢，限制到安全级别
        const safeZoom = [...zooms].reverse().find(z => z.tiles <= 200 && z.width <= 8000);
        targetZoom = safeZoom ? safeZoom.idx : zooms[zooms.length - 1].idx;
      } else {
        targetZoom = zooms[zooms.length - 1].idx;
      }

      // 验证级别有效性
      const validZoom = zooms.find(z => z.idx === targetZoom);
      if (!validZoom) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: `无效的分辨率级别: ${targetZoom}，可用级别: ${zooms.map(z => z.idx).join(', ')}`,
              zooms,
            }, null, 2),
          }],
          isError: true,
        };
      }

      // 3. 下载图片
      let title = (args.metadata as any)?.title;
      let artist = (args.metadata as any)?.artist;
      let date = (args.metadata as any)?.date;
      let institution = (args.metadata as any)?.institution;

      if (validZoom.label) {
        const parts = validZoom.label.split(';').map((p: string) => p.trim());
        if (parts.length >= 3) {
          artist = artist || parts[0];
          title = title || parts[1];
          date = date || parts[2];
        } else if (parts.length === 2) {
          artist = artist || parts[0];
          title = title || parts[1];
        } else if (parts.length === 1) {
          title = title || parts[0];
        }
      }

      const downloadResult = await googleArt.syncGoogleArtToMaterialLibrary({
        url,
        zoomLevel: targetZoom,
        workspaceDir,
        metadata: {
          title,
          artist,
          date,
          institution,
          color: (args.metadata as any)?.color,
          thumbnail: (args.metadata as any)?.thumbnail,
          aspectRatio: (args.metadata as any)?.aspectRatio ?? validZoom.width / validZoom.height,
          hasPixels: (args.metadata as any)?.hasPixels,
          id: (args.metadata as any)?.id,
        },
      });

      if (!downloadResult.ok) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: downloadResult.msg || '下载失败',
              url,
              zoomLevel: targetZoom,
            }, null, 2),
          }],
          isError: true,
        };
      }

      // 4. 返回成功结果
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            url,
            originUrl: url,
            zoomLevel: targetZoom,
            width: validZoom.width,
            height: validZoom.height,
            tiles: validZoom.tiles,
            filePath: downloadResult.filePath,
            fileName: downloadResult.fileName,
            fileSize: downloadResult.fileSize,
            materialLibraryOk: downloadResult.materialLibraryOk,
            syncToMaterial,
            availableZooms: zooms.map(z => ({ idx: z.idx, label: z.label, width: z.width, height: z.height })),
          }, null, 2),
        }],
      };
    } catch (error: any) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error?.message || String(error),
          }, null, 2),
        }],
        isError: true,
      };
    }
  },
};
