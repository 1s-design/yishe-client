// 文件顶部已有该导入
import { app, shell, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, session } from 'electron'
import { join } from 'path'
import { resolve, dirname, extname, basename } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/favicon.png?asset'
import puppeteer from 'puppeteer'
// 暂时注释掉发布服务相关引用，代码保留但不使用
// import { publishToXiaohongshu } from './xiaohongshu'
// import { publishToDouyin } from './douyin'
// import { publishToKuaishou } from './kuaishou'
import { spawn } from 'child_process'
import { homedir, platform } from 'os'
import { join as pathJoin } from 'path'
import fs from 'fs'
import https from 'https'
import http from 'http'
import { URL } from 'url'
import { getGoogleArtZooms, syncGoogleArtToMaterialLibrary, getGoogleArtStatus } from './googleArt'
import { uploadFileToCos } from './cos'
import sharp from 'sharp'
import { createHash } from 'crypto'
import {
  startServer,
  stopServer,
  isServerRunning,
  saveToken,
  getOrCreateBrowser,
  getTokenValue,
  isTokenExist
} from './server';
// 暂时注释掉发布服务相关引用，代码保留但不使用
// import { PublishService } from './publishService';
import { connectionManager } from './connectionManager';
import { networkMonitor } from './networkMonitor';
import ElectronStore from 'electron-store';
import { ExternalProcessManager, ProcessStatus } from './externalProcessManager';
import { pluginProcessConfigs } from './externalProcessConfig';

// 扩展app对象的类型
declare global {
  namespace NodeJS {
    interface Global {
      app: Electron.App & { isQuiting?: boolean }
    }
  }
}

// 为app对象添加isQuiting属性
;(app as any).isQuiting = false

// 全局变量
let tray: Tray | null = null
let mainWindow: BrowserWindow | null = null

// 插件/外部进程管理器
const externalProcessManager = new ExternalProcessManager(pluginProcessConfigs)

// 初始化 electron-store
// 处理 electron-store 在 CommonJS 环境下的导入问题
const Store = (ElectronStore as any).default || ElectronStore;
const store = new Store({
  defaults: {
    workspaceDirectory: ''
  }
})

/**
 * 获取默认工作目录路径
 * Windows: C:\yisheworkspace
 * macOS/Linux: ~/yisheworkspace
 */
function getDefaultWorkspaceDirectory(): string {
  if (platform() === 'win32') {
    // Windows: 使用 C 盘
    return 'C:\\yisheworkspace'
  } else {
    // macOS/Linux: 使用用户主目录
    return pathJoin(homedir(), 'yisheworkspace')
  }
}

/**
 * 初始化默认工作目录
 * 如果工作目录未设置，自动设置为默认路径并创建目录
 * 如果用户已经设置过工作目录，保持用户的设置（即使目录不存在）
 */
function initializeDefaultWorkspaceDirectory(): void {
  const currentWorkspace = store.get('workspaceDirectory', '') as string
  
  // 如果已经设置了工作目录（无论目录是否存在），保持用户的设置
  if (currentWorkspace && currentWorkspace.trim() !== '') {
    if (fs.existsSync(currentWorkspace)) {
      console.log('✅ 工作目录已设置:', currentWorkspace)
    } else {
      console.warn('⚠️ 工作目录不存在，但保持用户设置:', currentWorkspace)
    }
    return
  }
  
  // 工作目录未设置，自动设置为默认路径
  const defaultWorkspace = getDefaultWorkspaceDirectory()
  
  try {
    // 创建目录（如果不存在）
    if (!fs.existsSync(defaultWorkspace)) {
      fs.mkdirSync(defaultWorkspace, { recursive: true })
      console.log('📁 已创建默认工作目录:', defaultWorkspace)
    }
    
    // 保存到 store
    store.set('workspaceDirectory', defaultWorkspace)
    console.log('✅ 已自动设置默认工作目录:', defaultWorkspace)
  } catch (error: any) {
    console.error('❌ 初始化默认工作目录失败:', error)
    // 如果创建失败，仍然保存路径，让用户手动创建
    store.set('workspaceDirectory', defaultWorkspace)
  }
}

// 防止重复显示协议错误弹窗的标记
let protocolErrorDialogShown = false;
let protocolErrorDialogTimeout: NodeJS.Timeout | null = null;

// 设置连接管理器事件监听
function setupConnectionManagerEvents(): void {
  // 连接成功事件
  connectionManager.on('connected', () => {
    console.log('✅ 浏览器连接成功');
    if (mainWindow) {
      mainWindow.webContents.send('connection-status', { isConnected: true });
    }
  });

  // 连接错误事件
  connectionManager.on('error', async (error) => {
    console.error('❌ 浏览器连接错误:', error);
    if (mainWindow) {
      mainWindow.webContents.send('connection-status', { 
        isConnected: false, 
        error: error instanceof Error ? error.message : String(error) 
      });
    }

    // 检查是否是协议错误，如果是则显示用户弹窗
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('Protocol error') || errorMessage.includes('Connection closed')) {
      console.log('🔄 检测到协议错误，显示用户提示弹窗...');
      await showProtocolErrorDialog();
    }
  });

  // 重连事件
  connectionManager.on('reconnecting', () => {
    console.log('🔄 正在重新连接...');
    if (mainWindow) {
      mainWindow.webContents.send('connection-status', { isConnected: false, reconnecting: true });
    }
  });

  // 状态变化事件
  connectionManager.on('statusChanged', (status) => {
    console.log('📊 连接状态变化:', status);
    if (mainWindow) {
      mainWindow.webContents.send('connection-status', status);
    }
  });

  // 操作成功事件
  connectionManager.on('operationSuccess', (operationName) => {
    console.log(`✅ 操作成功: ${operationName}`);
  });

  // 操作失败事件
  connectionManager.on('operationFailed', async (operationName, error) => {
    console.error(`❌ 操作失败: ${operationName}`, error);
    
    // 检查是否是协议错误，如果是则显示用户弹窗
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('Protocol error') || errorMessage.includes('Connection closed')) {
      console.log('🔄 操作失败检测到协议错误，显示用户提示弹窗...');
      await showProtocolErrorDialog();
    }
  });

  // 达到最大重试次数事件
  connectionManager.on('maxRetriesReached', () => {
    console.warn('⚠️ 已达到最大重试次数');
    if (mainWindow) {
      mainWindow.webContents.send('connection-status', { 
        isConnected: false, 
        maxRetriesReached: true 
      });
    }
  });

  // 重连准备就绪事件
  connectionManager.on('reconnectReady', async () => {
    console.log('🔄 重连准备就绪，重新创建浏览器实例...');
    try {
      // 重新创建浏览器实例
      const newBrowser = await getOrCreateBrowser();
      connectionManager.setBrowser(newBrowser);
      console.log('✅ 浏览器实例重新创建成功');
    } catch (error) {
      console.error('❌ 重新创建浏览器实例失败:', error);
    }
  });

  // 达到最大重连次数事件
  connectionManager.on('maxReconnectAttemptsReached', async () => {
    console.warn('⚠️ 已达到最大重连次数');
    if (mainWindow) {
      mainWindow.webContents.send('connection-status', { 
        isConnected: false, 
        maxReconnectAttemptsReached: true 
      });
    }
    
    // 达到最大重连次数时也显示用户弹窗
    await showProtocolErrorDialog();
  });

  // 网络监控事件
  networkMonitor.on('networkLost', (status) => {
    console.error('🌐 网络连接丢失');
    if (mainWindow) {
      mainWindow.webContents.send('network-status', { 
        isOnline: false, 
        status 
      });
    }
  });

  networkMonitor.on('networkRestored', (status) => {
    console.log('🌐 网络连接已恢复');
    if (mainWindow) {
      mainWindow.webContents.send('network-status', { 
        isOnline: true, 
        status 
      });
    }
  });

  networkMonitor.on('statusChanged', (status) => {
    if (mainWindow) {
      mainWindow.webContents.send('network-status', status);
    }
  });
}

