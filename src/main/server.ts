/*
 * @Author: chan-max jackieontheway666@gmail.com
 * @Date: 2025-06-09 18:31:32
 * @LastEditors: chan-max jackieontheway666@gmail.com
 * @LastEditTime: 2025-07-28 06:42:02
 * @FilePath: /yishe-electron/src/main/server.ts
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
import express, { type Request, type Response } from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { specs } from './swagger';  // 新增cors导入
import { BrowserWindow } from 'electron';
import { Server as SocketIOServer } from 'socket.io';
import { createServer } from 'http';
import fs from 'fs';
import path from 'path';
import ElectronStore from 'electron-store';
import { uploadFileToCos, generateCosKey, getCurrentUserIdentity } from './cos';
import { crawlerCollectorService } from './crawlerCollector';

// 为了兼容部分证书配置不规范的站点，在 Node/Electron 端放宽 HTTPS 校验，
// 行为与之前 axios + https.Agent({ rejectUnauthorized: false }) 保持一致，
// 避免因为证书问题导致图片在 Electron 端无法拉取。
if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === undefined) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

// 用内存变量存储 token
let token: string | null = null;

// 导出保存 token 的函数和读取函数，供主进程使用
export function saveToken(newToken: string): void {
  token = newToken;
}

export function getTokenValue(): string | null {
  return token;
}

export function isTokenExist(): boolean {
  return !!token;
}

let stopServerFn: (() => Promise<void>) | null = null;
let ioServer: SocketIOServer | null = null;
type ExtensionClientInfoSnapshot = {
  appVersion?: string;
  workspaceDirectory?: string;
  user?: {
    id?: string | number | null;
    account?: string | null;
    name?: string | null;
    nickname?: string | null;
    email?: string | null;
  };
  machine?: {
    code?: string | null;
    platform?: string | null;
    createdAt?: string | null;
  };
};

type ExtensionConnectionInfo = {
  socketId: string;
  connectedAt: string;
  clientSource?: string;
  lastClientInfoAt?: string;
  clientInfo?: ExtensionClientInfoSnapshot;
};

let extensionConnections = new Map<string, ExtensionConnectionInfo>();

function normalizeExtensionClientInfo(data: any): ExtensionClientInfoSnapshot {
  const workspaceDirectory = String(data?.workspaceDirectory || '').trim();
  const appVersion = String(data?.appVersion || '').trim();
  const user =
    data?.user && typeof data.user === 'object'
      ? {
          id: data.user.id ?? null,
          account: data.user.account ? String(data.user.account).trim() : null,
          name: data.user.name ? String(data.user.name).trim() : null,
          nickname: data.user.nickname ? String(data.user.nickname).trim() : null,
          email: data.user.email ? String(data.user.email).trim() : null,
        }
      : undefined;
  const machine =
    data?.machine && typeof data.machine === 'object'
      ? {
          code: data.machine.code ? String(data.machine.code).trim() : null,
          platform: data.machine.platform ? String(data.machine.platform).trim() : null,
          createdAt: data.machine.createdAt ? String(data.machine.createdAt).trim() : null,
        }
      : undefined;

  return {
    appVersion: appVersion || undefined,
    workspaceDirectory: workspaceDirectory || undefined,
    user,
    machine,
  };
}

export function startServer(port: number = 1519): (() => Promise<void>) {
  // 如果服务器已经在运行，先停止它
  if (stopServerFn) {
    console.log('⚠️ 服务器已在运行，先停止旧实例');
    return stopServerFn().then(() => {
      console.log('✅ 旧服务器实例已停止');
      const stopFn = _startServer(port);
      stopServerFn = stopFn;
      return stopFn;
    }) as any;
  }

  const stopFn = _startServer(port);
  stopServerFn = stopFn;
  return stopFn;
}

export function stopServer(): Promise<void> {
  if (stopServerFn) {
    const fn = stopServerFn;
    stopServerFn = null;
    return fn();
  }
  return Promise.resolve();
}

export function isServerRunning(): boolean {
  return stopServerFn !== null;
}

export function getExtensionConnections() {
  return Array.from(extensionConnections.entries()).map(([clientId, info]) => ({
    clientId,
    ...info
  }));
}

function _startServer(port: number = 1519): (() => Promise<void>) {
  const app = express();
  
  console.log('🚀 启动 Express 服务器...');
  console.log(`📡 服务端口: ${port}`);
  console.log(`📚 API 文档: http://localhost:${port}/api-docs`);
  console.log(`🏥 健康检查: http://localhost:${port}/api/health`);
  console.log('─'.repeat(50));
  
  // 配置 CORS 选项
  const corsOptions = {
    origin: '*', // 允许所有来源访问
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], // 允许的 HTTP 方法
    allowedHeaders: ['Content-Type', 'Authorization'], // 允许的请求头
    credentials: true, // 允许发送凭证
    maxAge: 86400 // 预检请求的缓存时间（秒）
  };
  
  // 基础中间件
  app.use(cors(corsOptions));  // 使用配置好的 CORS 选项
  // 增加文件上传大小限制（50MB）
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // 设置路由
  app.get('/', (_req, res) => {
    res.send('Yishe Client Server Running');
  });

  // Swagger API 文档路由
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: '衣设 Electron API 文档'
  }));

  /**
   * @swagger
   * /api/health:
   *   get:
   *     summary: 健康检查接口
   *     description: 检查服务器运行状态和授权状态
   *     tags: [系统监控]
   *     responses:
   *       200:
   *         description: 服务器运行正常
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/HealthResponse'
   *       500:
   *         description: 服务器错误
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  app.get('/api/health', (_req, res) => {
    res.status(200).json({
      status: 'OK',
      timestamp: new Date().toISOString(),
      service: 'electron-server',
      version: '1.0.0',
      isAuthorized: !!token,
      mode: 'client-bridge'
    });
  });

  app.get('/api/auth/session', async (_req, res) => {
    try {
      const authorized = !!token;
      const identity = authorized
        ? await getCurrentUserIdentity().catch(() => ({ userId: '', account: '' }))
        : { userId: '', account: '' };

      const user =
        authorized && (identity.userId || identity.account)
          ? {
              id: identity.userId || null,
              userId: identity.userId || null,
              account: identity.account || null,
            }
          : null;

      res.status(200).json({
        success: true,
        authorized,
        user,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        authorized: false,
        message: error?.message || '获取本地会话失败',
      });
    }
  });


  /**
   * @swagger
   * /api/saveToken:
   *   post:
   *     summary: 保存 Token
   *     description: 保存用户认证 Token
   *     tags: [认证管理]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - token
   *             properties:
   *               token:
   *                 type: string
   *                 description: 用户认证 Token
   *                 example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
   *     responses:
   *       200:
   *         description: Token 保存成功
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *       400:
   *         description: Token 为空
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: false
   *                 message:
   *                   type: string
   *                   example: 'token 不能为空'
   */
  app.post('/api/saveToken', (req, res) => {
    const { token: newToken } = req.body;
    if (!newToken) {
      res.status(400).json({ success: false, message: 'token 不能为空' });
      return;
    }
    token = newToken;
    res.json({ success: true });
  });

  /**
   * @swagger
   * /api/logoutToken:
   *   post:
   *     summary: 退出授权
   *     description: 清除当前保存的 Token
   *     tags: [认证管理]
   *     responses:
   *       200:
   *         description: 退出成功
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   */
  app.post('/api/logoutToken', async (_req, res) => {
    token = null;
    // 登出时停止服务
    if (stopServerFn) {
      console.log('🔐 检测到 token 清除，停止 1519 服务...');
      await stopServer();
    }
    res.json({ success: true });
  });


  // 创建 HTTP 服务器并附加 Express 应用
  const httpServer = createServer(app);
  
  // 创建 Socket.IO 服务器
  ioServer = new SocketIOServer(httpServer, {
    path: '/ws',
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    },
    transports: ['websocket', 'polling']
  });

  // Socket.IO 连接管理
  ioServer.on('connection', (socket) => {
    const clientId = socket.handshake.query.clientId as string || socket.id;
    const clientSource = socket.handshake.query.clientSource as string || 'unknown';
    
    console.log(`[WS] 插件连接: ${clientId} (${clientSource})`);
    
    extensionConnections.set(clientId, {
      socketId: socket.id,
      connectedAt: new Date().toISOString(),
      clientSource,
    });

    // 通知主窗口插件连接状态
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow) {
      mainWindow.webContents.send('extension-connection-status', {
        connected: true,
        clientId,
        clientSource,
        connectedAt: extensionConnections.get(clientId)?.connectedAt,
        totalConnections: extensionConnections.size
      });
    }

    // 处理 ping
    socket.on('ping', () => {
      socket.emit('pong', {
        timestamp: new Date().toISOString(),
        message: 'pong'
      });
    });

    // 处理客户端信息
    socket.on('client-info', (data) => {
      console.log(`[WS] 收到客户端信息: ${clientId}`, data);
      const previous = extensionConnections.get(clientId);
      const nextInfo: ExtensionConnectionInfo = {
        socketId: socket.id,
        connectedAt: previous?.connectedAt || new Date().toISOString(),
        clientSource,
        lastClientInfoAt: new Date().toISOString(),
        clientInfo: normalizeExtensionClientInfo(data),
      };
      extensionConnections.set(clientId, nextInfo);

      const mainWindow = BrowserWindow.getAllWindows()[0];
      if (mainWindow) {
        mainWindow.webContents.send('extension-connection-status', {
          connected: true,
          clientId,
          clientSource,
          connectedAt: nextInfo.connectedAt,
          lastClientInfoAt: nextInfo.lastClientInfoAt,
          workspaceDirectory: nextInfo.clientInfo?.workspaceDirectory || '',
          user: nextInfo.clientInfo?.user || null,
          machine: nextInfo.clientInfo?.machine || null,
          totalConnections: extensionConnections.size
        });
      }
    });

    // 处理断开连接
    socket.on('disconnect', (reason) => {
      console.log(`[WS] 插件断开: ${clientId}, 原因: ${reason}`);
      extensionConnections.delete(clientId);
      
      // 通知主窗口插件断开
      const mainWindow = BrowserWindow.getAllWindows()[0];
      if (mainWindow) {
        mainWindow.webContents.send('extension-connection-status', {
          connected: false,
          clientId,
          disconnectedAt: new Date().toISOString(),
          reason,
          totalConnections: extensionConnections.size
        });
      }
    });

    // 处理错误
    socket.on('error', (error) => {
      console.error(`[WS] Socket 错误: ${clientId}`, error);
    });
  });

  // 启动 HTTP 服务器（绑定到 0.0.0.0 以允许所有网络接口访问）
  httpServer.listen(port, '0.0.0.0', () => {
    console.log('✅ Express 服务器启动成功！');
    console.log('✅ Socket.IO 服务器启动成功！');
    console.log(`📡 WebSocket 端点: ws://localhost:${port}/ws`);
    console.log('─'.repeat(50));
    console.log('📋 可用接口:');
    console.log('🔧 系统监控:');
    console.log(`   GET  /api/health                    - 健康检查`);
    console.log('🔐 认证管理:');
    console.log(`   POST /api/saveToken                 - 保存 Token`);
    console.log(`   POST /api/logoutToken               - 退出授权`);
    console.log('📦 商品管理:');
    console.log('🖼️  爬图库:');
    console.log(`   POST /api/material-upload                      - 上传图片到素材库/爬图素材`);
    console.log(`   POST /api/crawler-material-upload              - 兼容旧上传接口`);
    console.log('📋 任务队列:');
    console.log(`   GET  /api/queue/tasks                          - 根据任务类型查询任务列表`);
    console.log(`   POST /api/queue/task/status                    - 更新任务状态`);
    console.log('📚 API 文档:');
    console.log(`   GET  /api-docs                      - Swagger API 文档`);
    console.log('─'.repeat(50));
  }).on('error', (err) => {
    console.error('❌ HTTP 服务器启动失败:', err);
  });

  // 添加获取插件连接状态的 API
  app.get('/api/extension/connections', (_req, res) => {
    const connections = Array.from(extensionConnections.entries()).map(([clientId, info]) => ({
      clientId,
      ...info,
      workspaceDirectory: info.clientInfo?.workspaceDirectory || '',
      user: info.clientInfo?.user || null,
      machine: info.clientInfo?.machine || null,
      appVersion: info.clientInfo?.appVersion || '',
    }));
    res.json({
      total: extensionConnections.size,
      connections
    });
  });

  /**
   * @swagger
   * /api/crawler/schedule/start:
   *   post:
   *     summary: 启动爬虫定时采集
   *     description: 启动自动爬取 Sora/Pinterest 图片并上传到素材库的定时任务
   *     tags: [爬虫采集]
   *     requestBody:
   *       required: false
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               site:
   *                 type: string
   *                 enum: [sora, pinterest]
   *                 description: 爬虫站点
   *                 example: sora
   *               maxImages:
   *                 type: number
   *                 description: 每次最大图片数量
   *                 example: 20
   *               interval:
   *                 type: number
   *                 description: 定时间隔（毫秒）
   *                 example: 3600000
   *               category:
   *                 type: string
   *                 description: 素材分类
   *                 example: crawler
   *               isPublic:
   *                 type: boolean
   *                 description: 是否公开
   *                 example: false
   *     responses:
   *       200:
   *         description: 启动成功
   *       500:
   *         description: 启动失败
   */
  app.post('/api/crawler/schedule/start', async (req, res) => {
    try {
      const { site, ...config } = req.body || {};
      if (!site) {
        res.status(400).json({ success: false, message: 'site 不能为空' });
        return;
      }
      const result = await crawlerCollectorService.startSchedule(site, config);
      res.json(result);
    } catch (error: any) {
      console.error('启动爬虫定时器失败:', error);
      res.status(500).json({
        success: false,
        message: error?.message || '启动失败',
      });
    }
  });

  /**
   * @swagger
   * /api/crawler/schedule/stop:
   *   post:
   *     summary: 停止爬虫定时采集
   *     description: 停止正在运行的爬虫定时任务
   *     tags: [爬虫采集]
   *     responses:
   *       200:
   *         description: 停止成功
   */
  app.post('/api/crawler/schedule/stop', async (req, res) => {
    try {
      const { site } = req.body || {};
      if (!site) {
        res.status(400).json({ success: false, message: 'site 不能为空' });
        return;
      }
      const result = crawlerCollectorService.stopSchedule(site);
      res.json(result);
    } catch (error: any) {
      console.error('停止爬虫定时器失败:', error);
      res.status(500).json({
        success: false,
        message: error?.message || '停止失败',
      });
    }
  });

  /**
   * @swagger
   * /api/crawler/schedule/status:
   *   get:
   *     summary: 获取爬虫定时器状态
   *     description: 查询爬虫定时采集任务的运行状态和配置
   *     tags: [爬虫采集]
   *     responses:
   *       200:
   *         description: 状态查询成功
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 enabled:
   *                   type: boolean
   *                   description: 是否启用
   *                 isRunning:
   *                   type: boolean
   *                   description: 是否正在运行
   *                 config:
   *                   type: object
   *                   description: 当前配置
   */
  app.get('/api/crawler/schedule/status', (req, res) => {
    try {
      const { site } = req.query as { site?: string };
      const status = crawlerCollectorService.getStatus(site as any);
      res.json(status);
    } catch (error: any) {
      console.error('查询爬虫状态失败:', error);
      res.status(500).json({
        success: false,
        message: error?.message || '查询失败',
      });
    }
  });

  /**
   * @swagger
   * /api/crawler/progress:
   *   get:
   *     summary: 获取爬虫详细进度
   *     description: 查询每个站点采集过程的详细进度与错误日志
   *     tags: [爬虫采集]
   *     parameters:
   *       - in: query
   *         name: site
   *         schema:
   *           type: string
   *           enum: [sora, pinterest]
   *         required: false
   *         description: 可选，指定站点
   *     responses:
   *       200:
   *         description: 进度查询成功
   */
  app.get('/api/crawler/progress', (req, res) => {
    try {
      const { site } = req.query as { site?: string };
      const progress = crawlerCollectorService.getProgress(site as any);
      res.json(progress);
    } catch (error: any) {
      console.error('查询爬虫进度失败:', error);
      res.status(500).json({
        success: false,
        message: error?.message || '查询失败',
      });
    }
  });

  /**
   * @swagger
   * /api/crawler/schedule/config:
   *   put:
   *     summary: 更新爬虫配置
   *     description: 更新爬虫定时采集的配置（不会自动启动，需要手动调用 start 接口）
   *     tags: [爬虫采集]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               site:
   *                 type: string
   *                 enum: [sora, pinterest]
   *               maxImages:
   *                 type: number
   *               interval:
   *                 type: number
   *               category:
   *                 type: string
   *               isPublic:
   *                 type: boolean
   *     responses:
   *       200:
   *         description: 更新成功
   */
  app.put('/api/crawler/schedule/config', (req, res) => {
    try {
      const { site, ...config } = req.body || {};
      if (!site) {
        res.status(400).json({ success: false, message: 'site 不能为空' });
        return;
      }
      crawlerCollectorService.updateConfig(site, config);
      const status = crawlerCollectorService.getStatus(site);
      res.json({
        success: true,
        message: '配置已更新',
        config: (status as any).config,
      });
    } catch (error: any) {
      console.error('更新爬虫配置失败:', error);
      res.status(500).json({
        success: false,
        message: error?.message || '更新失败',
      });
    }
  });

  /**
   * @swagger
   * /api/crawler/manual-collect:
   *   post:
   *     summary: 手动触发一次爬虫采集
   *     description: 立即执行一次图片爬取和上传任务（不影响定时器）
   *     tags: [爬虫采集]
   *     requestBody:
   *       required: false
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               site:
   *                 type: string
   *                 enum: [sora, pinterest]
   *                 description: 爬虫站点
   *                 example: sora
   *               maxImages:
   *                 type: number
   *                 description: 最大图片数量
   *                 example: 20
   *     responses:
   *       200:
   *         description: 采集成功
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 message:
   *                   type: string
   *                 collected:
   *                   type: number
   *                   description: 成功采集数量
   *                 failed:
   *                   type: number
   *                   description: 失败数量
   *                 results:
   *                   type: array
   *                   description: 详细结果
   *       500:
   *         description: 采集失败
   */
  app.post('/api/crawler/manual-collect', async (req, res) => {
    try {
      const { site, maxImages } = req.body || {};
      if (!site) {
        res.status(400).json({ success: false, message: 'site 不能为空' });
        return;
      }
      const result = await crawlerCollectorService.manualCollect(site, maxImages);
      res.json(result);
    } catch (error: any) {
      console.error('手动采集失败:', error);
      res.status(500).json({
        success: false,
        message: error?.message || '采集失败',
        collected: 0,
        failed: 0,
        results: [],
      });
    }
  });

  /**
   * @swagger
   * /api/queue/tasks:
   *   get:
   *     summary: 根据任务类型查询任务列表
   *     description: 代理到后端服务，根据任务类型查询任务列表
   *     tags: [任务队列]
   *     parameters:
   *       - in: query
   *         name: type
   *         required: true
   *         schema:
   *           type: string
   *         description: 任务类型
   *       - in: query
   *         name: status
   *         required: false
   *         schema:
   *           type: string
   *           enum: [pending, processing, completed, failed]
   *         description: 任务状态（可选）
   *       - in: query
   *         name: limit
   *         required: false
   *         schema:
   *           type: number
   *         description: 限制数量（可选，默认50）
   *       - in: query
   *         name: offset
   *         required: false
   *         schema:
   *           type: number
   *         description: 偏移量（可选，默认0）
   *     responses:
   *       200:
   *         description: 成功获取任务列表
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 list:
   *                   type: array
   *                   items:
   *                     type: object
   *                 total:
   *                   type: number
   *                   example: 10
   *       400:
   *         description: 请求参数错误
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       401:
   *         description: 未授权，需要Token
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       500:
   *         description: 服务器错误
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  app.get('/api/queue/tasks', async (req, res) => {
    try {
      const { type, status, limit, offset } = req.query;

      if (!type || typeof type !== 'string' || !type.trim()) {
        res.status(400).json({
          code: 1,
          status: false,
          message: '任务类型不能为空'
        });
        return;
      }

      // 检查token
      if (!token) {
        res.status(401).json({
          code: 1,
          status: false,
          message: '未授权，请先登录'
        });
        return;
      }

      // 获取远程API地址
      const isDev = process.env.NODE_ENV === 'development';
      const REMOTE_API_BASE = isDev 
        ? 'http://localhost:1520/api' 
        : 'https://1s.design:1520/api';

      // 构建查询参数
      const queryParams = new URLSearchParams();
      queryParams.append('type', type.trim());
      if (status && typeof status === 'string') {
        queryParams.append('status', status);
      }
      if (limit && !isNaN(Number(limit))) {
        queryParams.append('limit', String(limit));
      }
      if (offset && !isNaN(Number(offset))) {
        queryParams.append('offset', String(offset));
      }

      // 调用远程API
      const response = await fetch(`${REMOTE_API_BASE}/queue/messages?${queryParams.toString()}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`查询任务列表失败: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      res.status(200).json(data);
    } catch (error: any) {
      console.error('查询任务列表失败:', error);
      res.status(500).json({
        code: 1,
        status: false,
        message: error?.message || '查询任务列表失败',
        error: error instanceof Error ? error.message : '未知错误'
      });
    }
  });

  /**
   * @swagger
   * /api/queue/task/status:
   *   post:
   *     summary: 更新任务状态
   *     description: 代理到后端服务，更新任务状态
   *     tags: [任务队列]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - type
   *               - messageId
   *               - status
   *             properties:
   *               type:
   *                 type: string
   *                 description: 任务类型
   *               messageId:
   *                 type: string
   *                 description: 任务ID
   *               status:
   *                 type: string
   *                 enum: [pending, processing, completed, failed]
   *                 description: 新状态
   *     responses:
   *       200:
   *         description: 状态更新成功
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 message:
   *                   type: string
   *                   example: '状态已更新'
   *       400:
   *         description: 请求参数错误
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       401:
   *         description: 未授权，需要Token
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       500:
   *         description: 服务器错误
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  app.post('/api/queue/task/status', async (req, res) => {
    try {
      const { type, messageId, status } = req.body;

      if (!type || typeof type !== 'string' || !type.trim()) {
        res.status(400).json({
          code: 1,
          status: false,
          message: '任务类型不能为空'
        });
        return;
      }

      if (!messageId || typeof messageId !== 'string' || !messageId.trim()) {
        res.status(400).json({
          code: 1,
          status: false,
          message: '任务ID不能为空'
        });
        return;
      }

      if (!status || !['pending', 'processing', 'completed', 'failed'].includes(status)) {
        res.status(400).json({
          code: 1,
          status: false,
          message: '状态值无效，必须是 pending、processing、completed 或 failed 之一'
        });
        return;
      }

      // 检查token
      if (!token) {
        res.status(401).json({
          code: 1,
          status: false,
          message: '未授权，请先登录'
        });
        return;
      }

      // 获取远程API地址
      const isDev = process.env.NODE_ENV === 'development';
      const REMOTE_API_BASE = isDev 
        ? 'http://localhost:1520/api' 
        : 'https://1s.design:1520/api';

      // 调用远程API
      const response = await fetch(`${REMOTE_API_BASE}/queue/message/status`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          type: type.trim(),
          messageId: messageId.trim(),
          status
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`更新任务状态失败: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      res.status(200).json(data);
    } catch (error: any) {
      console.error('更新任务状态失败:', error);
      res.status(500).json({
        code: 1,
        status: false,
        message: error?.message || '更新任务状态失败',
        error: error instanceof Error ? error.message : '未知错误'
      });
    }
  });

  /**
   * @swagger
   * /api/upload-to-cos:
   *   post:
   *     summary: 上传文件到COS（内部接口）
   *     description: 接收base64编码的文件数据，保存临时文件后上传到COS
   *     tags: [内部接口]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - fileData
   *               - fileName
   *             properties:
   *               fileData:
   *                 type: string
   *                 description: base64编码的文件数据
   *               fileName:
   *                 type: string
   *                 description: 文件名
   *     responses:
   *       200:
   *         description: 上传成功
   *       400:
   *         description: 参数错误
   *       500:
   *         description: 服务器错误
   */
  app.post('/api/upload-to-cos', async (req, res) => {
    try {
      const { fileData, fileName } = req.body;

      if (!fileData || typeof fileData !== 'string') {
        res.status(400).json({
          success: false,
          message: 'fileData 参数必填'
        });
        return;
      }

      if (!fileName || typeof fileName !== 'string') {
        res.status(400).json({
          success: false,
          message: 'fileName 参数必填'
        });
        return;
      }

      // 获取工作目录
      const Store = (ElectronStore as any).default || ElectronStore;
      const store = new Store({
        defaults: {
          workspaceDirectory: ''
        }
      });
      const workspaceDir = store.get('workspaceDirectory', '') as string;

      if (!workspaceDir || workspaceDir.trim() === '') {
        res.status(500).json({
          success: false,
          message: '工作目录未设置，无法保存文件'
        });
        return;
      }

      // 解析base64数据
      let base64Data = fileData;
      if (fileData.includes(',')) {
        base64Data = fileData.split(',')[1];
      }

      // 保存到临时文件
      const tempDir = path.join(workspaceDir, 'temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const tempFilePath = path.join(tempDir, fileName);
      const buffer = Buffer.from(base64Data, 'base64');
      fs.writeFileSync(tempFilePath, buffer);

      // 上传到COS（使用新的分类路径）
      const cosKey = await generateCosKey({
        category: 'client-api-crawler',
        filename: fileName
      });
      const cosResult = await uploadFileToCos(tempFilePath, cosKey);

      // 清理临时文件
      if (fs.existsSync(tempFilePath)) {
        try {
          fs.unlinkSync(tempFilePath);
        } catch (e) {
          console.error('清理临时文件失败:', e);
        }
      }

      if (!cosResult.ok) {
        const errMsg = 'msg' in cosResult ? cosResult.msg : 'COS 上传失败';
        res.status(500).json({
          success: false,
          message: errMsg
        });
        return;
      }

      res.status(200).json({
        success: true,
        url: (cosResult as any).url,
        key: (cosResult as any).key || cosKey
      });
    } catch (error: any) {
      console.error('上传到COS失败:', error);
      res.status(500).json({
        success: false,
        message: error?.message || '上传失败'
      });
    }
  });

  type MaterialUploadTarget = 'sticker' | 'crawler-material';

  const normalizeMaterialUploadTarget = (
    value: unknown,
    fallback: MaterialUploadTarget = 'sticker',
  ): MaterialUploadTarget => {
    return value === 'crawler-material' ? 'crawler-material' : fallback;
  };

  const handleMaterialUpload = async (
    req: Request,
    res: Response,
    fallbackTarget: MaterialUploadTarget = 'sticker',
  ) => {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const target = normalizeMaterialUploadTarget(req.body?.target, fallbackTarget);

    console.log(`[material-upload:${requestId}] ========== 开始处理请求 ==========`);
    console.log(
      `[material-upload:${requestId}] 请求体:`,
      JSON.stringify({ ...req.body, target }, null, 2),
    );

    try {
      const { url, name, description, keywords } = req.body || {};

      if (!url || typeof url !== 'string') {
        console.error(`[material-upload:${requestId}] 参数验证失败: url 参数必填`);
        res.status(400).json({
          code: 1,
          status: false,
          message: 'url 参数必填',
        });
        return;
      }

      console.log(
        `[material-upload:${requestId}] ========== 通过 IPC 调用 renderer 端 ==========`,
      );

      try {
        const mainWindow = BrowserWindow.getAllWindows()[0];
        if (!mainWindow) {
          throw new Error('主窗口未找到');
        }

        const payload = { url, name, description, keywords, target };
        const result = await mainWindow.webContents.executeJavaScript(`
          (async () => {
            const uploadService =
              window.__materialUploadService || window.__crawlerMaterialUploadService;
            if (uploadService) {
              return await uploadService(${JSON.stringify(payload)});
            }
            return { ok: false, message: '上传服务未初始化' };
          })()
        `);

        if (result.ok) {
          console.log(`[material-upload:${requestId}] ========== ✅ 全部流程完成 ==========`);
          console.log(`[material-upload:${requestId}] 上传目标: ${target}`);
          console.log(`[material-upload:${requestId}] COS URL: ${result.data?.cosUrl}`);
          console.log(
            `[material-upload:${requestId}] 素材数据:`,
            JSON.stringify(result.data?.material, null, 2),
          );

          res.status(200).json({
            code: 0,
            status: true,
            message: result.message || '上传成功',
            data: result.data,
          });
          return;
        }

        console.error(`[material-upload:${requestId}] ❌ 上传失败: ${result.message}`);
        res.status(500).json({
          code: 1,
          status: false,
          message: result.message || '上传失败',
        });
      } catch (ipcError: any) {
        console.error(`[material-upload:${requestId}] ❌ IPC调用失败:`, ipcError);
        res.status(500).json({
          code: 1,
          status: false,
          message: `IPC调用失败: ${ipcError?.message || '未知错误'}`,
        });
      }
    } catch (error: any) {
      console.error(`[material-upload:${requestId}] ❌ 未捕获的异常:`, {
        name: error.name,
        message: error.message,
        stack: error.stack,
      });
      res.status(500).json({
        code: 1,
        status: false,
        message: error?.message || '上传失败',
      });
    }
  };

  /**
   * @swagger
   * /api/material-upload:
   *   post:
   *     summary: 上传图片到指定素材库
   *     description: 接收图片URL，在 renderer 端下载图片，上传到 COS 后按 target 落到图片素材或爬图素材
   *     tags: [素材上传]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - url
   *             properties:
   *               url:
   *                 type: string
   *               name:
   *                 type: string
   *               description:
   *                 type: string
   *               keywords:
   *                 type: string
   *               target:
   *                 type: string
   *                 enum: [sticker, crawler-material]
   *     responses:
   *       200:
   *         description: 上传成功
   *       400:
   *         description: 参数错误或图片无效
   *       500:
   *         description: 服务器错误
   */
  app.post('/api/material-upload', async (req, res) => {
    await handleMaterialUpload(req, res, 'sticker');
  });

  // 兼容旧接口：
  // 历史上这个接口名虽然带 crawler，但现在统一转给通用上传逻辑。
  // 未显式传 target 时默认仍落图片库；若 body.target='crawler-material'，仍会按爬图库处理。
  app.post('/api/crawler-material-upload', async (req, res) => {
    await handleMaterialUpload(req, res, 'sticker');
  });

  // 返回停止服务器的函数
  return () => {
    return new Promise<void>((resolve) => {
      // 关闭所有 Socket.IO 连接
      if (ioServer) {
        ioServer.close(() => {
          console.log('✅ Socket.IO 服务器已停止');
        });
        ioServer = null;
      }
      
      // 清空连接记录
      extensionConnections.clear();
      
      // 关闭 HTTP 服务器
      if (httpServer) {
        httpServer.close(() => {
          console.log('✅ Express 服务器已停止');
          resolve();
        });
      } else {
        resolve();
      }
    });
  };
}



