/**
 * 客户端通用能力类型定义
 */

import { z } from 'zod';

/** 风险等级 */
export type RiskLevel = 'read' | 'write' | 'system';

/** 能力结果 */
export interface CapabilityResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

/** 能力定义 */
export interface CapabilityDefinition<TArgs = any, TResult = any> {
  name: string;
  namespace: string;
  description: string;
  riskLevel: RiskLevel;
  argsSchema: z.ZodType<TArgs>;
  handler: (args: TArgs) => Promise<CapabilityResult<TResult>>;
}

/** 注册的能力（不含 schema，对外暴露） */
export interface RegisteredCapability {
  name: string;
  namespace: string;
  description: string;
  riskLevel: RiskLevel;
}

/** 能力命名空间 */
export type CapabilityNamespace =
  | 'filesystem'
  | 'clipboard'
  | 'system'
  | 'screen'
  | 'network'
  | 'print';
