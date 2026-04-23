const axios = require('axios');
const MCPAdapter = require('./mcp-adapter');

class HTTPAdapter extends MCPAdapter {
  constructor(name, config, logger) {
    super(name, config, logger);

    // Parse baseUrl to extract query parameters (like tokens)
    const url = new URL(config.baseUrl);
    this.baseUrl = url.origin + url.pathname;
    this.queryParams = url.search; // Preserves ?token=xxx

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: config.timeout || 10000,
      headers: config.headers || {}
    });
  }

  async start() {
    this.status = 'starting';
    this.logger.info(`Connecting to HTTP MCP ${this.name}: ${this.config.baseUrl}`);

    try {
      await this.discoverCapabilities();
      this.status = 'running';
      this.logger.info(`HTTP MCP ${this.name} connected successfully`);
    } catch (err) {
      this.logger.error(`Failed to connect to HTTP MCP ${this.name}: ${err.message}`);
      this.status = 'failed';
      this.lastError = err.message;
      throw err;
    }
  }

  async stop() {
    this.status = 'stopped';
    this.logger.info(`Disconnected from HTTP MCP ${this.name}`);
  }

  async sendRequest(method, params = {}) {
    try {
      // Append query params (like token) to the request URL
      const url = '/' + this.queryParams;

      const response = await this.client.post(url, {
        jsonrpc: '2.0',
        id: Date.now(),
        method,
        params
      });

      if (response.data.error) {
        throw new Error(response.data.error.message || 'Unknown error');
      }

      return response.data.result;
    } catch (err) {
      if (err.response) {
        throw new Error(`HTTP ${err.response.status}: ${err.response.statusText}`);
      }
      throw err;
    }
  }

  async discoverCapabilities() {
    try {
      const toolsResult = await this.sendRequest('tools/list');
      this.tools = toolsResult.tools || [];

      try {
        const resourcesResult = await this.sendRequest('resources/list');
        this.resources = resourcesResult.resources || [];
      } catch (err) {
        this.resources = [];
      }

      try {
        const promptsResult = await this.sendRequest('prompts/list');
        this.prompts = promptsResult.prompts || [];
      } catch (err) {
        this.prompts = [];
      }

      this.logger.info(`HTTP MCP ${this.name} capabilities: ${this.tools.length} tools, ${this.resources.length} resources, ${this.prompts.length} prompts`);
    } catch (err) {
      this.logger.warn(`Failed to discover capabilities for ${this.name}: ${err.message}`);
    }
  }

  async listTools() {
    return this.tools;
  }

  async callTool(name, args) {
    return await this.sendRequest('tools/call', { name, arguments: args });
  }

  async listResources() {
    return this.resources;
  }

  async readResource(uri) {
    return await this.sendRequest('resources/read', { uri });
  }

  async listPrompts() {
    return this.prompts;
  }

  async getPrompt(name, args) {
    return await this.sendRequest('prompts/get', { name, arguments: args });
  }

  async healthCheck() {
    if (this.config.healthCheck?.endpoint) {
      try {
        const url = this.config.healthCheck.endpoint + this.queryParams;
        const response = await this.client.get(url);
        return response.status === 200;
      } catch (err) {
        return false;
      }
    }

    // 默认使用 tools/list 检查
    try {
      await this.sendRequest('tools/list');
      return true;
    } catch (err) {
      this.logger.warn(`Health check failed for ${this.name}: ${err.message}`);
      return false;
    }
  }
}

module.exports = HTTPAdapter;
