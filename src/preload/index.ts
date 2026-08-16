/*
 * @Author: chan-max jackieontheway666@gmail.com
 * @Date: 2025-06-08 23:07:32
 * @LastEditors: chan-max jackieontheway666@gmail.com
 * @LastEditTime: 2025-06-11 19:54:06
 * @FilePath: /yishe-electron/src/preload/index.ts
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
import { contextBridge, ipcRenderer } from "electron";
import { electronAPI } from "@electron-toolkit/preload";

// Custom APIs for renderer
const api = {
  showTrayNotification: (options: { title: string; body: string }) =>
    ipcRenderer.invoke("show-tray-notification", options),
  updateTrayTooltip: (tooltip: string) =>
    ipcRenderer.invoke("update-tray-tooltip", tooltip),
  hideMainWindow: () => ipcRenderer.invoke("hide-main-window"),
  showMainWindow: () => ipcRenderer.invoke("show-main-window"),
  confirmExit: () => ipcRenderer.invoke("confirm-exit"),
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  openExternal: (url: string) => ipcRenderer.invoke("open-external", url),
  toggleDevTools: () => ipcRenderer.invoke("toggle-devtools"),
  writeClientLog: (payload: {
    level?: string;
    module?: string;
    message?: string;
    context?: Record<string, any>;
  }) => ipcRenderer.invoke("client-log:write", payload),
  queryClientLog: (action: string, payload?: Record<string, any>) =>
    ipcRenderer.invoke("client-log:query", action, payload || {}),
  // 新增 token 相关方法
  saveToken: (token: string) => ipcRenderer.invoke("save-token", token),
  getToken: () => ipcRenderer.invoke("get-token"),
  isTokenExist: () => ipcRenderer.invoke("is-token-exist"),
  clearToken: () => ipcRenderer.invoke("clear-token"),
  getDeviceKey: () => ipcRenderer.invoke("get-device-key"),
  getLocalDatabaseInfo: () => ipcRenderer.invoke("local-database:get-info"),
  onAppRuntimeEvent: (callback: (event: any) => void) => {
    ipcRenderer.on("app-runtime-event", (_event, payload) => callback(payload));
  },
  onExtensionConnectionStatus: (callback: (status: any) => void) => {
    ipcRenderer.on("extension-connection-status", (_event, status) =>
      callback(status),
    );
  },
  // 工作目录相关方法
  selectWorkspaceDirectory: () =>
    ipcRenderer.invoke("select-workspace-directory"),
  getWorkspaceDirectory: () => ipcRenderer.invoke("get-workspace-directory"),
  setWorkspaceDirectory: (path: string) =>
    ipcRenderer.invoke("set-workspace-directory", path),
  getImageToolStatus: () => ipcRenderer.invoke("image-tool:get-status"),
  startImageToolService: () => ipcRenderer.invoke("image-tool:start"),
  stopImageToolService: () => ipcRenderer.invoke("image-tool:stop"),
  getImageToolDirectories: () =>
    ipcRenderer.invoke("image-tool:get-directories"),
  getImageToolCatalog: () => ipcRenderer.invoke("image-tool:get-catalog"),
  getImageToolOperations: () => ipcRenderer.invoke("image-tool:get-operations"),
  getImageToolOperationSchemas: () =>
    ipcRenderer.invoke("image-tool:get-operation-schemas"),
  getImageToolOperationDetail: (type: string) =>
    ipcRenderer.invoke("image-tool:get-operation-detail", type),
  getImageToolExamples: () => ipcRenderer.invoke("image-tool:get-examples"),
  getImageToolExampleDetail: (id: string) =>
    ipcRenderer.invoke("image-tool:get-example-detail", id),
  getImageToolVariationsConfig: () =>
    ipcRenderer.invoke("image-tool:get-variations-config"),
  saveImageToolInput: (payload: { sourcePath: string; fileName?: string }) =>
    ipcRenderer.invoke("image-tool:save-input", payload),
  getImageToolInfo: (payload: {
    sourcePath?: string;
    imageUrl?: string;
    image?: string;
    filename?: string;
    engine?: string;
  }) => ipcRenderer.invoke("image-tool:get-info", payload),
  processImageTool: (payload: {
    sourcePath?: string;
    imageUrl?: string;
    image?: string;
    filename?: string;
    operations: Array<any>;
    outputPrefix?: string;
    engine?: string;
  }) => ipcRenderer.invoke("image-tool:process", payload),
  processImageToolWithPrompt: (payload: {
    prompt: string;
    sourcePath?: string;
    imageUrl?: string;
    image?: string;
    filename?: string;
    outputPrefix?: string;
    engine?: string;
  }) => ipcRenderer.invoke("image-tool:process-with-prompt", payload),
  generateImageToolVariations: (payload: {
    sourcePath?: string;
    imageUrl?: string;
    image?: string;
    filename?: string;
    engine?: string;
  }) => ipcRenderer.invoke("image-tool:variations", payload),
  listImageToolFiles: (payload: {
    directory?: "uploads" | "output" | "template" | "temp";
  }) => ipcRenderer.invoke("image-tool:list-files", payload),
  deleteImageToolFile: (payload: {
    directory?: "uploads" | "output" | "template" | "temp";
    fileName: string;
  }) => ipcRenderer.invoke("image-tool:delete-file", payload),
  clearImageToolFiles: (payload: {
    directory?: "uploads" | "output" | "template" | "temp";
  }) => ipcRenderer.invoke("image-tool:clear-files", payload),
  getVideoTemplateStatus: () => ipcRenderer.invoke("video-template:get-status"),
  startVideoTemplateService: () => ipcRenderer.invoke("video-template:start"),
  stopVideoTemplateService: () => ipcRenderer.invoke("video-template:stop"),
  getVideoTemplateCatalog: () =>
    ipcRenderer.invoke("video-template:get-catalog"),
  listVideoTemplateRenders: () =>
    ipcRenderer.invoke("video-template:list-renders"),
  getVideoTemplateRender: (jobId: string) =>
    ipcRenderer.invoke("video-template:get-render", jobId),
  enqueueVideoTemplateRender: (payload: {
    templateId: string;
    inputProps?: Record<string, any>;
  }) => ipcRenderer.invoke("video-template:enqueue-render", payload),
  cancelVideoTemplateRender: (jobId: string) =>
    ipcRenderer.invoke("video-template:cancel-render", jobId),
  openPath: (path: string) => ipcRenderer.invoke("open-path", path),
  // 文件下载相关方法
  downloadFile: (url: string) => ipcRenderer.invoke("download-file", url),
  // 文件查询相关方法
  checkFileDownloaded: (url: string) =>
    ipcRenderer.invoke("check-file-downloaded", url),
  checkLocalFileExists: (filePath: string) =>
    ipcRenderer.invoke("check-local-file-exists", filePath),
  // 外部进程 / 插件管理
  listExternalProcesses: () => ipcRenderer.invoke("list-external-processes"),
  startExternalProcess: (id: string) =>
    ipcRenderer.invoke("start-external-process", id),
  stopExternalProcess: (id: string, force?: boolean) =>
    ipcRenderer.invoke("stop-external-process", id, force),
  restartExternalProcess: (id: string) =>
    ipcRenderer.invoke("restart-external-process", id),
  invokeAutoBrowser: (request: {
    method?: string;
    path: string;
    query?: Record<string, any>;
    body?: any;
  }) => ipcRenderer.invoke("auto-browser:invoke", request),
  // Google Arts 高清图片
  getGoogleArtStatus: () => ipcRenderer.invoke("google-art:status"),
  getGoogleArtZooms: (url: string) =>
    ipcRenderer.invoke("google-art:get-zooms", url),
  searchGoogleArts: (payload: {
    keyword: string;
    page?: number;
    hl?: string;
    maxCount?: number;
    cursor?: string | null;
  }) => ipcRenderer.invoke("google-art:search", payload),
  syncGoogleArtToMaterialLibrary: (payload: {
    url: string;
    zoomLevel: number;
  }) => ipcRenderer.invoke("google-art:sync", payload),
  // Pinterest 图搜与下载
  searchPinterest: (payload: {
    keyword: string;
    scope?: string;
    limit?: number;
    imageOnly?: boolean;
    bookmark?: string | null;
  }) => ipcRenderer.invoke("pinterest:search", payload),
  getPinterestStatus: () => ipcRenderer.invoke("pinterest:status"),
  downloadPinterestImage: (payload: { imageUrl: string; filename?: string }) =>
    ipcRenderer.invoke("pinterest:download", payload),
  syncPinterestToMaterialLibrary: (payload: {
    imageUrl: string;
    metadata?: Record<string, any>;
  }) => ipcRenderer.invoke("pinterest:sync", payload),
  // Wikimedia Commons 图搜与下载
  searchWikimedia: (payload: {
    keyword: string;
    limit?: number;
    imageOnly?: boolean;
    offset?: number | null;
  }) => ipcRenderer.invoke("wikimedia:search", payload),
  getWikimediaStatus: () => ipcRenderer.invoke("wikimedia:status"),
  downloadWikimediaImage: (payload: { imageUrl: string; filename?: string }) =>
    ipcRenderer.invoke("wikimedia:download", payload),
  syncWikimediaToMaterialLibrary: (payload: {
    imageUrl: string;
    metadata?: Record<string, any>;
  }) => ipcRenderer.invoke("wikimedia:sync", payload),
  // Pexels 高清摄影图搜与下载
  searchPexels: (payload: { keyword: string; limit?: number; page?: number }) =>
    ipcRenderer.invoke("pexels:search", payload),
  getPexelsStatus: () => ipcRenderer.invoke("pexels:status"),
  downloadPexelsImage: (payload: { imageUrl: string; filename?: string }) =>
    ipcRenderer.invoke("pexels:download", payload),
  syncPexelsToMaterialLibrary: (payload: {
    imageUrl: string;
    metadata?: Record<string, any>;
  }) => ipcRenderer.invoke("pexels:sync", payload),
  // Pixabay 免费图库图搜与下载
  searchPixabay: (payload: {
    keyword: string;
    limit?: number;
    page?: number;
  }) => ipcRenderer.invoke("pixabay:search", payload),
  getPixabayStatus: () => ipcRenderer.invoke("pixabay:status"),
  downloadPixabayImage: (payload: { imageUrl: string; filename?: string }) =>
    ipcRenderer.invoke("pixabay:download", payload),
  syncPixabayToMaterialLibrary: (payload: {
    imageUrl: string;
    metadata?: Record<string, any>;
  }) => ipcRenderer.invoke("pixabay:sync", payload),
  uploadFileToCos: (payload: { filePath: string; key?: string }) =>
    ipcRenderer.invoke("cos:upload-file", payload),
  generateCosKey: (payload: {
    category: string;
    filename: string;
    account?: string;
    userId?: string | number;
    entityId?: string | number;
    subDirectory?: string;
    isThumbnail?: boolean;
    timestamp?: number;
  }) => ipcRenderer.invoke("cos:generate-key", payload),
  // 本地服务管理
  startLocalService: () => ipcRenderer.invoke("start-local-service"),
  stopLocalService: () => ipcRenderer.invoke("stop-local-service"),
  checkLocalServiceStatus: () =>
    ipcRenderer.invoke("check-local-service-status"),
  // MCP Server 管理
  startMcpServer: () => ipcRenderer.invoke("mcp-server:start"),
  stopMcpServer: () => ipcRenderer.invoke("mcp-server:stop"),
  checkMcpServerStatus: () => ipcRenderer.invoke("mcp-server:status"),
  // MCP 工具执行
  callMcpTool: (toolName: string, toolArgs: Record<string, any>) =>
    ipcRenderer.invoke("mcp:call-tool", toolName, toolArgs),
  listMcpTools: () => ipcRenderer.invoke("mcp:list-tools"),
  // Agent 配置同步
  setAgentConfig: (config: {
    keyId: number | null;
    model: string;
    baseUrl: string;
    apiKey: string;
    enabled: boolean;
  }) => ipcRenderer.invoke("agent-config:set", config),
  getAgentConfig: () => ipcRenderer.invoke("agent-config:get"),
  // 通用图片上传（在 renderer 端执行）
  downloadImageAndUploadMaterial: (params: {
    url: string;
    name?: string;
    description?: string;
    keywords?: string;
    target?: "sticker" | "crawler-material";
  }) => ipcRenderer.invoke("material:download-and-upload", params),
  // 兼容旧命名
  downloadImageAndUploadToCrawler: (params: {
    url: string;
    name?: string;
    description?: string;
    keywords?: string;
    target?: "sticker" | "crawler-material";
  }) => ipcRenderer.invoke("material:download-and-upload", params),
  // 图片转PNG转换（支持SVG、WebP等）
  convertToPng: (payload: {
    inputPath: string;
    pngPath: string;
    width?: number;
    height?: number;
  }) => ipcRenderer.invoke("convert-to-png", payload),
  // Rawpixel API 导出
  searchRawpixel: (payload: {
    keyword: string;
    limit?: number;
    page?: number;
    sort?: string;
  }) => ipcRenderer.invoke("rawpixel:search", payload),
  getRawpixelStatus: () => ipcRenderer.invoke("rawpixel:status"),
  downloadRawpixelImage: (payload: { imageUrl: string; filename?: string }) =>
    ipcRenderer.invoke("rawpixel:download", payload),
  syncRawpixelToMaterialLibrary: (
    imageUrl: string,
    metadata?: Record<string, any>,
  ) => ipcRenderer.invoke("rawpixel:sync", { imageUrl, metadata }),
  // StockSnap API 导出
  searchStockSnap: (payload: {
    keyword: string;
    limit?: number;
    page?: number;
    sort?: string;
  }) => ipcRenderer.invoke("stocksnap:search", payload),
  getStockSnapStatus: () => ipcRenderer.invoke("stocksnap:status"),
  downloadStockSnapImage: (payload: { imageUrl: string; filename?: string }) =>
    ipcRenderer.invoke("stocksnap:download", payload),
  syncStockSnapToMaterialLibrary: (
    imageUrl: string,
    metadata?: Record<string, any>,
  ) => ipcRenderer.invoke("stocksnap:sync", { imageUrl, metadata }),
  // Openverse API 导出
  searchOpenverse: (payload: {
    query: string;
    limit?: number;
    page?: number;
  }) => ipcRenderer.invoke("openverse:search", payload),
  getOpenverseStatus: () => ipcRenderer.invoke("openverse:status"),
  downloadOpenverseImage: (payload: { imageUrl: string; filename?: string }) =>
    ipcRenderer.invoke("openverse:download", payload),
  syncOpenverseToMaterialLibrary: (
    imageUrl: string,
    metadata?: Record<string, any>,
  ) => ipcRenderer.invoke("openverse:sync", { imageUrl, metadata }),
  // Kaboompics API 导出
  searchKaboompics: (payload: {
    query: string;
    limit?: number;
    page?: number;
  }) => ipcRenderer.invoke("kaboompics:search", payload),
  getKaboompicsStatus: () => ipcRenderer.invoke("kaboompics:status"),
  downloadKaboompicsImage: (payload: { imageUrl: string; filename?: string }) =>
    ipcRenderer.invoke("kaboompics:download", payload),
  syncKaboompicsToMaterialLibrary: (
    imageUrl: string,
    metadata?: Record<string, any>,
  ) => ipcRenderer.invoke("kaboompics:sync", { imageUrl, metadata }),
  // Openclipart API 导出
  searchOpenclipart: (payload: {
    query: string;
    limit?: number;
    page?: number;
    formatPreference?: "svg" | "png";
  }) => ipcRenderer.invoke("openclipart:search", payload),
  getOpenclipartStatus: () => ipcRenderer.invoke("openclipart:status"),
  downloadOpenclipartImage: (payload: {
    imageUrl: string;
    filename?: string;
    format?: "svg" | "png";
  }) => ipcRenderer.invoke("openclipart:download", payload),
  syncOpenclipartToMaterialLibrary: (
    imageUrl: string,
    metadata?: Record<string, any>,
  ) => ipcRenderer.invoke("openclipart:sync", { imageUrl, metadata }),
  // undraw API 导出
  searchUndraw: (payload: {
    query: string;
    limit?: number;
    page?: number;
    color?: string;
  }) => ipcRenderer.invoke("undraw:search", payload),
  getUndrawStatus: () => ipcRenderer.invoke("undraw:status"),
  downloadUndrawImage: (payload: {
    imageUrl: string;
    filename?: string;
    color?: string;
  }) => ipcRenderer.invoke("undraw:download", payload),
  syncUndrawToMaterialLibrary: (
    imageUrl: string,
    metadata?: Record<string, any>,
  ) => ipcRenderer.invoke("undraw:sync", { imageUrl, metadata }),
  // Vecteezy API 导出
  searchVecteezy: (payload: {
    query: string;
    limit?: number;
    page?: number;
    mediaType?: "photos" | "png" | "vector";
  }) => ipcRenderer.invoke("vecteezy:search", payload),
  getVecteezyStatus: () => ipcRenderer.invoke("vecteezy:status"),
  downloadVecteezyAsset: (payload: {
    imageUrl: string;
    filename?: string;
    format?: "svg" | "png" | "jpg";
  }) => ipcRenderer.invoke("vecteezy:download", payload),
  syncVecteezyToMaterialLibrary: (
    imageUrl: string,
    metadata?: Record<string, any>,
  ) => ipcRenderer.invoke("vecteezy:sync", { imageUrl, metadata }),
  // OpenMoji API 导出
  searchOpenMoji: (payload: {
    query: string;
    limit?: number;
    page?: number;
    style?: "color" | "black";
    group?: string;
  }) => ipcRenderer.invoke("openmoji:search", payload),
  getOpenMojiStatus: () => ipcRenderer.invoke("openmoji:status"),
  downloadOpenMojiEmoji: (payload: {
    imageUrl: string;
    filename?: string;
    style?: "color" | "black";
  }) => ipcRenderer.invoke("openmoji:download", payload),
  syncOpenMojiToMaterialLibrary: (
    imageUrl: string,
    metadata?: Record<string, any>,
  ) => ipcRenderer.invoke("openmoji:sync", { imageUrl, metadata }),
  // Google Icons API 导出
  searchGoogleIcons: (payload: {
    query: string;
    limit?: number;
    page?: number;
    style?: "outlined" | "rounded" | "sharp" | "two-tone";
    size?: number;
  }) => ipcRenderer.invoke("googleicons:search", payload),
  getGoogleIconsStatus: () => ipcRenderer.invoke("googleicons:status"),
  downloadGoogleIcon: (payload: {
    imageUrl: string;
    filename?: string;
    style?: string;
  }) => ipcRenderer.invoke("googleicons:download", payload),
  syncGoogleIconsToMaterialLibrary: (
    imageUrl: string,
    metadata?: Record<string, any>,
  ) => ipcRenderer.invoke("googleicons:sync", { imageUrl, metadata }),
  // Emojipedia API 导出
  searchEmojipedia: (payload: {
    query: string;
    limit?: number;
    page?: number;
    category?: string;
    platform?: string;
  }) => ipcRenderer.invoke("emojipedia:search", payload),
  getEmojipediaStatus: () => ipcRenderer.invoke("emojipedia:status"),
  downloadEmojipediaItem: (payload: {
    imageUrl: string;
    filename?: string;
    platform?: string;
  }) => ipcRenderer.invoke("emojipedia:download", payload),
  syncEmojipediaToMaterialLibrary: (
    imageUrl: string,
    metadata?: Record<string, any>,
  ) => ipcRenderer.invoke("emojipedia:sync", { imageUrl, metadata }),
  // 新闻数据平台 API 导出
  searchHN: (payload: { type?: string; options?: any }) =>
    ipcRenderer.invoke("hackernews:search", payload),
  getHNStatus: () => ipcRenderer.invoke("hackernews:status"),
  searchArxiv: (payload: { query: string; options?: any }) =>
    ipcRenderer.invoke("arxiv:search", payload),
  getArxivStatus: () => ipcRenderer.invoke("arxiv:status"),
  searchGithub: (payload: { query: string; options?: any }) =>
    ipcRenderer.invoke("github:search", payload),
  getGithubStatus: () => ipcRenderer.invoke("github:status"),
  searchGdelt: (payload: { query: string; options?: any }) =>
    ipcRenderer.invoke("gdelt:search", payload),
  getGdeltStatus: () => ipcRenderer.invoke("gdelt:status"),
  searchGoogleNews: (payload: { query: string; options?: any }) =>
    ipcRenderer.invoke("googlenews:search", payload),
  getGoogleNewsStatus: () => ipcRenderer.invoke("googlenews:status"),
  searchReddit: (payload: { query: string; options?: any }) =>
    ipcRenderer.invoke("reddit:search", payload),
  getRedditStatus: () => ipcRenderer.invoke("reddit:status"),
  searchPH: (payload: { accessToken: string; options?: any }) =>
    ipcRenderer.invoke("producthunt:search", payload),
  getPHStatus: () => ipcRenderer.invoke("producthunt:status"),
  searchGuardian: (payload: { apiKey: string; options?: any }) =>
    ipcRenderer.invoke("theguardian:search", payload),
  getGuardianStatus: () => ipcRenderer.invoke("theguardian:status"),
  fetchBBC: (payload: { category?: string }) =>
    ipcRenderer.invoke("bbcnews:search", payload),
  getBBCStatus: () => ipcRenderer.invoke("bbcnews:status"),
  fetchNPR: (payload: { category?: string }) =>
    ipcRenderer.invoke("npr:search", payload),
  getNPRStatus: () => ipcRenderer.invoke("npr:status"),
  fetchTC: (payload: { category?: string }) =>
    ipcRenderer.invoke("techcrunch:search", payload),
  getTCStatus: () => ipcRenderer.invoke("techcrunch:status"),
  fetchVerge: (payload: { category?: string }) =>
    ipcRenderer.invoke("theverge:search", payload),
  getVergeStatus: () => ipcRenderer.invoke("theverge:status"),
  fetchArs: (payload: { category?: string }) =>
    ipcRenderer.invoke("arstechnica:search", payload),
  getArsStatus: () => ipcRenderer.invoke("arstechnica:status"),
  fetchMIT: (payload: { category?: string }) =>
    ipcRenderer.invoke("mittechreview:search", payload),
  getMITStatus: () => ipcRenderer.invoke("mittechreview:status"),
  fetchReuters: (payload: { category?: string }) =>
    ipcRenderer.invoke("reuters:search", payload),
  getReutersStatus: () => ipcRenderer.invoke("reuters:status"),
  fetchChinaDaily: (payload: { category?: string }) =>
    ipcRenderer.invoke("chinadaily:search", payload),
  getChinaDailyStatus: () => ipcRenderer.invoke("chinadaily:status"),
  fetchGovCN: (payload: { category?: string }) =>
    ipcRenderer.invoke("govcn:search", payload),
  getGovCNStatus: () => ipcRenderer.invoke("govcn:status"),
  fetchXH: (payload: { category?: string }) =>
    ipcRenderer.invoke("xinhuanet:search", payload),
  getXHStatus: () => ipcRenderer.invoke("xinhuanet:status"),
  fetchThePaper: (payload: { category?: string; query?: string }) =>
    ipcRenderer.invoke("thepaper:search", payload),
  getThePaperStatus: () => ipcRenderer.invoke("thepaper:status"),
  search36Kr: (payload: { category?: string; query?: string; options?: any }) =>
    ipcRenderer.invoke("36kr:search", payload),
  get36KrStatus: () => ipcRenderer.invoke("36kr:status"),
  searchHuxiu: (payload: {
    category?: string;
    query?: string;
    options?: any;
  }) => ipcRenderer.invoke("huxiu:search", payload),
  getHuxiuStatus: () => ipcRenderer.invoke("huxiu:status"),
  // nounproject API 导出
  searchNounProject: (payload: {
    query: string;
    limit?: number;
    page?: number;
    mediaType?: "photos" | "icons";
    color?: string;
  }) => ipcRenderer.invoke("nounproject:search", payload),
  getNounProjectStatus: () => ipcRenderer.invoke("nounproject:status"),
  downloadNounProjectAsset: (payload: {
    imageUrl: string;
    filename?: string;
    format?: "svg" | "png" | "jpg";
  }) => ipcRenderer.invoke("nounproject:download", payload),
  syncNounProjectToMaterialLibrary: (
    imageUrl: string,
    metadata?: Record<string, any>,
  ) => ipcRenderer.invoke("nounproject:sync", { imageUrl, metadata }),
  // Iconify API 导出
  searchIconify: (payload: {
    query: string;
    limit?: number;
    page?: number;
    prefix?: string;
    color?: string;
  }) => ipcRenderer.invoke("iconify:search", payload),
  getIconifyStatus: () => ipcRenderer.invoke("iconify:status"),
  downloadIconifyIcon: (payload: {
    imageUrl: string;
    filename?: string;
    color?: string;
  }) => ipcRenderer.invoke("iconify:download", payload),
  syncIconifyToMaterialLibrary: (
    imageUrl: string,
    metadata?: Record<string, any>,
  ) => ipcRenderer.invoke("iconify:sync", { imageUrl, metadata }),
  // SVGRepo API 导出
  searchSvgrepo: (payload: {
    query: string;
    limit?: number;
    page?: number;
    style?: string;
  }) => ipcRenderer.invoke("svgrepo:search", payload),
  getSvgrepoStatus: () => ipcRenderer.invoke("svgrepo:status"),
  downloadSvgrepoImage: (payload: { imageUrl: string; filename?: string }) =>
    ipcRenderer.invoke("svgrepo:download", payload),
  syncSvgrepoToMaterialLibrary: (
    imageUrl: string,
    metadata?: Record<string, any>,
  ) => ipcRenderer.invoke("svgrepo:sync", { imageUrl, metadata }),
  processImageWithLimits: (payload: {
    sourcePath: string;
    outputPath?: string;
    workspaceDir?: string;
    maxWidth?: number;
    maxHeight?: number;
    maxBytes?: number;
    format?: "jpeg" | "png" | "webp";
    quality?: number;
    minQuality?: number;
    fit?: "inside" | "cover" | "contain" | "fill";
    position?: string;
    background?: string;
    cacheKey?: string;
    cacheFolder?: string;
  }) => ipcRenderer.invoke("process-image-with-limits", payload),
  processImageForPreview: (payload: {
    sourcePath: string;
    outputPath?: string;
    workspaceDir?: string;
    maxWidth?: number;
    maxHeight?: number;
    maxBytes?: number;
    format?: "jpeg" | "png" | "webp";
    quality?: number;
    minQuality?: number;
    fit?: "inside" | "cover" | "contain" | "fill";
    position?: string;
    background?: string;
    cacheKey?: string;
    cacheFolder?: string;
  }) => ipcRenderer.invoke("process-image-for-preview", payload),
  processImagesWithLimits: (payload: {
    files: Array<{
      sourcePath: string;
      outputPath?: string;
      workspaceDir?: string;
      maxWidth?: number;
      maxHeight?: number;
      maxBytes?: number;
      format?: "jpeg" | "png" | "webp";
      quality?: number;
      minQuality?: number;
      fit?: "inside" | "cover" | "contain" | "fill";
      position?: string;
      background?: string;
      cacheKey?: string;
      cacheFolder?: string;
    }>;
  }) => ipcRenderer.invoke("process-images-with-limits", payload),
  // 客户端 Agent 相关方法
  agent: {
    sendMessage: (payload: {
      runId: string;
      sessionId: string;
      messages: any[];
      config?: any;
    }) => ipcRenderer.send("agent:send-message", payload),
    stop: () => ipcRenderer.invoke("agent:stop"),
    getConfig: () => ipcRenderer.invoke("agent:get-config"),
    saveConfig: (config: any) =>
      ipcRenderer.invoke("agent:save-config", config),
    syncCloudConfig: (payload: { serverBase: string; token: string }) =>
      ipcRenderer.invoke("agent:sync-cloud-config", payload),
    onReasoning: (callback: (data: { delta: string }) => void) => {
      const listener = (_event: any, data: any) => callback(data);
      ipcRenderer.on("agent:stream:reasoning", listener);
      return () =>
        ipcRenderer.removeListener("agent:stream:reasoning", listener);
    },
    onContent: (callback: (data: { delta: string }) => void) => {
      const listener = (_event: any, data: any) => callback(data);
      ipcRenderer.on("agent:stream:content", listener);
      return () => ipcRenderer.removeListener("agent:stream:content", listener);
    },
    onToolStart: (callback: (data: any) => void) => {
      const listener = (_event: any, data: any) => callback(data);
      ipcRenderer.on("agent:stream:tool_start", listener);
      return () =>
        ipcRenderer.removeListener("agent:stream:tool_start", listener);
    },
    onToolEnd: (callback: (data: any) => void) => {
      const listener = (_event: any, data: any) => callback(data);
      ipcRenderer.on("agent:stream:tool_end", listener);
      return () =>
        ipcRenderer.removeListener("agent:stream:tool_end", listener);
    },
    onComplete: (
      callback: (data: { fullText: string; fullReasoning: string }) => void,
    ) => {
      const listener = (_event: any, data: any) => callback(data);
      ipcRenderer.on("agent:stream:complete", listener);
      return () =>
        ipcRenderer.removeListener("agent:stream:complete", listener);
    },
    onError: (callback: (data: { error: string }) => void) => {
      const listener = (_event: any, data: any) => callback(data);
      ipcRenderer.on("agent:stream:error", listener);
      return () => ipcRenderer.removeListener("agent:stream:error", listener);
    },
    removeAllListeners: () => {
      ipcRenderer.removeAllListeners("agent:stream:reasoning");
      ipcRenderer.removeAllListeners("agent:stream:content");
      ipcRenderer.removeAllListeners("agent:stream:tool_start");
      ipcRenderer.removeAllListeners("agent:stream:tool_end");
      ipcRenderer.removeAllListeners("agent:stream:complete");
      ipcRenderer.removeAllListeners("agent:stream:error");
    },
  },
};

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    contextBridge.exposeInMainWorld("api", api);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI;
  // @ts-ignore (define in dts)
  window.api = api;
}
