import { spawn, ChildProcess } from 'child_process'
import { join, resolve, isAbsolute } from 'path'
import { existsSync } from 'fs'
import { app } from 'electron'
import { is } from '@electron-toolkit/utils'

/**
 * 进程健康检查类型
 */
export type HealthCheckType = 'http' | 'tcp' | 'file'

/**
 * 健康检查配置
 */
export interface HealthCheckConfig {
  type: HealthCheckType
  url?: string // HTTP 健康检查 URL
  port?: number // TCP 端口
  file?: string // 文件存在检查路径
  interval?: number // 检查间隔（毫秒），默认 5000
  timeout?: number // 超时时间（毫秒），默认 3000
  failureThreshold?: number // 连续失败多少次后标记异常，默认 2
}

/**
 * 外部进程配置
 */
export interface ProcessConfig {
  // 进程唯一标识
  id: string
  // 进程名称（用于日志）
  name: string
  // 可执行文件路径（相对或绝对）
  executable: string
  // 可选：用于优雅停止的可执行文件（默认同 executable）
  stopExecutable?: string
  // 工作目录（可选）
  cwd?: string
  // 命令行参数（可选）
  args?: string[]
  // 可选：停止时优雅调用的参数（会在 stop 时优先执行，不阻塞原有 kill 流程）
  stopArgs?: string[]
  // 环境变量（可选）
  env?: Record<string, string>
  // 是否自动重启（可选，默认 false）
  autoRestart?: boolean
  // 重启延迟（毫秒，可选，默认 3000）
  restartDelay?: number
  // 启动延迟（毫秒，可选，默认 0）
  startDelay?: number
  // 平台限制（可选，如 ['win32', 'darwin']）
  platforms?: NodeJS.Platform[]
  // 健康检查配置（可选）
  healthCheck?: HealthCheckConfig
  // 关闭超时时间（毫秒，可选，默认 5000）
  killTimeout?: number
  // 停止钩子超时时间（毫秒，可选，默认 5000）
  stopTimeout?: number
  // 是否在应用启动时自动启动（可选，默认 true）
  autoStart?: boolean
}

/**
 * 进程状态
 */
export enum ProcessStatus {
  STOPPED = 'stopped',
  STARTING = 'starting',
  RUNNING = 'running',
  STOPPING = 'stopping',
  ERROR = 'error'
}

/**
 * 进程信息
 */
interface ProcessInfo {
  config: ProcessConfig
  process: ChildProcess | null
  status: ProcessStatus
  startTime: number | null
  restartCount: number
  healthCheckFailureCount: number
  lastHealthCheckAt: number | null
  healthCheckTimer?: NodeJS.Timeout
}

/**
 * 外部进程管理器
 * 
 * 用于管理 Electron 应用启动的外部 exe 程序
 * 支持进程启动、关闭、监控、自动重启等功能
 */
export class ExternalProcessManager {
  private processes: Map<string, ProcessInfo> = new Map()
  private isShuttingDown = false

  /**
   * 构造函数
   * @param configs 进程配置数组
   */
  constructor(private configs: ProcessConfig[]) {
    // 验证配置
    this.validateConfigs()
  }

  /**
   * 验证配置
   */
  private validateConfigs(): void {
    const ids = new Set<string>()
    for (const config of this.configs) {
      if (ids.has(config.id)) {
        throw new Error(`重复的进程 ID: ${config.id}`)
      }
      ids.add(config.id)

      if (!config.id || !config.name || !config.executable) {
        throw new Error(`进程配置不完整: ${config.id}`)
      }
    }
  }

