/*
 * @Author: chan-max jackieontheway666@gmail.com
 * @Date: 2025-01-27 14:00:00
 * @LastEditors: chan-max jackieontheway666@gmail.com
 * @LastEditTime: 2025-01-27 14:00:00
 * @FilePath: /yishe-electron/src/main/connectionManager.ts
 * @Description: 连接管理器 - 处理网络连接错误和重试机制
 */

import { Browser } from 'puppeteer';
import { EventEmitter } from 'events';

export interface ConnectionConfig {
  maxRetries: number;
  retryDelay: number;
  timeout: number;
  backoffMultiplier: number;
  heartbeatInterval: number; // 心跳检测间隔
  heartbeatTimeout: number;  // 心跳超时时间
  autoReconnect: boolean;    // 是否自动重连
  maxReconnectAttempts: number; // 最大重连次数
}

export interface ConnectionStatus {
  isConnected: boolean;
  lastError: string | null;
  retryCount: number;
  lastAttempt: Date | null;
  reconnectCount: number;
  lastHeartbeat: Date | null;
  isReconnecting: boolean;
}

export class ConnectionManager extends EventEmitter {
  private config: ConnectionConfig;
  private status: ConnectionStatus;
  private retryTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private browser: Browser | null = null;
  private isShuttingDown: boolean = false;

  constructor(config: Partial<ConnectionConfig> = {}) {
    super();
    
    this.config = {
      maxRetries: 3,
      retryDelay: 1000,
      timeout: 30000,
      backoffMultiplier: 2,
      heartbeatInterval: 30000, // 30秒心跳检测
      heartbeatTimeout: 10000,  // 10秒心跳超时
      autoReconnect: true,      // 启用自动重连
      maxReconnectAttempts: 10, // 最大重连10次
      ...config
    };

    this.status = {
      isConnected: false,
      lastError: null,
      retryCount: 0,
      lastAttempt: null,
      reconnectCount: 0,
      lastHeartbeat: null,
      isReconnecting: false
    };
  }

  /**
   * 设置浏览器实例
   */
  setBrowser(browser: Browser): void {
    this.browser = browser;
    // 延迟检查连接，避免在浏览器刚启动时就进行检查
    setTimeout(() => {
      this.checkConnection();
      this.startHeartbeat();
    }, 2000); // 增加延迟时间，确保浏览器完全启动
  }

  /**
   * 检查连接状态
   */
  async checkConnection(): Promise<boolean> {
    if (!this.browser || this.isShuttingDown) {
      this.updateStatus(false, 'Browser instance not available or shutting down');
      return false;
    }

    try {
      this.status.lastAttempt = new Date();
      
      // 检查浏览器是否连接
      const pages = await this.browser.pages();
      console.log('✅ 连接检查成功，页面数量:', pages.length);
      
      this.updateStatus(true, null);
      this.status.lastHeartbeat = new Date();
      this.emit('connected');
      return true;
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown connection error';
      console.error('❌ 连接检查失败:', errorMessage);
      
      this.updateStatus(false, errorMessage);
      this.emit('error', error);
      
      // 检查是否是协议错误，如果是则尝试重连
      if (errorMessage.includes('Protocol error') || errorMessage.includes('Connection closed')) {
        console.log('🔄 检测到协议错误，尝试重新连接...');
        await this.handleProtocolError();
      } else if (this.status.retryCount < this.config.maxRetries) {
        this.scheduleRetry();
      }
      return false;
    }
  }

  /**
   * 处理协议错误
   */
  private async handleProtocolError(): Promise<void> {
    if (this.status.isReconnecting || this.isShuttingDown) {
      return;
    }

    this.status.isReconnecting = true;
    this.emit('reconnecting');

    try {
      // 关闭现有浏览器实例
      if (this.browser) {
        try {
          await this.browser.close();
        } catch (error) {
          console.warn('关闭浏览器实例时出错:', error);
        }
        this.browser = null;
      }

      // 重置状态
      this.status.retryCount = 0;
      this.status.lastError = null;
      this.status.reconnectCount++;

      // 如果重连次数过多，停止自动重连
      if (this.status.reconnectCount > this.config.maxReconnectAttempts) {
        console.warn('⚠️ 重连次数过多，停止自动重连');
        this.emit('maxReconnectAttemptsReached');
        this.status.isReconnecting = false;
        return;
      }

      // 等待一段时间后重新检查
      await this.delay(this.config.retryDelay * 2);
      
      // 发出重连完成事件，让外部重新创建浏览器实例
      this.emit('reconnectReady');
      
    } catch (error) {
      console.error('❌ 处理协议错误失败:', error);
      this.updateStatus(false, error instanceof Error ? error.message : 'Protocol error handling failed');
    } finally {
      this.status.isReconnecting = false;
    }
  }

