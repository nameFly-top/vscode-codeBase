const fs = require('fs-extra');
const path = require('path');
const yaml = require('yaml');
const config = require('./config.js');
const FileScanner = require('./fileScanner');
const ParserSelector = require('./parserSelector');
const Dispatcher = require('./dispatcher');
const Sender = require('./sender');
const ProgressTracker = require('./progressTracker');
const MerkleTree = require('./utils/merkleTree');
const VectorManager = require('./vectorManager');
const PerformanceAnalyzer = require('./utils/performanceAnalyzer');
const { createCacheSystem, createPresetConfig } = require('./cache');

class CodeChunker {
    constructor(userConfig) {
        this.config = this._loadConfig(userConfig);
        this.progressTracker = new ProgressTracker();
        this.fileScanner = new FileScanner(this.config);
        this.parserSelector = new ParserSelector(this.config);
        this.dispatcher = new Dispatcher(this.config);
        this.merkleTree = new MerkleTree();
        
        // 初始化性能分析器
        this.performanceAnalyzer = new PerformanceAnalyzer();
        
        // 初始化缓存系统
        const cacheMode = this.config.environment || 'development';
        const cacheConfig = {
            ...createPresetConfig(cacheMode),
            ...(this.config.cache || {}),
            dbPath: this.config.cache?.dbPath || path.join(process.cwd(), 'cache', `${cacheMode}-index.db`)
        };
        this.cacheSystem = createCacheSystem(cacheConfig);
        this.log(`🗃️ 缓存系统已创建 (${cacheMode}模式)`);
        
        // 初始化 VectorManager（只有在明确启用时才初始化）
        if (this.config.vectorManager?.enabled === true) {
            this.vectorManager = new VectorManager(this.config.vectorManager);
            this.vectorManager.initialize().catch(error => {
                this.error('Failed to initialize VectorManager:', error);
            });
        } else {
            this.log('VectorManager is disabled, skipping initialization.');
        }
        
        // 初始化Sender，传入VectorManager和性能分析器
        this.sender = new Sender(this.config, this.progressTracker, this.vectorManager);
        
        this.version = '0.1.0';
    }

    _loadConfig(userConfig) {
        // 加载默认配置
        const defaultConfigPath = path.join(__dirname, '..', 'config', 'default.yaml');
        let defaultConfig = {};
        
        try {
            if (fs.existsSync(defaultConfigPath)) {
                const defaultConfigContent = fs.readFileSync(defaultConfigPath, 'utf8');
                defaultConfig = yaml.parse(defaultConfigContent);
            }
        } catch (error) {
            console.warn('Error loading default config:', error);
        }

        // 合并用户配置
        return {
            ...defaultConfig,
            ...userConfig
        };
    }

    log(message) {
        console.log(message);
    }

    error(message) {
        console.error(message);
    }

    warn(message) {
        console.warn(message);
    }

