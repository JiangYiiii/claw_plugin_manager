const readline = require('readline');

class MCPServer {
  constructor(pluginManager, logger) {
    this.pluginManager = pluginManager;
    this.logger = logger;
  }

  start() {
    this.logger.info('Starting MCP stdio server');

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false
    });

    rl.on('line', async (line) => {
      try {
        const request = JSON.parse(line);
        const response = await this.handleRequest(request);
        this.sendResponse(response);
      } catch (err) {
        this.logger.error(`Error handling request: ${err.message}`);
        this.sendResponse({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32603,
            message: err.message
          }
        });
      }
    });

    rl.on('close', () => {
      this.logger.info('MCP stdio server closed');
      process.exit(0);
    });
  }

  async handleRequest(request) {
    const { id, method, params } = request;

    try {
      let result;

      switch (method) {
        case 'initialize':
          result = {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
              resources: {},
              prompts: {}
            },
            serverInfo: {
              name: 'openclaw-plugin-manager',
              version: '1.0.0'
            }
          };
          break;

        case 'tools/list':
          const tools = await this.pluginManager.listTools();
          result = { tools };
          break;

        case 'tools/call':
          result = await this.pluginManager.callTool(params.name, params.arguments);
          break;

        case 'resources/list':
          const resources = await this.pluginManager.listResources();
          result = { resources };
          break;

        case 'resources/read':
          result = await this.pluginManager.readResource(params.uri);
          break;

        case 'prompts/list':
          const prompts = await this.pluginManager.listPrompts();
          result = { prompts };
          break;

        case 'prompts/get':
          result = await this.pluginManager.getPrompt(params.name, params.arguments);
          break;

        default:
          throw new Error(`Unknown method: ${method}`);
      }

      return {
        jsonrpc: '2.0',
        id,
        result
      };
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message: err.message
        }
      };
    }
  }

  sendResponse(response) {
    console.log(JSON.stringify(response));
  }
}

module.exports = MCPServer;
