const path = require('path');

class ProgressTracker {
    constructor() {
        this.chunks = new Map();
        this.fileProgress = new Map();

        // 新增：文件级别跟踪
        this.fileStatus = new Map(); // filePath -> 'pending'|'processing'|'completed'|'failed'
        this.totalFiles = 0;
        this.completedFiles = 0;
        this.processingFiles = 0;
        this.failedFiles = 0;
    }

    registerChunk(chunkId, metadata) {
        if (!this.chunks.has(chunkId)) {
            const chunkInfo = {
                chunkId,
                filePath: metadata.filePath,
                language: this._detectLanguage(metadata.filePath),
                startLine: metadata.startLine,
                endLine: metadata.endLine,
                content: metadata.content || '',
                parser: metadata.parser || this._getDefaultParser(metadata.filePath),
                type: metadata.type || 'unknown',
                registeredAt: Date.now(),
                status: 'pending',
                startTime: Date.now(),
                endTime: null,
                retries: 0,
                metadata: metadata,
            };

            this.chunks.set(chunkId, chunkInfo);

            // 初始化文件进度
            const filePath = metadata.filePath;
            if (!this.fileProgress.has(filePath)) {
                this.fileProgress.set(filePath, {
                    total: 0,
                    pending: 0,
                    processing: 0,
                    completed: 0,
                    failed: 0,
                    language: chunkInfo.language,
                });
            }

            const fileStats = this.fileProgress.get(filePath);
            fileStats.total++;
            fileStats.pending++;
        }
    }

    _detectLanguage(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        const languageMap = {
            '.py': 'python',
            '.js': 'javascript',
            '.ts': 'typescript',
            '.java': 'java',
            '.cpp': 'cpp',
            '.c': 'c',
            '.go': 'go',
            '.rs': 'rust',
            '.php': 'php',
            '.rb': 'ruby',
            '.swift': 'swift',
            '.kt': 'kotlin',
            '.scala': 'scala',
            '.hs': 'haskell',
            '.lua': 'lua',
            '.pl': 'perl',
            '.sh': 'shell',
            '.sql': 'sql',
            '.html': 'html',
            '.css': 'css',
            '.json': 'json',
            '.xml': 'xml',
            '.yaml': 'yaml',
            '.yml': 'yaml',
            '.md': 'markdown',
        };
        return languageMap[ext] || 'unknown';
    }

    _getDefaultParser(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        const parserMap = {
            '.py': 'python_parser',
            '.js': 'javascript_parser',
            '.ts': 'typescript_parser',
            '.java': 'java_parser',
            '.cpp': 'cpp_parser',
            '.c': 'c_parser',
            '.go': 'go_parser',
            '.rs': 'rust_parser',
            '.php': 'php_parser',
            '.rb': 'ruby_parser',
            '.swift': 'swift_parser',
            '.kt': 'kotlin_parser',
            '.scala': 'scala_parser',
            '.hs': 'haskell_parser',
            '.lua': 'lua_parser',
            '.pl': 'perl_parser',
            '.sh': 'shell_parser',
            '.sql': 'sql_parser',
            '.html': 'html_parser',
            '.css': 'css_parser',
            '.json': 'json_parser',
            '.xml': 'xml_parser',
            '.yaml': 'yaml_parser',
            '.yml': 'yaml_parser',
            '.md': 'markdown_parser',
        };
        return parserMap[ext] || 'default_parser';
    }

    updateChunkStatus(chunkId, status) {
        const chunk = this.chunks.get(chunkId);
        if (!chunk) {
            // 检查是否是分割代码块，如果是，尝试处理原始代码块
            if (chunkId.includes('_part_')) {
                const originalChunkId = chunkId.replace(/_part_\d+$/, '');
                const originalChunk = this.chunks.get(originalChunkId);
                if (originalChunk) {
                    // 找到原始代码块，更新其状态
                    this._updateSplitChunkStatus(originalChunkId, chunkId, status);
                    return;
                }
            }
            
            // 对于其他情况，使用调试级别的日志而不是警告
            console.debug(`Chunk ${chunkId} not found in progress tracker (可能是分割代码块)`);
            return;
        }

        const oldStatus = chunk.status;
        chunk.status = status;
        chunk.endTime = ['completed', 'failed'].includes(status) ? Date.now() : null;

        if (status === 'processing') {
            chunk.retries++;
        }

        // 更新文件进度
        const filePath = chunk.filePath;
        const fileStats = this.fileProgress.get(filePath);

        if (fileStats) {
        // 减少旧状态的计数
        if (oldStatus) {
            fileStats[oldStatus]--;
        }

        // 增加新状态的计数
        fileStats[status]++;
        }

        // 新增：自动更新文件级别的状态
        this._updateFileStatusByChunks();
    }

