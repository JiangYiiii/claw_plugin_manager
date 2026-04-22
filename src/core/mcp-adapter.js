// MCP 适配器基类
class MCPAdapter {
  constructor(name, config, logger) {
    this.name = name;
    this.config = config;
    this.logger = logger;
    this.status = 'stopped'; // stopped | starting | running | degraded | failed
    this.tools = [];
    this.resources = [];
    this.prompts = [];
    this.restartCount = 0;
    this.lastError = null;
  }

  async start() {
    throw new Error('start() must be implemented');
  }

  async stop() {
    throw new Error('stop() must be implemented');
  }

  async restart() {
    await this.stop();
    await new Promise(resolve => setTimeout(resolve, this.config.restartDelay * 1000 || 5000));
    await this.start();
  }

  async listTools() {
    throw new Error('listTools() must be implemented');
  }

  async callTool(name, args) {
    throw new Error('callTool() must be implemented');
  }

  async listResources() {
    return [];
  }

  async readResource(uri) {
    throw new Error('readResource() not implemented');
  }

  async listPrompts() {
    return [];
  }

  async getPrompt(name, args) {
    throw new Error('getPrompt() not implemented');
  }

  async healthCheck() {
    throw new Error('healthCheck() must be implemented');
  }

  getStatus() {
    return {
      name: this.name,
      type: this.config.type,
      status: this.status,
      enabled: this.config.enabled,
      tools: this.tools.length,
      resources: this.resources.length,
      restartCount: this.restartCount,
      lastError: this.lastError
    };
  }
}

module.exports = MCPAdapter;