    async processWorkspace(userId, deviceId, workspacePath, token, ignorePatterns = []) {
        const startTime = Date.now();
        
        try {
            // 开始性能分析
            this.performanceAnalyzer.startAnalysis(workspacePath, userId, deviceId);
            
            this.log(`Starting Code Chunker v${this.version} for workspace: ${workspacePath}`);
            
            // 初始化缓存系统
            this.log('🗃️ 初始化缓存系统...');
            await this.cacheSystem.initialize();
            this.log('✅ 缓存系统初始化完成');
            
            // 更新配置
            const updatedConfig = {
                ...this.config,
                workspacePath,
                ignorePatterns: Array.isArray(ignorePatterns) ? ignorePatterns : [],
                userId,
                deviceId,
                token
            };
            
            // 重新初始化组件
            this.progressTracker = new ProgressTracker();
            this.config = { ...updatedConfig, progressTracker: this.progressTracker };
            
            this.fileScanner = new FileScanner(this.config, this.performanceAnalyzer);
            this.parserSelector = new ParserSelector(this.config, this.performanceAnalyzer);
            this.dispatcher = new Dispatcher(this.config, this.performanceAnalyzer);
            this.merkleTree = new MerkleTree();
            
            // 重新初始化Sender，传入现有的VectorManager和性能分析器
            this.sender = new Sender(this.config, this.progressTracker, this.vectorManager, this.performanceAnalyzer);
            
            // 如果 VectorManager 已存在且启用，则更新配置；否则初始化
            if (this.config.vectorManager?.enabled === true) {
                if (!this.vectorManager) {
                    this.vectorManager = new VectorManager(this.config.vectorManager);
                    await this.vectorManager.initialize();
                }
                // 不需要重新初始化，VectorManager可以重用
            }

           
            // return;
            this.log('Scanning workspace...');
            this.performanceAnalyzer.startFileScanning();
            const { fileList, fileContents, merkleTree: scanMerkleTree, fileHashes, scanStats } = await this.fileScanner.scanWorkspace(workspacePath);
            this.performanceAnalyzer.endFileScanning(fileList.length, scanStats ? scanStats.skippedFiles : 0);
            this.log(`Found ${fileList.length} files to process.`);
            
            // 缓存检查和过滤
            this.log('🔍 检查文件缓存状态...');
            const cacheCheckStart = performance.now();
            const cacheStatus = await this.cacheSystem.cache.batchCheck(
                fileList.map(filePath => ({
                    path: filePath,
                    hash: fileHashes[filePath]
                }))
            );
            const cacheCheckTime = performance.now() - cacheCheckStart;
            
            this.log(`📊 缓存检查完成 (${cacheCheckTime.toFixed(2)}ms):`);
            this.log(`   ✅ 缓存命中: ${cacheStatus.cached.length} 个文件`);
            this.log(`   ❌ 缓存未命中: ${cacheStatus.uncached.length} 个文件`);
            this.log(`   ⚠️  缓存过期: ${cacheStatus.expired.length} 个文件`);
            
            // 只处理缓存未命中的文件
            const filesToProcess = cacheStatus.uncached.map(item => item.path);
            const cachedFiles = cacheStatus.cached.map(item => item.path);
            
            this.log(`📝 需要处理的文件: ${filesToProcess.length}/${fileList.length} (节省 ${((cachedFiles.length / fileList.length) * 100).toFixed(1)}% 的处理时间)`);
            
            // 🔥 修复：注册所有文件到进度跟踪器，包括缓存的文件
            this.progressTracker.registerFiles(fileList);
            this.log(`Registered ${fileList.length} files for progress tracking.`);
            
            // 🔥 立即标记缓存文件为已完成
            for (const cachedFile of cachedFiles) {
                this.progressTracker.updateFileStatus(cachedFile, 'completed');
            }
            this.log(`Marked ${cachedFiles.length} cached files as completed.`);
            
            // 🔥 如果所有文件都有缓存，确保进度显示为100%完成
            if (filesToProcess.length === 0) {
                this.log('🎉 所有文件都有有效缓存，无需重新处理！');
                
                // 🔥 重要修复：从缓存中加载代码块并注册到ProgressTracker
                this.log(`🗃️ 从缓存加载所有 ${cachedFiles.length} 个文件的代码块...`);
                const cacheLoadStart = performance.now();
                let totalCachedChunks = 0;
                
                for (const filePath of cachedFiles) {
                    try {
                        const cached = await this.cacheSystem.cache.get(filePath, fileHashes[filePath]);
                        if (cached && (cached.chunks || (cached.result && cached.result.chunks))) {
                            let fileChunkCount = 0;
                            // 兼容两种缓存格式：直接chunks字段 或 result.chunks字段
                            const cachedChunks = cached.chunks || cached.result.chunks;
                            // 注册缓存的代码块到ProgressTracker
                            for (const chunk of cachedChunks) {
                                const chunkId = chunk.chunkId || chunk.id; // 兼容两种字段命名
                                if (chunkId && this.progressTracker) {
                                    this.progressTracker.registerChunk(chunkId, {
                                        filePath: chunk.filePath,
                                        startLine: chunk.startLine,
                                        endLine: chunk.endLine,
                                        content: chunk.content,
                                        parser: chunk.parser,
                                        type: chunk.type,
                                        language: chunk.language
                                    });
                                    // 立即标记为已完成
                                    this.progressTracker.updateChunkStatus(chunkId, 'completed');
                                    fileChunkCount++;
                                    totalCachedChunks++;
                                } else {
                                    this.warn(`代码块缺少chunkId或id字段: ${JSON.stringify({
                                        hasChunkId: !!chunk.chunkId,
                                        hasId: !!chunk.id,
                                        filePath: chunk.filePath
                                    })}`);
                                }
                            }
                            this.log(`  📁 ${filePath}: 注册了 ${fileChunkCount} 个代码块`);
                        } else {
                            this.warn(`缓存数据格式异常: ${filePath}，期望有chunks字段但未找到。数据结构: ${JSON.stringify(Object.keys(cached || {}))}`);
                        }
                    } catch (error) {
                        this.warn(`Failed to load cache for ${filePath}:`, error.message);
                    }
                }
                
                const cacheLoadTime = performance.now() - cacheLoadStart;
                this.log(`📚 缓存加载完成: 总共注册了 ${totalCachedChunks} 个代码块 (${cacheLoadTime.toFixed(2)}ms)`);
                
                // 确保进度跟踪器显示所有文件和代码块已完成
                const finalProgress = this.progressTracker.getFileProgress();
                const chunkProgress = this.progressTracker.getOverallProgress();
                this.log(`Final Progress: ${finalProgress.completedFiles}/${finalProgress.totalFiles} files completed (${finalProgress.progressPercentage.toFixed(2)}%)`);
                this.log(`Chunk Progress: ${chunkProgress.completedChunks}/${chunkProgress.totalChunks} chunks completed (${chunkProgress.successRate.toFixed(2)}%)`);
                
                return true;
            }
            
            // 构建 Merkle 树 - 使用需要处理的文件列表
            let rootHash, tree;
            if (scanMerkleTree && scanMerkleTree.rootHash && filesToProcess.length === fileList.length) {
                // 如果fileScanner已经构建了增强的Merkle树且没有缓存优化，直接使用
                rootHash = scanMerkleTree.rootHash;
                tree = scanMerkleTree.tree;
                this.merkleTree.leaves = scanMerkleTree.leaves || [];
                this.merkleTree.tree = tree || [];
            } else {
                // 从需要处理的文件哈希构建Merkle树
                const hashArray = filesToProcess.map(filePath => fileHashes[filePath]);
                const result = this.merkleTree.buildTree(hashArray);
                rootHash = result.rootHash;
                tree = result.tree;
            }
            this.log(`Generated Merkle tree with root hash: ${rootHash}`);

            // 处理文件（仅处理未缓存的文件）
            this.log(`Processing ${filesToProcess.length} files concurrently...`);
            this.performanceAnalyzer.startFileParsing(filesToProcess.length);
            const fileObjects = filesToProcess.map((f, index) => ({ 
                path: f,
                merkleProof: this.merkleTree.getProof(index)
            }));
            
            let processedChunks = [];
            if (fileObjects.length > 0) {
                processedChunks = await this.dispatcher.processFilesConcurrently(fileObjects, this.parserSelector);
            }
            
            // 从缓存中获取已处理的块
            let cachedChunks = [];
            if (cachedFiles.length > 0) {
                this.log(`🗃️ 从缓存加载 ${cachedFiles.length} 个文件的结果...`);
                const cacheLoadStart = performance.now();
                
                for (const filePath of cachedFiles) {
                    try {
                        const cached = await this.cacheSystem.cache.get(filePath, fileHashes[filePath]);
                        if (cached && (cached.chunks || (cached.result && cached.result.chunks))) {
                            // 兼容两种缓存格式：直接chunks字段 或 result.chunks字段
                            const chunks = cached.chunks || cached.result.chunks;
                            cachedChunks.push(...chunks);
                        }
                    } catch (error) {
                        this.warn(`Failed to load cache for ${filePath}:`, error.message);
                    }
                }
                
                const cacheLoadTime = performance.now() - cacheLoadStart;
                this.log(`📚 缓存加载完成: ${cachedChunks.length} 个块 (${cacheLoadTime.toFixed(2)}ms)`);
            }
            
            // 合并处理结果和缓存结果
            const chunks = [...processedChunks, ...cachedChunks];
            
            // 异步存储新处理的结果到缓存
            if (processedChunks.length > 0) {
                this.log('💾 异步存储处理结果到缓存...');
                const cacheStorePromises = filesToProcess.map(async (filePath) => {
                    try {
                        const fileChunks = processedChunks.filter(chunk => chunk.filePath === filePath);
                        if (fileChunks.length > 0) {
                            const cacheData = {
                                chunks: fileChunks,
                                metadata: {
                                    processedAt: new Date().toISOString(),
                                    chunkCount: fileChunks.length,
                                    fileSize: fileContents[filePath]?.length || 0
                                }
                            };
                            await this.cacheSystem.cache.set(filePath, fileHashes[filePath], cacheData);
                        }
                    } catch (error) {
                        this.warn(`Failed to cache results for ${filePath}:`, error.message);
                    }
                });
                
                // 不等待缓存完成，继续处理
                Promise.all(cacheStorePromises).then(() => {
                    this.log('✅ 处理结果已存储到缓存');
                }).catch(error => {
                    this.warn('部分缓存存储失败:', error.message);
                });
            }
            
            // 获取真实的Worker统计信息
            const workerStats = this.dispatcher.getWorkerStats();
            const processedFiles = filesToProcess.length;
            const successFiles = processedChunks.length > 0 ? processedFiles : 0;
            const failedFiles = processedFiles - successFiles;
            const syncCount = workerStats.useWorkers ? 0 : processedFiles;
            const workerCount = workerStats.useWorkers ? processedFiles : 0;
            
            this.performanceAnalyzer.endFileParsing(
                successFiles, 
                failedFiles, 
                workerStats.workerFailures, 
                syncCount, 
                workerCount
            );
            
            this.log(`📊 处理结果统计:`);
            this.log(`   🆕 新处理: ${processedChunks.length} 个块 (来自 ${processedFiles} 个文件)`);
            this.log(`   🗃️ 缓存加载: ${cachedChunks.length} 个块 (来自 ${cachedFiles.length} 个文件)`);
            this.log(`   📦 总计: ${chunks.length} 个块`);
            
            // 记录分块生成信息
            const chunkSizes = chunks.map(chunk => chunk.content ? chunk.content.length : 0);
            this.performanceAnalyzer.recordChunkGeneration(chunks.length, chunkSizes);
            
            // ============ 集合清理和重新创建 - 强制执行 ============
            this.log('开始清理和重新创建集合（强制执行）');
            this.performanceAnalyzer.startVectorDBOperations();
            await this._cleanAndRecreateCollection(userId, deviceId, workspacePath);
            this.log('集合清理和重新创建完成');
            
            this.log('Sending chunks to embedding service...');
            this.performanceAnalyzer.startEmbeddingGeneration();
            await this.sender.sendChunks(chunks, rootHash);
             
            // 数据已直接发送到向量数据库，无需额外持久化

            // 更新文件处理状态为完成
            if (this.progressTracker) {
                // 🔥 只标记新处理的文件为已完成（缓存文件已经在开始时标记为完成）
                for (const filePath of filesToProcess) {
                    this.progressTracker.updateFileStatus(filePath, 'completed');
                }
                this.log(`Marked ${filesToProcess.length} newly processed files as completed.`);
                
                const finalProgress = this.progressTracker.getOverallProgress();
                const fileProgress = this.progressTracker.getFileProgress();
                
                this.log(`File Processing Summary: ${fileProgress.completedFiles}/${fileProgress.totalFiles} files completed (${fileProgress.progressPercentage.toFixed(2)}%)`);
                this.log(`Chunk Processing Summary: ${finalProgress.completedChunks}/${finalProgress.totalChunks} chunks completed (${finalProgress.successRate.toFixed(2)}%)`);
                
                if (finalProgress.successRate < 100) {
                    this.warn("Some chunks could not be sent");
                }
                
                // 记录内存使用情况
                this.performanceAnalyzer.recordMemoryUsage('completion');
                
                // 完成性能分析并生成报告
                this.performanceAnalyzer.endVectorDBOperations(chunks.length, Math.ceil(chunks.length / 10)); // 假设每批10个
                const performanceReport = await this.performanceAnalyzer.endAnalysis();
                
                this.log(`\n🎉 ============== 项目处理完成 ==============`);
                this.log(`📊 性能测速报告已自动生成:`);
                this.log(`   📁 报告文件夹: ${this.performanceAnalyzer.reportFolder}`);
                this.log(`   📄 JSON报告: ${this.performanceAnalyzer.reportPath}`);
                this.log(`   📄 MD报告: ${this.performanceAnalyzer.reportPath.replace('.json', '.md')}`);
                
                if (performanceReport) {
                    const totalTime = (performanceReport.summary.totalDuration / 1000).toFixed(2);
                    const score = this.performanceAnalyzer._calculatePerformanceScore(performanceReport);
                    
                    this.log(`\n📈 性能概览:`);
                    this.log(`   ⏱️  总处理时间: ${totalTime}秒`);
                    this.log(`   📁 处理文件数: ${performanceReport.summary.processedFiles}/${performanceReport.summary.totalFiles}`);
                    this.log(`   🧩 生成代码块: ${performanceReport.summary.totalChunks}`);
                    this.log(`   🌐 Embedding请求: ${performanceReport.summary.totalEmbeddingRequests}`);
                    this.log(`   📊 插入向量数: ${performanceReport.summary.insertedVectors}`);
                    this.log(`   🎯 性能评分: ${score}/100 分`);
                    
                    if (performanceReport.performance.bottlenecks.length > 0) {
                        this.log(`\n🚨 发现 ${performanceReport.performance.bottlenecks.length} 个性能瓶颈:`);
                        performanceReport.performance.bottlenecks.forEach((bottleneck, index) => {
                            const icon = bottleneck.impact === 'high' ? '🔴' : bottleneck.impact === 'medium' ? '🟡' : '🟢';
                            this.log(`   ${index + 1}. ${icon} ${bottleneck.phase}: ${bottleneck.description}`);
                        });
                    } else {
                        this.log(`\n✅ 未检测到明显性能瓶颈，运行良好！`);
                    }
                    
                    if (performanceReport.performance.recommendations.length > 0) {
                        this.log(`\n💡 性能优化建议:`);
                        performanceReport.performance.recommendations.slice(0, 3).forEach((rec, index) => {
                            const icon = rec.priority === 'high' ? '🔴' : rec.priority === 'medium' ? '🟡' : '🟢';
                            this.log(`   ${index + 1}. ${icon} ${rec.category}: ${rec.suggestion}`);
                        });
                    }
                }
                
                this.log(`\n📋 请查看详细的性能测速报告以了解更多信息。`);
                this.log(`===============================================\n`);
            }
            
            // 显示缓存统计信息
            try {
                const cacheStats = await this.cacheSystem.getSystemStats();
                this.log(`\n🗃️ ============== 缓存系统统计 ==============`);
                this.log(`📊 缓存性能:`);
                this.log(`   📈 命中率: ${cacheStats.parser.hitRate}`);
                this.log(`   📝 总请求: ${cacheStats.parser.totalRequests}`);
                this.log(`   ✅ 缓存命中: ${cacheStats.parser.cacheHits}`);
                this.log(`   ❌ 缓存未命中: ${cacheStats.parser.cacheMisses}`);
                this.log(`   ⏱️  平均解析时间: ${cacheStats.parser.avgParseTime}`);
                this.log(`   ⚡ 平均缓存时间: ${cacheStats.parser.avgCacheTime}`);
                
                this.log(`\n💾 数据库状态:`);
                this.log(`   📁 缓存条目: ${cacheStats.cache.database.entryCount} 个`);
                this.log(`   📦 总大小: ${this._formatBytes(cacheStats.cache.database.totalSize)}`);
                this.log(`   📊 平均大小: ${this._formatBytes(cacheStats.cache.database.avgSize)}`);
                
                if (cacheStats.cache.database.entryCount > 0) {
                    this.log(`   📅 最旧条目: ${new Date(cacheStats.cache.database.oldestEntry).toLocaleString()}`);
                    this.log(`   🆕 最新条目: ${new Date(cacheStats.cache.database.newestEntry).toLocaleString()}`);
                }
                
                this.log(`\n💡 缓存效益:`);
                const timeSaved = cachedFiles.length > 0 ? 
                    `节省了约 ${(cachedFiles.length * parseFloat(cacheStats.parser.avgParseTime) / 1000).toFixed(2)} 秒解析时间` :
                    '本次运行未使用缓存';
                this.log(`   ⏰ ${timeSaved}`);
                this.log(`===============================================\n`);
            } catch (error) {
                this.warn('获取缓存统计失败:', error.message);
            }

            const endTime = Date.now();
            this.log(`Code Chunker completed in ${((endTime - startTime) / 1000).toFixed(2)} seconds`);

            return true;
        } catch (error) {
            this.error('❌ Error in processWorkspace:', error);
            this.error('❌ Error details:', {
                name: error.name,
                message: error.message,
                stack: error.stack
            });
            
            // 向上抛出错误而不是返回false，这样TypeScript层可以看到具体错误
            throw error;
        }
    }

