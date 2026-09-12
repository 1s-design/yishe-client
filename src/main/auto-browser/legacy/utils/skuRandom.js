/**
 * SKU 随机值生成工具
 * 供各平台 handler 使用，生成随机库存和随机价格
 */

/** 默认价格尾数池 */
const DEFAULT_PRICE_DECIMALS = [0.19, 0.5, 0.88, 0.99, 0.69, 0, 0.08, 0.66, 0.89, 0.9]

/**
 * 生成随机整数库存
 * @param {number} min - 最小值
 * @param {number} max - 最大值
 * @returns {number} 范围内的随机整数
 */
function randomStock(min, max) {
  const lo = Math.ceil(Number(min))
  const hi = Math.floor(Number(max))
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo < 0 || hi < lo) {
    return 0
  }
  return Math.floor(Math.random() * (hi - lo + 1)) + lo
}

/**
 * 生成随机价格（整数部分随机 + 尾数从列表中选取）
 * @param {number} min - 最低价
 * @param {number} max - 最高价
 * @param {number[]} [decimals] - 可选尾数数组，默认使用 DEFAULT_PRICE_DECIMALS
 * @returns {number} 如 34.99
 */
function randomPrice(min, max, decimals) {
  const pool = Array.isArray(decimals) && decimals.length > 0
    ? decimals.filter((d) => Number.isFinite(d) && d >= 0 && d < 1)
    : DEFAULT_PRICE_DECIMALS

  const lo = Math.ceil(Number(min))
  const hi = Math.floor(Number(max))
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo < 0 || hi < lo) {
    return 0
  }

  const integerPart = Math.floor(Math.random() * (hi - lo + 1)) + lo
  const decimal = pool[Math.floor(Math.random() * pool.length)]
  return Number((integerPart + decimal).toFixed(2))
}

/**
 * 解析 SKU 配置中的库存值（支持固定值 / 随机范围）
 * @param {Object} sku - SKU 配置项
 * @returns {number|undefined} 要填写的库存值
 */
function resolveStock(sku) {
  if (!sku || typeof sku !== 'object') return undefined
  if (sku.stock !== undefined && sku.stock !== null && Number.isFinite(Number(sku.stock))) {
    return Number(sku.stock)
  }
  if (Number.isFinite(Number(sku.stockMin)) && Number.isFinite(Number(sku.stockMax))) {
    return randomStock(sku.stockMin, sku.stockMax)
  }
  return undefined
}

/**
 * 解析 SKU 配置中的价格值（支持固定值 / 随机范围 + 尾数）
 * @param {Object} sku - SKU 配置项
 * @returns {number|undefined} 要填写的价格值
 */
function resolvePrice(sku) {
  if (!sku || typeof sku !== 'object') return undefined
  if (sku.price !== undefined && sku.price !== null && Number.isFinite(Number(sku.price))) {
    return Number(sku.price)
  }
  if (Number.isFinite(Number(sku.priceMin)) && Number.isFinite(Number(sku.priceMax))) {
    return randomPrice(sku.priceMin, sku.priceMax, sku.priceDecimals)
  }
  return undefined
}

module.exports = {
  DEFAULT_PRICE_DECIMALS,
  randomStock,
  randomPrice,
  resolveStock,
  resolvePrice,
}