  /**
   * 开始心跳检测
   */
  private startHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    this.heartbeatTimer = setInterval(async () => {
      if (this.isShuttingDown || !this.browser) {
        return;
      }

      try {
        // 检查浏览器是否仍然响应
        const pages = await this.browser.pages();
        this.status.lastHeartbeat = new Date();
        console.log('💓 心跳检测正常，页面数量:', pages.length);
        
      } catch (error) {
        console.warn('💔 心跳检测失败:', error);
        this.status.lastError = error instanceof Error ? error.message : 'Heartbeat failed';
        
        // 如果心跳失败，尝试重新检查连接
        await this.checkConnection();
      }
    }, this.config.heartbeatInterval);
  }

  /**
   * 停止心跳检测
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * 执行带重试的操作
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string = 'Operation'
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        console.log(`🔄 ${operationName} 尝试 ${attempt}/${this.config.maxRetries}`);
        
        // 检查连接状态
        if (!this.browser) {
          throw new Error('Browser instance not available');
        }

        // 在执行操作前检查连接
        const isConnected = await this.checkConnection();
        if (!isConnected) {
          throw new Error('Browser connection is not available');
        }

        const result = await operation();
        console.log(`✅ ${operationName} 执行成功`);
        
        // 重置重试计数
        this.status.retryCount = 0;
        this.emit('operationSuccess', operationName);
        
        return result;
        
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.error(`❌ ${operationName} 尝试 ${attempt} 失败:`, lastError.message);
        
        this.status.retryCount = attempt;
        this.emit('operationError', operationName, lastError, attempt);
        
        // 检查是否是协议错误
        if (lastError.message.includes('Protocol error') || lastError.message.includes('Connection closed')) {
          console.log('🔄 检测到协议错误，等待重连...');
          await this.handleProtocolError();
          // 等待重连完成
          await this.waitForReconnection();
        } else if (attempt < this.config.maxRetries) {
          const delay = this.config.retryDelay * Math.pow(this.config.backoffMultiplier, attempt - 1);
          console.log(`⏳ ${operationName} 将在 ${delay}ms 后重试...`);
          await this.delay(delay);
        }
      }
    }

    // 所有重试都失败了
    const finalError = new Error(`${operationName} failed after ${this.config.maxRetries} attempts. Last error: ${lastError?.message}`);
    this.emit('operationFailed', operationName, finalError);
    throw finalError;
  }

  /**
   * 等待重连完成
   */
  private async waitForReconnection(): Promise<void> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.warn('⚠️ 等待重连超时');
        resolve();
      }, this.config.timeout);

      const onReconnectReady = () => {
        clearTimeout(timeout);
        this.removeListener('reconnectReady', onReconnectReady);
        resolve();
      };

      this.once('reconnectReady', onReconnectReady);
    });
  }

  /**
   * 重新连接
   */
  async reconnect(): Promise<boolean> {
    console.log('🔄 手动触发重新连接...');
    
    try {
      // 关闭现有浏览器实例
      if (this.browser) {
        try {
          await this.browser.close();
        } catch (error) {
          console.warn('关闭浏览器实例时出错:', error);
        }
        this.browser = null;
      }

      // 重置状态
      this.status.retryCount = 0;
      this.status.lastError = null;
      this.status.reconnectCount = 0;
      
      // 发出重连事件
      this.emit('reconnecting');
      
      // 等待一段时间后重新检查
      await this.delay(this.config.retryDelay);
      
      return true;
      
    } catch (error) {
      console.error('❌ 重新连接失败:', error);
      this.updateStatus(false, error instanceof Error ? error.message : 'Reconnection failed');
      return false;
    }
  }

  /**
   * 获取连接状态
   */
  getStatus(): ConnectionStatus {
    return { ...this.status };
  }

  /**
   * 获取配置
   */
  getConfig(): ConnectionConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig: Partial<ConnectionConfig>): void {
    this.config = { ...this.config, ...newConfig };
    console.log('⚙️ 连接配置已更新:', this.config);
    
    // 如果心跳间隔改变，重启心跳检测
    if (newConfig.heartbeatInterval && this.heartbeatTimer) {
      this.startHeartbeat();
    }
  }

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    this.isShuttingDown = true;
    
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    
    this.stopHeartbeat();
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    if (this.browser) {
      try {
        await this.browser.close();
      } catch (error) {
        console.warn('清理浏览器实例时出错:', error);
      }
      this.browser = null;
    }
    
    this.removeAllListeners();
  }

  /**
   * 私有方法：更新状态
   */
  private updateStatus(isConnected: boolean, error: string | null): void {
    this.status.isConnected = isConnected;
    this.status.lastError = error;
    
    // 如果连接成功，重置重试计数
    if (isConnected) {
      this.status.retryCount = 0;
    }
    
    console.log(`📊 连接状态更新: ${isConnected ? '已连接' : '未连接'}${error ? ` (错误: ${error})` : ''}`);
    
    this.emit('statusChanged', this.status);
  }

  /**
   * 私有方法：安排重试
   */
  private scheduleRetry(): void {
    if (this.status.retryCount >= this.config.maxRetries) {
      console.log('⚠️ 已达到最大重试次数，停止自动重试');
      this.emit('maxRetriesReached');
      return;
    }

    // 增加重试计数
    this.status.retryCount++;

    const delay = this.config.retryDelay * Math.pow(this.config.backoffMultiplier, this.status.retryCount - 1);
    console.log(`⏰ 安排 ${delay}ms 后重试连接... (第 ${this.status.retryCount} 次)`);
    
    this.retryTimer = setTimeout(async () => {
      await this.checkConnection();
    }, delay);
  }

  /**
   * 私有方法：延迟
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// 创建全局连接管理器实例
export const connectionManager = new ConnectionManager({
  maxRetries: 5,
  retryDelay: 2000,
  timeout: 30000,
  backoffMultiplier: 1.5,
  heartbeatInterval: 30000, // 30秒心跳
  heartbeatTimeout: 10000,  // 10秒超时
  autoReconnect: true,
  maxReconnectAttempts: 10
});

// 导出默认实例
export default connectionManager; 