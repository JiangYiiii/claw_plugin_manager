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

    // 启动 Web 服务器
    const webPort = config.server?.webPort || 8091;
    const webServer = new WebServer(pluginManager, logger, webPort);
    webServer.start();

    // 根据模式启动对应服务
    let mcpHttpServer = null;
    if (process.env.WEB_ONLY_MODE === 'true') {
      // Web Only 模式（测试用）
      logger.info('Running in Web Only mode (no stdio/http interface)');
      logger.info('Press Ctrl+C to stop');
    } else if (config.server?.mode === 'http') {
      // HTTP 模式
      const httpPort = config.server?.httpPort || 8090;
      mcpHttpServer = new MCPHTTPServer(pluginManager, logger, httpPort);
      await mcpHttpServer.start();
      logger.info('Running in HTTP MCP mode');
    } else {
      // Stdio 模式（默认）
      const mcpServer = new MCPServer(pluginManager, logger);
      mcpServer.start();
    }

    // 优雅退出
    process.on('SIGINT', async () => {
      logger.info('Shutting down...');
      await pluginManager.stop();
      webServer.stop();
      if (mcpHttpServer) mcpHttpServer.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('Shutting down...');
      await pluginManager.stop();
      webServer.stop();
      if (mcpHttpServer) mcpHttpServer.stop();
      process.exit(0);
    });

  } catch (err) {
    logger.error(`Failed to start: ${err.message}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
