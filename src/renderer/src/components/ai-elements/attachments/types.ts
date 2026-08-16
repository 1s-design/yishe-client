export interface AttachmentData {
  id: string
  type?: string
  name?: string
  filename?: string
  title?: string
  url?: string
  mediaType?: string
  size?: number
  [key: string]: any
}

export type AttachmentMediaCategory
  = | 'image'
    | 'video'
    | 'audio'
    | 'document'
    | 'source'
    | 'unknown'

export type AttachmentVariant = 'grid' | 'inline' | 'list'
