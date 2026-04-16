/**
 * 日志工具
 */

import { Chalk } from 'chalk';
import util from 'util';
import { AsyncLocalStorage } from 'async_hooks';

const logContextStorage = new AsyncLocalStorage();
const chalk = new Chalk();

function normalizeLogData(args = []) {
  return args.map((item) => {
    if (item instanceof Error) {
      return {
        name: item.name,
        message: item.message,
        stack: item.stack
      };
    }

    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean' || item === null) {
      return item;
    }

    if (item === undefined) {
      return '[undefined]';
    }

    try {
      return JSON.parse(JSON.stringify(item));
    } catch {
      return util.inspect(item, { depth: 3, breakLength: 120 });
    }
  });
}

class Logger {
  constructor() {
    this.isDebug = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';
  }

  emitToTaskContext(level, message, args) {
    const context = logContextStorage.getStore();
    if (!context?.handler || typeof context.handler !== 'function') {
      return;
    }

    try {
      context.handler({
        level,
        message: String(message || ''),
        data: normalizeLogData(args)
      });
    } catch {
      // ignore task log forwarding error
    }
  }

  runWithContext(context, executor) {
    return logContextStorage.run(context || {}, executor);
  }

  info(message, ...args) {
    console.log(chalk.blue('ℹ'), message, ...args);
    this.emitToTaskContext('info', message, args);
  }

  success(message, ...args) {
    console.log(chalk.green('✅'), message, ...args);
    this.emitToTaskContext('info', message, args);
  }

  warn(message, ...args) {
    console.log(chalk.yellow('⚠️'), message, ...args);
    this.emitToTaskContext('warn', message, args);
  }

  error(message, ...args) {
    console.log(chalk.red('❌'), message, ...args);
    this.emitToTaskContext('error', message, args);
  }

  debug(message, ...args) {
    if (this.isDebug) {
      console.log(chalk.gray('🐛'), message, ...args);
      this.emitToTaskContext('info', message, args);
    }
  }

  log(message, ...args) {
    console.log(message, ...args);
    this.emitToTaskContext('info', message, args);
  }
}

export const logger = new Logger();
