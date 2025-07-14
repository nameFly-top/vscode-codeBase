const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');
const CacheDatabase = require('./CacheDatabase');
const { performance } = require('perf_hooks');

/**
 * Index缓存管理器
 * 负责管理代码解析结果的缓存，提升重复解析性能
 */
class IndexCache {
    constructor(config = {}) {
        this.config = {
            // 缓存数据库路径
            dbPath: config.dbPath || path.join(process.cwd(), 'cache', 'index.db'),
            // 最大缓存大小 (MB)
            maxSizeMB: config.maxSizeMB || 500,
            // 最大缓存条目数
            maxEntries: config.maxEntries || 10000,
            // 缓存TTL (小时)
            ttlHours: config.ttlHours || 24 * 7, // 7天
            // 是否启用压缩
            enableCompression: config.enableCompression !== false,
            // 是否启用详细日志
            verbose: config.verbose || false,
            ...config
        };
        
        this.database = null;
        this.initialized = false;
        this.stats = {
            hits: 0,
            misses: 0,
            stores: 0,
            evictions: 0,
            errors: 0
        };
        
        this.log('IndexCache创建完成', { config: this.config });
    }
    
    /**
     * 初始化缓存系统
     */
    async initialize() {
        if (this.initialized) {
            return;
        }
        
        try {
            // 确保缓存目录存在
            await fs.ensureDir(path.dirname(this.config.dbPath));
            
            // 初始化数据库
            this.database = new CacheDatabase(this.config.dbPath);
            await this.database.initialize();
            
            // 设置为已初始化状态
            this.initialized = true;
            
            // 清理过期缓存（现在可以安全调用了）
            await this.cleanExpiredEntries();
            
            // 清理超出限制的缓存
            await this.enforceStorageLimits();
            
            this.log('IndexCache初始化成功');
            
        } catch (error) {
            this.initialized = false; // 确保失败时重置状态
            this.error('IndexCache初始化失败:', error);
            throw error;
        }
    }
    
    /**
     * 获取文件的缓存结果
     * @param {string} filePath 文件路径
     * @param {string} fileHash 文件哈希
     * @returns {Object|null} 缓存的解析结果
     */
    async get(filePath, fileHash) {
        this.ensureInitialized();
        
        const startTime = performance.now();
        const cacheKey = this.generateCacheKey(filePath, fileHash);
        
        try {
            const entry = await this.database.getEntry(cacheKey);
            
            if (!entry) {
                this.stats.misses++;
                this.log(`缓存未命中: ${filePath}`);
                return null;
            }
            
            // 检查是否过期
            if (this.isExpired(entry.created_at)) {
                await this.database.deleteEntry(cacheKey);
                this.stats.misses++;
                this.log(`缓存已过期: ${filePath}`);
                return null;
            }
            
            // 更新访问时间
            await this.database.updateLastAccess(cacheKey);
            
            this.stats.hits++;
            const duration = performance.now() - startTime;
            this.log(`缓存命中: ${filePath} (${duration.toFixed(2)}ms)`);
            
            return this.deserializeData(entry.data);
            
        } catch (error) {
            this.stats.errors++;
            this.error('获取缓存失败:', error);
            return null;
        }
    }
    
    /**
     * 存储解析结果到缓存
     * @param {string} filePath 文件路径
     * @param {string} fileHash 文件哈希
     * @param {Object} data 解析结果数据
     */
    async set(filePath, fileHash, data) {
        this.ensureInitialized();
        
        const startTime = performance.now();
        const cacheKey = this.generateCacheKey(filePath, fileHash);
        
        try {
            const serializedData = this.serializeData(data);
            const dataSize = Buffer.byteLength(serializedData, 'utf8');
            
            const entry = {
                cache_key: cacheKey,
                file_path: filePath,
                file_hash: fileHash,
                data: serializedData,
                data_size: dataSize,
                created_at: new Date().toISOString(),
                last_accessed: new Date().toISOString()
            };
            
            await this.database.setEntry(entry);
            
            this.stats.stores++;
            const duration = performance.now() - startTime;
            this.log(`缓存存储: ${filePath} (${this.formatSize(dataSize)}, ${duration.toFixed(2)}ms)`);
            
            // 检查存储限制
            await this.enforceStorageLimits();
            
        } catch (error) {
            this.stats.errors++;
            this.error('存储缓存失败:', error);
        }
    }
    
    /**
     * 检查文件是否有有效缓存
     * @param {string} filePath 文件路径
     * @param {string} fileHash 文件哈希
     * @returns {boolean} 是否有有效缓存
     */
    async has(filePath, fileHash) {
        this.ensureInitialized();
        
        const cacheKey = this.generateCacheKey(filePath, fileHash);
        const entry = await this.database.getEntry(cacheKey);
        
        if (!entry) {
            return false;
        }
        
        if (this.isExpired(entry.created_at)) {
            await this.database.deleteEntry(cacheKey);
            return false;
        }
        
        return true;
    }
    
