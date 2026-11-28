/**
 * 客户端通用能力 — 纯 COS 直传（不写素材表）
 *
 * 与 materialLibrary_upload / webcollect_upload 的区别：
 * 那两个工具上传后会再写 sticker / crawler_material / collect_file；
 * 本能力只把本地文件直传 COS，返回 HTTPS URL，供外部 Agent 喂给
 * 服务端 MCP 的 design-inspiration-create / update 等工具的 imageUrls 字段。
 *
 * 仍然遵守铁律：文件字节只从客户端发出，服务端只签 STS。
 */

import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';
import { generateCosKey, uploadFileToCos } from '../cos';

const cosUploadDef: CapabilityDefinition = {
  name: 'upload',
  namespace: 'cos',
  description:
    '只把本地文件直传到当前账号配置的 COS，返回 HTTPS URL；不写素材库、不写贴纸表。图片可随后传给服务端 design-inspiration-create/update 的 imageUrls。',
  riskLevel: 'write',
  argsSchema: z.object({
    filePaths: z
      .array(z.string())
      .min(1)
      .describe('要上传的本地文件绝对路径数组'),
    category: z
      .string()
      .optional()
      .default('design-inspiration')
      .describe('COS 路径分类，默认 design-inspiration'),
  }),
  async handler(args: { filePaths: string[]; category?: string }) {
    const category = args.category || 'design-inspiration';
    const results: Array<{
      filePath: string;
      fileName: string;
      url?: string;
      key?: string;
      size?: number;
      error?: string;
    }> = [];

    for (const rawPath of args.filePaths) {
      const filePath = path.resolve(rawPath);
      const fileName = path.basename(filePath);
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        results.push({ filePath, fileName, error: '文件不存在或不是文件' });
        continue;
      }

      try {
        const key = await generateCosKey({ category, filename: fileName });
        const uploaded = await uploadFileToCos(filePath, key);
        if (!uploaded.ok) {
          results.push({
            filePath,
            fileName,
            error: 'msg' in uploaded ? uploaded.msg : 'COS 上传失败',
          });
          continue;
        }
        results.push({
          filePath,
          fileName,
          url: uploaded.url,
          key: uploaded.key || key,
          size: fs.statSync(filePath).size,
        });
      } catch (error: any) {
        results.push({ filePath, fileName, error: error?.message || String(error) });
      }
    }

    const succeeded = results.filter((item) => !!item.url);
    if (!succeeded.length) {
      return {
        success: false,
        error: results.map((item) => `${item.fileName}: ${item.error}`).join('; '),
        data: { results },
      };
    }

    return {
      success: true,
      data: {
        urls: succeeded.map((item) => item.url),
        results,
        uploadedCount: succeeded.length,
        failedCount: results.length - succeeded.length,
      },
    };
  },
};

/** 注册纯 COS 上传能力（MCP 工具名：cos_upload） */
export function registerCosUploadCapabilities(): void {
  CapabilityRegistry.registerAll([cosUploadDef]);
}
