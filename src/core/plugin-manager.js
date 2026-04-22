const StdioAdapter = require('./stdio-adapter');
const HTTPAdapter = require('./http-adapter');
const Router = require('./router');
const HealthMonitor = require('./health-monitor');

class PluginManager {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.mcps = new Map();
    this.router = new Router(logger);
    this.healthMonitor = new HealthMonitor(this, logger);
  }

  async start() {
    this.logger.info('Starting Plugin Manager');

    // 启动所有启用的 MCP
    const mcpsConfig = this.config.get('mcps', {});
    for (const [name, mcpConfig] of Object.entries(mcpsConfig)) {
      if (!mcpConfig.enabled) {
        this.logger.info(`Skipping disabled MCP: ${name}`);
        continue;
      }

      try {
        await this.addMCP(name, mcpConfig);
      } catch (err) {
        this.logger.error(`Failed to start MCP ${name}: ${err.message}`);
      }
    }

    // 构建路由表
    this.router.buildRoutingTable(this.mcps);

    // 启动健康监控
    this.healthMonitor.start();

    this.logger.info('Plugin Manager started successfully');
  }

  async stop() {
    this.logger.info('Stopping Plugin Manager');

    this.healthMonitor.stop();

    for (const [name, adapter] of this.mcps.entries()) {
      try {
        await adapter.stop();
      } catch (err) {
        this.logger.error(`Error stopping ${name}: ${err.message}`);
      }
    }

    this.mcps.clear();
  }

  async addMCP(name, mcpConfig) {
    if (this.mcps.has(name)) {
      throw new Error(`MCP ${name} already exists`);
    }

    let adapter;
    if (mcpConfig.type === 'stdio') {
      adapter = new StdioAdapter(name, mcpConfig, this.logger);
    } else if (mcpConfig.type === 'http') {
      adapter = new HTTPAdapter(name, mcpConfig, this.logger);
    } else {
      throw new Error(`Unknown MCP type: ${mcpConfig.type}`);
    }

    await adapter.start();
    this.mcps.set(name, adapter);

    // 重新构建路由表
    this.router.buildRoutingTable(this.mcps);

    return adapter;
  }

  async removeMCP(name) {
    const adapter = this.mcps.get(name);
    if (!adapter) {
      throw new Error(`MCP ${name} not found`);
    }

    await adapter.stop();
    this.mcps.delete(name);

    // 重新构建路由表
    this.router.buildRoutingTable(this.mcps);
  }

  async restartMCP(name) {
    const adapter = this.mcps.get(name);
    if (!adapter) {
      throw new Error(`MCP ${name} not found`);
    }

    await adapter.restart();

    // 重新构建路由表
    this.router.buildRoutingTable(this.mcps);
  }

  // 聚合所有 MCP 的工具
  async listTools() {
    const allTools = [];
    for (const adapter of this.mcps.values()) {
      if (adapter.status === 'running') {
        allTools.push(...adapter.tools);
      }
    }
    return allTools;
  }

  // 路由工具调用
  async callTool(name, args) {
    const mcpName = this.router.findMCPForTool(name);
    if (!mcpName) {
      throw new Error(`Tool ${name} not found`);
    }

    const adapter = this.mcps.get(mcpName);
    if (!adapter || adapter.status !== 'running') {
      throw new Error(`MCP ${mcpName} not available`);
    }

    return await adapter.callTool(name, args);
  }

  // 聚合所有 MCP 的资源
  async listResources() {
    const allResources = [];
    for (const adapter of this.mcps.values()) {
      if (adapter.status === 'running') {
        allResources.push(...adapter.resources);
      }
    }
    return allResources;
  }

  // 路由资源读取
  async readResource(uri) {
    const mcpName = this.router.findMCPForResource(uri);
    if (!mcpName) {
      throw new Error(`No MCP found for resource ${uri}`);
    }

    const adapter = this.mcps.get(mcpName);
    if (!adapter || adapter.status !== 'running') {
      throw new Error(`MCP ${mcpName} not available`);
    }

    return await adapter.readResource(uri);
  }

  // 聚合所有 MCP 的 prompts
  async listPrompts() {
    const allPrompts = [];
    for (const adapter of this.mcps.values()) {
      if (adapter.status === 'running') {
        allPrompts.push(...adapter.prompts);
      }
    }
    return allPrompts;
  }

  // 路由 prompt 获取
  async getPrompt(name, args) {
    const mcpName = this.router.findMCPForPrompt(name);
    if (!mcpName) {
      throw new Error(`Prompt ${name} not found`);
    }

    const adapter = this.mcps.get(mcpName);
    if (!adapter || adapter.status !== 'running') {
      throw new Error(`MCP ${mcpName} not available`);
    }

    return await adapter.getPrompt(name, args);
  }

  getStatus() {
    const mcpStatus = {};
    for (const [name, adapter] of this.mcps.entries()) {
      mcpStatus[name] = adapter.getStatus();
    }

    return {
      mcps: mcpStatus,
      routing: this.router.getStats(),
      totalTools: this.router.toolMap.size,
      totalResources: this.router.resourceMap.size,
      totalPrompts: this.router.promptMap.size
    };
  }
}

module.exports = PluginManager;