  /**
   * 解析可执行文件路径
   */
  private resolveExecutablePath(config: ProcessConfig): string {
    const { executable } = config

    // 如果是绝对路径，直接返回
    if (isAbsolute(executable)) {
      return executable
    }

    // 相对路径处理
    if (is.dev) {
      // 开发环境：从项目根目录解析
      return resolve(__dirname, '../../', executable)
    } else {
      // 生产环境：从 resources 目录或应用目录解析
      const appPath = app.getAppPath()
      const resourcesPath = process.resourcesPath
      
      // 计算 app.asar.unpacked 目录路径
      // app.asar.unpacked 通常和 app.asar 在同一目录（resourcesPath）
      const asarUnpackedPath = join(resourcesPath, 'app.asar.unpacked')

      // 尝试多个可能的路径
      const possiblePaths = [
        // 方案1: app.asar.unpacked 目录（推荐，因为配置了 asarUnpack: resources/**）
        join(asarUnpackedPath, executable),
        // 方案2: resourcesPath 目录（如果资源直接放在 resources 下）
        join(resourcesPath, executable),
        // 方案3: 如果 executable 不包含 resources/，尝试添加
        executable.startsWith('resources/')
          ? null // 跳过，已在方案1和2中处理
          : join(asarUnpackedPath, 'resources', executable),
        // 方案4: 从 __dirname 向上查找（开发/调试场景）
        join(__dirname, '../..', executable),
        // 方案5: 从 appPath 解析
        join(appPath, executable)
      ].filter((path): path is string => path !== null) // 过滤掉 null 值

      for (const path of possiblePaths) {
        if (existsSync(path)) {
          console.log(`✅ 找到可执行文件: ${path}`)
          return path
        }
      }

      // 如果都不存在，返回第一个路径（用于错误提示）
      console.error(`❌ 未找到可执行文件，尝试的路径:`, possiblePaths)
      return possiblePaths[0]
    }
  }

  /**
   * 检查平台是否支持
   */
  private isPlatformSupported(config: ProcessConfig): boolean {
    if (!config.platforms || config.platforms.length === 0) {
      return true
    }
    return config.platforms.includes(process.platform)
  }