/**
 * 显示协议错误提示弹窗
 */
async function showProtocolErrorDialog(): Promise<void> {
  // 防止重复显示弹窗
  if (protocolErrorDialogShown) {
    console.log('协议错误弹窗已显示，跳过重复显示');
    return;
  }

  if (!mainWindow) {
    console.warn('主窗口不存在，无法显示弹窗');
    return;
  }

  try {
    // 设置弹窗显示标记
    protocolErrorDialogShown = true;
    
    // 清除之前的超时
    if (protocolErrorDialogTimeout) {
      clearTimeout(protocolErrorDialogTimeout);
    }
    
    // 设置5分钟后重置标记，允许再次显示弹窗
    protocolErrorDialogTimeout = setTimeout(() => {
      protocolErrorDialogShown = false;
      protocolErrorDialogTimeout = null;
    }, 5 * 60 * 1000); // 5分钟

    const result = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['关闭客户端', '稍后重试', '取消'],
      defaultId: 0,
      cancelId: 2,
      title: '连接错误',
      message: '检测到浏览器连接协议错误',
      detail: '建议关闭客户端后重新启动以恢复连接。\n\n错误类型：Protocol error: Connection closed\n\n如果问题持续存在，请检查网络连接或联系技术支持。',
      icon: icon
    });

    switch (result.response) {
      case 0: // 关闭客户端
        console.log('用户选择关闭客户端');
        (app as any).isQuiting = true;
        app.quit();
        break;
      case 1: // 稍后重试
        console.log('用户选择稍后重试');
        // 重置弹窗标记，允许用户稍后再次看到弹窗
        protocolErrorDialogShown = false;
        if (protocolErrorDialogTimeout) {
          clearTimeout(protocolErrorDialogTimeout);
          protocolErrorDialogTimeout = null;
        }
        break;
      case 2: // 取消
        console.log('用户取消操作');
        // 重置弹窗标记，允许用户稍后再次看到弹窗
        protocolErrorDialogShown = false;
        if (protocolErrorDialogTimeout) {
          clearTimeout(protocolErrorDialogTimeout);
          protocolErrorDialogTimeout = null;
        }
        break;
    }
  } catch (error) {
    console.error('显示协议错误弹窗失败:', error);
    // 出错时重置标记
    protocolErrorDialogShown = false;
    if (protocolErrorDialogTimeout) {
      clearTimeout(protocolErrorDialogTimeout);
      protocolErrorDialogTimeout = null;
    }
  }
}

const isMac = process.platform === 'darwin'

function shouldForceTrayMode(): boolean {
  return app.isPackaged
}

function createWindow(): void {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    fullscreen: false,
    fullscreenable: !isMac,
    simpleFullscreen: false,
    autoHideMenuBar: !isMac,
    title: '衣设程序',
    ...(process.platform === 'linux' ? { icon } : { icon }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webSecurity: false, // 允许加载外部资源（图片、视频等）
      allowRunningInsecureContent: true, // 允许混合内容（HTTPS页面加载HTTP资源）
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  // 设置连接管理器事件监听
  setupConnectionManagerEvents();

  // 启动网络监控
  networkMonitor.start();

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    if (isMac) {
      mainWindow?.setFullScreen(false)
      mainWindow?.setSimpleFullScreen(false)
      mainWindow?.setFullScreenable(false)
    }
    mainWindow?.maximize()
    // 在开发模式下启用开发者工具（已注释掉，默认不打开）
    // if (is.dev) {
    //   mainWindow?.webContents.openDevTools()
    // }
  })

  // Windows: 处理最小化到托盘
  if (process.platform === 'win32') {
    mainWindow!.on('minimize', () => {
      // 如果启用了托盘模式，最小化时隐藏窗口而不是最小化到任务栏
      if (shouldForceTrayMode()) {
        mainWindow?.hide()
      }
    })
  }

  mainWindow.on('close', async (event) => {
    if ((app as any).isQuiting) {
      return
    }

    if (shouldForceTrayMode()) {
      event.preventDefault()
      mainWindow?.hide()
      return
    }

    event.preventDefault()

    const result = await dialog.showMessageBox(mainWindow!, {
      type: 'question',
      buttons: ['退到托盘', '直接退出', '取消'],
      defaultId: 0,
      cancelId: 2,
      title: '退出确认',
      message: '退出客户端后将无法提供服务',
      detail: '您可以选择退到托盘继续运行，或者直接退出程序。',
      icon: icon
    })
    
    switch (result.response) {
      case 0: // 退到托盘
        mainWindow?.hide()
        break
      case 1: // 直接退出
        (app as any).isQuiting = true
        app.quit()
        break
      case 2: // 取消
        break
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // 配置 session 以允许加载外部图片和视频
  const ses = session.defaultSession
  
  // 设置权限处理，允许加载所有外部资源
  ses.setPermissionRequestHandler((webContents, permission, callback) => {
    // 允许所有权限请求（包括图片、视频等）
    callback(true)
  })

  // 拦截资源请求，添加必要的请求头
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    // 为图片和视频请求添加必要的请求头
    if (details.resourceType === 'image' || details.resourceType === 'media') {
      details.requestHeaders['Referer'] = details.url
      details.requestHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
    callback({ requestHeaders: details.requestHeaders })
  })

  // 监听资源加载失败
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    if (validatedURL && (validatedURL.includes('http://') || validatedURL.includes('https://'))) {
      console.warn('资源加载失败:', {
        url: validatedURL,
        errorCode,
        errorDescription
      })
    }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// 创建系统托盘
function createTray(): void {
  const { nativeImage } = require('electron')
  const path = require('path')
  const fs = require('fs')
  
  // 获取资源文件路径的辅助函数
  function getResourcePath(relativePath: string): string {
    if (is.dev) {
      // 开发环境：从 src/main 目录向上两级到项目根目录
      return path.join(__dirname, '../../', relativePath)
    } else {
      // 生产环境：尝试多个可能的路径
      const appPath = app.getAppPath()
      const resourcesPath = process.resourcesPath
      const dirname = __dirname
      const fileName = path.basename(relativePath)
      
      console.log('🔍 调试托盘图标路径:')
      console.log('  - app.getAppPath():', appPath)
      console.log('  - process.resourcesPath:', resourcesPath)
      console.log('  - __dirname:', dirname)
      console.log('  - 查找文件:', fileName)
      
      const possiblePaths = [
        // 方案1: asar.unpacked 目录（如果配置了 asarUnpack）
        path.join(appPath.replace(/app\.asar$/, 'app.asar.unpacked'), relativePath),
        // 方案2: 从 process.resourcesPath 查找（electron-builder 打包后的 resources 目录）
        path.join(resourcesPath, 'resources', fileName),
        // 方案3: 从 __dirname (out/main) 向上查找 resources
        path.join(dirname, '../resources', fileName),
        // 方案4: 从 __dirname 向上两级查找
        path.join(dirname, '../../resources', fileName),
        // 方案5: 直接使用 process.resourcesPath
        path.join(resourcesPath, fileName),
        // 方案6: 从 appPath 的父目录查找
        path.join(path.dirname(appPath.replace(/app\.asar$/, '')), 'resources', fileName),
        // 方案7: 更多可能的路径
        path.join(dirname, '../../../resources', fileName),
      ]
      
      // 返回第一个存在的路径
      for (const testPath of possiblePaths) {
        try {
          if (fs.existsSync(testPath)) {
            console.log(`✅ 找到托盘图标: ${testPath}`)
            return testPath
          }
        } catch (e) {
          // 忽略路径错误
        }
      }
      
      // 如果都不存在，返回第一个路径（用于错误提示）
      console.error(`❌ 托盘图标文件未找到，尝试过的路径:`)
      possiblePaths.forEach(p => {
        try {
          const exists = fs.existsSync(p)
          console.error(`   ${exists ? '✅' : '❌'} ${p}`)
        } catch {
          console.error(`   ❌ ${p}`)
        }
      })
      return possiblePaths[0]
    }
  }
  
  let trayIconPath: string
  if (process.platform === 'win32') {
    // Windows: 优先使用 .ico 文件，如果不存在则使用 .png
    trayIconPath = getResourcePath('resources/tray-icon.ico')
    if (!fs.existsSync(trayIconPath)) {
      trayIconPath = getResourcePath('resources/tray-icon.png')
    }
  } else {
    // macOS/Linux
    trayIconPath = getResourcePath('resources/tray-icon.png')
  }
  
  // 检查文件是否存在，如果不存在则使用默认图标
  if (!fs.existsSync(trayIconPath)) {
    console.warn(`⚠️ 托盘图标文件不存在: ${trayIconPath}，尝试备用方案`)
    
    // 尝试多个备用路径
    const fallbackPaths = [
      // 尝试使用应用主图标
      icon && typeof icon === 'string' ? icon : null,
      // 尝试从 resources 目录找其他图标
      getResourcePath('resources/icon.png'),
      getResourcePath('resources/favicon.png'),
      // 尝试从 renderer assets
      path.join(__dirname, '../renderer/assets/icon.png'),
      // 在打包后可能的位置
      !is.dev ? path.join(process.resourcesPath, 'icon.png') : null,
      !is.dev ? path.join(app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked'), 'resources/icon.png') : null,
    ].filter(Boolean) as string[]
    
    let found = false
    for (const fallbackPath of fallbackPaths) {
      if (fallbackPath && fs.existsSync(fallbackPath)) {
        console.log(`✅ 使用备用图标: ${fallbackPath}`)
        trayIconPath = fallbackPath
        found = true
        break
      }
    }
    
    if (!found) {
      console.error('❌ 无法找到任何可用的托盘图标文件，托盘可能无法正常显示')
      // 不返回，继续创建托盘，但可能会使用空图标或默认图标
    }
  }
  
  let trayIcon = nativeImage.createFromPath(trayIconPath)
  
  // Windows 和 macOS 都需要调整图标尺寸以确保显示正常
  if (process.platform === 'win32') {
    // Windows 托盘图标推荐尺寸：16x16 或 32x32
    // 如果图标过大或过小，调整到合适的尺寸
    const size = trayIcon.getSize()
    if (size.width > 32 || size.height > 32) {
      trayIcon = trayIcon.resize({ width: 32, height: 32 })
    } else if (size.width < 16 || size.height < 16) {
      trayIcon = trayIcon.resize({ width: 16, height: 16 })
    }
  } else if (process.platform === 'darwin') {
    // macOS 托盘图标尺寸
    trayIcon = trayIcon.resize({ width: 20, height: 20 })
  }
  
  tray = new Tray(trayIcon)
  tray.setToolTip('衣设程序')
  
  // Windows 特定配置：防止双击时触发两次点击事件
  if (process.platform === 'win32') {
    tray.setIgnoreDoubleClickEvents(true)
  }
  
  // 创建托盘菜单
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => {
        if (mainWindow) {
          mainWindow.show()
          mainWindow.focus()
        }
      }
    },
    {
      label: '隐藏主窗口',
      click: () => {
        mainWindow?.hide()
      }
    },
    { type: 'separator' },
    {
      label: '服务器状态',
      submenu: [
        {
          label: '检查本地服务',
          click: async () => {
            try {
              const response = await fetch('http://localhost:1519/api/health')
              if (response.ok) {
                // 可以显示通知或更新托盘菜单
                console.log('本地服务运行正常')
              }
            } catch (error) {
              console.log('本地服务未运行')
            }
          }
        },
        {
          label: '检查远程服务',
          click: async () => {
            try {
              const response = await fetch('https://1s.design:1520/api/test')
              if (response.ok) {
                console.log('远程服务连接正常')
              }
            } catch (error) {
              console.log('远程服务连接失败')
            }
          }
        }
      ]
    },
    { type: 'separator' },
    {
      label: '退出程序',
      click: async () => {
        // 显示退出确认对话框
        const result = await dialog.showMessageBox(mainWindow!, {
          type: 'question',
          buttons: ['确认退出', '取消'],
          defaultId: 1,
          cancelId: 1,
          title: '退出确认',
          message: '确定要退出衣设程序吗？',
          detail: '退出后将无法提供服务。',
          icon: icon
        })
        
        if (result.response === 0) {
          (app as any).isQuiting = true
          app.quit()
        }
      }
    }
  ])
  
  tray.setContextMenu(contextMenu)
  
  // 托盘图标点击事件
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide()
      } else {
        mainWindow.show()
        mainWindow.focus()
      }
    }
  })
  
  // 托盘图标双击事件
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.

