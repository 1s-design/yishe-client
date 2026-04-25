import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
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
      getDeviceKey(): Promise<string>
      onExtensionConnectionStatus(callback: (status: any) => void): void
      openExternal(url: string): Promise<void>
      toggleDevTools(): Promise<{ opened: boolean }>
      // 工作目录相关方法
      selectWorkspaceDirectory(): Promise<string | null>
      getWorkspaceDirectory(): Promise<string>
      setWorkspaceDirectory(path: string): Promise<boolean>
      getImageToolStatus(): Promise<any>
      getImageToolDirectories(): Promise<any>
      getImageToolCatalog(): Promise<any>
      getImageToolOperations(): Promise<any>
      getImageToolOperationSchemas(): Promise<any>
      getImageToolOperationDetail(type: string): Promise<any>
      getImageToolExamples(): Promise<any>
      getImageToolExampleDetail(id: string): Promise<any>
      getImageToolVariationsConfig(): Promise<any>
      saveImageToolInput(payload: { sourcePath: string; fileName?: string }): Promise<any>
      getImageToolInfo(payload: {
        sourcePath?: string
        imageUrl?: string
        image?: string
        filename?: string
        engine?: string
      }): Promise<any>
      processImageTool(payload: {
        sourcePath?: string
        imageUrl?: string
        image?: string
        filename?: string
        operations: Array<any>
        outputPrefix?: string
        engine?: string
      }): Promise<any>
      processImageToolWithPrompt(payload: {
        prompt: string
        sourcePath?: string
        imageUrl?: string
        image?: string
        filename?: string
        outputPrefix?: string
        engine?: string
      }): Promise<any>
      generateImageToolVariations(payload: {
        sourcePath?: string
        imageUrl?: string
        image?: string
        filename?: string
        engine?: string
      }): Promise<any>
      listImageToolFiles(payload: {
        directory?: 'uploads' | 'output' | 'template' | 'temp'
      }): Promise<any>
      deleteImageToolFile(payload: {
        directory?: 'uploads' | 'output' | 'template' | 'temp'
        fileName: string
      }): Promise<any>
      clearImageToolFiles(payload: {
        directory?: 'uploads' | 'output' | 'template' | 'temp'
      }): Promise<any>
      getVideoTemplateStatus(): Promise<any>
      getVideoTemplateCatalog(): Promise<any>
      listVideoTemplateRenders(): Promise<any>
      getVideoTemplateRender(jobId: string): Promise<any>
      enqueueVideoTemplateRender(payload: {
        templateId: string
        inputProps?: Record<string, any>
      }): Promise<any>
      cancelVideoTemplateRender(jobId: string): Promise<any>
      openPath(path: string): Promise<void>
      // 文件下载相关方法
      downloadFile(url: string): Promise<{
        success: boolean
        message: string
        filePath?: string
        skipped?: boolean
        fileSize?: number
        error?: string
        statusCode?: number
      }>
      // 文件查询相关方法
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
      // 外部进程 / 插件管理
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
        status: number
        ok: boolean
        body: any
        headers?: Record<string, string>
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
      // 本地服务管理
      startLocalService(): Promise<{ success: boolean; message: string }>
      stopLocalService(): Promise<{ success: boolean; message: string }>
      checkLocalServiceStatus(): Promise<{
        running: boolean
        available: boolean
        port: number
        error?: string
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
}
