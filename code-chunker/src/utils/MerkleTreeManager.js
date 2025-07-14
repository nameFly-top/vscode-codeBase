const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const MerkleTree = require('./merkleTree');

/**
 * 增强型 Merkle Tree 管理器
 * 提供统一的文件变更检测、持久化存储和增量更新功能
 */
class MerkleTreeManager {
    constructor(workspacePath, config = {}) {
        this.workspacePath = workspacePath;
        this.config = {
            // 存储配置
            persistencePath: config.persistencePath || path.join(workspacePath, '.vscode', 'merkle-cache'),
            stateFileName: config.stateFileName || 'merkle-state.json',
            compressionEnabled: config.compressionEnabled !== false,
            
            // 哈希配置
            hashAlgorithm: config.hashAlgorithm || 'sha256',
            includeMetadata: config.includeMetadata !== false,
            
            // 性能配置
            maxCacheAge: config.maxCacheAge || 7 * 24 * 60 * 60 * 1000, // 7天
            enableAsyncProcessing: config.enableAsyncProcessing !== false,
            
            // 调试配置
            verbose: config.verbose || false
        };
        
        this.merkleTree = new MerkleTree();
        this.currentState = null;
        this.lastState = null;
        this.isInitialized = false;
        
        // 性能统计
        this.stats = {
            buildTime: 0,
            compareTime: 0,
            saveTime: 0,
            loadTime: 0,
            filesProcessed: 0,
            changesDetected: 0
        };
    }

    /**
     * 初始化管理器
     */
    async initialize() {
        if (this.isInitialized) return;

        try {
            // 确保持久化目录存在
            await fs.mkdir(this.config.persistencePath, { recursive: true });
            
            // 加载历史状态
            await this.loadLastState();
            
            this.isInitialized = true;
            this.log('MerkleTreeManager 初始化成功');
        } catch (error) {
            this.error('MerkleTreeManager 初始化失败:', error);
            throw error;
        }
    }

    /**
     * 从文件列表构建 Merkle Tree
     * @param {Array} files 文件信息数组 [{path, content, hash}]
     * @returns {Object} 构建结果
     */
    async buildFromFiles(files) {
        const startTime = performance.now();
        
        try {
            this.log(`开始构建 Merkle Tree，文件数: ${files.length}`);
            
            // 处理文件格式：如果是字符串数组，转换为文件对象数组
            const fileObjects = files.map(file => {
                if (typeof file === 'string') {
                    return { path: file };
                }
                return file;
            });
            
            // 预处理文件数据
            const processedFiles = await this.preprocessFiles(fileObjects);
            
            // 构建文件哈希映射
            const fileHashMap = new Map();
            const hashArray = [];
            
            for (const file of processedFiles) {
                const fileHash = await this.calculateFileHash(file);
                fileHashMap.set(file.path, {
                    hash: fileHash,
                    metadata: this.extractMetadata(file)
                });
                hashArray.push(fileHash);
            }
            
            // 构建 Merkle Tree
            const treeResult = this.merkleTree.buildTree(hashArray);
            
            // 创建当前状态
            this.currentState = {
                timestamp: Date.now(),
                rootHash: treeResult.rootHash,
                tree: treeResult.tree,
                fileCount: files.length,
                fileHashMap: Object.fromEntries(fileHashMap),
                workspacePath: this.workspacePath,
                version: '2.0'
            };
            
            this.stats.buildTime = performance.now() - startTime;
            this.stats.filesProcessed = files.length;
            
            this.log(`Merkle Tree 构建完成，根哈希: ${treeResult.rootHash.substring(0, 16)}...`);
            return this.currentState;
            
        } catch (error) {
            this.error('构建 Merkle Tree 失败:', error);
            throw error;
        }
    }

