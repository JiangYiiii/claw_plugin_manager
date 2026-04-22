const { spawn } = require('child_process');
const MCPAdapter = require('./mcp-adapter');
const readline = require('readline');

class StdioAdapter extends MCPAdapter {
  constructor(name, config, logger) {
    super(name, config, logger);
    this.process = null;
    this.messageQueue = [];
    this.pendingRequests = new Map();
    this.requestId = 0;
  }

  async start() {
    if (this.process) {
      this.logger.warn(`MCP ${this.name} already running`);
      return;
    }

    this.status = 'starting';
    this.logger.info(`Starting MCP ${this.name}: ${this.config.command} ${this.config.args.join(' ')}`);

    try {
      this.process = spawn(this.config.command, this.config.args, {
        env: { ...process.env, ...this.config.env },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      const rl = readline.createInterface({
        input: this.process.stdout,
        crlfDelay: Infinity
      });

      rl.on('line', (line) => {
        try {
          const message = JSON.parse(line);
          this.handleMessage(message);
        } catch (err) {
          this.logger.debug(`MCP ${this.name} non-JSON output: ${line}`);
        }
      });

      this.process.stderr.on('data', (data) => {
        this.logger.debug(`MCP ${this.name} stderr: ${data.toString()}`);
      });

      this.process.on('exit', (code) => {
        this.logger.warn(`MCP ${this.name} exited with code ${code}`);
        this.status = 'stopped';
        this.process = null;
        if (code !== 0 && code !== null) {
          this.lastError = `Process exited with code ${code}`;
        }
      });

      this.process.on('error', (err) => {
        this.logger.error(`MCP ${this.name} error: ${err.message}`);
        this.lastError = err.message;
        this.status = 'failed';
      });

      // 等待进程启动
      await new Promise(resolve => setTimeout(resolve, 1000));

      // 初始化：获取能力
      await this.discoverCapabilities();

      this.status = 'running';
      this.logger.info(`MCP ${this.name} started successfully`);
    } catch (err) {
      this.logger.error(`Failed to start MCP ${this.name}: ${err.message}`);
      this.status = 'failed';
      this.lastError = err.message;
      throw err;
    }
  }

  async stop() {
    if (!this.process) {
      return;
    }

    this.logger.info(`Stopping MCP ${this.name}`);
    this.process.kill();
    this.process = null;
    this.status = 'stopped';
  }

  async sendRequest(method, params = {}) {
    if (!this.process) {
      throw new Error(`MCP ${this.name} not running`);
    }

    const id = ++this.requestId;
    const request = {
      jsonrpc: '2.0',
      id,
      method,
      params
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      this.process.stdin.write(JSON.stringify(request) + '\n');

      // 超时处理
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request timeout: ${method}`));
        }
      }, 30000);
    });
  }

  handleMessage(message) {
    if (message.id && this.pendingRequests.has(message.id)) {
      const { resolve, reject } = this.pendingRequests.get(message.id);
      this.pendingRequests.delete(message.id);

      if (message.error) {
        reject(new Error(message.error.message || 'Unknown error'));
      } else {
        resolve(message.result);
      }
    }
  }

  async discoverCapabilities() {
    try {
      // 查询工具列表
      const toolsResult = await this.sendRequest('tools/list');
      this.tools = toolsResult.tools || [];

      // 查询资源列表
      try {
        const resourcesResult = await this.sendRequest('resources/list');
        this.resources = resourcesResult.resources || [];
      } catch (err) {
        // 有些 MCP 不支持 resources
        this.resources = [];
      }

      // 查询 prompts 列表
      try {
        const promptsResult = await this.sendRequest('prompts/list');
        this.prompts = promptsResult.prompts || [];
      } catch (err) {
        this.prompts = [];
      }

      this.logger.info(`MCP ${this.name} capabilities: ${this.tools.length} tools, ${this.resources.length} resources, ${this.prompts.length} prompts`);
    } catch (err) {
      this.logger.warn(`Failed to discover capabilities for ${this.name}: ${err.message}`);
      this.lastError = `Failed to discover capabilities: ${err.message}`;
    }
  }

  async listTools() {
    return this.tools;
  }

  async callTool(name, args) {
    const result = await this.sendRequest('tools/call', { name, arguments: args });
    return result;
  }

  async listResources() {
    return this.resources;
  }

  async readResource(uri) {
    const result = await this.sendRequest('resources/read', { uri });
    return result;
  }

  async listPrompts() {
    return this.prompts;
  }

  async getPrompt(name, args) {
    const result = await this.sendRequest('prompts/get', { name, arguments: args });
    return result;
  }

  async healthCheck() {
    if (!this.process || this.process.killed) {
      return false;
    }

    try {
      // 尝试调用 tools/list 检查响应
      await this.sendRequest('tools/list');
      return true;
    } catch (err) {
      this.logger.warn(`Health check failed for ${this.name}: ${err.message}`);
      return false;
    }
  }
}

module.exports = StdioAdapter;
