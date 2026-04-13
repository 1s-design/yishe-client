/*
 * @Author: chan-max jackieontheway666@gmail.com
 * @Date: 2025-06-08 23:07:32
 * @LastEditors: chan-max jackieontheway666@gmail.com
 * @LastEditTime: 2025-06-11 19:54:06
 * @FilePath: /yishe-electron/src/preload/index.ts
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  showTrayNotification: (options: { title: string; body: string }) => ipcRenderer.invoke('show-tray-notification', options),
  updateTrayTooltip: (tooltip: string) => ipcRenderer.invoke('update-tray-tooltip', tooltip),
  hideMainWindow: () => ipcRenderer.invoke('hide-main-window'),
  showMainWindow: () => ipcRenderer.invoke('show-main-window'),
  confirmExit: () => ipcRenderer.invoke('confirm-exit'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  toggleDevTools: () => ipcRenderer.invoke('toggle-devtools'),
  // 新增 token 相关方法
  saveToken: (token: string) => ipcRenderer.invoke('save-token', token),
  getToken: () => ipcRenderer.invoke('get-token'),
  isTokenExist: () => ipcRenderer.invoke('is-token-exist'),
  onExtensionConnectionStatus: (callback: (status: any) => void) => {
    ipcRenderer.on('extension-connection-status', (_event, status) => callback(status));
  },
  // 工作目录相关方法
  selectWorkspaceDirectory: () => ipcRenderer.invoke('select-workspace-directory'),
  getWorkspaceDirectory: () => ipcRenderer.invoke('get-workspace-directory'),
  setWorkspaceDirectory: (path: string) => ipcRenderer.invoke('set-workspace-directory', path),
  openPath: (path: string) => ipcRenderer.invoke('open-path', path),
  // 文件下载相关方法
  downloadFile: (url: string) => ipcRenderer.invoke('download-file', url),
  // 文件查询相关方法
  checkFileDownloaded: (url: string) => ipcRenderer.invoke('check-file-downloaded', url),
  checkLocalFileExists: (filePath: string) => ipcRenderer.invoke('check-local-file-exists', filePath),
  // 外部进程 / 插件管理
  listExternalProcesses: () => ipcRenderer.invoke('list-external-processes'),
  startExternalProcess: (id: string) => ipcRenderer.invoke('start-external-process', id),
  stopExternalProcess: (id: string, force?: boolean) => ipcRenderer.invoke('stop-external-process', id, force),
  // Google Arts 高清图片
  getGoogleArtStatus: () => ipcRenderer.invoke('google-art:status'),
  getGoogleArtZooms: (url: string) => ipcRenderer.invoke('google-art:get-zooms', url),
  syncGoogleArtToMaterialLibrary: (payload: { url: string; zoomLevel: number }) =>
    ipcRenderer.invoke('google-art:sync', payload),
  uploadFileToCos: (payload: { filePath: string; key?: string }) =>
    ipcRenderer.invoke('cos:upload-file', payload),
  generateCosKey: (payload: {
    category: string
    filename: string
    account?: string
    userId?: string | number
    entityId?: string | number
    subDirectory?: string
    isThumbnail?: boolean
    timestamp?: number
  }) =>
    ipcRenderer.invoke('cos:generate-key', payload),
  // 本地服务管理
  startLocalService: () => ipcRenderer.invoke('start-local-service'),
  stopLocalService: () => ipcRenderer.invoke('stop-local-service'),
  checkLocalServiceStatus: () => ipcRenderer.invoke('check-local-service-status'),
  // 通用图片上传（在 renderer 端执行）
  downloadImageAndUploadMaterial: (params: {
    url: string
    name?: string
    description?: string
    keywords?: string
    target?: 'sticker' | 'crawler-material'
  }) =>
    ipcRenderer.invoke('material:download-and-upload', params),
  // 兼容旧命名
  downloadImageAndUploadToCrawler: (params: {
    url: string
    name?: string
    description?: string
    keywords?: string
    target?: 'sticker' | 'crawler-material'
  }) =>
    ipcRenderer.invoke('material:download-and-upload', params),
  // 图片转PNG转换（支持SVG、WebP等）
  convertToPng: (payload: { inputPath: string; pngPath: string; width?: number; height?: number }) =>
    ipcRenderer.invoke('convert-to-png', payload)
  ,
  // 通用图片压缩：限制尺寸与大小（不裁剪不填充）
  processImageWithLimits: (payload: {
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
  }) => ipcRenderer.invoke('process-image-with-limits', payload),
  processImageForPreview: (payload: {
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
  }) => ipcRenderer.invoke('process-image-for-preview', payload),
  processImagesWithLimits: (payload: {
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
  }) => ipcRenderer.invoke('process-images-with-limits', payload)
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