    // 添加搜索方法
    async search(query, options = {}) {
        if (!this.vectorManager) {
            throw new Error('VectorManager is not enabled');
        }

        try {
            const searchResults = await this.vectorManager.search(query, options.topK || 10, {
                userId: this.config.userId,
                deviceId: this.config.deviceId,
                workspacePath: this.config.workspacePath,
                ...options
            });

            // 过滤掉包含"unknown"的结果
            const filteredResults = this._filterUnknownResults(searchResults);
            
            // 记录过滤信息
            if (searchResults.length !== filteredResults.length) {
                this.log(`搜索结果过滤: 原始${searchResults.length}条 -> 过滤后${filteredResults.length}条 (移除了${searchResults.length - filteredResults.length}条包含"unknown"的结果)`);
            }

            return filteredResults;
        } catch (error) {
            this.error('Error searching vectors:', error);
            throw error;
        }
    }

    /**
     * 过滤包含"unknown"的搜索结果
     * @param {Array} results - 原始搜索结果
     * @returns {Array} 过滤后的结果
     */
    _filterUnknownResults(results) {
        if (!Array.isArray(results)) {
            return results;
        }

        return results.filter(result => {
            // 检查各个可能包含"unknown"的字段
            const fieldsToCheck = [
                result.filePath,
                result.content, 
                result.chunkId,
                result.metadata?.userId,
                result.metadata?.deviceId,
                result.metadata?.workspacePath,
                result.metadata?.vectorModel
            ];

            // 检查是否有任何字段包含"unknown"（不区分大小写）
            const hasUnknown = fieldsToCheck.some(field => {
                if (typeof field === 'string') {
                    return field.toLowerCase().includes('unknown');
                }
                return false;
            });

            // 额外检查：如果filePath是"unknown"或以"unknown"开头，也过滤掉
            if (result.filePath && 
                (result.filePath.toLowerCase() === 'unknown' || 
                 result.filePath.toLowerCase().startsWith('unknown/'))) {
                return false;
            }

            // 额外检查：如果content为空或只有空白字符，也过滤掉
            if (!result.content || result.content.trim().length === 0) {
                return false;
            }

            return !hasUnknown;
        });
    }