    /**
     * 与历史状态对比，检测变更
     * @returns {Object} 变更检测结果
     */
    async detectChanges() {
        const startTime = performance.now();
        
        if (!this.currentState) {
            throw new Error('当前状态未初始化，请先调用 buildFromFiles');
        }
        
        if (!this.lastState) {
            this.log('首次构建，所有文件视为新增');
            return {
                hasChanges: true,
                changeType: 'initial_build',
                changedFiles: Object.keys(this.currentState.fileHashMap).map(path => ({
                    path,
                    changeType: 'added',
                    newHash: this.currentState.fileHashMap[path].hash
                })),
                summary: {
                    added: Object.keys(this.currentState.fileHashMap).length,
                    modified: 0,
                    deleted: 0,
                    total: Object.keys(this.currentState.fileHashMap).length
                }
            };
        }

        try {
            // 快速根哈希对比
            if (this.currentState.rootHash === this.lastState.rootHash) {
                this.log('根哈希匹配，无变更');
                return {
                    hasChanges: false,
                    changeType: 'no_changes',
                    changedFiles: [],
                    summary: { added: 0, modified: 0, deleted: 0, total: 0 }
                };
            }

            // 详细文件对比
            const changes = this.compareFileMaps(
                this.lastState.fileHashMap,
                this.currentState.fileHashMap
            );

            this.stats.compareTime = performance.now() - startTime;
            this.stats.changesDetected = changes.changedFiles.length;

            this.log(`变更检测完成: ${changes.summary.total} 个文件变更`);
            return changes;

        } catch (error) {
            this.error('变更检测失败:', error);
            throw error;
        }
    }

    /**
     * 比较两个文件哈希映射
     * @private
     */
    compareFileMaps(oldMap, newMap) {
        const changedFiles = [];
        const summary = { added: 0, modified: 0, deleted: 0, total: 0 };

        // 检查新增和修改的文件
        for (const [filePath, fileInfo] of Object.entries(newMap)) {
            const oldFileInfo = oldMap[filePath];
            
            if (!oldFileInfo) {
                // 新增文件
                changedFiles.push({
                    path: filePath,
                    changeType: 'added',
                    newHash: fileInfo.hash,
                    metadata: fileInfo.metadata
                });
                summary.added++;
            } else if (oldFileInfo.hash !== fileInfo.hash) {
                // 修改文件
                changedFiles.push({
                    path: filePath,
                    changeType: 'modified',
                    oldHash: oldFileInfo.hash,
                    newHash: fileInfo.hash,
                    metadata: fileInfo.metadata
                });
                summary.modified++;
            }
        }

        // 检查删除的文件
        for (const [filePath, fileInfo] of Object.entries(oldMap)) {
            if (!newMap[filePath]) {
                changedFiles.push({
                    path: filePath,
                    changeType: 'deleted',
                    oldHash: fileInfo.hash,
                    metadata: fileInfo.metadata
                });
                summary.deleted++;
            }
        }

        summary.total = summary.added + summary.modified + summary.deleted;

        return {
            hasChanges: summary.total > 0,
            changeType: 'file_changes',
            changedFiles,
            summary
        };
    }

    /**
     * 持久化当前状态
     */
    async saveCurrentState() {
        if (!this.currentState) {
            this.warn('没有当前状态需要保存');
            return false;
        }

        const startTime = performance.now();
        const statePath = path.join(this.config.persistencePath, this.config.stateFileName);

        try {
            let stateData = JSON.stringify(this.currentState, null, 2);
            
            // 可选压缩
            if (this.config.compressionEnabled) {
                const zlib = require('zlib');
                stateData = zlib.gzipSync(stateData).toString('base64');
            }

            await fs.writeFile(statePath, stateData);
            
            // 保存成功后，将当前状态设置为历史状态，用于下次对比
            this.lastState = JSON.parse(JSON.stringify(this.currentState));
            
            this.stats.saveTime = performance.now() - startTime;
            this.log(`状态已保存: ${statePath}`);
            return true;
            
        } catch (error) {
            this.error('保存状态失败:', error);
            throw error;
        }
    }

