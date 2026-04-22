class HealthMonitor {
  constructor(pluginManager, logger) {
    this.pluginManager = pluginManager;
    this.logger = logger;
    this.intervals = new Map();
  }

  start() {
    this.logger.info('Starting health monitor');

    for (const [name, adapter] of this.pluginManager.mcps.entries()) {
      if (!adapter.config.enabled) {
        continue;
      }

      const interval = adapter.config.healthCheck?.interval || 30;
      const intervalId = setInterval(async () => {
        await this.checkHealth(name, adapter);
      }, interval * 1000);

      this.intervals.set(name, intervalId);
    }
  }

  stop() {
    this.logger.info('Stopping health monitor');
    for (const intervalId of this.intervals.values()) {
      clearInterval(intervalId);
    }
    this.intervals.clear();
  }

  async checkHealth(name, adapter) {
    try {
      const isHealthy = await adapter.healthCheck();

      if (!isHealthy && adapter.status === 'running') {
        this.logger.warn(`Health check failed for ${name}, marking as degraded`);
        adapter.status = 'degraded';

        // 尝试重启
        if (adapter.restartCount < (adapter.config.maxRestarts || 3)) {
          this.logger.info(`Attempting to restart ${name} (${adapter.restartCount + 1}/${adapter.config.maxRestarts || 3})`);
          adapter.restartCount++;

          try {
            await adapter.restart();
            adapter.status = 'running';
            this.logger.info(`Successfully restarted ${name}`);

            // 重新构建路由表
            this.pluginManager.router.buildRoutingTable(this.pluginManager.mcps);
          } catch (err) {
            this.logger.error(`Failed to restart ${name}: ${err.message}`);
            adapter.status = 'failed';
          }
        } else {
          this.logger.error(`${name} exceeded max restart attempts, marking as failed`);
          adapter.status = 'failed';
        }
      } else if (isHealthy && adapter.status === 'degraded') {
        this.logger.info(`${name} recovered`);
        adapter.status = 'running';
        adapter.restartCount = 0;
      }
    } catch (err) {
      this.logger.error(`Health check error for ${name}: ${err.message}`);
    }
  }

  async checkAll() {
    const results = {};
    for (const [name, adapter] of this.pluginManager.mcps.entries()) {
      results[name] = await adapter.healthCheck();
    }
    return results;
  }
}

module.exports = HealthMonitor;
