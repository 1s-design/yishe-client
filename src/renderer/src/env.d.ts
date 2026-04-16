/*
 * @Author: chan-max jackieontheway666@gmail.com
 * @Date: 2025-06-08 23:07:32
 * @LastEditors: chan-max jackieontheway666@gmail.com
 * @LastEditTime: 2025-06-11 19:54:36
 * @FilePath: /yishe-electron/src/renderer/src/env.d.ts
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
/// <reference types="vite/client" />

interface Window {
  electron: {
    process: {
      versions: Record<string, string>
    }
    ipcRenderer: {
      send(channel: string, ...args: any[]): void
      on(channel: string, func: (...args: any[]) => void): void
      once(channel: string, func: (...args: any[]) => void): void
    }
  }
  api: {
    showTrayNotification(options: { title: string; body: string }): Promise<void>
    updateTrayTooltip(tooltip: string): Promise<void>
    hideMainWindow(): Promise<void>
    showMainWindow(): Promise<void>
    confirmExit(): Promise<'tray' | 'quit' | 'cancel'>
    getAppVersion(): Promise<string>
    saveToken(token: string): Promise<boolean>
    getToken(): Promise<string | undefined>
    isTokenExist(): Promise<boolean>
    onExtensionConnectionStatus(callback: (status: any) => void): void
    openExternal(url: string): Promise<void>
    toggleDevTools(): Promise<{ opened: boolean }>
    // 工作目录
    selectWorkspaceDirectory(): Promise<string | null>
    getWorkspaceDirectory(): Promise<string>
    setWorkspaceDirectory(path: string): Promise<boolean>
    openPath(path: string): Promise<void>
    // 文件下载
    downloadFile(url: string): Promise<{
      success: boolean
      message: string
      filePath?: string
      skipped?: boolean
      fileSize?: number
      error?: string
      statusCode?: number
    }>
    checkFileDownloaded(url: string): Promise<{
      found: boolean
      filePath?: string | null
      fileSize?: number
      message: string
      error?: string
    }>
    checkLocalFileExists(filePath: string): Promise<{
      exists: boolean
      isFile: boolean
      isDirectory: boolean
      fileSize?: number
      message: string
    }>
    // 外部进程
    listExternalProcesses(): Promise<Array<{
      id: string
      name: string
      executable: string
      platforms?: NodeJS.Platform[]
      autoRestart?: boolean
      status: string
    }>>
    startExternalProcess(id: string): Promise<boolean>
    stopExternalProcess(id: string, force?: boolean): Promise<boolean>
    invokeAutoBrowser(request: {
      method?: string
      path: string
      query?: Record<string, any>
      body?: any
    }): Promise<{
      ok?: boolean
      status?: number
      body?: any
      headers?: Record<string, string>
    }>
    startLocalService(): Promise<{ success: boolean; message: string }>
    stopLocalService(): Promise<{ success: boolean; message: string }>
    checkLocalServiceStatus(): Promise<{
      running: boolean
      available: boolean
      port: number
      error?: string
    }>
    // Google Arts 高清图片
    getGoogleArtStatus(): Promise<{
      ok: boolean
      platform: string
      platformName: string
      supported: boolean
      binaryExists: boolean
      binaryPath?: string | null
      siteUrl: string
      siteAvailable: boolean
      siteStatus?: number | null
      siteLatencyMs?: number | null
      siteCheckedAt: string
      siteError?: string | null
      message: string
    }>
    getGoogleArtZooms(url: string): Promise<{
      ok: boolean
      zooms?: Array<{ idx: number; label: string; width: number; height: number; tiles: number }>
      msg?: string
    }>
    syncGoogleArtToMaterialLibrary(payload: { url: string; zoomLevel: number }): Promise<{
      ok: boolean
      msg?: string
      filePath?: string
      fileName?: string
      fileSize?: number
      materialLibraryOk?: boolean
    }>
    uploadFileToCos(payload: { filePath: string; key?: string }): Promise<{
      ok: boolean
      msg?: string
      url?: string
      key?: string
    }>
    generateCosKey(payload: {
      category: string
      filename: string
      account?: string
      userId?: string | number
      entityId?: string | number
      subDirectory?: string
      isThumbnail?: boolean
      timestamp?: number
    }): Promise<{
      ok: boolean
      msg?: string
      key?: string
    }>
    downloadImageAndUploadMaterial(payload: {
      url: string
      name?: string
      description?: string
      keywords?: string
      target?: 'sticker' | 'crawler-material'
    }): Promise<{
      ok: boolean
      message?: string
      data?: {
        cosUrl: string
        material: any
      }
    }>
    downloadImageAndUploadToCrawler(payload: {
      url: string
      name?: string
      description?: string
      keywords?: string
      target?: 'sticker' | 'crawler-material'
    }): Promise<{
      ok: boolean
      message?: string
      data?: {
        cosUrl: string
        material: any
      }
    }>
    processImageWithLimits(payload: {
      sourcePath: string
      outputPath?: string
      workspaceDir?: string
      maxWidth?: number
      maxHeight?: number
      maxBytes?: number
      format?: 'jpeg' | 'png' | 'webp'
      quality?: number
      minQuality?: number
      fit?: 'inside' | 'cover' | 'contain' | 'fill'
      position?: string
      background?: string
      cacheKey?: string
      cacheFolder?: string
    }): Promise<{
      success: boolean
      filePath?: string
      format?: string
      width?: number
      height?: number
      fileSize?: number
      limitReached?: boolean
      maxBytes?: number | null
      underLimit?: boolean
      cached?: boolean
      error?: string
    }>
    processImageForPreview(payload: {
      sourcePath: string
      outputPath?: string
      workspaceDir?: string
      maxWidth?: number
      maxHeight?: number
      maxBytes?: number
      format?: 'jpeg' | 'png' | 'webp'
      quality?: number
      minQuality?: number
      fit?: 'inside' | 'cover' | 'contain' | 'fill'
      position?: string
      background?: string
      cacheKey?: string
      cacheFolder?: string
    }): Promise<{
      success: boolean
      filePath?: string
      format?: string
      width?: number
      height?: number
      fileSize?: number
      limitReached?: boolean
      maxBytes?: number | null
      underLimit?: boolean
      cached?: boolean
      previewDataUrl?: string
      error?: string
    }>
    processImagesWithLimits(payload: {
      files: Array<{
        sourcePath: string
        outputPath?: string
        workspaceDir?: string
        maxWidth?: number
        maxHeight?: number
        maxBytes?: number
        format?: 'jpeg' | 'png' | 'webp'
        quality?: number
        minQuality?: number
        fit?: 'inside' | 'cover' | 'contain' | 'fill'
        position?: string
        background?: string
        cacheKey?: string
        cacheFolder?: string
      }>
    }): Promise<{
      success: boolean
      total?: number
      successCount?: number
      results?: Array<any>
      error?: string
    }>
  }
}