// protocol.registerSchemesAsPrivileged([{ 
//   scheme: 'yishe',
//   privileges: { 
//     bypassCSP: true,  
//     standard: true,
//     secure: true,
//     supportFetchAPI: true }
// }]);

app.setAsDefaultProtocolClient('yishe')

// 单实例锁定：确保同一物理机上只能运行一个实例
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  // 如果获取锁失败，说明已经有实例在运行
  console.log('⚠️ 程序已经在运行中，退出当前实例')
  
  // 显示提示对话框（在退出前）
  // 注意：此时还没有窗口，所以使用 dialog.showMessageBoxSync
  dialog.showMessageBoxSync({
    type: 'info',
    buttons: ['确定'],
    defaultId: 0,
    title: '程序已运行',
    message: '程序已经运行',
    detail: '检测到程序已经在运行中，请勿重复启动。\n\n如果无法找到运行中的程序窗口，请检查系统托盘。',
    icon: icon
  })
  
  // 退出当前实例
  app.quit()
  process.exit(0)
} else {
  // 成功获取锁，监听第二个实例的启动
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // 当第二个实例尝试启动时，在第一个实例中触发此事件
    console.log('⚠️ 检测到第二个实例尝试启动，激活第一个实例窗口')
    
    // 如果主窗口存在，显示并聚焦
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore()
      }
      mainWindow.show()
      mainWindow.focus()
      
      // 显示提示对话框，告知用户程序已在运行
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        buttons: ['确定'],
        defaultId: 0,
        title: '程序已运行',
        message: '程序已经运行',
        detail: '检测到程序已经在运行中，请勿重复启动。\n\n如果无法找到运行中的程序窗口，请检查系统托盘。',
        icon: icon
      }).catch((error) => {
        console.error('显示提示对话框失败:', error)
      })
    }
  })
}

