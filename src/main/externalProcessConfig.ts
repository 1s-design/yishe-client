import { ProcessConfig } from './externalProcessManager'

/**
 * 插件进程配置
 *
 * 约定：插件可执行文件统一放置在 resources/plugin 目录下，便于管理。
 * 
 * 注意：PS 工具服务（ps.exe）已提取为独立服务，不再由客户端管理，改为通过 HTTP 接口交互。
 */
export const pluginProcessConfigs: ProcessConfig[] = [
  // PS 工具服务已提取为独立服务，不再在此配置

  // 示例1: 简单的辅助工具（无健康检查）
  // {
  //   id: 'helper-tool',
  //   name: '辅助工具',
  //   executable: 'resources/helper.exe',
  //   args: [],
  //   autoRestart: false,
  //   platforms: ['win32']
  // },

  // 示例3: TCP 服务健康检查
  // {
  //   id: 'tcp-service',
  //   name: 'TCP 服务',
  //   executable: 'resources/tcp-service.exe',
  //   healthCheck: {
  //     type: 'tcp',
  //     port: 8080,
  //     interval: 5000,
  //     timeout: 3000
  //   }
  // },

  // 示例4: 文件存在检查
  // {
  //   id: 'file-service',
  //   name: '文件服务',
  //   executable: 'resources/file-service.exe',
  //   healthCheck: {
  //     type: 'file',
  //     file: 'C:\\temp\\service-ready.flag',
  //     interval: 5000
  //   }
  // },

  // 示例5: 跨平台支持
  // {
  //   id: 'cross-platform-service',
  //   name: '跨平台服务',
  //   executable: process.platform === 'win32' 
  //     ? 'resources/service.exe' 
  //     : 'resources/service',
  //   platforms: ['win32', 'darwin', 'linux'] // 支持所有平台
  // }
]

/**
 * 从配置文件加载进程配置（可选）
 * 如果使用配置文件，可以取消注释以下代码
 */
// import { readFileSync } from 'fs'
// import { join } from 'path'
// 
// export function loadProcessConfigs(): ProcessConfig[] {
//   try {
//     const configPath = join(__dirname, '../../resources/process-config.json')
//     const configContent = readFileSync(configPath, 'utf-8')
//     return JSON.parse(configContent)
//   } catch (error) {
//     console.error('加载进程配置失败，使用默认配置:', error)
//     return pluginProcessConfigs
//   }
// }

