/**
 * 客户端能力注册中心
 * 统一管理所有客户端能力的注册、发现和调用
 */

import type { CapabilityCallContext, CapabilityDefinition, RegisteredCapability, CapabilityResult } from './types';

class CapabilityRegistryImpl {
  private capabilities = new Map<string, CapabilityDefinition>();

  /**
   * 注册一个能力
   */
  register<TArgs, TResult>(definition: CapabilityDefinition<TArgs, TResult>): void {
    const key = `${definition.namespace}.${definition.name}`;
    if (this.capabilities.has(key)) {
      console.warn(`[CapabilityRegistry] 覆盖已注册的能力: ${key}`);
    }
    this.capabilities.set(key, definition as CapabilityDefinition);
    console.log(`[CapabilityRegistry] 已注册: ${key} [${definition.riskLevel}]`);
  }

  /**
   * 批量注册
   */
  registerAll(definitions: CapabilityDefinition[]): void {
    for (const def of definitions) {
      this.register(def);
    }
  }

  /**
   * 调用一个能力
   */
  async call<T = any>(
    namespace: string,
    name: string,
    args: any = {},
    context?: CapabilityCallContext,
  ): Promise<CapabilityResult<T>> {
    const key = `${namespace}.${name}`;
    const capability = this.capabilities.get(key);
    if (!capability) {
      return { success: false, error: `能力不存在: ${key}` };
    }

    try {
      // 参数校验
      const parsed = capability.argsSchema.safeParse(args);
      if (!parsed.success) {
        return {
          success: false,
          error: `参数校验失败: ${parsed.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
        };
      }
      return await capability.handler(parsed.data, context);
    } catch (error: any) {
      return { success: false, error: error?.message || String(error) };
    }
  }

  /**
   * 通过完整名称调用
   */
  async callByFullName<T = any>(
    fullName: string,
    args: any = {},
    context?: CapabilityCallContext,
  ): Promise<CapabilityResult<T>> {
    const dotIndex = fullName.indexOf('.');
    if (dotIndex === -1) {
      return { success: false, error: `无效的能力名称: ${fullName}` };
    }
    const namespace = fullName.substring(0, dotIndex);
    const name = fullName.substring(dotIndex + 1);
    return this.call(namespace, name, args, context);
  }

  /**
   * 列出所有已注册的能力
   */
  list(): RegisteredCapability[] {
    return Array.from(this.capabilities.values()).map((cap) => ({
      name: cap.name,
      namespace: cap.namespace,
      description: cap.description,
      riskLevel: cap.riskLevel,
    }));
  }

  /**
   * 按命名空间列出
   */
  listByNamespace(namespace: string): RegisteredCapability[] {
    return this.list().filter((cap) => cap.namespace === namespace);
  }

  /**
   * 获取能力定义（含 schema）
   */
  getDefinition(namespace: string, name: string): CapabilityDefinition | undefined {
    return this.capabilities.get(`${namespace}.${name}`);
  }

  /**
   * 获取能力数量
   */
  get size(): number {
    return this.capabilities.size;
  }
}

/** 全局单例 */
export const CapabilityRegistry = new CapabilityRegistryImpl();
