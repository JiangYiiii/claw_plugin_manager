const express = require('express');
const { randomUUID } = require('node:crypto');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const {
  StreamableHTTPServerTransport,
} = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

const SERVER_INFO = {
  name: 'openclaw-plugin-manager',
  version: '2.0.0',
};

const SERVER_CAPABILITIES = {
  tools: { listChanged: true },
  resources: { listChanged: true },
  prompts: { listChanged: true },
  logging: {},
};

const MCP_SESSION_HEADER = 'mcp-session-id';

class MCPHTTPServer {
  constructor(pluginManager, logger, port = 8090) {
    this.pluginManager = pluginManager;
    this.logger = logger;
    this.port = port;

    this.app = express();
    this.httpServer = null;

    // sessionId -> { server, transport }
    this.sessions = new Map();

    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(
      express.json({
        limit: '10mb',
        type: ['application/json', 'application/json-rpc'],
      })
    );

    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.header(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-Id, Accept'
      );
      res.header('Access-Control-Expose-Headers', 'Mcp-Session-Id');

      if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
      }
      next();
    });

    this.app.use((req, res, next) => {
      if (req.url.startsWith('/mcp')) {
        const sid = req.headers[MCP_SESSION_HEADER];
        this.logger.debug(
          `MCP HTTP ${req.method} ${req.url} session=${sid || 'none'}`
        );
      }
      next();
    });
  }

  setupRoutes() {
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        service: SERVER_INFO.name,
        version: SERVER_INFO.version,
        sessions: this.sessions.size,
        protocol: 'streamable-http',
      });
    });

    this.app.post('/mcp', (req, res) => this.handleMcpRequest(req, res));
    this.app.get('/mcp', (req, res) => this.handleMcpRequest(req, res));
    this.app.delete('/mcp', (req, res) => this.handleMcpRequest(req, res));
  }

  async handleMcpRequest(req, res) {
    try {
      const sessionId = req.headers[MCP_SESSION_HEADER];
      const isInitializeRequest = this.detectInitializeRequest(req);

      let entry;
      if (sessionId && this.sessions.has(sessionId)) {
        entry = this.sessions.get(sessionId);
      } else if (!sessionId && isInitializeRequest && req.method === 'POST') {
        entry = await this.createSession();
      } else {
        const code = sessionId ? 404 : 400;
        const message = sessionId
          ? `Unknown or expired session: ${sessionId}`
          : 'Mcp-Session-Id header is required for non-initialize requests';
        res.status(code).json({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32000, message },
        });
        return;
      }

      await entry.transport.handleRequest(req, res, req.body);
    } catch (err) {
      this.logger.error(`MCP HTTP request failed: ${err.stack || err.message}`);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32603,
            message: `Internal error: ${err.message}`,
          },
        });
      }
    }
  }

  detectInitializeRequest(req) {
    if (req.method !== 'POST') return false;
    const body = req.body;
    if (!body) return false;
    const messages = Array.isArray(body) ? body : [body];
    return messages.some(
      (m) => m && typeof m === 'object' && m.method === 'initialize'
    );
  }

  async createSession() {
    const server = new Server(SERVER_INFO, {
      capabilities: SERVER_CAPABILITIES,
    });

    this.registerHandlers(server);

    const entry = { server, transport: null };

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        this.logger.info(`MCP session initialized: ${sessionId}`);
        this.sessions.set(sessionId, entry);
      },
    });

    entry.transport = transport;

    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid && this.sessions.has(sid)) {
        this.logger.info(`MCP session closed: ${sid}`);
        this.sessions.delete(sid);
      }
    };

    transport.onerror = (err) => {
      this.logger.warn(
        `MCP transport error (session=${transport.sessionId || 'pending'}): ${err.message}`
      );
    };

    await server.connect(transport);

    return entry;
  }

  registerHandlers(server) {
    server.oninitialized = () => {
      const ci = server.getClientVersion();
      this.logger.info(
        `MCP client initialized: ${ci?.name || 'unknown'}@${ci?.version || '?'}`
      );
    };

    server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = await this.pluginManager.listTools();
      return { tools };
    });

    server.setRequestHandler(CallToolRequestSchema, async (req) => {
      const { name, arguments: args } = req.params;
      try {
        const result = await this.pluginManager.callTool(name, args || {});
        return this.normalizeToolResult(result);
      } catch (err) {
        this.logger.warn(`Tool call failed: ${name}: ${err.message}`);
        return {
          isError: true,
          content: [{ type: 'text', text: `Error: ${err.message}` }],
        };
      }
    });

    server.setRequestHandler(ListResourcesRequestSchema, async () => {
      const resources = await this.pluginManager.listResources();
      return { resources };
    });

    server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
      return await this.pluginManager.readResource(req.params.uri);
    });

    server.setRequestHandler(ListPromptsRequestSchema, async () => {
      const prompts = await this.pluginManager.listPrompts();
      return { prompts };
    });

    server.setRequestHandler(GetPromptRequestSchema, async (req) => {
      return await this.pluginManager.getPrompt(
        req.params.name,
        req.params.arguments || {}
      );
    });
  }

  normalizeToolResult(result) {
    if (!result || typeof result !== 'object') {
      return {
        content: [{ type: 'text', text: String(result ?? '') }],
      };
    }
    if (Array.isArray(result.content)) {
      return result;
    }
    return {
      content: [
        { type: 'text', text: JSON.stringify(result, null, 2) },
      ],
    };
  }

  async broadcastToolListChanged() {
    for (const { server } of this.sessions.values()) {
      try {
        await server.sendToolListChanged();
      } catch (err) {
        this.logger.debug(`Failed to send list_changed: ${err.message}`);
      }
    }
  }

  start() {
    return new Promise((resolve, reject) => {
      try {
        this.httpServer = this.app.listen(this.port, () => {
          this.logger.info(
            `MCP HTTP server (Streamable HTTP) listening on port ${this.port}`
          );
          this.logger.info(`MCP endpoint: http://0.0.0.0:${this.port}/mcp`);
          resolve();
        });

        this.httpServer.on('error', (err) => {
          this.logger.error(`Failed to start MCP HTTP server: ${err.message}`);
          reject(err);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  async stop() {
    for (const { transport } of this.sessions.values()) {
      try {
        await transport.close();
      } catch {
      }
    }
    this.sessions.clear();

    if (this.httpServer) {
      await new Promise((resolve) => this.httpServer.close(resolve));
      this.logger.info('MCP HTTP server stopped');
    }
  }
}

module.exports = MCPHTTPServer;