app.whenReady().then(() => {
  // 初始化默认工作目录（在创建窗口之前）
  initializeDefaultWorkspaceDirectory()

  // 添加协议注册代码

  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  // 切换开发者工具（供 header 按钮调用）
  ipcMain.handle('toggle-devtools', async (event) => {
    const wc = event?.sender || mainWindow?.webContents
    if (!wc) return { opened: false }
    if (wc.isDevToolsOpened()) {
      wc.closeDevTools()
      return { opened: false }
    }
    wc.openDevTools({ mode: 'right' })
    return { opened: true }
  })

  // 监听 token 保存事件，启动服务
  // 注意：server.ts 中也有 save-token 处理器，但它在服务启动后才注册
  // 这里我们在服务启动前拦截，先启动服务并保存 token
  ipcMain.handle('save-token', async (event, newToken) => {
    // 先保存 token（无论服务是否启动）
    saveToken(newToken);
    
    // 如果服务未启动，启动服务
    if (!isServerRunning()) {
      console.log('🔐 检测到 token 保存，启动 1519 服务...');
      startServer(1519);
    }
    
    return true;
  })

  // token 读取相关 IPC 处理器
  ipcMain.handle('get-token', async () => {
    return getTokenValue();
  });

  ipcMain.handle('is-token-exist', async () => {
    return isTokenExist();
  });

  // 插件/外部进程管理 IPC
  ipcMain.handle('list-external-processes', async () => {
    return pluginProcessConfigs.map((config) => ({
      id: config.id,
      name: config.name,
      executable: config.executable,
      platforms: config.platforms,
      autoRestart: config.autoRestart ?? false,
      status: externalProcessManager.getProcessStatus(config.id) || ProcessStatus.STOPPED
    }));
  });

  ipcMain.handle('start-external-process', async (_event, id: string) => {
    return externalProcessManager.startProcess(id);
  });

  ipcMain.handle('stop-external-process', async (_event, id: string, force = false) => {
    return externalProcessManager.stopProcess(id, force);
  });

  // 本地服务管理 IPC
  ipcMain.handle('start-local-service', async () => {
    try {
      if (!isServerRunning()) {
        console.log('🚀 启动本地服务 (1519端口)...');
        startServer(1519);
        return { success: true, message: '本地服务启动成功' };
      } else {
        return { success: true, message: '本地服务已在运行' };
      }
    } catch (error: any) {
      console.error('❌ 启动本地服务失败:', error);
      return { success: false, message: error?.message || '启动本地服务失败' };
    }
  });

  ipcMain.handle('stop-local-service', async () => {
    try {
      if (isServerRunning()) {
        console.log('🛑 停止本地服务 (1519端口)...');
        await stopServer();
        return { success: true, message: '本地服务已停止' };
      } else {
        return { success: true, message: '本地服务未运行' };
      }
    } catch (error: any) {
      console.error('❌ 停止本地服务失败:', error);
      return { success: false, message: error?.message || '停止本地服务失败' };
    }
  });

  ipcMain.handle('check-local-service-status', async () => {
    try {
      const running = isServerRunning();
      // 尝试访问健康检查接口来确认服务是否真正可用
      let isAvailable = false;
      if (running) {
        try {
          await new Promise<void>((resolve) => {
            const req = http.get('http://localhost:1519/api/health', (res: any) => {
              isAvailable = res.statusCode === 200;
              resolve(null);
            });
            req.on('error', () => {
              isAvailable = false;
              resolve(null);
            });
            req.setTimeout(2000, () => {
              req.destroy();
              isAvailable = false;
              resolve(null);
            });
          });
        } catch {
          isAvailable = false;
        }
      }
      return {
        running,
        available: isAvailable,
        port: 1519
      };
    } catch (error: any) {
      console.error('❌ 检查本地服务状态失败:', error);
      return {
        running: false,
        available: false,
        port: 1519,
        error: error?.message
      };
    }
  });

  // 退出确认IPC处理器
  ipcMain.handle('confirm-exit', async () => {
    if (!mainWindow) return 'cancel'
    
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['退到托盘', '直接退出', '取消'],
      defaultId: 0,
      cancelId: 2,
      title: '退出确认',
      message: '退出客户端后将无法提供服务',
      detail: '您可以选择退到托盘继续运行，或者直接退出程序。',
      icon: icon
    })
    
    switch (result.response) {
      case 0: // 退到托盘
        mainWindow.hide()
        return 'tray'
      case 1: // 直接退出
        (app as any).isQuiting = true
        app.quit()
        return 'quit'
      case 2: // 取消
        return 'cancel'
      default:
        return 'cancel'
    }
  })

  // 启动外部进程（在创建窗口之前）
  externalProcessManager.startAll().catch((error) => {
    console.error('❌ 启动外部进程失败:', error)
  })

  createWindow()
  
  // 创建系统托盘
  createTray()

  // 注意：服务器现在只在用户登录后启动，不再在应用启动时启动

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // 在Windows和Linux上，不要直接退出，而是隐藏窗口
    // app.quit()
  }
})

// 应用退出时清理资源
app.on('before-quit', async () => {
  console.log('🔄 应用即将退出，清理资源...');
  
  // 停止外部进程（优先执行，给进程时间优雅关闭）
  await externalProcessManager.stopAll().catch((error) => {
    console.error('❌ 停止外部进程失败:', error)
    // 如果优雅关闭失败，尝试强制关闭
    externalProcessManager.stopAll(true).catch(console.error)
  })
  
  // 清理协议错误弹窗相关资源
  if (protocolErrorDialogTimeout) {
    clearTimeout(protocolErrorDialogTimeout);
    protocolErrorDialogTimeout = null;
  }
  protocolErrorDialogShown = false;
  
  // 停止网络监控
  await networkMonitor.cleanup();
  
  // 清理连接管理器
  await connectionManager.cleanup();
  
  // 清理托盘
  if (tray) {
    tray.destroy()
  }
  
  console.log('✅ 资源清理完成');
})

// 添加 IPC 监听器
ipcMain.handle('start-publish', async (_, params): Promise<void> => {
  console.log('收到发布请求，参数:', params)
  try {
    // 并行执行发布操作
    await Promise.all([
      // publishToXiaohongshu(),
      // publishToDouyin(),
      // publishToKuaishou()
    ])
  } catch (error) {
    console.error('发布过程出错:', error)
    throw error
  }
})

// 添加托盘相关的IPC监听器
ipcMain.handle('show-tray-notification', async (_, options: { title: string; body: string }) => {
  if (tray) {
    tray.displayBalloon({
      title: options.title,
      content: options.body,
      icon: icon
    })
  }
})

ipcMain.handle('update-tray-tooltip', async (_, tooltip: string) => {
  if (tray) {
    tray.setToolTip(tooltip)
  }
})

ipcMain.handle('hide-main-window', async () => {
  if (mainWindow) {
    mainWindow.hide()
  }
})

ipcMain.handle('show-main-window', async () => {
  if (mainWindow) {
    mainWindow.show()
    mainWindow.focus()
  }
})

// 添加调试工具切换事件处理
ipcMain.on('toggle-devtools', (event) => {
  console.log('toggle')
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win) {
    if (win.webContents.isDevToolsOpened()) {
      win.webContents.closeDevTools()
    } else {
      win.webContents.openDevTools()
    }
  }
})

ipcMain.handle('get-app-version', () => app.getVersion())

// 暂时注释掉发布服务相关功能
// 在主进程暴露社交媒体登录状态检测方法
// ipcMain.handle('check-social-media-login', async (_, forceRefresh: boolean = false) => {
//   try {
//     // 如果强制刷新，先清除缓存
//     if (forceRefresh) {
//       console.log('[IPC] 强制刷新模式，清除缓存');
//       PublishService.clearLoginStatusCache();
//     }
//     
//     // 直接调用PublishService方法，传递forceRefresh参数
//     const result = await PublishService.checkSocialMediaLoginStatus(forceRefresh);
//     return {
//       code: 0,
//       status: true,
//       data: result,
//       timestamp: new Date().toISOString()
//     };
//   } catch (error) {
//     console.error('检查社交媒体登录状态失败:', error);
//     return {
//       code: 1,
//       status: false,
//       msg: '检查失败',
//       error: error instanceof Error ? error.message : '未知错误',
//       timestamp: new Date().toISOString()
//     };
//   }
// });



ipcMain.handle('open-external', async (event, url: string) => {
  await shell.openExternal(url);
});

// 工作目录相关 IPC 处理器
ipcMain.handle('select-workspace-directory', async () => {
  if (!mainWindow) {
    throw new Error('主窗口不存在')
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: '选择工作目录'
  })

  if (result.canceled) {
    return null
  }

  const selectedPath = result.filePaths[0]
  if (selectedPath) {
    // 保存到 electron-store
    store.set('workspaceDirectory', selectedPath)
    return selectedPath
  }

  return null
})

ipcMain.handle('get-workspace-directory', async () => {
  return store.get('workspaceDirectory', '') as string
})

ipcMain.handle('set-workspace-directory', async (event, path: string) => {
  if (path && typeof path === 'string') {
    store.set('workspaceDirectory', path)
    return true
  }
  return false
})

