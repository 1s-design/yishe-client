/**
 * 简单的日志服务
 */

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR'
}

interface LogContext {
  [key: string]: any
}

class Logger {
  private level: LogLevel = LogLevel.INFO

  setLevel(level: LogLevel) {
    this.level = level
  }

  private formatLog(level: LogLevel, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString()
    const contextStr = context ? ` | ${JSON.stringify(context)}` : ''
    return `[${timestamp}] [${level}] ${message}${contextStr}`
  }

  private writeFile(level: LogLevel, message: string, context?: LogContext) {
    try {
      void window.api?.writeClientLog?.({
        level,
        module: 'renderer',
        message,
        context
      })
    } catch {
      // 文件日志失败不能影响前端运行
    }
  }

  debug(message: string, context?: LogContext) {
    if ([LogLevel.DEBUG].includes(this.level)) {
      console.debug(this.formatLog(LogLevel.DEBUG, message, context))
    }
    this.writeFile(LogLevel.DEBUG, message, context)
  }

  info(message: string, context?: LogContext) {
    if ([LogLevel.DEBUG, LogLevel.INFO].includes(this.level)) {
      console.info(this.formatLog(LogLevel.INFO, message, context))
    }
    this.writeFile(LogLevel.INFO, message, context)
  }

  warn(message: string, context?: LogContext) {
    if ([LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN].includes(this.level)) {
      console.warn(this.formatLog(LogLevel.WARN, message, context))
    }
    this.writeFile(LogLevel.WARN, message, context)
  }

  error(message: string, context?: LogContext) {
    console.error(this.formatLog(LogLevel.ERROR, message, context))
    this.writeFile(LogLevel.ERROR, message, context)
  }
}

export const logger = new Logger()
