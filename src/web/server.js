const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const path = require('path');

class WebServer {
  constructor(pluginManager, logger, port = 8091) {
    this.pluginManager = pluginManager;
    this.logger = logger;
    this.port = port;
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, 'public')));
  }

  setupRoutes() {
    // 状态接口
    this.app.get('/api/status', (req, res) => {
      res.json(this.pluginManager.getStatus());
    });

    // MCP 列表
    this.app.get('/api/mcps', (req, res) => {
      const mcps = [];
      for (const [name, adapter] of this.pluginManager.mcps.entries()) {
        mcps.push(adapter.getStatus());
      }
      res.json(mcps);
    });

    // MCP 详情
    this.app.get('/api/mcps/:name', (req, res) => {
      const adapter = this.pluginManager.mcps.get(req.params.name);
      if (!adapter) {
        return res.status(404).json({ error: 'MCP not found' });
      }
      res.json(adapter.getStatus());
    });

    // 重启 MCP
    this.app.post('/api/mcps/:name/restart', async (req, res) => {
      try {
        await this.pluginManager.restartMCP(req.params.name);
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // 启用 MCP
    this.app.post('/api/mcps/:name/enable', async (req, res) => {
      const adapter = this.pluginManager.mcps.get(req.params.name);
      if (!adapter) {
        return res.status(404).json({ error: 'MCP not found' });
      }
      adapter.config.enabled = true;
      await adapter.start();
      res.json({ success: true });
    });

    // 禁用 MCP
    this.app.post('/api/mcps/:name/disable', async (req, res) => {
      const adapter = this.pluginManager.mcps.get(req.params.name);
      if (!adapter) {
        return res.status(404).json({ error: 'MCP not found' });
      }
      adapter.config.enabled = false;
      await adapter.stop();
      res.json({ success: true });
    });

    // 健康检查
    this.app.get('/api/health', async (req, res) => {
      const results = await this.pluginManager.healthMonitor.checkAll();
      res.json(results);
    });

    // 配置相关
    this.app.get('/api/config', (req, res) => {
      res.json(this.pluginManager.config.config);
    });

    this.app.post('/api/config/reload', async (req, res) => {
      try {
        this.pluginManager.config.reload();
        res.json({ success: true, message: 'Config reloaded' });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
  }

  start() {
    this.server = this.app.listen(this.port, () => {
      this.logger.info(`Web server started on http://localhost:${this.port}`);
    });

    // WebSocket for real-time logs (future enhancement)
    this.wss = new WebSocket.Server({ server: this.server });
    this.wss.on('connection', (ws) => {
      this.logger.info('WebSocket client connected');
      ws.send(JSON.stringify({ type: 'connected' }));
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
    }
    if (this.wss) {
      this.wss.close();
    }
  }
}

module.exports = WebServer;
