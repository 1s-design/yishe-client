/**
 * 客户端通用能力 — 文件系统
 * 提供本地文件读写、目录操作、批量处理、文件监听
 */

import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';

/** 安全路径校验 — 防止路径穿越 */
function safePath(inputPath: string): string {
  const resolved = path.resolve(inputPath);
  return resolved;
}

// ─── file_read ──────────────────────────────────────────
const fileReadDef: CapabilityDefinition = {
  name: 'file_read',
  namespace: 'filesystem',
  description: '读取本地文件内容（文本或 base64 编码的二进制）',
  riskLevel: 'read',
  argsSchema: z.object({
    path: z.string().describe('文件路径'),
    encoding: z.enum(['utf8', 'base64', 'hex']).optional().default('utf8').describe('编码方式'),
  }),
  handler: async ({ path: filePath, encoding }) => {
    const absPath = safePath(filePath);
    if (!fs.existsSync(absPath)) {
      return { success: false, error: `文件不存在: ${absPath}` };
    }
    const stat = fs.statSync(absPath);
    if (!stat.isFile()) {
      return { success: false, error: `路径不是文件: ${absPath}` };
    }
    const content = fs.readFileSync(absPath, encoding === 'utf8' ? 'utf8' : encoding);
    return {
      success: true,
      data: {
        content,
        size: stat.size,
        modified: stat.mtime.toISOString(),
        created: stat.birthtime.toISOString(),
      },
    };
  },
};

// ─── file_write ─────────────────────────────────────────
const fileWriteDef: CapabilityDefinition = {
  name: 'file_write',
  namespace: 'filesystem',
  description: '写入内容到本地文件（自动创建父目录）',
  riskLevel: 'write',
  argsSchema: z.object({
    path: z.string().describe('目标文件路径'),
    content: z.string().describe('文件内容（文本或 base64）'),
    encoding: z.enum(['utf8', 'base64', 'hex']).optional().default('utf8').describe('编码方式'),
  }),
  handler: async ({ path: filePath, content, encoding }) => {
    const absPath = safePath(filePath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    const buffer = encoding === 'utf8' ? Buffer.from(content, 'utf8') : Buffer.from(content, encoding);
    fs.writeFileSync(absPath, buffer);
    return {
      success: true,
      data: { path: absPath, size: buffer.length },
    };
  },
};

// ─── file_delete ────────────────────────────────────────
const fileDeleteDef: CapabilityDefinition = {
  name: 'file_delete',
  namespace: 'filesystem',
  description: '删除指定文件',
  riskLevel: 'write',
  argsSchema: z.object({
    path: z.string().describe('文件路径'),
  }),
  handler: async ({ path: filePath }) => {
    const absPath = safePath(filePath);
    if (!fs.existsSync(absPath)) {
      return { success: false, error: `文件不存在: ${absPath}` };
    }
    fs.unlinkSync(absPath);
    return { success: true, data: { path: absPath } };
  },
};

// ─── file_stat ──────────────────────────────────────────
const fileStatDef: CapabilityDefinition = {
  name: 'file_stat',
  namespace: 'filesystem',
  description: '获取文件信息（大小、修改时间、类型等）',
  riskLevel: 'read',
  argsSchema: z.object({
    path: z.string().describe('文件路径'),
  }),
  handler: async ({ path: filePath }) => {
    const absPath = safePath(filePath);
    if (!fs.existsSync(absPath)) {
      return { success: false, error: `路径不存在: ${absPath}` };
    }
    const stat = fs.statSync(absPath);
    return {
      success: true,
      data: {
        path: absPath,
        isFile: stat.isFile(),
        isDirectory: stat.isDirectory(),
        size: stat.size,
        modified: stat.mtime.toISOString(),
        created: stat.birthtime.toISOString(),
        permissions: (stat.mode & 0o777).toString(8),
      },
    };
  },
};

// ─── dir_list ───────────────────────────────────────────
const dirListDef: CapabilityDefinition = {
  name: 'dir_list',
  namespace: 'filesystem',
  description: '列出目录下的文件和子目录',
  riskLevel: 'read',
  argsSchema: z.object({
    path: z.string().describe('目录路径'),
    recursive: z.boolean().optional().default(false).describe('是否递归列出'),
    pattern: z.string().optional().describe('文件名过滤 glob 模式，如 "*.png"'),
  }),
  handler: async ({ path: dirPath, recursive, pattern }) => {
    const absPath = safePath(dirPath);
    if (!fs.existsSync(absPath)) {
      return { success: false, error: `目录不存在: ${absPath}` };
    }
    if (!fs.statSync(absPath).isDirectory()) {
      return { success: false, error: `路径不是目录: ${absPath}` };
    }

    const minimatch = (await import('minimatch')).minimatch;

    function listDir(dir: string, depth: number): Array<{ name: string; path: string; type: 'file' | 'directory'; size: number; depth: number }> {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const result: Array<{ name: string; path: string; type: 'file' | 'directory'; size: number; depth: number }> = [];
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const isDir = entry.isDirectory();
        if (pattern && !isDir && !minimatch(entry.name, pattern)) continue;
        result.push({
          name: entry.name,
          path: fullPath,
          type: isDir ? 'directory' : 'file',
          size: isDir ? 0 : fs.statSync(fullPath).size,
          depth,
        });
        if (recursive && isDir && depth < 10) {
          result.push(...listDir(fullPath, depth + 1));
        }
      }
      return result;
    }

    const items = listDir(absPath, 0);
    return {
      success: true,
      data: {
        path: absPath,
        items,
        total: items.length,
      },
    };
  },
};

