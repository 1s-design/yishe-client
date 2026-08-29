import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';

interface CachedCapability {
  type: string;
  version: string;
  hash: string;
  script: string;
  updatedAt: string;
}

export class DynamicCapabilityManager {
  private static inMemoryCache = new Map<string, { meta: CachedCapability; fn: Function }>();
  private static initialized = false;

  private static getCacheFilePath(): string {
    const baseDir = app?.getPath ? app.getPath('userData') : (process.env.HOME || '/tmp');
    return path.join(baseDir, 'dynamic-capabilities-cache.json');
  }

  private static initDiskCache() {
    if (this.initialized) return;
    this.initialized = true;
    try {
      const cachePath = this.getCacheFilePath();
      if (fs.existsSync(cachePath)) {
        const raw = fs.readFileSync(cachePath, 'utf-8');
        const list: CachedCapability[] = JSON.parse(raw);
        if (Array.isArray(list)) {
          for (const item of list) {
            try {
              const fn = this.compileScript(item.script);
              this.inMemoryCache.set(item.type, { meta: item, fn });
            } catch (err: any) {
              console.warn(`[DynamicCapability] 预加载本地缓存 ${item.type} 失败:`, err?.message);
            }
          }
          console.log(`[DynamicCapability] 已加载 ${this.inMemoryCache.size} 个本地持久化节点能力`);
        }
      }
    } catch (err: any) {
      console.warn('[DynamicCapability] 读取本地能力缓存失败:', err?.message);
    }
  }

  private static persistDiskCache() {
    try {
      const cachePath = this.getCacheFilePath();
      const list = Array.from(this.inMemoryCache.values()).map((v) => v.meta);
      fs.writeFileSync(cachePath, JSON.stringify(list, null, 2), 'utf-8');
    } catch (err: any) {
      console.warn('[DynamicCapability] 持久化能力缓存失败:', err?.message);
    }
  }

  public static resolveServerUrl(): string {
    if (process.env.VITE_BASE_URL) return process.env.VITE_BASE_URL;
    if (process.env.SERVER_URL) return process.env.SERVER_URL;
    return process.env.NODE_ENV === 'development'
      ? 'http://localhost:1520'
      : 'https://api.1s.design';
  }

  /**
   * 从服务端拉取指定节点能力的最新脚本定义
   */
  public static async fetchCapabilityFromServer(type: string): Promise<CachedCapability> {
    const serverUrl = this.resolveServerUrl();
    const endpoint = `${serverUrl}/api/workflow/node-capabilities/${type}`;

    console.log(`[DynamicCapability] 🌐 正在从服务端拉取节点能力定义: ${type} -> ${endpoint}`);

    // 使用客户端统一的 token（如果已登录），否则使用内置 super token
    let authHeader = 'Bearer 1sdesign';
    try {
      const { getTokenValue } = await import('../server');
      const clientToken = getTokenValue?.();
      if (clientToken) {
        authHeader = `Bearer ${clientToken}`;
      }
    } catch {
      // 无法导入 getTokenValue 时使用内置 token
    }

    const res = await axios.get(endpoint, {
      timeout: 8000,
      headers: {
        authorization: authHeader,
      },
    });

    const body = res.data;
    // 兼容返回格式: { data: { data: { script, hash, ... } } } 或 { data: { script, ... } }
    const capability = body?.data?.data || body?.data || body;

    if (!capability || !capability.script) {
      throw new Error(`服务端返回的能力数据无效: ${JSON.stringify(body)}`);
    }

    return {
      type: capability.type || type,
      version: capability.version || '1.0.0',
      hash: capability.hash || '',
      script: capability.script,
      updatedAt: capability.updatedAt || new Date().toISOString(),
    };
  }

  /**
   * 将脚本字符串编译为可执行异步函数
   */
  private static compileScript(scriptContent: string): Function {
    // 构造自包含的函数包装器
    const wrappedCode = `
      return (async function() {
        ${scriptContent}
        if (typeof execute === 'function') {
          return execute;
        }
        throw new Error('脚本中未找到可执行的 execute(params, context) 函数定义');
      })();
    `;
    const factory = new Function(wrappedCode);
    return factory;
  }

  /**
   * 获取并执行节点能力（带版本缓存与自动热拉取机制）
   */
  public static async executeCapability(
    type: string,
    params: Record<string, any> = {},
    customContext: Record<string, any> = {},
  ): Promise<any> {
    this.initDiskCache();

    let cached = this.inMemoryCache.get(type);

    // 首次如果本地没有，直接从服务端拉取
    if (!cached) {
      console.log(`[DynamicCapability] ⚡ 本地未发现能力 ${type}，触发首次远程拉取...`);
      const fetched = await this.fetchCapabilityFromServer(type);
      const fnFactory = this.compileScript(fetched.script);
      const fn = await fnFactory();
      cached = { meta: fetched, fn };
      this.inMemoryCache.set(type, cached);
      this.persistDiskCache();
      console.log(`[DynamicCapability] ✅ 能力 ${type} 首次拉取成功并已缓存 (hash=${fetched.hash})`);
    } else {
      console.log(`[DynamicCapability] ⚡ 命中本地能力缓存: ${type} (hash=${cached.meta.hash})`);
    }

    // 构造客户端运行上下文（注入常用本地工具和网络实例）
    const executionContext = {
      axios,
      fetch: globalThis.fetch,
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      timeout: 10000,
      log: (...args: any[]) => console.log(`[DynamicCapability:${type}]`, ...args),
      ...customContext,
    };

    try {
      console.log(`[DynamicCapability] 🚀 开始在客户端本地执行节点能力: ${type}`);
      const startTime = Date.now();
      const result = await cached.fn(params, executionContext);
      const durationMs = Date.now() - startTime;
      console.log(`[DynamicCapability] ✨ 节点能力 ${type} 本地执行完成，耗时 ${durationMs}ms`);
      return result;
    } catch (execError: any) {
      console.error(`[DynamicCapability] ❌ 节点能力 ${type} 本地执行异常:`, execError?.message || execError);
      throw execError;
    }
  }

  /**
   * 手动清除或刷新指定节点能力的本地缓存（用于测试热更新）
   */
  public static clearCache(type?: string) {
    if (type) {
      this.inMemoryCache.delete(type);
    } else {
      this.inMemoryCache.clear();
    }
    this.persistDiskCache();
    console.log(`[DynamicCapability] 已清除能力缓存: ${type || '全部'}`);
  }
}
