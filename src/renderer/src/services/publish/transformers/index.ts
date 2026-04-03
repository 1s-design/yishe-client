/**
 * 所有平台转换器导出
 */

export { BaseTransformer } from '../BaseTransformer'
export { xiaohongshuTransformer, XiaohongshuTransformer } from './XiaohongshuTransformer'

import { douyinTransformer } from './DouyinTransformer'
import { xiaohongshuTransformer } from './XiaohongshuTransformer'
import { xianyuTransformer } from './XianyuTransformer'
import { shumaiyunTransformer } from './ShumaiyunTransformer'
import { amazonTransformer } from './AmazonTransformer'
import { sheinTransformer } from './SheinTransformer'
import type { ITransformer, PlatformType } from '../types'

/**
 * 平台转换器映射
 */
export const transformerMap: Record<PlatformType, ITransformer> = {
  douyin: douyinTransformer,
  xiaohongshu: xiaohongshuTransformer,
  weibo: douyinTransformer, // 临时使用抖音的转换器
  kuaishou: douyinTransformer, // 临时使用抖音的转换器
  xianyu: xianyuTransformer,
  shumaiyun: shumaiyunTransformer,
  amazon: amazonTransformer,
  shein: sheinTransformer
} as any

/**
 * 根据平台获取对应的转换器
 */
export function getTransformer(platform: PlatformType): ITransformer | undefined {
  return transformerMap[platform]
}
