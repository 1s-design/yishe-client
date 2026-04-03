/*
 * @Author: chan-max jackieontheway666@gmail.com
 * @Date: 2025-01-27 14:00:00
 * @LastEditors: chan-max jackieontheway666@gmail.com
 * @LastEditTime: 2025-01-27 14:00:00
 * @FilePath: /yishe-electron/src/main/networkMonitor.ts
 * @Description: 网络监控服务 - 检测网络状态变化并自动处理连接问题
 */

import { EventEmitter } from 'events';
import { connectionManager } from './connectionManager';
import { getOrCreateBrowser } from './server';

export interface NetworkStatus {
  isOnline: boolean;
  lastCheck: Date;
  consecutiveFailures: number;
  latency: number | null;
}

export interface NetworkConfig {
  checkInterval: number;      // 网络检查间隔 (毫秒)
  timeout: number;           // 网络检查超时 (毫秒)
  maxFailures: number;       // 最大连续失败次数
  recoveryDelay: number;     // 恢复延迟 (毫秒)
}

export class NetworkMonitor extends EventEmitter {
  private config: NetworkConfig;
  private status: NetworkStatus;
  private checkTimer: NodeJS.Timeout | null = null;
  private isMonitoring: boolean = false;
  private testUrls: string[] = [
    'https://www.baidu.com',
    'https://www.google.com',
    'https://www.bing.com'
  ];

  constructor(config: Partial<NetworkConfig> = {}) {
    super();
    
    this.config = {
      checkInterval: 30000,    // 30秒检查一次
      timeout: 10000,         // 10秒超时
      maxFailures: 3,         // 最多3次连续失败
      recoveryDelay: 5000,    // 5秒恢复延迟
      ...config
    };

    this.status = {
      isOnline: true,
      lastCheck: new Date(),
      consecutiveFailures: 0,
      latency: null
    };
  }

  /**
   * 开始网络监控
   */
  start(): void {
    if (this.isMonitoring) {
      console.log('网络监控已在运行中');
      return;
    }

    this.isMonitoring = true;
    console.log('🌐 开始网络监控...');
    
    // 立即执行一次检查
    this.checkNetwork();
    
    // 设置定期检查
    this.checkTimer = setInterval(() => {
      this.checkNetwork();
    }, this.config.checkInterval);
  }

  /**
   * 停止网络监控
   */
  stop(): void {
    this.isMonitoring = false;
    
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
    
    console.log('🌐 网络监控已停止');
  }

  /**
   * 检查网络状态
   */
  private async checkNetwork(): Promise<void> {
    if (!this.isMonitoring) return;

    try {
      const startTime = Date.now();
      const isOnline = await this.testConnectivity();
      const latency = isOnline ? Date.now() - startTime : null;
      
      this.status.lastCheck = new Date();
      this.status.latency = latency;

      if (isOnline) {
        if (!this.status.isOnline) {
          console.log('🌐 网络已恢复');
          this.emit('networkRestored', this.status);
        }
        this.status.isOnline = true;
        this.status.consecutiveFailures = 0;
      } else {
        this.status.consecutiveFailures++;
        console.warn(`🌐 网络检查失败 (${this.status.consecutiveFailures}/${this.config.maxFailures})`);
        
        if (this.status.consecutiveFailures >= this.config.maxFailures) {
          if (this.status.isOnline) {
            console.error('🌐 网络连接已断开');
            this.status.isOnline = false;
            this.emit('networkLost', this.status);
            await this.handleNetworkLoss();
          }
        }
      }

      this.emit('statusChanged', this.status);
      
    } catch (error) {
      console.error('🌐 网络检查出错:', error);
      this.status.consecutiveFailures++;
    }
  }

  /**
   * 测试网络连接
   */
  private async testConnectivity(): Promise<boolean> {
    for (const url of this.testUrls) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);
        
        const response = await fetch(url, {
          method: 'HEAD',
          signal: controller.signal,
          cache: 'no-cache'
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
          return true;
        }
      } catch (error) {
        // 继续尝试下一个URL
        continue;
      }
    }
    
    return false;
  }

  /**
   * 处理网络丢失
   */
  private async handleNetworkLoss(): Promise<void> {
    console.log('🔄 网络丢失，准备处理连接问题...');
    
    try {
      // 等待一段时间让网络稳定
      await this.delay(this.config.recoveryDelay);
      
      // 检查连接管理器状态
      const connectionStatus = connectionManager.getStatus();
      
      if (!connectionStatus.isConnected) {
        console.log('🔄 检测到浏览器连接问题，尝试恢复...');
        
        // 触发连接管理器的重连
        await connectionManager.reconnect();
        
        // 等待重连完成
        await this.waitForReconnection();
      }
      
    } catch (error) {
      console.error('❌ 处理网络丢失失败:', error);
    }
  }

  /**
   * 等待重连完成
   */
  private async waitForReconnection(): Promise<void> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.warn('⚠️ 等待重连超时');
        resolve();
      }, 30000); // 30秒超时

      const onConnected = () => {
        clearTimeout(timeout);
        connectionManager.removeListener('connected', onConnected);
        resolve();
      };

      connectionManager.once('connected', onConnected);
    });
  }

  /**
   * 手动触发网络检查
   */
  async forceCheck(): Promise<NetworkStatus> {
    console.log('🔍 手动触发网络检查...');
    await this.checkNetwork();
    return this.getStatus();
  }

  /**
   * 获取网络状态
   */
  getStatus(): NetworkStatus {
    return { ...this.status };
  }

  /**
   * 获取配置
   */
  getConfig(): NetworkConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig: Partial<NetworkConfig>): void {
    this.config = { ...this.config, ...newConfig };
    console.log('⚙️ 网络监控配置已更新:', this.config);
  }

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    this.stop();
    this.removeAllListeners();
  }

  /**
   * 私有方法：延迟
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// 创建全局网络监控实例
export const networkMonitor = new NetworkMonitor({
  checkInterval: 30000,    // 30秒检查一次
  timeout: 10000,         // 10秒超时
  maxFailures: 3,         // 最多3次连续失败
  recoveryDelay: 5000     // 5秒恢复延迟
});

// 导出默认实例
export default networkMonitor; 