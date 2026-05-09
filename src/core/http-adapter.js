const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const {
  StreamableHTTPClientTransport,
} = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const {
  SSEClientTransport,
} = require('@modelcontextprotocol/sdk/client/sse.js');

const MCPAdapter = require('./mcp-adapter');

const DEFAULT_TIMEOUT_MS = 10_000;
const CLIENT_INFO = {
  name: 'openclaw-plugin-manager',
  version: '2.0.0',
};

class HTTPAdapter extends MCPAdapter {
  constructor(name, config, logger) {
    super(name, config, logger);

    if (!config.baseUrl && !config.url) {
      throw new Error(
        `HTTP MCP ${name}: must provide baseUrl or url in config`
      );
    }
    this.url = new URL(config.baseUrl || config.url);
    this.timeoutMs = config.timeout || DEFAULT_TIMEOUT_MS;

    this.transportPreference = (
      config.transport || 'auto'
    ).toLowerCase();

    this.client = null;
    this.transport = null;
    this.activeTransportKind = null;
  }

  async start() {
    this.status = 'starting';
    this.logger.info(
      `Connecting to HTTP MCP ${this.name}: ${this.url.href} (transport=${this.transportPreference})`
    );

    try {
      await this.connectWithFallback();
      await this.discoverCapabilities();
      this.status = 'running';
      this.logger.info(
        `HTTP MCP ${this.name} connected via ${this.activeTransportKind}: ${this.tools.length} tools, ${this.resources.length} resources, ${this.prompts.length} prompts`
      );
    } catch (err) {
      this.status = 'failed';
      this.lastError = err.message;
      this.logger.error(
        `Failed to connect to HTTP MCP ${this.name}: ${err.message}`
      );
      await this.safeClose();
      throw err;
    }
  }

  async connectWithFallback() {
    const order = this.resolveTransportOrder();
    let lastErr = null;

    for (const kind of order) {
      try {
        await this.connectAs(kind);
        this.activeTransportKind = kind;
        return;
      } catch (err) {
        lastErr = err;
        const status = this.extractHttpStatus(err);
        this.logger.warn(
          `HTTP MCP ${this.name} transport=${kind} failed: ${err.message}${status ? ` (status=${status})` : ''}`
        );
        await this.safeClose();
        if (!this.shouldFallback(kind, status, order)) {
          break;
        }
      }
    }

    throw lastErr || new Error('All transports failed');
  }

  resolveTransportOrder() {
    switch (this.transportPreference) {
      case 'streamable-http':
      case 'http':
        return ['streamable-http'];
      case 'sse':
        return ['sse'];
      case 'auto':
      default:
        return ['streamable-http', 'sse'];
    }
  }

  shouldFallback(currentKind, status, order) {
    if (currentKind !== 'streamable-http') return false;
    if (!order.includes('sse')) return false;
    if (status === undefined) return true;
    return [404, 405, 406, 415, 501].includes(status);
  }

  extractHttpStatus(err) {
    if (!err) return undefined;
    if (typeof err.code === 'number') return err.code;
    const match = /\b(4\d\d|5\d\d)\b/.exec(err.message || '');
    return match ? Number(match[1]) : undefined;
  }

  async connectAs(kind) {
    const headers = { ...(this.config.headers || {}) };

    let transport;
    if (kind === 'streamable-http') {
      transport = new StreamableHTTPClientTransport(this.url, {
        requestInit: { headers },
      });
    } else if (kind === 'sse') {
      transport = new SSEClientTransport(this.url, {
        requestInit: { headers },
        eventSourceInit: {
          fetch: (input, init = {}) => {
            const merged = {
              ...init,
              headers: { ...(init.headers || {}), ...headers },
            };
            return fetch(input, merged);
          },
        },
      });
    } else {
      throw new Error(`Unknown transport kind: ${kind}`);
    }

    const client = new Client(CLIENT_INFO);

    transport.onerror = (err) => {
      this.logger.warn(
        `HTTP MCP ${this.name} transport error: ${err.message}`
      );
    };
    transport.onclose = () => {
      this.logger.warn(`HTTP MCP ${this.name} transport closed`);
      if (this.status === 'running') {
        this.status = 'degraded';
      }
    };

    await this.withTimeout(
      client.connect(transport),
      this.timeoutMs,
      `connect ${kind}`
    );

    this.client = client;
    this.transport = transport;
  }

