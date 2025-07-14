import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as zlib from 'zlib';

interface IndexedFileRecord {
    filePath: string;
    fileHash: string;
    indexedAt: number;
    workspacePath: string;
    userId: string;
    deviceId: string;
    lastAccessed?: number; // 新增：最后访问时间
    accessCount?: number; // 新增：访问次数
}

interface IndexCacheData {
    version: string;
    records: IndexedFileRecord[];
    lastUpdated: number;
    lastCleanup?: number; // 新增：最后清理时间
    compressionEnabled?: boolean; // 新增：压缩标志
}

interface CacheConfig {
    maxCacheSize?: number; // MB
    maxRecords?: number;
    expireTime?: number; // ms
    cleanupInterval?: number; // ms
    compressionThreshold?: number; // KB
    enableCompression?: boolean;
    backupEnabled?: boolean;
    batchSaveDelay?: number; // 批量保存延迟 (ms)
    maxRetries?: number; // 最大重试次数
    retryDelay?: number; // 重试延迟 (ms)
}

export class IndexCacheService {
    private context: vscode.ExtensionContext;
    private cacheFilePath: string;
    private backupFilePath: string;
    private cache: Map<string, IndexedFileRecord> = new Map();
    private isInitialized = false;
    private config: CacheConfig;
    private lastCleanupTime = 0;
    private cleanupTimer?: NodeJS.Timeout;
    
    // 🔥 新增：文件锁和队列机制
    private isWriting = false;
    private pendingWrites: (() => Promise<void>)[] = [];
    private batchSaveTimer?: NodeJS.Timeout;
    private hasUnsavedChanges = false;

    constructor(context: vscode.ExtensionContext, config: CacheConfig = {}) {
        this.context = context;
        this.cacheFilePath = path.join(context.globalStorageUri.fsPath, 'indexed-files-cache.json');
        this.backupFilePath = path.join(context.globalStorageUri.fsPath, 'indexed-files-cache.backup.json');
        
        // 默认配置
        this.config = {
            maxCacheSize: 50, // 50MB
            maxRecords: 10000, // 最多10000条记录
            expireTime: 7 * 24 * 60 * 60 * 1000, // 7天过期
            cleanupInterval: 60 * 60 * 1000, // 1小时清理间隔
            compressionThreshold: 100, // 100KB压缩阈值
            enableCompression: true,
            backupEnabled: true,
            batchSaveDelay: 2000, // 2秒批量保存延迟
            maxRetries: 3, // 最大重试3次
            retryDelay: 500, // 重试延迟500ms
            ...config
        };
    }

    /**
     * 初始化缓存服务
     */
    async initialize(): Promise<void> {
        try {
            // 确保全局存储目录存在
            await fs.promises.mkdir(path.dirname(this.cacheFilePath), { recursive: true });

            // 加载现有缓存
            await this.loadCache();
            
            // 启动定时清理
            this.startCleanupTimer();
            
            this.isInitialized = true;
            console.log('[IndexCacheService] 缓存服务初始化完成');
            
        } catch (error) {
            console.error('[IndexCacheService] 初始化失败:', error);
            // 尝试错误恢复
            await this.recoverFromError();
            this.isInitialized = true;
        }
    }

    /**
     * 检查文件是否已经索引过
     */
    async isFileIndexed(
        filePath: string, 
        workspacePath: string, 
        userId: string, 
        deviceId: string
    ): Promise<boolean> {
        if (!this.isInitialized) {
            await this.initialize();
        }

        try {
            // 计算文件哈希
            const fileHash = await this.calculateFileHash(filePath);
            const cacheKey = this.generateCacheKey(filePath, workspacePath, userId, deviceId);

            const cachedRecord = this.cache.get(cacheKey);
            
            if (!cachedRecord) {
                return false;
            }

            // 检查是否过期
            if (this.isRecordExpired(cachedRecord)) {
                this.cache.delete(cacheKey);
                this.scheduleDelayedSave(); // 标记需要保存
                return false;
            }

            // 检查文件是否被修改过
            if (cachedRecord.fileHash !== fileHash) {
                // 移除过期的缓存记录
                this.cache.delete(cacheKey);
                this.scheduleDelayedSave(); // 标记需要保存
                return false;
            }

            // 更新访问统计
            this.updateAccessStats(cachedRecord);
            return true;
        } catch (error) {
            console.error(`[IndexCacheService] 检查文件索引状态失败: ${filePath}`, error);
            return false; // 出错时默认进行索引
        }
    }

