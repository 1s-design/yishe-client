export interface CosUserIdentity {
  userId: string
  account: string
  directory: string
}

export interface BuildCosObjectKeyOptions {
  category?: string
  userId?: string | number
  account?: string
  entityId?: string | number
  isThumbnail?: boolean
  timestamp?: number
  date?: Date
}

const DEFAULT_COS_ACCOUNT = 'anonymous'
const DEFAULT_COS_USER_ID = '0'
const DEFAULT_COS_CATEGORY = 'uncategorized'

export function sanitizeCosFilename(filename: string): string {
  if (!filename) {
    return 'file'
  }

  return filename.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 200) || 'file'
}

export function sanitizeCosAccount(account?: string): string {
  if (!account || typeof account !== 'string') {
    return DEFAULT_COS_ACCOUNT
  }

  const sanitized = account
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .toLowerCase()
    .substring(0, 50)

  return sanitized || DEFAULT_COS_ACCOUNT
}

export function sanitizeCosUserId(userId?: string | number | null): string {
  if (userId == null) {
    return DEFAULT_COS_USER_ID
  }

  const sanitized = String(userId)
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .substring(0, 50)

  return sanitized || DEFAULT_COS_USER_ID
}

export function sanitizeCosPathSegment(
  value?: string | number | null,
  fallback = ''
): string {
  if (value == null) {
    return fallback
  }

  const sanitized = String(value)
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .substring(0, 100)

  return sanitized || fallback
}

export function sanitizeCosCategoryPath(category?: string): string {
  if (!category || typeof category !== 'string') {
    return DEFAULT_COS_CATEGORY
  }

  const segments = category
    .split(/[\\/]+/)
    .map((segment) => sanitizeCosPathSegment(segment))
    .filter(Boolean)

  return segments.length ? segments.join('/') : DEFAULT_COS_CATEGORY
}

export function formatCosDate(date?: Date): string {
  const targetDate = date || new Date()
  const year = targetDate.getFullYear()
  const month = String(targetDate.getMonth() + 1).padStart(2, '0')
  const day = String(targetDate.getDate()).padStart(2, '0')

  return `${year}${month}${day}`
}

export function resolveCosUserIdentity(options?: {
  userId?: string | number
  account?: string
}): CosUserIdentity {
  const userId = sanitizeCosUserId(options?.userId)
  const account = sanitizeCosAccount(options?.account)

  return {
    userId,
    account,
    directory: `${userId}_${account}`,
  }
}

export function buildCosObjectKey(
  filename: string,
  options?: BuildCosObjectKeyOptions
): string {
  const category = sanitizeCosCategoryPath(options?.category)
  const identity = resolveCosUserIdentity(options)
  const now = options?.date || new Date()
  const dateStr = formatCosDate(now)
  const timestamp = options?.timestamp || now.getTime()
  const entityId = sanitizeCosPathSegment(options?.entityId)
  const sanitizedFilename = sanitizeCosFilename(filename)
  const finalFilename = options?.isThumbnail && entityId
    ? `thumbnail_${timestamp}_${sanitizedFilename}`
    : `${timestamp}_${sanitizedFilename}`

  if (entityId) {
    return `users/${identity.directory}/${category}/${dateStr}/${entityId}/${finalFilename}`
  }

  return `users/${identity.directory}/${category}/${dateStr}/${finalFilename}`
}

export function extractCosObjectKey(value: string): string {
  const rawValue = String(value || '').trim()
  if (!rawValue) {
    return ''
  }

  if (rawValue.startsWith('http://') || rawValue.startsWith('https://')) {
    const url = new URL(rawValue)
    return decodeURIComponent(url.pathname.replace(/^\/+/, ''))
  }

  return rawValue.replace(/^\/+/, '')
}

export function extractCosFilename(value: string): string {
  const objectKey = extractCosObjectKey(value)
  if (!objectKey) {
    return ''
  }

  const basename = objectKey.split('/').filter(Boolean).pop() || ''
  if (!basename) {
    return ''
  }

  const normalized = basename
    .replace(/^thumbnail_/, '')
    .replace(/^\d+_/, '')
    .replace(/^1s_/, '')

  return normalized || basename
}