  async discoverCapabilities() {
    const caps = this.client.getServerCapabilities() || {};

    if (caps.tools) {
      try {
        const r = await this.withTimeout(
          this.client.listTools(),
          this.timeoutMs,
          'listTools'
        );
        this.tools = r.tools || [];
      } catch (err) {
        this.logger.warn(
          `HTTP MCP ${this.name} listTools failed: ${err.message}`
        );
        this.tools = [];
      }
    } else {
      this.tools = [];
    }

    if (caps.resources) {
      try {
        const r = await this.withTimeout(
          this.client.listResources(),
          this.timeoutMs,
          'listResources'
        );
        this.resources = r.resources || [];
      } catch (err) {
        this.logger.debug(
          `HTTP MCP ${this.name} listResources failed: ${err.message}`
        );
        this.resources = [];
      }
    } else {
      this.resources = [];
    }

    if (caps.prompts) {
      try {
        const r = await this.withTimeout(
          this.client.listPrompts(),
          this.timeoutMs,
          'listPrompts'
        );
        this.prompts = r.prompts || [];
      } catch (err) {
        this.logger.debug(
          `HTTP MCP ${this.name} listPrompts failed: ${err.message}`
        );
        this.prompts = [];
      }
    } else {
      this.prompts = [];
    }
  }

  async listTools() {
    return this.tools;
  }

  async callTool(name, args) {
    if (!this.client) throw new Error(`MCP ${this.name} not connected`);
    return await this.withTimeout(
      this.client.callTool({ name, arguments: args || {} }),
      this.timeoutMs,
      `callTool ${name}`
    );
  }

  async listResources() {
    return this.resources;
  }

  async readResource(uri) {
    if (!this.client) throw new Error(`MCP ${this.name} not connected`);
    return await this.withTimeout(
      this.client.readResource({ uri }),
      this.timeoutMs,
      `readResource ${uri}`
    );
  }

  async listPrompts() {
    return this.prompts;
  }

  async getPrompt(name, args) {
    if (!this.client) throw new Error(`MCP ${this.name} not connected`);
    return await this.withTimeout(
      this.client.getPrompt({ name, arguments: args || {} }),
      this.timeoutMs,
      `getPrompt ${name}`
    );
  }

  async healthCheck() {
    if (!this.client) return false;
    try {
      await this.withTimeout(this.client.ping(), this.timeoutMs, 'ping');
      if (this.status === 'degraded') {
        this.status = 'running';
      }
      return true;
    } catch (err) {
      if (this.isMethodNotFoundError(err)) {
        try {
          await this.withTimeout(
            this.client.listTools(),
            this.timeoutMs,
            'listTools(health)'
          );
          if (this.status === 'degraded') {
            this.status = 'running';
          }
          return true;
        } catch (innerErr) {
          this.logger.warn(
            `Health check failed for ${this.name}: ${innerErr.message}`
          );
          this.status = 'degraded';
          return false;
        }
      }
      this.logger.warn(
        `Health check failed for ${this.name}: ${err.message}`
      );
      this.status = 'degraded';
      return false;
    }
  }

  isMethodNotFoundError(err) {
    if (!err) return false;
    if (err.code === -32601) return true;
    return /-?32601|method not found/i.test(err.message || '');
  }

  async stop() {
    await this.safeClose();
    this.status = 'stopped';
    this.logger.info(`Disconnected from HTTP MCP ${this.name}`);
  }

  async safeClose() {
    if (this.client) {
      try {
        await this.client.close();
      } catch {
      }
    }
    if (this.transport) {
      try {
        await this.transport.close();
      } catch {
      }
    }
    this.client = null;
    this.transport = null;
  }

  withTimeout(promise, ms, label) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(
        () => reject(new Error(`${label} timed out after ${ms}ms`)),
        ms
      );
      Promise.resolve(promise).then(
        (v) => {
          clearTimeout(t);
          resolve(v);
        },
        (err) => {
          clearTimeout(t);
          reject(err);
        }
      );
    });
  }
}

module.exports = HTTPAdapter;