    /**
     * 处理分割代码块的状态更新
     */
    _updateSplitChunkStatus(originalChunkId, splitChunkId, status) {
        const originalChunk = this.chunks.get(originalChunkId);
        if (!originalChunk) {
            return;
        }

        // 初始化分割代码块跟踪
        if (!originalChunk.splitChunks) {
            originalChunk.splitChunks = new Map();
        }

        // 记录分割代码块的状态
        originalChunk.splitChunks.set(splitChunkId, status);

        // 检查所有分割代码块的状态
        const splitStatuses = Array.from(originalChunk.splitChunks.values());
        const completedCount = splitStatuses.filter(s => s === 'completed').length;
        const failedCount = splitStatuses.filter(s => s === 'failed').length;
        const totalSplitChunks = splitStatuses.length;

        // 根据分割代码块的状态更新原始代码块的状态
        let newOriginalStatus = originalChunk.status;

        if (status === 'processing' && originalChunk.status === 'pending') {
            newOriginalStatus = 'processing';
        } else if (completedCount === totalSplitChunks) {
            // 所有分割部分都完成了
            newOriginalStatus = 'completed';
        } else if (failedCount > 0 && (completedCount + failedCount) === totalSplitChunks) {
            // 有失败的部分，且所有部分都处理完了
            newOriginalStatus = 'failed';
        }

        // 更新原始代码块状态
        if (newOriginalStatus !== originalChunk.status) {
            console.log(`🔄 更新原始代码块状态: ${originalChunkId} ${originalChunk.status} -> ${newOriginalStatus} (分割进度: ${completedCount}/${totalSplitChunks})`);
            
            const oldStatus = originalChunk.status;
            originalChunk.status = newOriginalStatus;
            originalChunk.endTime = ['completed', 'failed'].includes(newOriginalStatus) ? Date.now() : null;

            // 更新文件进度统计
            const filePath = originalChunk.filePath;
            const fileStats = this.fileProgress.get(filePath);
            if (fileStats) {
                if (oldStatus) {
                    fileStats[oldStatus]--;
                }
                fileStats[newOriginalStatus]++;
            }

            // 更新文件级别的状态
            this._updateFileStatusByChunks();
        }
    }

    getOverallProgress() {
        let pendingChunks = 0;
        let processingChunks = 0;
        let completedChunks = 0;
        let failedChunks = 0;
        let totalChunks = this.chunks.size;

        for (const chunk of this.chunks.values()) {
            switch (chunk.status) {
                case 'pending':
                    pendingChunks++;
                    break;
                case 'processing':
                    processingChunks++;
                    break;
                case 'completed':
                    completedChunks++;
                    break;
                case 'failed':
                    failedChunks++;
                    break;
            }
        }

        return {
            pendingChunks,
            processingChunks,
            completedChunks,
            failedChunks,
            totalChunks,
            successRate: totalChunks > 0 ? (completedChunks / totalChunks) * 100 : 0,
        };
    }

    getFileProgressSummary() {
        const summary = [];
        for (const [file, stats] of this.fileProgress.entries()) {
            summary.push({
                file: path.basename(file),
                language: stats.language,
                pending: stats.pending,
                processing: stats.processing,
                completed: stats.completed,
                failed: stats.failed,
                total: stats.total,
                successRate: stats.total > 0 ? (stats.completed / stats.total) * 100 : 0,
            });
        }
        return summary;
    }

    getChunkDetails(chunkId) {
        return this.chunks.get(chunkId);
    }

    getAllChunks() {
        return Array.from(this.chunks.values());
    }

    getChunksByStatus(status) {
        return Array.from(this.chunks.values()).filter(chunk => chunk.status === status);
    }

    getChunksByFile(filePath) {
        return Array.from(this.chunks.values()).filter(chunk => chunk.filePath === filePath);
    }

    getChunksByLanguage(language) {
        return Array.from(this.chunks.values()).filter(chunk => chunk.language === language);
    }

