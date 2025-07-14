const sqlite3 = require('sqlite3').verbose();
const { promisify } = require('util');

/**
 * 缓存数据库操作类
 * 使用SQLite存储和管理缓存数据
 */
class CacheDatabase {
    constructor(dbPath) {
        this.dbPath = dbPath;
        this.db = null;
    }
    
    /**
     * 初始化数据库
     */
    async initialize() {
        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                
                // 创建表结构
                this.createTables()
                    .then(() => {
                        // 创建索引
                        return this.createIndexes();
                    })
                    .then(() => {
                        console.log(`[CacheDatabase] 数据库初始化成功: ${this.dbPath}`);
                        resolve();
                    })
                    .catch(reject);
            });
        });
    }
    
    /**
     * 创建数据表
     */
    async createTables() {
        const createTableSQL = `
            CREATE TABLE IF NOT EXISTS cache_entries (
                cache_key TEXT PRIMARY KEY,
                file_path TEXT NOT NULL,
                file_hash TEXT NOT NULL,
                data TEXT NOT NULL,
                data_size INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                last_accessed TEXT NOT NULL
            )
        `;
        
        return this.runAsync(createTableSQL);
    }
    
    /**
     * 创建索引
     */
    async createIndexes() {
        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_file_path ON cache_entries(file_path)',
            'CREATE INDEX IF NOT EXISTS idx_file_hash ON cache_entries(file_hash)',
            'CREATE INDEX IF NOT EXISTS idx_created_at ON cache_entries(created_at)',
            'CREATE INDEX IF NOT EXISTS idx_last_accessed ON cache_entries(last_accessed)',
            'CREATE INDEX IF NOT EXISTS idx_data_size ON cache_entries(data_size)'
        ];
        
        for (const indexSQL of indexes) {
            await this.runAsync(indexSQL);
        }
    }
    
    /**
     * 获取缓存条目
     * @param {string} cacheKey 缓存键
     * @returns {Object|null} 缓存条目
     */
    async getEntry(cacheKey) {
        const sql = 'SELECT * FROM cache_entries WHERE cache_key = ?';
        return this.getAsync(sql, [cacheKey]);
    }
    
    /**
     * 设置缓存条目
     * @param {Object} entry 缓存条目对象
     */
    async setEntry(entry) {
        const sql = `
            INSERT OR REPLACE INTO cache_entries 
            (cache_key, file_path, file_hash, data, data_size, created_at, last_accessed)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;
        
        const params = [
            entry.cache_key,
            entry.file_path,
            entry.file_hash,
            entry.data,
            entry.data_size,
            entry.created_at,
            entry.last_accessed
        ];
        
        return this.runAsync(sql, params);
    }
    
    /**
     * 删除缓存条目
     * @param {string} cacheKey 缓存键
     */
    async deleteEntry(cacheKey) {
        const sql = 'DELETE FROM cache_entries WHERE cache_key = ?';
        const result = await this.runAsync(sql, [cacheKey]);
        return result.changes;
    }
    
    /**
     * 根据文件路径删除所有相关缓存
     * @param {string} filePath 文件路径
     * @returns {number} 删除的记录数
     */
    async deleteByFilePath(filePath) {
        const sql = 'DELETE FROM cache_entries WHERE file_path = ?';
        const result = await this.runAsync(sql, [filePath]);
        return result.changes;
    }
    
    /**
     * 删除过期的缓存条目
     * @param {string} expiredBefore ISO时间字符串
     * @returns {number} 删除的记录数
     */
    async deleteExpiredEntries(expiredBefore) {
        const sql = 'DELETE FROM cache_entries WHERE created_at < ?';
        const result = await this.runAsync(sql, [expiredBefore]);
        return result.changes;
    }
    
    /**
     * 删除最旧的缓存条目（LRU策略）
     * @param {number} count 要删除的数量
     * @returns {number} 实际删除的记录数
     */
    async deleteOldestEntries(count) {
        const sql = `
            DELETE FROM cache_entries 
            WHERE cache_key IN (
                SELECT cache_key FROM cache_entries 
                ORDER BY last_accessed ASC 
                LIMIT ?
            )
        `;
        const result = await this.runAsync(sql, [count]);
        return result.changes;
    }
    
    /**
     * 更新最后访问时间
     * @param {string} cacheKey 缓存键
     */
    async updateLastAccess(cacheKey) {
        const sql = 'UPDATE cache_entries SET last_accessed = ? WHERE cache_key = ?';
        const now = new Date().toISOString();
        return this.runAsync(sql, [now, cacheKey]);
    }
    
    /**
     * 获取数据库统计信息
     * @returns {Object} 统计信息
     */
    async getStats() {
        const queries = {
            entryCount: 'SELECT COUNT(*) as count FROM cache_entries',
            totalSize: 'SELECT SUM(data_size) as total FROM cache_entries',
            oldestEntry: 'SELECT MIN(created_at) as oldest FROM cache_entries',
            newestEntry: 'SELECT MAX(created_at) as newest FROM cache_entries',
            avgSize: 'SELECT AVG(data_size) as avg FROM cache_entries'
        };
        
        const results = {};
        
        for (const [key, sql] of Object.entries(queries)) {
            try {
                const result = await this.getAsync(sql);
                switch (key) {
                    case 'entryCount':
                        results[key] = result.count || 0;
                        break;
                    case 'totalSize':
                        results[key] = result.total || 0;
                        break;
                    case 'avgSize':
                        results[key] = Math.round(result.avg || 0);
                        break;
                    case 'oldestEntry':
                    case 'newestEntry':
                        results[key] = result[key === 'oldestEntry' ? 'oldest' : 'newest'];
                        break;
                }
            } catch (error) {
                results[key] = null;
            }
        }
        
        return results;
    }
    
    /**
     * 获取文件路径的缓存统计
     * @param {Array} filePaths 文件路径列表
     * @returns {Object} 文件缓存统计
     */
    async getFileStats(filePaths) {
        if (!filePaths || filePaths.length === 0) {
            return {};
        }
        
        const placeholders = filePaths.map(() => '?').join(',');
        const sql = `
            SELECT 
                file_path,
                COUNT(*) as cache_count,
                SUM(data_size) as total_size,
                MAX(created_at) as latest_cache
            FROM cache_entries 
            WHERE file_path IN (${placeholders})
            GROUP BY file_path
        `;
        
        const results = await this.allAsync(sql, filePaths);
        
        const stats = {};
        results.forEach(row => {
            stats[row.file_path] = {
                cacheCount: row.cache_count,
                totalSize: row.total_size,
                latestCache: row.latest_cache
            };
        });
        
        return stats;
    }
    
    /**
     * 清空所有缓存
     */
    async clearAll() {
        const sql = 'DELETE FROM cache_entries';
        const result = await this.runAsync(sql);
        return result.changes;
    }
    
    /**
     * 获取缓存大小排行榜
     * @param {number} limit 限制数量
     * @returns {Array} 排行榜数据
     */
    async getTopSizeEntries(limit = 10) {
        const sql = `
            SELECT file_path, file_hash, data_size, created_at
            FROM cache_entries 
            ORDER BY data_size DESC 
            LIMIT ?
        `;
        return this.allAsync(sql, [limit]);
    }
    
    /**
     * 获取最近访问的缓存
     * @param {number} limit 限制数量
     * @returns {Array} 最近访问的缓存列表
     */
    async getRecentlyAccessed(limit = 10) {
        const sql = `
            SELECT file_path, file_hash, data_size, last_accessed
            FROM cache_entries 
            ORDER BY last_accessed DESC 
            LIMIT ?
        `;
        return this.allAsync(sql, [limit]);
    }
    
    /**
     * 数据库健康检查
     * @returns {Object} 健康状态
     */
    async healthCheck() {
        try {
            const stats = await this.getStats();
            const recentCount = await this.getAsync(
                'SELECT COUNT(*) as count FROM cache_entries WHERE created_at > ?',
                [new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()]
            );
            
            return {
                status: 'healthy',
                totalEntries: stats.entryCount,
                totalSize: stats.totalSize,
                recentEntries: recentCount.count,
                oldestEntry: stats.oldestEntry,
                newestEntry: stats.newestEntry
            };
        } catch (error) {
            return {
                status: 'error',
                error: error.message
            };
        }
    }
    
    /**
     * 关闭数据库连接
     */
    async close() {
        if (this.db) {
            return new Promise((resolve) => {
                this.db.close((err) => {
                    if (err) {
                        console.error('[CacheDatabase] 关闭数据库时出错:', err);
                    } else {
                        console.log('[CacheDatabase] 数据库连接已关闭');
                    }
                    resolve();
                });
            });
        }
    }
    
    // ==================== 私有辅助方法 ====================
    
    /**
     * 包装db.run为Promise
     */
    runAsync(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ lastID: this.lastID, changes: this.changes });
                }
            });
        });
    }
    
    /**
     * 包装db.get为Promise
     */
    getAsync(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }
    
    /**
     * 包装db.all为Promise
     */
    allAsync(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows || []);
                }
            });
        });
    }
}

module.exports = CacheDatabase; 