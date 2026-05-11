#!/usr/bin/env node

const path = require('path');
const ConfigLoader = require('./config/config-loader');
const Logger = require('./core/logger');
const PluginManager = require('./core/plugin-manager');
const MCPServer = require('./mcp-server');
const MCPHTTPServer = require('./mcp-http-server');
const WebServer = require('./web/server');

async function main() {
  // 解析命令行参数
  const args = process.argv.slice(2);
  const configPath = args.find(arg => arg.startsWith('--config='))?.split('=')[1]
    || process.env.PLUGIN_MANAGER_CONFIG
    || path.join(__dirname, '../config/config.yaml');

  const devMode = args.includes('--dev') || process.env.NODE_ENV === 'development';

  // stdio 模式下 stdout 必须是干净的 JSON-RPC，所有日志走 stderr
  if (args.includes('--stdio')) {
    process.env.PLUGIN_MANAGER_LOG_STREAM = 'stderr';
  }

  // 加载配置
  const configLoader = new ConfigLoader(configPath);
  const config = configLoader.load();

  // 初始化日志
  const logger = new Logger({
    logLevel: config.server?.logLevel || 'info',
    logDir: config.server?.logDir || '/tmp/openclaw-plugin-manager'
  });

  logger.info('='.repeat(60));
  logger.info('OpenClaw Plugin Manager Starting');
  logger.info(`Config: ${configPath}`);
  logger.info(`Mode: ${config.server?.mode || 'stdio'}`);
  logger.info('='.repeat(60));

  // 初始化 Plugin Manager
  const pluginManager = new PluginManager(configLoader, logger);

  try {
    await pluginManager.start();

    // 检查是否强制 stdio 模式（通过 --stdio 参数）
    const forceStdio = args.includes('--stdio');

    let mcpHttpServer = null;
    let mcpServer = null;
    let webServer = null;

    if (process.env.WEB_ONLY_MODE === 'true') {
      const webPort = config.server?.webPort || 19000;
      webServer = new WebServer(pluginManager, logger, webPort);
      webServer.start();
      logger.info('Running in Web Only mode (no stdio/http interface)');
      logger.info('Press Ctrl+C to stop');
    } else if (forceStdio) {
      // Stdio-only：podman exec 短进程，不抢端口、不打开非必要资源
      logger.info('Running in stdio-only mode (forced by --stdio flag)');
      mcpServer = new MCPServer(pluginManager, logger);
      mcpServer.start();
    } else if (config.server?.mode === 'http') {
      // HTTP daemon：暴露 MCP HTTP + Web UI
      const webPort = config.server?.webPort || 19000;
      webServer = new WebServer(pluginManager, logger, webPort);
      webServer.start();

      const httpPort = config.server?.httpPort || 18091;
      mcpHttpServer = new MCPHTTPServer(pluginManager, logger, httpPort);
      await mcpHttpServer.start();
      logger.info('Running in HTTP MCP mode (daemon)');
      logger.info('You can also call with --stdio flag for stdio access');
    } else {
      // 默认 stdio 模式（命令行直接启动）
      mcpServer = new MCPServer(pluginManager, logger);
      mcpServer.start();
    }

    // 优雅退出
    const shutdown = async () => {
      logger.info('Shutting down...');
      await pluginManager.stop();
      if (webServer) webServer.stop();
      if (mcpHttpServer) await mcpHttpServer.stop();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

  } catch (err) {
    logger.error(`Failed to start: ${err.message}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