    /**
     * 标记文件为已索引
     */
    async markFileAsIndexed(
        filePath: string, 
        workspacePath: string, 
        userId: string, 
        deviceId: string
    ): Promise<void> {
        if (!this.isInitialized) {
            await this.initialize();
        }

        try {
            const fileHash = await this.calculateFileHash(filePath);
            const cacheKey = this.generateCacheKey(filePath, workspacePath, userId, deviceId);

            const now = Date.now();
            const record: IndexedFileRecord = {
                filePath,
                fileHash,
                indexedAt: now,
                workspacePath,
                userId,
                deviceId,
                lastAccessed: now,
                accessCount: 1
            };

            this.cache.set(cacheKey, record);
            
            // 检查是否需要清理
            await this.checkAndCleanupCache();
            
            // 🔥 使用延迟批量保存替代立即保存
            this.scheduleDelayedSave();

            console.log(`[IndexCacheService] 文件已标记为索引: ${path.basename(filePath)}`);
        } catch (error) {
            console.error(`[IndexCacheService] 标记文件索引失败: ${filePath}`, error);
        }
    }

    /**
     * 批量检查文件索引状态
     */
    async filterUnindexedFiles(
        files: string[], 
        workspacePath: string, 
        userId: string, 
        deviceId: string
    ): Promise<{ indexed: string[]; unindexed: string[] }> {
        const indexed: string[] = [];
        const unindexed: string[] = [];

        for (const file of files) {
            const fullPath = path.isAbsolute(file) ? file : path.join(workspacePath, file);
            
            try {
                const isIndexed = await this.isFileIndexed(fullPath, workspacePath, userId, deviceId);
                if (isIndexed) {
                    indexed.push(file);
                } else {
                    unindexed.push(file);
                }
            } catch (error) {
                console.error(`[IndexCacheService] 检查文件失败: ${file}`, error);
                unindexed.push(file); // 出错时默认需要索引
            }
        }

        console.log(`[IndexCacheService] 缓存检查完成: ${indexed.length} 个文件已索引, ${unindexed.length} 个文件待索引`);
        return { indexed, unindexed };
    }

    /**
     * 批量标记文件为已索引
     */
    async markFilesAsIndexed(
        files: string[], 
        workspacePath: string, 
        userId: string, 
        deviceId: string
    ): Promise<void> {
        // 🔥 批量处理以提高性能
        for (const file of files) {
            const fullPath = path.isAbsolute(file) ? file : path.join(workspacePath, file);
            await this.markFileAsIndexed(fullPath, workspacePath, userId, deviceId);
        }
        
        // 🔥 立即保存批量操作结果
        await this.forceSave();
    }

    /**
     * 清除指定工作区的缓存
     */
    async clearWorkspaceCache(workspacePath: string, userId: string, deviceId: string): Promise<void> {
        const keysToDelete: string[] = [];
        
        for (const [key, record] of this.cache.entries()) {
            if (record.workspacePath === workspacePath && 
                record.userId === userId && 
                record.deviceId === deviceId) {
                keysToDelete.push(key);
            }
        }

        keysToDelete.forEach(key => this.cache.delete(key));
        
        await this.forceSave(); // 立即保存
        console.log(`[IndexCacheService] 已清除工作区缓存: ${keysToDelete.length} 条记录`);
    }

    /**
     * 获取缓存统计信息
     */
    getCacheStats(): { 
        totalFiles: number; 
        totalSize: string; 
        oldestRecord?: Date; 
        newestRecord?: Date;
        expiredRecords: number;
        compressionEnabled: boolean;
        nextCleanup?: Date;
    } {
        let oldestTime = Number.MAX_SAFE_INTEGER;
        let newestTime = 0;
        let expiredRecords = 0;

        for (const record of this.cache.values()) {
            if (record.indexedAt < oldestTime) {
                oldestTime = record.indexedAt;
            }
            if (record.indexedAt > newestTime) {
                newestTime = record.indexedAt;
            }
            if (this.isRecordExpired(record)) {
                expiredRecords++;
            }
        }

        const nextCleanup = this.cleanupTimer ? 
            new Date(this.lastCleanupTime + this.config.cleanupInterval!) : 
            undefined;

        const stats = {
            totalFiles: this.cache.size,
            totalSize: this.formatSize(JSON.stringify([...this.cache.values()]).length),
            oldestRecord: oldestTime === Number.MAX_SAFE_INTEGER ? undefined : new Date(oldestTime),
            newestRecord: newestTime === 0 ? undefined : new Date(newestTime),
            expiredRecords,
            compressionEnabled: this.config.enableCompression || false,
            nextCleanup
        };

        return stats;
    }

