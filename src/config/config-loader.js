const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

class ConfigLoader {
  constructor(configPath) {
    this.configPath = configPath;
    this.config = null;
  }

  load() {
    if (!fs.existsSync(this.configPath)) {
      throw new Error(`Config file not found: ${this.configPath}`);
    }

    const content = fs.readFileSync(this.configPath, 'utf8');
    const config = YAML.parse(content);

    // 环境变量替换
    this.config = this.replaceEnvVars(config);
    return this.config;
  }

  replaceEnvVars(obj) {
    if (typeof obj === 'string') {
      // 匹配 ${VAR} 或 ${VAR:-default}
      return obj.replace(/\$\{([^:}]+)(?::-(.*?))?\}/g, (match, varName, defaultValue) => {
        return process.env[varName] || defaultValue || '';
      });
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.replaceEnvVars(item));
    }

    if (obj !== null && typeof obj === 'object') {
      const result = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.replaceEnvVars(value);
      }
      return result;
    }

    return obj;
  }

  reload() {
    return this.load();
  }

  get(path, defaultValue) {
    if (!this.config) {
      throw new Error('Config not loaded');
    }

    const keys = path.split('.');
    let value = this.config;

    for (const key of keys) {
      if (value === undefined || value === null) {
        return defaultValue;
      }
      value = value[key];
    }

    return value !== undefined ? value : defaultValue;
  }
}

module.exports = ConfigLoader;
