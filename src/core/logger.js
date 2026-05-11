const winston = require('winston');
const path = require('path');
const fs = require('fs');

class Logger {
  constructor(config = {}) {
    const logDir = config.logDir || '/tmp/openclaw-plugin-manager';
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    // stdio 模式下 stdout 是 MCP 协议数据，所有日志必须走 stderr
    // 通过 PLUGIN_MANAGER_LOG_STREAM=stderr 或 --stdio 启动参数（在 index.js 中设置）触发
    const consoleStream =
      process.env.PLUGIN_MANAGER_LOG_STREAM === 'stderr' ? process.stderr : process.stdout;

    this.logger = winston.createLogger({
      level: config.logLevel || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [
        new winston.transports.File({
          filename: path.join(logDir, 'error.log'),
          level: 'error'
        }),
        new winston.transports.File({
          filename: path.join(logDir, 'combined.log')
        }),
        new winston.transports.Console({
          stderrLevels: ['error', 'warn', 'info', 'debug', 'verbose', 'silly'],
          consoleWarnLevels: ['error', 'warn', 'info', 'debug', 'verbose', 'silly'],
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          )
        })
      ]
    });

    // 如果上面的 stderrLevels 在某些 winston 版本不生效，强制重定向
    if (consoleStream === process.stderr) {
      this.logger.transports
        .filter((t) => t instanceof winston.transports.Console)
        .forEach((t) => {
          t.log = (info, callback) => {
            setImmediate(() => t.emit('logged', info));
            const formatted = info[Symbol.for('message')] || info.message || '';
            process.stderr.write(formatted + '\n');
            if (callback) callback();
          };
        });
    }
  }

  info(message, meta = {}) {
    this.logger.info(message, meta);
  }

  warn(message, meta = {}) {
    this.logger.warn(message, meta);
  }

  error(message, meta = {}) {
    this.logger.error(message, meta);
  }

  debug(message, meta = {}) {
    this.logger.debug(message, meta);
  }
}

module.exports = Logger;
