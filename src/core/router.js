class Router {
  constructor(logger) {
    this.logger = logger;
    this.toolMap = new Map(); // tool name -> mcp name
    this.resourceMap = new Map(); // resource uri pattern -> mcp name
    this.promptMap = new Map(); // prompt name -> mcp name
  }

  buildRoutingTable(mcps) {
    this.toolMap.clear();
    this.resourceMap.clear();
    this.promptMap.clear();

    for (const [mcpName, adapter] of mcps.entries()) {
      if (adapter.status !== 'running') {
        continue;
      }

      // 注册工具路由
      for (const tool of adapter.tools) {
        if (this.toolMap.has(tool.name)) {
          this.logger.warn(`Tool ${tool.name} already registered by ${this.toolMap.get(tool.name)}, overriding with ${mcpName}`);
        }
        this.toolMap.set(tool.name, mcpName);
      }

      // 注册资源路由
      for (const resource of adapter.resources) {
        // 简单按 URI scheme 路由
        const scheme = resource.uri.split(':')[0];
        if (!this.resourceMap.has(scheme)) {
          this.resourceMap.set(scheme, mcpName);
        }
      }

      // 注册 prompt 路由
      for (const prompt of adapter.prompts) {
        if (this.promptMap.has(prompt.name)) {
          this.logger.warn(`Prompt ${prompt.name} already registered by ${this.promptMap.get(prompt.name)}, overriding with ${mcpName}`);
        }
        this.promptMap.set(prompt.name, mcpName);
      }
    }

    this.logger.info(`Routing table built: ${this.toolMap.size} tools, ${this.resourceMap.size} resource schemes, ${this.promptMap.size} prompts`);
  }

  findMCPForTool(toolName) {
    return this.toolMap.get(toolName);
  }

  findMCPForResource(uri) {
    const scheme = uri.split(':')[0];
    return this.resourceMap.get(scheme);
  }

  findMCPForPrompt(promptName) {
    return this.promptMap.get(promptName);
  }

  getStats() {
    return {
      tools: this.toolMap.size,
      resources: this.resourceMap.size,
      prompts: this.promptMap.size
    };
  }
}

module.exports = Router;