    getChunksByType(type) {
        return Array.from(this.chunks.values()).filter(chunk => chunk.type === type);
    }

    // 新增：文件级别的进度跟踪方法

    /**
     * 注册文件到进度跟踪器
     * @param {string} filePath - 文件路径
     */
    registerFile(filePath) {
        if (!this.fileStatus.has(filePath)) {
            this.fileStatus.set(filePath, 'pending');
            this.totalFiles++;
        }
    }

    /**
     * 批量注册文件
     * @param {Array} fileList - 文件路径数组
     */
    registerFiles(fileList) {
        fileList.forEach(filePath => {
            this.registerFile(filePath);
        });
    }

    /**
     * 更新文件处理状态
     * @param {string} filePath - 文件路径
     * @param {string} status - 状态：'pending'|'processing'|'completed'|'failed'
     */
    updateFileStatus(filePath, status) {
        const oldStatus = this.fileStatus.get(filePath);

        if (oldStatus) {
            // 减少旧状态的计数
            switch (oldStatus) {
                case 'processing':
                    this.processingFiles = Math.max(0, this.processingFiles - 1);
                    break;
                case 'completed':
                    this.completedFiles = Math.max(0, this.completedFiles - 1);
                    break;
                case 'failed':
                    this.failedFiles = Math.max(0, this.failedFiles - 1);
                    break;
            }
        }

        // 设置新状态
        this.fileStatus.set(filePath, status);

        // 增加新状态的计数
        switch (status) {
            case 'processing':
                this.processingFiles++;
                break;
            case 'completed':
                this.completedFiles++;
                break;
            case 'failed':
                this.failedFiles++;
                break;
        }
    }

    /**
     * 获取文件级别的处理进度
     * @returns {Object} 包含文件处理进度的对象
     */
    getFileProgress() {
        return {
            totalFiles: this.totalFiles,
            completedFiles: this.completedFiles,
            processingFiles: this.processingFiles,
            failedFiles: this.failedFiles,
            pendingFiles:
                this.totalFiles - this.completedFiles - this.processingFiles - this.failedFiles,
            progressPercentage:
                this.totalFiles > 0 ? (this.completedFiles / this.totalFiles) * 100 : 0,
        };
    }

    /**
     * 获取文件处理进度百分比（0-100浮点数）
     * @returns {number} 进度百分比
     */
    getFileProgressPercentage() {
        return this.totalFiles > 0 ? (this.completedFiles / this.totalFiles) * 100 : 0;
    }

    /**
     * 获取所有文件的状态详情
     * @returns {Array} 文件状态详情数组
     */
    getFileStatusDetails() {
        const details = [];
        for (const [filePath, status] of this.fileStatus.entries()) {
            details.push({
                filePath,
                status,
                language: this._detectLanguage(filePath),
            });
        }
        return details;
    }

    /**
     * 根据文件中的chunks来自动更新文件状态
     * 当文件中所有chunks都完成时，文件状态自动变为completed
     */
    _updateFileStatusByChunks() {
        const fileChunkStatus = new Map();

        // 统计每个文件的chunk状态
        for (const chunk of this.chunks.values()) {
            const filePath = chunk.filePath;
            if (!fileChunkStatus.has(filePath)) {
                fileChunkStatus.set(filePath, {
                    total: 0,
                    completed: 0,
                    failed: 0,
                    processing: 0,
                });
            }

            const fileStats = fileChunkStatus.get(filePath);
            fileStats.total++;

            switch (chunk.status) {
                case 'completed':
                    fileStats.completed++;
                    break;
                case 'failed':
                    fileStats.failed++;
                    break;
                case 'processing':
                    fileStats.processing++;
                    break;
            }
        }

        // 根据chunk状态更新文件状态
        for (const [filePath, stats] of fileChunkStatus.entries()) {
            let newFileStatus = 'pending';

            if (stats.processing > 0) {
                newFileStatus = 'processing';
            } else if (stats.completed === stats.total) {
                newFileStatus = 'completed';
            } else if (stats.failed > 0 && stats.completed + stats.failed === stats.total) {
                newFileStatus = 'failed';
            }

            const currentStatus = this.fileStatus.get(filePath);
            if (currentStatus !== newFileStatus) {
                this.updateFileStatus(filePath, newFileStatus);
            }
        }
    }
}

module.exports = ProgressTracker;
