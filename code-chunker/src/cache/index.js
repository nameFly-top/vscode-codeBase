const IndexCache = require('./IndexCache');
const CacheDatabase = require('./CacheDatabase');
const CachedAstParser = require('./CachedAstParser');

/**
 * 缓存系统主入口
 * 提供统一的缓存功能接口
 */

// 导出缓存相关类
module.exports = {
    IndexCache,
    CacheDatabase,
    CachedAstParser,
    
    /**
     * 创建默认配置的缓存系统
     * @param {Object} config 缓存配置
     * @returns {Object} 缓存系统实例
     */
    createCacheSystem(config = {}) {
        const defaultConfig = {
            // 数据库配置
            dbPath: config.dbPath || './cache/index.db',
            maxSizeMB: config.maxSizeMB || 500,
            maxEntries: config.maxEntries || 10000,
            ttlHours: config.ttlHours || 24 * 7, // 7天
            
            // 功能配置
            enableCompression: config.enableCompression !== false,
            verbose: config.verbose || false,
            
            // 性能配置
            batchSize: config.batchSize || 100,
            cleanupInterval: config.cleanupInterval || 60 * 60 * 1000, // 1小时
            
            ...config
        };
        
        const cache = new IndexCache(defaultConfig);
        const parser = new CachedAstParser(defaultConfig);
        
        // 确保parser使用同一个cache实例，以保持统计同步
        parser.cache = cache;
        
        return {
            cache,
            parser,
            config: defaultConfig,
            
            /**
             * 初始化整个缓存系统
             */
            async initialize() {
                await cache.initialize();
                await parser.initialize();
                console.log('[CacheSystem] 缓存系统初始化完成');
            },
            
            /**
             * 获取系统统计信息
             */
            async getSystemStats() {
                const cacheStats = await cache.getStats();
                const parserStats = await parser.getCacheStats();
                
                return {
                    cache: cacheStats,
                    parser: parserStats.parser,
                    database: cacheStats.database, // 添加独立的database统计
                    system: {
                        config: defaultConfig,
                        uptime: process.uptime(),
                        memoryUsage: process.memoryUsage()
                    }
                };
            },
            
            /**
             * 执行系统维护
             */
            async performMaintenance() {
                console.log('[CacheSystem] 开始系统维护...');
                
                await cache.cleanExpiredEntries();
                await cache.enforceStorageLimits();
                
                console.log('[CacheSystem] 系统维护完成');
            },
            
            /**
             * 关闭缓存系统
             */
            async shutdown() {
                await parser.shutdown();
                await cache.shutdown();
                console.log('[CacheSystem] 缓存系统已关闭');
            }
        };
    },
    
    /**
     * 创建快速缓存配置
     * @param {string} mode 模式: 'development', 'production', 'testing'
     * @returns {Object} 预设配置
     */
    createPresetConfig(mode = 'development') {
        const basePresets = {
            development: {
                dbPath: './cache/dev-index.db',
                maxSizeMB: 100,
                maxEntries: 1000,
                ttlHours: 24,
                enableCompression: false,
                verbose: true
            },
            
            production: {
                dbPath: './cache/prod-index.db',
                maxSizeMB: 1000,
                maxEntries: 50000,
                ttlHours: 24 * 7,
                enableCompression: true,
                verbose: false
            },
            
            testing: {
                dbPath: ':memory:', // 内存数据库
                maxSizeMB: 50,
                maxEntries: 500,
                ttlHours: 1,
                enableCompression: false,
                verbose: false
            }
        };
        
        const baseConfig = basePresets[mode] || basePresets.development;
        
        // 返回包含cache对象的配置结构
        return {
            ...baseConfig,
            cache: {
                ...baseConfig
            }
        };
    }
}; 