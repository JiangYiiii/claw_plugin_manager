const express = require('express');

class MCPHTTPServer {
  constructor(pluginManager, logger, port = 8090) {
    this.pluginManager = pluginManager;
    this.logger = logger;
    this.port = port;
    this.app = express();
    this.server = null;

    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(express.json());

    // CORS support
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

      if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
      }
      next();
    });

    // Request logging
    this.app.use((req, res, next) => {
      this.logger.debug(`HTTP MCP Request: ${req.method} ${req.url}`);
      next();
    });
  }

  setupRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', service: 'openclaw-plugin-manager-mcp' });
    });

    // MCP JSON-RPC endpoint
    this.app.post('/', async (req, res) => {
      try {
        const request = req.body;

        if (!request.jsonrpc || request.jsonrpc !== '2.0') {
          return res.status(400).json({
            jsonrpc: '2.0',
            id: request.id || null,
            error: {
              code: -32600,
              message: 'Invalid Request: jsonrpc version must be 2.0'
            }
          });
        }

        const response = await this.handleRequest(request);
        res.json(response);
      } catch (err) {
        this.logger.error(`HTTP MCP error: ${err.message}`);
        res.status(500).json({
          jsonrpc: '2.0',
          id: req.body.id || null,
          error: {
            code: -32603,
            message: `Internal error: ${err.message}`
          }
        });
      }
    });

    // Alternative endpoint for compatibility
    this.app.post('/mcp', async (req, res) => {
      req.url = '/';
      this.app._router.handle(req, res);
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
          this.logger.info('MCP HTTP client initialized');
          break;

        case 'tools/list':
          const tools = await this.pluginManager.listTools();
          result = { tools };
          this.logger.info(`Listed ${tools.length} tools via HTTP MCP`);
          break;

        case 'tools/call':
          if (!params || !params.name) {
            throw new Error('Missing required parameter: name');
          }
          result = await this.pluginManager.callTool(params.name, params.arguments || {});
          this.logger.info(`Called tool ${params.name} via HTTP MCP`);
          break;

        case 'resources/list':
          const resources = await this.pluginManager.listResources();
          result = { resources };
          break;

        case 'resources/read':
          if (!params || !params.uri) {
            throw new Error('Missing required parameter: uri');
          }
          result = await this.pluginManager.readResource(params.uri);
          break;

        case 'prompts/list':
          const prompts = await this.pluginManager.listPrompts();
          result = { prompts };
          break;

        case 'prompts/get':
          if (!params || !params.name) {
            throw new Error('Missing required parameter: name');
          }
          result = await this.pluginManager.getPrompt(params.name, params.arguments || {});
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
      this.logger.error(`Error handling ${method}: ${err.message}`);
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

  start() {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.port, () => {
          this.logger.info(`MCP HTTP server listening on port ${this.port}`);
          this.logger.info(`MCP endpoint: http://0.0.0.0:${this.port}/`);
          resolve();
        });

        this.server.on('error', (err) => {
          this.logger.error(`Failed to start MCP HTTP server: ${err.message}`);
          reject(err);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  stop() {
    if (this.server) {
      this.server.close(() => {
        this.logger.info('MCP HTTP server stopped');
      });
    }
  }
}

module.exports = MCPHTTPServer;