    /**
     * 加载历史状态
     * @private
     */
    async loadLastState() {
        const startTime = performance.now();
        const statePath = path.join(this.config.persistencePath, this.config.stateFileName);

        try {
            const exists = await fs.access(statePath).then(() => true).catch(() => false);
            if (!exists) {
                this.log('历史状态文件不存在，首次运行');
                return false;
            }

            let stateData = await fs.readFile(statePath, 'utf8');
            
            // 尝试解压缩
            if (this.config.compressionEnabled) {
                try {
                    const zlib = require('zlib');
                    stateData = zlib.gunzipSync(Buffer.from(stateData, 'base64')).toString();
                } catch (error) {
                    // 可能是未压缩的旧格式，直接解析
                }
            }

            this.lastState = JSON.parse(stateData);
            
            // 验证状态版本兼容性
            if (!this.lastState.version || this.lastState.version !== '2.0') {
                this.warn('状态版本不兼容，重新构建');
                this.lastState = null;
                return false;
            }

            this.stats.loadTime = performance.now() - startTime;
            this.log(`历史状态已加载: ${this.lastState ? '成功' : '失败'}`);
            return true;
            
        } catch (error) {
            this.warn('加载历史状态失败:', error.message);
            this.lastState = null;
            return false;
        }
    }

    /**
     * 计算文件哈希
     * @private
     */
    async calculateFileHash(file) {
        let content = '';
        
        if (file.content !== undefined) {
            content = file.content;
        } else if (file.hash) {
            // 如果已有哈希，直接使用
            return file.hash;
        } else {
            // 从文件路径读取
            const fullPath = path.isAbsolute(file.path) ? file.path : path.join(this.workspacePath, file.path);
            const buffer = await fs.readFile(fullPath);
            content = buffer.toString();
        }

        // 包含元数据的哈希
        if (this.config.includeMetadata) {
            const metadata = this.extractMetadata(file);
            content += JSON.stringify(metadata);
        }

        return crypto.createHash(this.config.hashAlgorithm).update(content).digest('hex');
    }

    /**
     * 提取文件元数据
     * @private
     */
    extractMetadata(file) {
        if (!this.config.includeMetadata) return {};
        
        return {
            extension: path.extname(file.path),
            size: file.content ? file.content.length : file.size || 0,
            relativePath: file.path
        };
    }

    /**
     * 预处理文件数据
     * @private
     */
    async preprocessFiles(files) {
        return files.map(file => {
            // 规范化文件路径
            if (path.isAbsolute(file.path)) {
                file.path = path.relative(this.workspacePath, file.path);
            }
            return file;
        });
    }

    /**
     * 获取统计信息
     */
    getStats() {
        return {
            ...this.stats,
            currentStateExists: !!this.currentState,
            lastStateExists: !!this.lastState,
            isInitialized: this.isInitialized
        };
    }

    /**
     * 清理过期缓存
     */
    async cleanupExpiredCache() {
        if (!this.lastState) return;

        const age = Date.now() - this.lastState.timestamp;
        if (age > this.config.maxCacheAge) {
            this.log('清理过期缓存');
            this.lastState = null;
            
            const statePath = path.join(this.config.persistencePath, this.config.stateFileName);
            try {
                await fs.unlink(statePath);
            } catch (error) {
                // 文件可能已经不存在
            }
        }
    }

    /**
     * 重置状态
     */
    async reset() {
        this.currentState = null;
        this.lastState = null;
        
        const statePath = path.join(this.config.persistencePath, this.config.stateFileName);
        try {
            await fs.unlink(statePath);
            this.log('状态已重置');
        } catch (error) {
            // 文件可能不存在
        }
    }

    // 日志方法
    log(message) {
        if (this.config.verbose) {
            console.log(`[MerkleTreeManager] ${message}`);
        }
    }

    warn(message) {
        console.warn(`[MerkleTreeManager] ⚠️ ${message}`);
    }

    error(message, error) {
        console.error(`[MerkleTreeManager] ❌ ${message}`, error);
    }
}

module.exports = MerkleTreeManager; 