    /**
     * 获取文件处理进度百分比
     * @returns {number} 0-100之间的浮点数
     */
    getFileProcessingProgress() {
        if (!this.progressTracker) {
            return 0;
        }
        return this.progressTracker.getFileProgressPercentage();
    }

    /**
     * 获取详细的文件处理进度信息
     * @returns {Object} 包含详细进度信息的对象
     */
    getFileProcessingDetails() {
        if (!this.progressTracker) {
            return {
                totalFiles: 0,
                completedFiles: 0,
                processingFiles: 0,
                failedFiles: 0,
                pendingFiles: 0,
                progressPercentage: 0
            };
        }
        return this.progressTracker.getFileProgress();
    }

    // 添加关闭方法
    async shutdown() {
        try {
            if (this.vectorManager) {
                await this.vectorManager.shutdown();
            }
            if (this.sender) {
                await this.sender.shutdown();
            }
            if (this.cacheSystem) {
                await this.cacheSystem.shutdown();
            }
        } catch (error) {
            this.error('Error during shutdown:', error);
        }
    }
    
    /**
     * 格式化字节大小
     * @param {number} bytes 字节数
     * @returns {string} 格式化后的大小字符串
     */
    _formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
        return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
    }

    /**
     * 清理并重新创建集合
     * 确保每次处理工作空间时都有一个干净的向量数据库集合
     */
    async _cleanAndRecreateCollection(userId, deviceId, workspacePath) {
        // 强制执行模式：如果VectorManager不存在，尝试创建一个
        if (!this.vectorManager) {
            this.log('VectorManager不存在，尝试强制初始化...');
            try {
                // 确保有基础配置
                if (!this.config.vectorManager) {
                    this.config.vectorManager = { enabled: true };
                }
                this.vectorManager = new VectorManager(this.config.vectorManager);
                await this.vectorManager.initialize();
                this.log('VectorManager强制初始化成功');
            } catch (error) {
                this.error('VectorManager强制初始化失败:', error);
                this.warn('跳过集合清理操作');
                return;
            }
        }
        
        if (!this.vectorManager.vectorDB) {
            this.warn('VectorDB not available for collection cleanup');
            return;
        }



        this.log('========== 开始清理和重新创建集合 ==========');
        
        // 生成集合标识符（与VectorManager保持一致）
        const crypto = require('crypto');
const { createCollectionName } = require('./utils/collectionNameUtils');
        const workspaceHash = crypto
            .createHash('sha256')
            .update(workspacePath)
            .digest('hex')
            .substring(0, 16); // 取前16位
        // 使用统一的collection名称生成工具
        const collectionName = createCollectionName(userId, deviceId, workspacePath);
        const databaseName = this.config.vectorManager?.database?.query?.defaultDatabase || 'vectorservice-test';
        
        this.log(`集合标识: ${collectionName}`);
        this.log(`数据库名: ${databaseName}`);

        // 步骤1：删除现有集合（如果存在）
        this.log(`步骤1: 删除现有集合 ${collectionName}`);
        try {
            const deleteResult = await this.vectorManager.vectorDB.implementation.dropCollection(databaseName, collectionName);
            this.log('✅ 集合删除成功:', deleteResult);
        } catch (error) {
            // 如果集合不存在，这是正常的
            if (error.message.includes('not exist') || 
                error.message.includes('找不到') || 
                error.message.includes('does not exist') ||
                error.code === 'COLLECTION_NOT_FOUND' || 
                error.status === 404 ||
                error.response?.status === 404) {
                this.log('✅ 集合不存在，无需删除（这是正常的）');
            } else {
                this.warn('⚠️ 删除集合时出现错误:', {
                    message: error.message,
                    code: error.code,
                    status: error.status || error.response?.status
                });
                // 继续执行，不中断处理
            }
        }
        
        // 步骤2：等待确保删除操作完成
        this.log('步骤2: 等待删除操作完成...');
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // 步骤3：创建新的干净集合
        this.log(`步骤3: 创建新集合 ${collectionName}`);
        try {
            const createResult = await this.vectorManager.vectorDB.implementation.createCollection(databaseName, collectionName, {
                description: `工作空间集合 - ${collectionName} - ${new Date().toISOString()}`,
                replicaNum: 0,  // 腾讯云要求必须为0
                shardNum: 1,
                indexes: [
                    // 主键索引
                    {
                        fieldName: "id",
                        fieldType: "string",
                        indexType: "primaryKey"
                    },
                    // 向量索引
                    {
                        fieldName: "vector",
                        fieldType: "vector",
                        indexType: "HNSW",
                        dimension: this.config.vectorManager?.database?.collections?.vectorDimension || 768,
                        metricType: this.config.vectorManager?.database?.collections?.metricType || "COSINE",
                        params: {
                            M: 16,
                            efConstruction: 200
                        }
                    },
                    // 元数据字段索引（用于过滤）
                    {
                        fieldName: "user_id",
                        fieldType: "string",
                        indexType: "filter"
                    },
                    {
                        fieldName: "device_id",
                        fieldType: "string",
                        indexType: "filter"
                    },
                    {
                        fieldName: "workspace_path",
                        fieldType: "string",
                        indexType: "filter"
                    },
                    {
                        fieldName: "file_path",
                        fieldType: "string",
                        indexType: "filter"
                    },
                    {
                        fieldName: "start_line",
                        fieldType: "uint64",
                        indexType: "filter"
                    },
                    {
                        fieldName: "end_line",
                        fieldType: "uint64",
                        indexType: "filter"
                    },
                    {
                        fieldName: "code",
                        fieldType: "string",
                        indexType: "filter"
                    },
                    {
                        fieldName: "vector_model",
                        fieldType: "string",
                        indexType: "filter"
                    }
                ]
            });
            this.log('✅ 集合创建成功:', createResult);
        } catch (error) {
            this.error('❌ 创建集合失败:', {
                message: error.message,
                code: error.code,
                status: error.status,
                response: error.response?.data
            });
            throw error;
        }
        
        // 步骤4：验证集合已创建
        this.log('步骤4: 验证集合状态');
        try {
            const response = await this.vectorManager.vectorDB.implementation.listCollections(databaseName);
            const collections = response.data?.collections || [];
            
            this.log('验证集合列表:', collections.map(col => col.collectionName || col.collection || col.name));
            
            const collectionExists = collections.some(col => 
                col.collectionName === collectionName || 
                col.collection === collectionName ||
                col.name === collectionName
            );
            
            if (collectionExists) {
                this.log('✅ 集合创建验证成功，环境准备完毕');
            } else {
                this.warn('⚠️ 在集合列表中未找到目标集合，但这可能是正常的（延迟）');
            }
        } catch (error) {
            this.error('❌ 验证集合状态失败:', error.message);
            throw error;
        }
        
        this.log('========== 集合清理和重新创建完成 ==========');
    }
}

module.exports = CodeChunker;