    /**
     * 删除特定文件的所有缓存
     * @param {string} filePath 文件路径
     */
    async invalidateFile(filePath) {
        this.ensureInitialized();
        
        try {
            const deletedCount = await this.database.deleteByFilePath(filePath);
            this.log(`清理文件缓存: ${filePath} (删除${deletedCount}条记录)`);
            
        } catch (error) {
            this.error('清理文件缓存失败:', error);
        }
    }
    
    /**
     * 批量检查文件缓存状态
     * @param {Array} files 文件列表 [{path, hash}]
     * @returns {Object} 缓存状态统计
     */
    async batchCheck(files) {
        this.ensureInitialized();
        
        const results = {
            cached: [],
            uncached: [],
            expired: []
        };
        
        for (const file of files) {
            const hasCache = await this.has(file.path, file.hash);
            if (hasCache) {
                results.cached.push(file);
            } else {
                results.uncached.push(file);
            }
        }
        
        return results;
    }
    
    /**
     * 获取缓存统计信息
     */
    async getStats() {
        this.ensureInitialized();
        
        const dbStats = await this.database.getStats();
        
        return {
            ...this.stats,
            hitRate: this.stats.hits + this.stats.misses > 0 
                ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(2) + '%'
                : '0%',
            database: dbStats,
            config: this.config
        };
    }
    
    /**
     * 清理过期缓存条目
     */
    async cleanExpiredEntries() {
        this.ensureInitialized();
        
        try {
            const expiredBefore = new Date(Date.now() - this.config.ttlHours * 60 * 60 * 1000).toISOString();
            const deletedCount = await this.database.deleteExpiredEntries(expiredBefore);
            
            if (deletedCount > 0) {
                this.log(`清理过期缓存: 删除${deletedCount}条记录`);
            }
            
        } catch (error) {
            this.error('清理过期缓存失败:', error);
        }
    }
    
    /**
     * 强制执行存储限制
     */
    async enforceStorageLimits() {
        this.ensureInitialized();
        
        try {
            const stats = await this.database.getStats();
            
            // 检查条目数限制
            if (stats.entryCount > this.config.maxEntries) {
                const deleteCount = stats.entryCount - this.config.maxEntries;
                const deletedCount = await this.database.deleteOldestEntries(deleteCount);
                this.stats.evictions += deletedCount;
                this.log(`LRU清理: 删除${deletedCount}条最旧记录`);
            }
            
            // 检查大小限制
            const maxSizeBytes = this.config.maxSizeMB * 1024 * 1024;
            if (stats.totalSize > maxSizeBytes) {
                const targetSize = maxSizeBytes * 0.8; // 清理到80%
                let deletedCount = 0;
                
                while (true) {
                    const currentStats = await this.database.getStats();
                    if (currentStats.totalSize <= targetSize) break;
                    
                    const batchDeleted = await this.database.deleteOldestEntries(100);
                    deletedCount += batchDeleted;
                    
                    if (batchDeleted === 0) break; // 避免无限循环
                }
                
                this.stats.evictions += deletedCount;
                this.log(`大小限制清理: 删除${deletedCount}条记录`);
            }
            
        } catch (error) {
            this.error('执行存储限制失败:', error);
        }
    }
    
    /**
     * 关闭缓存系统
     */
    async shutdown() {
        if (this.database) {
            await this.database.close();
            this.database = null;
        }
        this.initialized = false;
        this.log('IndexCache已关闭');
    }
    
    // ==================== 私有方法 ====================
    
    generateCacheKey(filePath, fileHash) {
        return crypto
            .createHash('md5')
            .update(`${filePath}:${fileHash}`)
            .digest('hex');
    }
    
    serializeData(data) {
        const jsonString = JSON.stringify(data);
        
        if (this.config.enableCompression && jsonString.length > 1024) {
            const zlib = require('zlib');
            return zlib.gzipSync(jsonString).toString('base64');
        }
        
        return jsonString;
    }
    
    deserializeData(serializedData) {
        try {
            // 检查是否是压缩数据（base64格式）
            if (this.config.enableCompression && !serializedData.startsWith('{') && !serializedData.startsWith('[')) {
                const zlib = require('zlib');
                const compressed = Buffer.from(serializedData, 'base64');
                const decompressed = zlib.gunzipSync(compressed).toString('utf8');
                return JSON.parse(decompressed);
            }
            
            return JSON.parse(serializedData);
            
        } catch (error) {
            this.error('反序列化数据失败:', error);
            return null;
        }
    }
    
    isExpired(createdAt) {
        const created = new Date(createdAt);
        const now = new Date();
        const diffHours = (now - created) / (1000 * 60 * 60);
        return diffHours > this.config.ttlHours;
    }
    
    ensureInitialized() {
        if (!this.initialized) {
            throw new Error('IndexCache未初始化，请先调用initialize()');
        }
    }
    
    formatSize(bytes) {
        if (bytes < 1024) return bytes + 'B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
        return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
    }
    
    log(message, data = null) {
        if (this.config.verbose) {
            console.log(`[IndexCache] ${message}`, data || '');
        }
    }
    
    error(message, error) {
        console.error(`[IndexCache] ${message}`, error);
    }
}

module.exports = IndexCache; 