ipcMain.handle('open-path', async (event, path: string) => {
  if (!path || typeof path !== 'string') {
    throw new Error('路径无效')
  }
  
  try {
    await shell.openPath(path)
  } catch (error: any) {
    throw new Error(`打开路径失败: ${error?.message || '未知错误'}`)
  }
})

// 辅助函数：确保文件名有正确的扩展名
function ensureFileExtension(fileName: string, url?: string, contentType?: string): string {
  // 如果文件名已经有扩展名，直接返回
  if (fileName.includes('.')) {
    return fileName
  }

  // 检查 URL 中是否包含 .psd
  if (url && url.toLowerCase().includes('.psd')) {
    return `${fileName}.psd`
  }

  // 检查 Content-Type 是否为 PSD 相关类型
  if (contentType) {
    const lowerContentType = contentType.toLowerCase()
    if (lowerContentType.includes('photoshop') || 
        lowerContentType.includes('image/vnd.adobe.photoshop') ||
        (lowerContentType === 'application/octet-stream' && url && url.toLowerCase().includes('psd'))) {
      return `${fileName}.psd`
    }
  }

  // 如果无法确定，返回原文件名（让系统处理）
  return fileName
}

// 文件下载辅助函数：处理下载响应
function handleDownloadResponse(
  response: http.IncomingMessage,
  filesDir: string,
  resolve: (result: any) => void,
  initialFileName?: string,
  sourceUrl?: string,
  downloadTimeout: number = 120000 // 默认120秒超时
) {
  if (response.statusCode && (response.statusCode < 200 || response.statusCode >= 300)) {
    resolve({
      success: false,
      message: `下载失败: HTTP ${response.statusCode}`,
      error: 'HTTP_ERROR',
      statusCode: response.statusCode
    })
    return
  }

  // 从响应头获取文件名
  let fileName = initialFileName || 'download'
  const contentDisposition = response.headers['content-disposition']
  const contentType = response.headers['content-type']
  
  if (contentDisposition) {
    const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
    if (filenameMatch && filenameMatch[1]) {
      let suggestedFileName = filenameMatch[1].replace(/['"]/g, '')
      try {
        suggestedFileName = decodeURIComponent(suggestedFileName)
      } catch (e) {
        // 忽略解码错误
      }
      if (suggestedFileName) {
        fileName = suggestedFileName.replace(/[<>:"/\\|?*]/g, '_')
      }
    }
  }

  // 确保文件名有正确的扩展名
  fileName = ensureFileExtension(fileName, sourceUrl, contentType)

  const finalFilePath = pathJoin(filesDir, fileName)
  
  // 如果文件已存在，返回跳过
  if (fs.existsSync(finalFilePath)) {
    const stats = fs.statSync(finalFilePath)
    resolve({
      success: true,
      message: '文件已存在，跳过下载',
      filePath: finalFilePath,
      skipped: true,
      fileSize: stats.size
    })
    return
  }

  // 创建写入流
  const fileStream = fs.createWriteStream(finalFilePath)
  let downloadedBytes = 0
  let timeoutTimer: NodeJS.Timeout | null = null

  // 重置超时计时器的函数
  const resetTimeout = () => {
    if (timeoutTimer) {
      clearTimeout(timeoutTimer)
    }
    timeoutTimer = setTimeout(() => {
      fileStream.close()
      if (fs.existsSync(finalFilePath)) {
        fs.unlinkSync(finalFilePath) // 删除不完整的文件
      }
      resolve({
        success: false,
        message: '下载超时（数据传输中断）',
        error: 'TIMEOUT'
      })
    }, downloadTimeout)
  }

  // 初始化超时计时器
  resetTimeout()

  response.pipe(fileStream)

  fileStream.on('finish', () => {
    if (timeoutTimer) {
      clearTimeout(timeoutTimer)
    }
    fileStream.close()
    const stats = fs.statSync(finalFilePath)
    resolve({
      success: true,
      message: '下载完成',
      filePath: finalFilePath,
      fileSize: stats.size,
      downloadedBytes: downloadedBytes
    })
  })

  fileStream.on('error', (error) => {
    if (timeoutTimer) {
      clearTimeout(timeoutTimer)
    }
    if (fs.existsSync(finalFilePath)) {
      fs.unlinkSync(finalFilePath) // 删除不完整的文件
    }
    resolve({
      success: false,
      message: `文件写入失败: ${error.message}`,
      error: 'FILE_WRITE_ERROR'
    })
  })

  // 在数据传输过程中重置超时计时器
  response.on('data', (chunk) => {
    downloadedBytes += chunk.length
    resetTimeout() // 有数据传输时重置超时
  })

  response.on('error', (error) => {
    if (timeoutTimer) {
      clearTimeout(timeoutTimer)
    }
    fileStream.close()
    if (fs.existsSync(finalFilePath)) {
      fs.unlinkSync(finalFilePath) // 删除不完整的文件
    }
    resolve({
      success: false,
      message: `下载失败: ${error.message}`,
      error: 'DOWNLOAD_ERROR'
    })
  })
}

// 文件下载相关 IPC 处理器
/**
 * 从 URL 下载文件到工作目录下的 files 目录
 * @param url 文件下载链接
 * @returns 下载结果 { success: boolean, message: string, filePath?: string, skipped?: boolean }
 */
ipcMain.handle('download-file', async (event, url: string) => {
  try {
    // 检查工作目录是否设置
    const workspaceDir = store.get('workspaceDirectory', '') as string
    if (!workspaceDir || workspaceDir.trim() === '') {
      return {
        success: false,
        message: '请先设置工作目录',
        error: 'WORKSPACE_NOT_SET'
      }
    }

    // 验证 URL
    if (!url || typeof url !== 'string' || url.trim() === '') {
      return {
        success: false,
        message: '无效的下载链接',
        error: 'INVALID_URL'
      }
    }

    let parsedUrl: URL
    try {
      parsedUrl = new URL(url)
    } catch (error) {
      return {
        success: false,
        message: '无效的 URL 格式',
        error: 'INVALID_URL_FORMAT'
      }
    }

    // 创建 files 目录
    const filesDir = pathJoin(workspaceDir, 'files')
    if (!fs.existsSync(filesDir)) {
      fs.mkdirSync(filesDir, { recursive: true })
    }

    // 从 URL 获取文件名
    const urlPath = parsedUrl.pathname
    let fileName = urlPath.split('/').pop() || 'download'
    
    // 如果文件名没有扩展名，尝试从 Content-Disposition 或 URL 中获取
    if (!fileName.includes('.')) {
      // 尝试从 URL 查询参数中获取文件名
      const urlParams = parsedUrl.searchParams
      const suggestedName = urlParams.get('filename') || urlParams.get('name')
      if (suggestedName) {
        fileName = suggestedName
      } else {
        // 默认使用时间戳作为文件名
        fileName = `download_${Date.now()}`
      }
    }

    // 清理文件名（移除非法字符）
    fileName = fileName.replace(/[<>:"/\\|?*]/g, '_')
    
    // 确保文件名有正确的扩展名（如果还没有扩展名，尝试从 URL 判断）
    fileName = ensureFileExtension(fileName, url)

    const filePath = pathJoin(filesDir, fileName)

    // 检查文件是否已存在
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath)
      return {
        success: true,
        message: '文件已存在，跳过下载',
        filePath: filePath,
        skipped: true,
        fileSize: stats.size
      }
    }

    // 使用 fetch API 下载文件（参考 yishe-admin 的实现）
    try {
      const DOWNLOAD_TIMEOUT = 120000 // 下载超时120秒
      
      // 创建 AbortController 用于超时控制
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT)
      
      // 使用 fetch 下载文件，参考 yishe-admin 的实现
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Referer': parsedUrl.origin
        },
        signal: controller.signal
      })
      
      clearTimeout(timeoutId)
      
      // 检查响应状态
      if (!response.ok) {
        return {
          success: false,
          message: `下载失败: HTTP ${response.status} ${response.statusText}`,
          error: 'HTTP_ERROR',
          statusCode: response.status
        }
      }
      
      // 从响应头获取文件名（如果 Content-Disposition 存在）
      const contentDisposition = response.headers.get('content-disposition')
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
        if (filenameMatch && filenameMatch[1]) {
          let suggestedFileName = filenameMatch[1].replace(/['"]/g, '')
          try {
            suggestedFileName = decodeURIComponent(suggestedFileName)
          } catch (e) {
            // 忽略解码错误
          }
          if (suggestedFileName) {
            fileName = suggestedFileName.replace(/[<>:"/\\|?*]/g, '_')
          }
        }
      }
      
      // 确保文件名有正确的扩展名
      fileName = ensureFileExtension(fileName, url, response.headers.get('content-type') || undefined)
      
      const finalFilePath = pathJoin(filesDir, fileName)
      
      // 如果文件已存在，返回跳过
      if (fs.existsSync(finalFilePath)) {
        const stats = fs.statSync(finalFilePath)
        return {
          success: true,
          message: '文件已存在，跳过下载',
          filePath: finalFilePath,
          skipped: true,
          fileSize: stats.size
        }
      }
      
      // 获取响应数据并写入文件
      const arrayBuffer = await response.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      
      // 写入文件
      fs.writeFileSync(finalFilePath, buffer)
      
      const stats = fs.statSync(finalFilePath)
      return {
        success: true,
        message: '下载完成',
        filePath: finalFilePath,
        fileSize: stats.size,
        downloadedBytes: buffer.length
      }
    } catch (error: any) {
      // 处理超时错误
      if (error.name === 'AbortError') {
        return {
          success: false,
          message: '下载超时',
          error: 'TIMEOUT'
        }
      }
      
      // 处理其他错误
      return {
        success: false,
        message: `下载失败: ${error.message || '未知错误'}`,
        error: 'DOWNLOAD_ERROR'
      }
    }
  } catch (error: any) {
    return {
      success: false,
      message: `下载失败: ${error.message || '未知错误'}`,
      error: 'UNKNOWN_ERROR'
    }
  }
})

// 查询文件是否已下载
/**
 * 根据 URL 查询文件是否已下载
 * @param url 文件下载链接
 * @returns 查询结果 { found: boolean, filePath?: string, fileSize?: number, message: string }
 */
ipcMain.handle('check-file-downloaded', async (event, url: string) => {
  try {
    // 检查工作目录是否设置
    const workspaceDir = store.get('workspaceDirectory', '') as string
    if (!workspaceDir || workspaceDir.trim() === '') {
      return {
        found: false,
        message: '工作目录未设置',
        error: 'WORKSPACE_NOT_SET'
      }
    }

    // 验证 URL
    if (!url || typeof url !== 'string' || url.trim() === '') {
      return {
        found: false,
        message: '无效的下载链接',
        error: 'INVALID_URL'
      }
    }

    let parsedUrl: URL
    try {
      parsedUrl = new URL(url)
    } catch (error) {
      return {
        found: false,
        message: '无效的 URL 格式',
        error: 'INVALID_URL_FORMAT'
      }
    }

    const filesDir = pathJoin(workspaceDir, 'files')
    
    // 如果 files 目录不存在，说明没有下载过文件
    if (!fs.existsSync(filesDir)) {
      return {
        found: false,
        message: '文件目录不存在，未找到文件',
        filePath: null
      }
    }

    // 从 URL 提取可能的文件名
    const urlPath = parsedUrl.pathname
    let possibleFileName = urlPath.split('/').pop() || 'download'
    
    // 清理文件名
    possibleFileName = possibleFileName.replace(/[<>:"/\\|?*]/g, '_')

    // 检查可能的文件路径
    const possibleFilePath = pathJoin(filesDir, possibleFileName)
    
    if (fs.existsSync(possibleFilePath)) {
      const stats = fs.statSync(possibleFilePath)
      // 返回绝对路径（跨平台）
      const absolutePath = resolve(filesDir, possibleFileName)
      return {
        found: true,
        filePath: absolutePath,
        fileSize: stats.size,
        message: '文件已找到'
      }
    }

    // 如果直接文件名匹配失败，尝试在 files 目录中搜索
    // 读取目录中的所有文件
    try {
      const files = fs.readdirSync(filesDir)
      
      // 尝试匹配文件名（不区分大小写，支持部分匹配）
      const urlFileName = possibleFileName.toLowerCase()
      for (const file of files) {
        const filePath = pathJoin(filesDir, file)
        const fileStats = fs.statSync(filePath)
        
        // 如果是文件（不是目录）
        if (fileStats.isFile()) {
          const fileName = file.toLowerCase()
          // 精确匹配或部分匹配
          if (fileName === urlFileName || fileName.includes(urlFileName) || urlFileName.includes(fileName)) {
            const absolutePath = resolve(filesDir, file)
            return {
              found: true,
              filePath: absolutePath,
              fileSize: fileStats.size,
              message: '找到匹配的文件'
            }
          }
        }
      }
    } catch (error) {
      // 忽略读取目录错误
    }

    // 如果都找不到，返回未找到
    return {
      found: false,
      message: '未找到对应的文件',
      filePath: null
    }
  } catch (error: any) {
    return {
      found: false,
      message: `查询失败: ${error.message || '未知错误'}`,
      error: 'UNKNOWN_ERROR'
    }
  }
})

/**
 * 检查任意本地路径是否存在（不限制在工作目录）
 */
ipcMain.handle('check-local-file-exists', async (_event, filePath: string) => {
  try {
    if (!filePath || typeof filePath !== 'string' || filePath.trim() === '') {
      return {
        exists: false,
        isFile: false,
        isDirectory: false,
        message: '无效的文件路径'
      }
    }

    const normalized = filePath.trim()
    if (!fs.existsSync(normalized)) {
      return {
        exists: false,
        isFile: false,
        isDirectory: false,
        message: '文件不存在'
      }
    }

    const stats = fs.statSync(normalized)
    return {
      exists: true,
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory(),
      fileSize: stats.isFile() ? stats.size : undefined,
      message: 'OK'
    }
  } catch (error: any) {
    return {
      exists: false,
      isFile: false,
      isDirectory: false,
      message: error?.message || '检查文件时发生错误'
    }
  }
})

// Google Arts & Culture 高清下载 - 支持 Windows 和 macOS
ipcMain.handle('convert-to-png', async (_event, payload: { inputPath: string; pngPath: string; width?: number; height?: number }) => {
  const { inputPath, pngPath, width, height } = payload

  try {
    console.log('开始图片转PNG:', { inputPath, pngPath, width, height })

    // 检查文件是否存在
    if (!fs.existsSync(inputPath)) {
      throw new Error(`文件不存在: ${inputPath}`)
    }

    // 获取文件信息
    const imageInfo = await sharp(inputPath).metadata()
    console.log('图片信息:', {
      width: imageInfo.width,
      height: imageInfo.height,
      format: imageInfo.format
    })

    let result

    if (width && height) {
      // 如果指定了尺寸，则按指定尺寸转换，保持宽高比，使用透明背景
      result = await sharp(inputPath)
        .resize(width, height, {
          fit: 'inside', // 确保图像完全包含在内，保持原始宽高比
          background: { r: 0, g: 0, b: 0, alpha: 0 }, // 透明背景
          withoutEnlargement: true // 如果图片小于目标尺寸，不放大
        })
        .png({
          compressionLevel: 6,
          quality: 100,
          progressive: false
        })
        .toFile(pngPath)
    } else {
      // 如果没有指定尺寸，直接转换为PNG，保持原始尺寸和比例
      result = await sharp(inputPath)
        .png({
          compressionLevel: 6,
          quality: 100,
          progressive: false
        })
        .toFile(pngPath)
    }

    // 方案2：如果上面的方案仍有问题，可以尝试这个更保守的方法
    // 先转换为高分辨率PNG，然后再缩放到目标尺寸
    /*
    const tempBuffer = await sharp(svgPath)
      .png({
        compressionLevel: 6,
        quality: 100,
        progressive: false
      })
      .toBuffer()

    await sharp(tempBuffer)
      .resize(width, height, {
        fit: 'cover',
        position: 'center',
        withoutEnlargement: false
      })
      .png({
        compressionLevel: 6,
        quality: 100,
        progressive: false
      })
      .toFile(pngPath)
    */

    // 检查生成的PNG文件
    const pngInfo = await sharp(pngPath).metadata()
    const fileStats = fs.statSync(pngPath)

    console.log('生成的PNG文件信息:', {
      width: pngInfo.width,
      height: pngInfo.height,
      format: pngInfo.format,
      channels: pngInfo.channels,
      depth: pngInfo.depth,
      density: pngInfo.density,
      hasAlpha: pngInfo.hasAlpha,
      size: fileStats.size,
      created: fileStats.birthtime,
      modified: fileStats.mtime
    })

    // 验证PNG文件是否可以被正常读取
    try {
      const testRead = await sharp(pngPath).toBuffer()
      console.log('PNG文件验证成功，buffer大小:', testRead.length)
    } catch (readError) {
      console.error('PNG文件验证失败:', readError)
    }

    return { success: true, info: pngInfo }
  } catch (error) {
    console.error('SVG转PNG失败:', error)
    const errorMessage = error instanceof Error ? error.message : String(error)
    return { success: false, error: errorMessage }
  }
})

ipcMain.handle('google-art:get-zooms', async (_event, url: string) => {
  const result = await getGoogleArtZooms(url)
  return result
})

ipcMain.handle('google-art:status', async () => {
  return getGoogleArtStatus()
})

ipcMain.handle('google-art:sync', async (_event, payload: { url: string; zoomLevel: number }) => {
  const workspaceDir = store.get('workspaceDirectory', '') as string
  if (!workspaceDir) {
    return { ok: false, msg: '工作目录未设置' }
  }
  const result = await syncGoogleArtToMaterialLibrary({
    url: payload?.url,
    zoomLevel: payload?.zoomLevel,
    workspaceDir
  })
  return result
})

ipcMain.handle('cos:upload-file', async (_event, payload: { filePath: string; key?: string }) => {
  const { filePath, key } = payload || {}
  if (!filePath) {
    return { ok: false, msg: '缺少文件路径' }
  }
  const res = await uploadFileToCos(filePath, key)
  return res
})

ipcMain.handle('cos:generate-key', async (_event, payload: { category: string; filename: string; subDirectory?: string; timestamp?: number }) => {
  const { generateCosKey } = await import('./cos')
  try {
    const key = await generateCosKey({
      category: payload.category,
      filename: payload.filename,
      subDirectory: payload.subDirectory,
      timestamp: payload.timestamp
    })
    return { ok: true, key }
  } catch (error: any) {
    return { ok: false, msg: error?.message || '生成COS Key失败' }
  }
})

// 爬图库上传 - 在 renderer 端执行
ipcMain.handle('crawler-material:download-and-upload', async (event, params: { url: string; name?: string; description?: string; keywords?: string }) => {
  if (!mainWindow) {
    return { ok: false, message: '主窗口未初始化' }
  }
  
  try {
    // 在 renderer 端执行下载和上传
    const result = await mainWindow.webContents.executeJavaScript(`
      (async () => {
        if (window.__crawlerMaterialUploadService) {
          return await window.__crawlerMaterialUploadService(${JSON.stringify(params)});
        } else {
          return { ok: false, message: '上传服务未初始化' };
        }
      })()
    `)
    
    return result
  } catch (error: any) {
    console.error('爬图库上传失败:', error)
    return {
      ok: false,
      message: error?.message || '上传失败'
    }
  }
})

ipcMain.handle('read-file-bytes', async (_event, payload: { filePath: string; start: number; end: number }) => {
  try {
    const { filePath, start, end } = payload
    if (!filePath || start < 0 || end <= start) {
      return null
    }
    if (!fs.existsSync(filePath)) {
      return null
    }
    const fd = fs.openSync(filePath, 'r')
    const bytesToRead = end - start
    const buffer = Buffer.alloc(bytesToRead)
    fs.readSync(fd, buffer, 0, bytesToRead, start)
    fs.closeSync(fd)
    
    // Convert Buffer to ArrayBuffer to transfer over IPC
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  } catch (error: any) {
    console.error('读取文件字节失败:', error)
    return null
  }
})

ipcMain.handle('convert-image-format', async (_event, payload: { sourcePath: string; destPath: string; targetFormat: string }) => {
  try {
    const { sourcePath, destPath, targetFormat } = payload
    
    console.log('[convert-image-format] 开始转换:', { sourcePath, destPath, targetFormat })
    
    if (!sourcePath || !destPath || !targetFormat) {
      console.error('[convert-image-format] 缺少参数')
      return { success: false, error: '缺少必要参数' }
    }
    
    if (!fs.existsSync(sourcePath)) {
      console.error('[convert-image-format] 源文件不存在:', sourcePath)
      return { success: false, error: '源文件不存在' }
    }
    
    // 确保目标目录存在
    const destDir = dirname(destPath)
    if (!fs.existsSync(destDir)) {
      console.log('[convert-image-format] 创建目标目录:', destDir)
      fs.mkdirSync(destDir, { recursive: true })
    }
    
    const absoluteDestPath = resolve(destPath)

    try {
      let sharpInstance = sharp(sourcePath)
      
      if (targetFormat === 'png') {
        sharpInstance = sharpInstance.png({ compressionLevel: 6, progressive: false })
      } else if (targetFormat === 'jpg' || targetFormat === 'jpeg') {
        sharpInstance = sharpInstance.jpeg({ quality: 95, progressive: false })
      }
      
      console.log('[convert-image-format] 尝试使用 sharp 转换...')
      await sharpInstance.toFile(absoluteDestPath)
      console.log('[convert-image-format] sharp 转换成功')
    } catch (saveError: any) {
      console.error('[convert-image-format] sharp 转换失败:', saveError)
      
      // 降级策略：如果转换失败，尝试直接复制文件
      try {
        console.log('[convert-image-format] 尝试降级策略：直接复制文件...')
        fs.copyFileSync(sourcePath, absoluteDestPath)
        console.log('[convert-image-format] 降级复制成功')
      } catch (copyError: any) {
        console.error('[convert-image-format] 降级复制也失败:', copyError)
        throw new Error(`文件保存失败: ${saveError.message}, 且降级复制失败: ${copyError.message}`)
      }
    }
    
    console.log('[convert-image-format] 文件保存完成，开始验证...')
    
    // 验证文件是否真的创建成功
    if (!fs.existsSync(absoluteDestPath)) {
      console.error('[convert-image-format] 转换后文件不存在!')
      return { success: false, error: '转换后文件不存在' }
    }
    
    const destStats = fs.statSync(absoluteDestPath)
    
    return { 
      success: true, 
      filePath: absoluteDestPath, 
      fileSize: destStats.size
    }
    
  } catch (error: any) {
    console.error('[convert-image-format] 转换失败:', error)
    return { success: false, error: error?.message || '格式转换失败' }
  }
})

type ImageLimitPayload = {
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
}

function detectTargetFormat(sourcePath: string, preferred?: 'jpeg' | 'png' | 'webp') {
  if (preferred) return preferred
  const lower = String(sourcePath || '').toLowerCase()
  if (lower.endsWith('.png')) return 'png'
  if (lower.endsWith('.webp')) return 'webp'
  return 'jpeg'
}

function buildDefaultOutputPath(sourcePath: string, format: 'jpeg' | 'png' | 'webp') {
  const ext = format === 'jpeg' ? 'jpg' : format
  const dot = sourcePath.lastIndexOf('.')
  const base = dot > 0 ? sourcePath.slice(0, dot) : sourcePath
  return `${base}.compressed.${ext}`
}

function ensureDirectory(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

function normalizeColor(input?: string) {
  const color = String(input || '').trim()
  return color || '#ffffff'
}

function getWorkspaceDirForImagePayload(payload: ImageLimitPayload) {
  const explicitWorkspaceDir = typeof payload.workspaceDir === 'string' ? payload.workspaceDir.trim() : ''
  if (explicitWorkspaceDir) {
    return explicitWorkspaceDir
  }
  const storedWorkspaceDir = store.get('workspaceDirectory', '') as string
  return typeof storedWorkspaceDir === 'string' ? storedWorkspaceDir.trim() : ''
}

function buildImageProcessSignature(payload: ImageLimitPayload, sourceStats: fs.Stats) {
  const signaturePayload = {
    sourcePath: resolve(payload.sourcePath),
    size: sourceStats.size,
    mtimeMs: Math.floor(sourceStats.mtimeMs),
    maxWidth: payload.maxWidth || null,
    maxHeight: payload.maxHeight || null,
    maxBytes: payload.maxBytes || null,
    format: payload.format || null,
    quality: payload.quality || null,
    minQuality: payload.minQuality || null,
    fit: payload.fit || 'inside',
    position: payload.position || 'centre',
    background: normalizeColor(payload.background),
    cacheKey: payload.cacheKey || null,
  }

  return createHash('sha1')
    .update(JSON.stringify(signaturePayload))
    .digest('hex')
}

function buildCachedOutputPath(payload: ImageLimitPayload, format: 'jpeg' | 'png' | 'webp', sourceStats: fs.Stats) {
  const workspaceDir = getWorkspaceDirForImagePayload(payload)
  if (!workspaceDir) return null

  const cacheFolder = String(payload.cacheFolder || 'publish-assets').trim() || 'publish-assets'
  const cacheDir = resolve(workspaceDir, 'cache', cacheFolder)
  ensureDirectory(cacheDir)

  const ext = format === 'jpeg' ? 'jpg' : format
  const signature = buildImageProcessSignature(payload, sourceStats)
  const sourceBaseName = basename(payload.sourcePath, extname(payload.sourcePath))
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 48) || 'image'

  return resolve(cacheDir, `${sourceBaseName}.${signature}.${ext}`)
}

async function processImageWithLimits(payload: ImageLimitPayload) {
  const {
    sourcePath,
    outputPath,
    maxWidth,
    maxHeight,
    maxBytes,
    format,
  } = payload

  if (!sourcePath || typeof sourcePath !== 'string') {
    return { success: false, error: 'sourcePath 缺失' }
  }
  if (!fs.existsSync(sourcePath)) {
    return { success: false, error: '源文件不存在' }
  }

  const targetFormat = detectTargetFormat(sourcePath, format)
  const sourceStats = fs.statSync(sourcePath)
  const targetPath = outputPath || buildCachedOutputPath(payload, targetFormat, sourceStats) || buildDefaultOutputPath(sourcePath, targetFormat)
  const targetDir = dirname(targetPath)
  ensureDirectory(targetDir)

  if (fs.existsSync(targetPath)) {
    const cachedStats = fs.statSync(targetPath)
    const cachedMeta = await sharp(targetPath).metadata().catch(() => null)
    return {
      success: true,
      filePath: targetPath,
      format: cachedMeta?.format,
      width: cachedMeta?.width,
      height: cachedMeta?.height,
      fileSize: cachedStats.size,
      limitReached: !!maxBytes,
      maxBytes: maxBytes || null,
      underLimit: maxBytes ? cachedStats.size <= maxBytes : true,
      cached: true,
    }
  }

  const initialQuality = Math.max(1, Math.min(100, Number(payload.quality ?? 85)))
  const minQuality = Math.max(1, Math.min(initialQuality, Number(payload.minQuality ?? 45)))
  const fit = payload.fit || 'inside'
  const position = payload.position || 'centre'
  const background = normalizeColor(payload.background)

  let quality = initialQuality
  let scale = 1
  let bestBuffer: Buffer | null = null

  for (let i = 0; i < 12; i++) {
    const targetWidth = maxWidth ? Math.max(1, Math.floor(maxWidth * scale)) : undefined
    const targetHeight = maxHeight ? Math.max(1, Math.floor(maxHeight * scale)) : undefined

    let pipeline = sharp(sourcePath).rotate()

    if (targetWidth || targetHeight) {
      pipeline = pipeline.resize(targetWidth, targetHeight, {
        fit,
        position,
        background,
        withoutEnlargement: fit === 'inside',
      })
    }

    if (targetFormat === 'png') {
      pipeline = pipeline.png({
        compressionLevel: 9,
        palette: true,
        quality: Math.max(quality, 60)
      })
    } else if (targetFormat === 'webp') {
      pipeline = pipeline.webp({ quality })
    } else {
      pipeline = pipeline.jpeg({ quality, mozjpeg: true, progressive: true })
    }

    const buffer = await pipeline.toBuffer()
    bestBuffer = buffer

    if (!maxBytes || buffer.length <= maxBytes) {
      break
    }

    if (quality > minQuality) {
      quality = Math.max(minQuality, quality - 8)
      continue
    }

    if (scale > 0.45) {
      scale = Math.max(0.45, Number((scale - 0.1).toFixed(2)))
      continue
    }

    break
  }

  if (!bestBuffer) {
    return { success: false, error: '压缩失败：未生成输出内容' }
  }

  fs.writeFileSync(targetPath, bestBuffer)
  const outStats = fs.statSync(targetPath)
  const outMeta = await sharp(bestBuffer).metadata()

  return {
    success: true,
    filePath: targetPath,
    format: outMeta.format,
    width: outMeta.width,
    height: outMeta.height,
    fileSize: outStats.size,
    limitReached: !!maxBytes,
    maxBytes: maxBytes || null,
    underLimit: maxBytes ? outStats.size <= maxBytes : true,
    cached: false,
  }
}

ipcMain.handle('process-image-for-preview', async (_event, payload: ImageLimitPayload) => {
  try {
    const result = await processImageWithLimits(payload)
    if (!result?.success || !result.filePath) {
      return result
    }

    const extension = extname(result.filePath).toLowerCase()
    const mimeType = extension === '.png'
      ? 'image/png'
      : extension === '.webp'
        ? 'image/webp'
        : 'image/jpeg'
    const bytes = fs.readFileSync(result.filePath)

    return {
      ...result,
      previewDataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`,
    }
  } catch (error: any) {
    return { success: false, error: error?.message || '生成图片预览失败' }
  }
})

ipcMain.handle('process-image-with-limits', async (_event, payload: ImageLimitPayload) => {
  try {
    return await processImageWithLimits(payload)
  } catch (error: any) {
    return { success: false, error: error?.message || '图片处理失败' }
  }
})

ipcMain.handle('process-images-with-limits', async (_event, payload: { files: ImageLimitPayload[] }) => {
  try {
    const files = Array.isArray(payload?.files) ? payload.files : []
    const results = [] as any[]
    for (const item of files) {
      results.push(await processImageWithLimits(item))
    }
    return {
      success: true,
      total: files.length,
      successCount: results.filter(r => r?.success).length,
      results,
    }
  } catch (error: any) {
    return { success: false, error: error?.message || '批量图片处理失败' }
  }
})

ipcMain.handle('copy-file', async (_event, payload: { sourcePath: string; destPath: string }) => {
  try {
    const { sourcePath, destPath } = payload
    if (!sourcePath || !destPath) return { success: false, error: '参数缺失' }
    
    const destDir = dirname(destPath)
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true })
    }
    
    fs.copyFileSync(sourcePath, destPath)
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})