    /**
     * 手动清理缓存
     */
    async manualCleanup(): Promise<{ removed: number; size: string }> {
        const originalSize = this.cache.size;
        const originalSizeBytes = JSON.stringify([...this.cache.values()]).length;
        
        await this.performCleanup();
        
        const removedCount = originalSize - this.cache.size;
        const newSizeBytes = JSON.stringify([...this.cache.values()]).length;
        const savedSize = this.formatSize(originalSizeBytes - newSizeBytes);
        
        return { removed: removedCount, size: savedSize };
    }

    /**
     * 销毁缓存服务
     */
    async destroy(): Promise<void> {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = undefined;
        }
        
        // 🔥 清除批量保存定时器
        if (this.batchSaveTimer) {
            clearTimeout(this.batchSaveTimer);
            this.batchSaveTimer = undefined;
        }
        
        // 🔥 确保所有未保存的更改都保存
        await this.forceSave();
        this.cache.clear();
        this.isInitialized = false;
        
        console.log('[IndexCacheService] 缓存服务已销毁');
    }

    /**
     * 🔥 格式化文件大小显示
     */
    private formatSize(bytes: number): string {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    /**
     * 验证缓存数据
     */
    private validateCacheData(data: any): data is IndexCacheData {
        return data && 
               typeof data === 'object' && 
               Array.isArray(data.records) &&
               typeof data.lastUpdated === 'number';
    }

    /**
     * 检查记录是否过期
     */
    private isRecordExpired(record: IndexedFileRecord): boolean {
        const now = Date.now();
        return (now - record.indexedAt) > this.config.expireTime!;
    }

    /**
     * 更新访问统计
     */
    private updateAccessStats(record: IndexedFileRecord): void {
        record.lastAccessed = Date.now();
        record.accessCount = (record.accessCount || 0) + 1;
        this.scheduleDelayedSave(); // 标记需要保存
    }

    /**
     * 启动定时清理
     */
    private startCleanupTimer(): void {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
        }
        
        this.cleanupTimer = setInterval(() => {
            this.performCleanup().catch(error => {
                console.error('[IndexCacheService] 定时清理失败:', error);
            });
        }, this.config.cleanupInterval!);
    }

    /**
     * 检查并清理缓存
     */
    private async checkAndCleanupCache(): Promise<void> {
        const currentSize = JSON.stringify([...this.cache.values()]).length;
        const maxSizeBytes = this.config.maxCacheSize! * 1024 * 1024;
        
        if (currentSize > maxSizeBytes || this.cache.size > this.config.maxRecords!) {
            await this.performCleanup();
        }
    }

    /**
     * 执行缓存清理
     */
    private async performCleanup(): Promise<void> {
        const now = Date.now();
        const expiredKeys: string[] = [];
        const validRecords: [string, IndexedFileRecord][] = [];

        // 第一阶段：清理过期和不存在的文件
        for (const [key, record] of this.cache.entries()) {
            if (this.isRecordExpired(record)) {
                expiredKeys.push(key);
                continue;
            }
            
            // 检查文件是否仍然存在
            try {
                await fs.promises.access(record.filePath);
                validRecords.push([key, record]);
            } catch {
                // 文件不存在，标记为过期
                expiredKeys.push(key);
            }
        }

        // 移除过期记录
        expiredKeys.forEach(key => this.cache.delete(key));

        // 第二阶段：如果仍然超过限制，使用LRU清理
        if (validRecords.length > this.config.maxRecords!) {
            // 按最后访问时间排序（LRU）
            validRecords.sort((a, b) => {
                const aTime = a[1].lastAccessed || a[1].indexedAt;
                const bTime = b[1].lastAccessed || b[1].indexedAt;
                return aTime - bTime;
            });

            // 保留最新的记录
            const toKeep = validRecords.slice(-this.config.maxRecords!);
            const toRemove = validRecords.slice(0, -this.config.maxRecords!);
            
            this.cache.clear();
            toKeep.forEach(([key, record]) => this.cache.set(key, record));
            
            console.log(`[IndexCacheService] LRU清理完成: 移除 ${toRemove.length} 条记录`);
        }

        this.lastCleanupTime = now;
        console.log(`[IndexCacheService] 缓存清理完成: 移除 ${expiredKeys.length} 条过期记录`);
    }

    /**
     * 错误恢复
     */
    private async recoverFromError(): Promise<void> {
        console.log('[IndexCacheService] 开始错误恢复...');
        
        try {
            // 尝试从备份恢复
            if (this.config.backupEnabled && fs.existsSync(this.backupFilePath)) {
                console.log('[IndexCacheService] 尝试从备份恢复');
                const backupContent = await fs.promises.readFile(this.backupFilePath, 'utf8');
                const backupData = JSON.parse(backupContent);
                
                if (this.validateCacheData(backupData)) {
                    await fs.promises.copyFile(this.backupFilePath, this.cacheFilePath);
                    await this.loadCache();
                    console.log('[IndexCacheService] 从备份恢复成功');
                    return;
                }
            }
            
            // 创建新的缓存文件
            console.log('[IndexCacheService] 创建新的缓存文件');
            this.cache.clear();
            await this.saveCache();
            
        } catch (error) {
            console.error('[IndexCacheService] 错误恢复失败:', error);
            this.cache.clear();
        }
    }

    /**
     * 生成缓存键
     */
    private generateCacheKey(filePath: string, workspacePath: string, userId: string, deviceId: string): string {
        const relativePath = path.relative(workspacePath, filePath);
        const identifier = `${userId}_${deviceId}_${workspacePath}_${relativePath}`;
        return crypto.createHash('md5').update(identifier).digest('hex');
    }

    /**
     * 计算文件哈希
     */
    private async calculateFileHash(filePath: string): Promise<string> {
        try {
            const content = await fs.promises.readFile(filePath);
            return crypto.createHash('md5').update(content).digest('hex');
        } catch (error) {
            console.warn(`[IndexCacheService] 计算文件哈希失败: ${filePath}`, error);
            // 如果无法读取文件，使用文件路径和修改时间作为替代
            const stats = await fs.promises.stat(filePath);
            return crypto.createHash('md5').update(`${filePath}_${stats.mtime.getTime()}`).digest('hex');
        }
    }

    /**
     * 加载缓存数据 - 🔥 使用重试机制
     */
    private async loadCache(): Promise<void> {
        try {
            if (!fs.existsSync(this.cacheFilePath)) {
                return;
            }

            const cacheContent = await this.retryFileOperation(
                () => fs.promises.readFile(this.cacheFilePath, 'utf8'),
                '读取缓存文件'
            );
            
            let cacheData: IndexCacheData;
            
            // 尝试解压缩
            try {
                if (cacheContent.startsWith('H4sIA')) { // gzip magic bytes in base64
                    const compressed = Buffer.from(cacheContent, 'base64');
                    const decompressed = zlib.gunzipSync(compressed);
                    cacheData = JSON.parse(decompressed.toString('utf8'));
                } else {
                    cacheData = JSON.parse(cacheContent);
                }
            } catch (error) {
                console.warn('[IndexCacheService] 解压缩失败，尝试直接解析:', error);
                cacheData = JSON.parse(cacheContent);
            }

            // 验证缓存数据
            if (!this.validateCacheData(cacheData)) {
                console.warn('[IndexCacheService] 缓存数据验证失败，创建新缓存');
                return;
            }

            // 验证缓存版本兼容性
            if (!cacheData.version || cacheData.version !== '1.0') {
                console.warn('[IndexCacheService] 缓存版本不兼容，创建新缓存');
                return;
            }

            // 重建缓存映射
            this.cache.clear();
            for (const record of cacheData.records || []) {
                const key = this.generateCacheKey(
                    record.filePath, 
                    record.workspacePath, 
                    record.userId, 
                    record.deviceId
                );
                this.cache.set(key, record);
            }

            console.log(`[IndexCacheService] 缓存加载完成: ${this.cache.size} 条记录`);
        } catch (error) {
            console.error('[IndexCacheService] 加载缓存失败:', error);
            await this.recoverFromError();
        }
    }

    /**
     * 保存缓存数据 - 🔥 使用队列和重试机制
     */
    private async saveCache(): Promise<void> {
        return this.executeWithQueue(async () => {
            await this.retryFileOperation(async () => {
                const cacheData: IndexCacheData = {
                    version: '1.0',
                    records: [...this.cache.values()],
                    lastUpdated: Date.now(),
                    lastCleanup: this.lastCleanupTime,
                    compressionEnabled: this.config.enableCompression
                };

                let content = JSON.stringify(cacheData, null, 2);
                
                // 检查是否需要压缩
                if (this.config.enableCompression && content.length > this.config.compressionThreshold! * 1024) {
                    const originalSize = Buffer.byteLength(content, 'utf8');
                    const compressed = zlib.gzipSync(Buffer.from(content, 'utf8'));
                    content = compressed.toString('base64');
                    console.log(`[IndexCacheService] 缓存已压缩: ${this.formatSize(originalSize)} -> ${this.formatSize(compressed.length)}`);
                }

                // 🔥 创建备份 - 使用重试机制
                if (this.config.backupEnabled && fs.existsSync(this.cacheFilePath)) {
                    await this.retryFileOperation(
                        () => fs.promises.copyFile(this.cacheFilePath, this.backupFilePath),
                        '创建备份文件'
                    );
                }

                // 🔥 写入主文件 - 使用重试机制
                await this.retryFileOperation(
                    () => fs.promises.writeFile(this.cacheFilePath, content, 'utf8'),
                    '写入缓存文件'
                );

                console.log(`[IndexCacheService] 缓存已保存: ${this.cache.size} 条记录`);
            }, '保存缓存');
        });
    }

    /**
     * 🔥 调度延迟保存 - 避免频繁文件写入
     */
    private scheduleDelayedSave(): void {
        this.hasUnsavedChanges = true;
        
        // 清除现有定时器
        if (this.batchSaveTimer) {
            clearTimeout(this.batchSaveTimer);
        }
        
        // 设置新的延迟保存定时器
        this.batchSaveTimer = setTimeout(() => {
            this.forceSave().catch(error => {
                console.error('[IndexCacheService] 延迟保存失败:', error);
            });
        }, this.config.batchSaveDelay!);
    }

    /**
     * 🔥 强制保存 - 立即保存所有更改
     */
    private async forceSave(): Promise<void> {
        if (!this.hasUnsavedChanges) {
            return;
        }
        
        // 清除延迟保存定时器
        if (this.batchSaveTimer) {
            clearTimeout(this.batchSaveTimer);
            this.batchSaveTimer = undefined;
        }
        
        await this.saveCache();
        this.hasUnsavedChanges = false;
    }

    /**
     * 🔥 带重试机制的文件写入队列
     */
    private async executeWithQueue<T>(operation: () => Promise<T>): Promise<T> {
        return new Promise((resolve, reject) => {
            this.pendingWrites.push(async () => {
                try {
                    const result = await operation();
                    resolve(result);
                } catch (error) {
                    reject(error);
                }
            });
            
            this.processWriteQueue();
        });
    }

    /**
     * 🔥 处理写入队列
     */
    private async processWriteQueue(): Promise<void> {
        if (this.isWriting || this.pendingWrites.length === 0) {
            return;
        }
        
        this.isWriting = true;
        
        try {
            while (this.pendingWrites.length > 0) {
                const operation = this.pendingWrites.shift()!;
                await operation();
            }
        } finally {
            this.isWriting = false;
        }
    }

    /**
     * 🔥 带重试机制的文件操作
     */
    private async retryFileOperation<T>(
        operation: () => Promise<T>,
        operationName: string,
        retries: number = this.config.maxRetries!
    ): Promise<T> {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                return await operation();
            } catch (error: any) {
                if (error.code === 'EBUSY' && attempt < retries) {
                    console.warn(`[IndexCacheService] ${operationName} 失败，尝试重试 ${attempt}/${retries}:`, error.message);
                    await new Promise(resolve => setTimeout(resolve, this.config.retryDelay! * attempt));
                    continue;
                }
                throw error;
            }
        }
        throw new Error(`${operationName} 重试 ${retries} 次后仍然失败`);
    }
} 