  /**
   * 启动单个进程
   */
  async startProcess(id: string): Promise<boolean> {
    const config = this.configs.find(c => c.id === id)
    if (!config) {
      console.error(`❌ 未找到进程配置: ${id}`)
      return false
    }

    // 检查平台支持
    if (!this.isPlatformSupported(config)) {
      console.log(`⏭️  跳过进程 ${config.name}（平台不支持）`)
      return false
    }

    // 检查是否已在运行
    const existingInfo = this.processes.get(id)
    if (existingInfo && existingInfo.status === ProcessStatus.RUNNING) {
      console.log(`⚠️  进程 ${config.name} 已在运行`)
      return true
    }

    if (existingInfo?.process && existingInfo.status === ProcessStatus.ERROR) {
      console.log(`⚠️  进程 ${config.name} 当前处于异常状态，先停止旧进程后再重启`)
      await this.stopProcess(id, true).catch(() => false)
    }

    // 解析可执行文件路径
    const executablePath = this.resolveExecutablePath(config)
    if (!existsSync(executablePath)) {
      console.error(`❌ 可执行文件不存在: ${executablePath}`)
      const info: ProcessInfo = {
        config,
        process: null,
        status: ProcessStatus.ERROR,
        startTime: null,
        restartCount: 0,
        healthCheckFailureCount: 0,
        lastHealthCheckAt: null
      }
      this.processes.set(id, info)
      return false
    }

    // 启动延迟
    if (config.startDelay && config.startDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, config.startDelay))
    }

    try {
      console.log(`🚀 启动进程: ${config.name} (${executablePath})`)

      // 创建工作目录
      const cwd = config.cwd || (isAbsolute(config.executable) 
        ? resolve(config.executable, '..') 
        : resolve(executablePath, '..'))

      // 合并环境变量
      const env = {
        ...process.env,
        ...config.env
      }

      // 启动进程
      const childProcess = spawn(executablePath, config.args || [], {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'], // 忽略 stdin，捕获 stdout 和 stderr
        detached: false // 不分离进程，确保可以控制
      })

      // 记录进程信息
      const info: ProcessInfo = {
        config,
        process: childProcess,
        status: ProcessStatus.STARTING,
        startTime: Date.now(),
        restartCount: existingInfo?.restartCount || 0,
        healthCheckFailureCount: 0,
        lastHealthCheckAt: null
      }
      this.processes.set(id, info)

      // 监听进程输出
      childProcess.stdout?.on('data', (data) => {
        console.log(`[${config.name}] ${data.toString().trim()}`)
      })

      childProcess.stderr?.on('data', (data) => {
        console.error(`[${config.name}] ${data.toString().trim()}`)
      })

      // 监听进程错误
      childProcess.on('error', (error) => {
        console.error(`❌ 进程 ${config.name} 启动错误:`, error)
        info.status = ProcessStatus.ERROR
        this.handleProcessExit(id, 'error')
      })

      // 监听进程退出
      childProcess.on('exit', (code, signal) => {
        console.log(`⚠️  进程 ${config.name} 退出，代码: ${code}, 信号: ${signal}`)
        this.handleProcessExit(id, code === 0 ? 'normal' : 'error', code)
      })

      // 等待进程启动
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          resolve()
        }, 1000)

        childProcess.once('spawn', () => {
          clearTimeout(timeout)
          info.status = ProcessStatus.RUNNING
          info.healthCheckFailureCount = 0
          console.log(`✅ 进程 ${config.name} 启动成功 (PID: ${childProcess.pid})`)
          resolve()
        })
      })

      // 启动健康检查
      if (config.healthCheck) {
        this.startHealthCheck(id)
      }

      return true
    } catch (error) {
      console.error(`❌ 启动进程 ${config.name} 失败:`, error)
      const info: ProcessInfo = {
        config,
        process: null,
        status: ProcessStatus.ERROR,
        startTime: null,
        restartCount: existingInfo?.restartCount || 0,
        healthCheckFailureCount: 0,
        lastHealthCheckAt: null
      }
      this.processes.set(id, info)
      return false
    }
  }

  /**
   * 停止单个进程
   */
  async stopProcess(id: string, force = false): Promise<boolean> {
    const info = this.processes.get(id)
    if (!info || !info.process) {
      console.log(`⚠️  进程 ${id} 未运行`)
      return true
    }

    const { config, process } = info

    if (info.status === ProcessStatus.STOPPING) {
      console.log(`⚠️  进程 ${config.name} 正在关闭中...`)
      return false
    }

    try {
      console.log(`🛑 停止进程: ${config.name}`)
      info.status = ProcessStatus.STOPPING

      // 先执行优雅停止钩子（如果配置了）
      await this.runStopHook(config)

      // 停止健康检查
      if (info.healthCheckTimer) {
        clearInterval(info.healthCheckTimer)
        info.healthCheckTimer = undefined
      }
      info.healthCheckFailureCount = 0
      info.lastHealthCheckAt = null

      // 优雅关闭
      if (!force) {
        const killed = await this.killProcessGracefully(process, config.killTimeout || 5000)
        if (killed) {
          info.status = ProcessStatus.STOPPED
          info.process = null
          console.log(`✅ 进程 ${config.name} 已停止`)
          return true
        }
      }

      // 强制关闭
      console.log(`⚠️  强制终止进程: ${config.name}`)
      if (process.pid) {
        await this.killProcessTree(process.pid)
      } else {
        process.kill('SIGKILL')
      }
      
      // 等待进程退出
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          resolve()
        }, 2000)

        process.once('exit', () => {
          clearTimeout(timeout)
          resolve()
        })
      })

      info.status = ProcessStatus.STOPPED
      info.process = null
      console.log(`✅ 进程 ${config.name} 已强制停止`)
      return true
    } catch (error) {
      console.error(`❌ 停止进程 ${config.name} 失败:`, error)
      info.status = ProcessStatus.ERROR
      return false
    }
  }

  /**
   * 优雅停止钩子：调用 stopExecutable/stopArgs
   * 不抛异常，不阻塞整体关闭流程
   */
  private async runStopHook(config: ProcessConfig): Promise<void> {
    if (!config.stopArgs || config.stopArgs.length === 0) return

    const stopExecPath = this.resolveExecutablePath({
      ...config,
      executable: config.stopExecutable || config.executable
    })

    const cwd = config.cwd || (isAbsolute(stopExecPath) ? resolve(stopExecPath, '..') : undefined)
    const env = { ...process.env, ...config.env }
    const timeout = config.stopTimeout ?? 5000

    return new Promise((resolve) => {
      try {
        console.log(`⏹️  执行停止钩子: ${config.name} (${stopExecPath} ${config.stopArgs.join(' ')})`)
        const child = spawn(stopExecPath, config.stopArgs, {
          cwd,
          env,
          stdio: 'ignore',
          detached: false
        })

        const timer = setTimeout(() => {
          console.warn(`⚠️  停止钩子超时 (${config.name})`)
          resolve()
        }, timeout)

        child.once('exit', () => {
          clearTimeout(timer)
          console.log(`✅ 停止钩子完成 (${config.name})`)
          resolve()
        })

        child.once('error', (err) => {
          clearTimeout(timer)
          console.error(`❌ 停止钩子执行失败 (${config.name}):`, err)
          resolve()
        })
      } catch (error) {
        console.error(`❌ 停止钩子执行异常 (${config.name}):`, error)
        resolve()
      }
    })
  }

  /**
   * 优雅关闭进程
   */
  private async killProcessGracefully(
    process: ChildProcess,
    timeout: number
  ): Promise<boolean> {
    return new Promise((resolve) => {
      // 发送 SIGTERM（Windows 上会转换为终止信号）
      process.kill('SIGTERM')

      const timer = setTimeout(() => {
        resolve(false)
      }, timeout)

      process.once('exit', () => {
        clearTimeout(timer)
        resolve(true)
      })
    })
  }

  /**
   * 在 Windows 上终止进程树，其他平台退化为 SIGKILL
   */
  private async killProcessTree(pid: number): Promise<void> {
    if (process.platform !== 'win32') {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // 进程已退出时忽略
      }
      return
    }

    await new Promise<void>((resolve) => {
      try {
        const killer = spawn('taskkill', ['/PID', pid.toString(), '/T', '/F'])
        killer.once('exit', () => resolve())
        killer.once('error', () => resolve())
      } catch {
        resolve()
      }
    })
  }

  /**
   * 处理进程退出
   */
  private handleProcessExit(id: string, reason: 'normal' | 'error', _code?: number): void {
    const info = this.processes.get(id)
    if (!info) return

    // 停止健康检查
    if (info.healthCheckTimer) {
      clearInterval(info.healthCheckTimer)
      info.healthCheckTimer = undefined
    }
    info.healthCheckFailureCount = 0
    info.lastHealthCheckAt = null

    // 如果正在关闭，不处理重启
    if (this.isShuttingDown || info.status === ProcessStatus.STOPPING) {
      info.status = ProcessStatus.STOPPED
      info.process = null
      return
    }

    // 更新状态
    info.status = ProcessStatus.STOPPED
    info.process = null

    // 自动重启
    if (info.config.autoRestart && reason === 'error') {
      const delay = info.config.restartDelay || 3000
      info.restartCount++
      console.log(`🔄 ${delay}ms 后重启进程 ${info.config.name} (第 ${info.restartCount} 次)`)
      
      setTimeout(() => {
        if (!this.isShuttingDown) {
          this.startProcess(id).catch((error) => {
            console.error(`❌ 自动重启进程 ${info.config.name} 失败:`, error)
          })
        }
      }, delay)
    }
  }

  /**
   * 启动健康检查
   */
  private startHealthCheck(id: string): void {
    const info = this.processes.get(id)
    if (!info || !info.config.healthCheck) return

    const { healthCheck } = info.config
    const interval = healthCheck.interval || 5000
    const timeout = healthCheck.timeout || 3000
    const failureThreshold = Math.max(1, healthCheck.failureThreshold || 2)

    const checkHealth = async () => {
      if (
        this.isShuttingDown ||
        (info.status !== ProcessStatus.RUNNING &&
          info.status !== ProcessStatus.ERROR)
      ) {
        return
      }

      try {
        let isHealthy = false
        info.lastHealthCheckAt = Date.now()

        switch (healthCheck.type) {
          case 'http':
            if (healthCheck.url) {
              isHealthy = await this.checkHttpHealth(healthCheck.url, timeout)
            }
            break
          case 'tcp':
            if (healthCheck.port) {
              isHealthy = await this.checkTcpHealth(healthCheck.port, timeout)
            }
            break
          case 'file':
            if (healthCheck.file) {
              isHealthy = existsSync(healthCheck.file)
            }
            break
        }

        if (isHealthy) {
          if (
            info.status === ProcessStatus.ERROR &&
            info.process &&
            !info.process.killed
          ) {
            console.log(`✅ 进程 ${info.config.name} 健康检查恢复`)
            info.status = ProcessStatus.RUNNING
          }
          info.healthCheckFailureCount = 0
          return
        }

        info.healthCheckFailureCount += 1

        if (info.healthCheckFailureCount < failureThreshold) {
          console.warn(
            `⚠️  进程 ${info.config.name} 健康检查失败 (${info.healthCheckFailureCount}/${failureThreshold})`
          )
          return
        }

        if (info.status !== ProcessStatus.ERROR) {
          console.warn(
            `⚠️  进程 ${info.config.name} 健康检查连续失败 ${info.healthCheckFailureCount} 次，已标记为异常`
          )
          info.status = ProcessStatus.ERROR
        }
      } catch (error) {
        console.error(`❌ 健康检查失败 (${info.config.name}):`, error)
      }
    }

    // 立即执行一次
    checkHealth()

    // 设置定时检查
    info.healthCheckTimer = setInterval(checkHealth, interval)
  }

  /**
   * HTTP 健康检查
   */
  private async checkHttpHealth(url: string, timeout: number): Promise<boolean> {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeout)

      const response = await fetch(url, {
        signal: controller.signal,
        method: 'GET'
      })

      clearTimeout(timeoutId)
      return response.ok
    } catch {
      return false
    }
  }

  /**
   * TCP 健康检查
   */
  private async checkTcpHealth(port: number, timeout: number): Promise<boolean> {
    return new Promise((resolve) => {
      const net = require('net')
      const socket = new net.Socket()
      let resolved = false

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true
          socket.destroy()
          resolve(false)
        }
      }, timeout)

      socket.once('connect', () => {
        if (!resolved) {
          resolved = true
          clearTimeout(timer)
          socket.destroy()
          resolve(true)
        }
      })

      socket.once('error', () => {
        if (!resolved) {
          resolved = true
          clearTimeout(timer)
          resolve(false)
        }
      })

      socket.connect(port, 'localhost')
    })
  }

  /**
   * 启动所有进程
   */
  async startAll(): Promise<void> {
    console.log('🚀 开始启动外部进程...')
    // 只启动 autoStart 不为 false 的进程（默认 true）
    const promises = this.configs
      .filter(config => config.autoStart !== false)
      .map(config => this.startProcess(config.id))
    await Promise.allSettled(promises)
    console.log('✅ 外部进程启动完成')
  }

  /**
   * 停止所有进程
   */
  async stopAll(force = false): Promise<void> {
    this.isShuttingDown = true
    console.log('🛑 开始停止外部进程...')
    const promises = Array.from(this.processes.keys()).map(id => 
      this.stopProcess(id, force)
    )
    await Promise.allSettled(promises)
    console.log('✅ 外部进程停止完成')
  }

  /**
   * 获取进程状态
   */
  getProcessStatus(id: string): ProcessStatus | null {
    const info = this.processes.get(id)
    return info ? info.status : null
  }

  /**
   * 获取所有进程状态
   */
  getAllProcessStatus(): Record<string, ProcessStatus> {
    const status: Record<string, ProcessStatus> = {}
    for (const [id, info] of this.processes.entries()) {
      status[id] = info.status
    }
    return status
  }

  /**
   * 重启进程
   */
  async restartProcess(id: string): Promise<boolean> {
    await this.stopProcess(id)
    return await this.startProcess(id)
  }
}
