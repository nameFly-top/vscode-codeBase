const path = require('path');
const fs = require('fs-extra');

class Config {
    constructor(userConfig = {}) {
        try {
            this.configModule = this._loadConfigModule();
            this.config = this._mergeConfigs(userConfig);
        } catch (error) {
            console.error('❌ Config 类初始化失败:', error.message);
            throw error;
        }
    }

    _loadConfigModule() {
        try {
            const configModule = require('../config/config');
            return configModule;
        } catch (error) {
            console.error('❌ 致命错误：无法加载配置模块:', error.message);
            throw new Error(
                `配置模块加载失败: ${error.message}。请检查 config/config.js 文件是否存在且格式正确。`
            );
        }
    }

    _mergeConfigs(userConfig) {
        // 获取配置的所有数据
        const baseConfig = this.configModule.getAll();

        // 合并用户配置
        const mergedConfig = {
            ...baseConfig,
            ...userConfig,
        };

        return mergedConfig;
    }

    get(key) {
        return this.config[key];
    }

    set(key, value) {
        this.config[key] = value;
    }

    getAll() {
        return this.config;
    }

    // 新增：获取应用配置的便捷方法
    getApplication() {
        return this.configModule.getApplication();
    }

    // 新增：获取VectorManager配置的便捷方法
    getVectorManager() {
        return this.configModule.getVectorManager();
    }

    // 新增：获取API配置的便捷方法
    getApiConfig(env) {
        return this.configModule.getEnvironment(env);
    }

    // 新增：获取API URL的便捷方法
    getApiUrl(endpoint = 'embed', env) {
        return this.configModule.getApiUrl(env, endpoint);
    }

    // 新增：验证配置
    validate(env) {
        return this.configModule.validate(env);
    }

    // 新增：获取配置摘要（用于调试）
    getConfigSummary() {
        const configSummary = this.configModule.getConfigSummary();
        return {
            ...configSummary,
            hasConfigModule: true,
            configKeys: Object.keys(this.config),
            mergedConfigSize: Object.keys(this.config).length,
        };
    }

    // 向后兼容：保持旧的API
    getEnvironment(env) {
        return this.getApiConfig(env);
    }
}

module.exports = new Config();