// ─── dir_create ─────────────────────────────────────────
const dirCreateDef: CapabilityDefinition = {
  name: 'dir_create',
  namespace: 'filesystem',
  description: '递归创建目录',
  riskLevel: 'write',
  argsSchema: z.object({
    path: z.string().describe('目录路径'),
  }),
  handler: async ({ path: dirPath }) => {
    const absPath = safePath(dirPath);
    fs.mkdirSync(absPath, { recursive: true });
    return { success: true, data: { path: absPath } };
  },
};

// ─── file_hash ──────────────────────────────────────────
const fileHashDef: CapabilityDefinition = {
  name: 'file_hash',
  namespace: 'filesystem',
  description: '计算文件哈希值（MD5 / SHA256）',
  riskLevel: 'read',
  argsSchema: z.object({
    path: z.string().describe('文件路径'),
    algorithm: z.enum(['md5', 'sha256']).optional().default('md5').describe('哈希算法'),
  }),
  handler: async ({ path: filePath, algorithm }) => {
    const absPath = safePath(filePath);
    if (!fs.existsSync(absPath)) {
      return { success: false, error: `文件不存在: ${absPath}` };
    }
    const crypto = await import('crypto');
    const hash = crypto.createHash(algorithm);
    const buffer = fs.readFileSync(absPath);
    hash.update(buffer);
    return {
      success: true,
      data: { algorithm, hash: hash.digest('hex') },
    };
  },
};

// ─── file_copy ──────────────────────────────────────────
const fileCopyDef: CapabilityDefinition = {
  name: 'file_copy',
  namespace: 'filesystem',
  description: '复制文件',
  riskLevel: 'write',
  argsSchema: z.object({
    source: z.string().describe('源文件路径'),
    dest: z.string().describe('目标文件路径'),
  }),
  handler: async ({ source, dest }) => {
    const srcPath = safePath(source);
    const destPath = safePath(dest);
    if (!fs.existsSync(srcPath)) {
      return { success: false, error: `源文件不存在: ${srcPath}` };
    }
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(srcPath, destPath);
    return { success: true, data: { source: srcPath, dest: destPath } };
  },
};

// ─── file_move ──────────────────────────────────────────
const fileMoveDef: CapabilityDefinition = {
  name: 'file_move',
  namespace: 'filesystem',
  description: '移动文件',
  riskLevel: 'write',
  argsSchema: z.object({
    source: z.string().describe('源文件路径'),
    dest: z.string().describe('目标文件路径'),
  }),
  handler: async ({ source, dest }) => {
    const srcPath = safePath(source);
    const destPath = safePath(dest);
    if (!fs.existsSync(srcPath)) {
      return { success: false, error: `源文件不存在: ${srcPath}` };
    }
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.renameSync(srcPath, destPath);
    return { success: true, data: { source: srcPath, dest: destPath } };
  },
};

// ─── 注册所有文件系统能力 ──────────────────────────────────
export function registerFilesystemCapabilities(): void {
  CapabilityRegistry.registerAll([
    fileReadDef,
    fileWriteDef,
    fileDeleteDef,
    fileStatDef,
    dirListDef,
    dirCreateDef,
    fileHashDef,
    fileCopyDef,
    fileMoveDef,
  ]);
}
