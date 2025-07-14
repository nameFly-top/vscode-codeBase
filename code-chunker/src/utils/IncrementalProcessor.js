const path = require('path');

/**
 * 增量处理策略
 * 提供智能的增量更新、批量处理和缓存优化策略
 */
class IncrementalProcessor {
    constructor(config = {}) {
        this.config = {
            // 处理策略
            enableSmartFiltering: config.enableSmartFiltering !== false,
            enablePriorityProcessing: config.enablePriorityProcessing !== false,
            
            // 批量处理
            batchSize: config.batchSize || 50,
            maxConcurrency: config.maxConcurrency || 5,
            enableBatchOptimization: config.enableBatchOptimization !== false,
            
            // 缓存策略
            preserveExistingCache: config.preserveExistingCache !== false,
            enableCachePreload: config.enableCachePreload !== false,
            
            // 性能优化
            skipUnchangedFiles: config.skipUnchangedFiles !== false,
            enableDependencyAnalysis: config.enableDependencyAnalysis || false,
            
            // 调试配置
            verbose: config.verbose || false
        };
        
        // 处理统计
        this.stats = {
            totalFiles: 0,
            processedFiles: 0,
            skippedFiles: 0,
            batchesProcessed: 0,
            cacheHits: 0,
            cacheMisses: 0,
            processingTime: 0,
            optimizationsSaved: 0
        };
        
        // 内部状态
        this.processingQueue = [];
        this.priorityQueue = [];
        this.dependencyGraph = new Map();
        this.processingResults = new Map();
    }

    /**
     * 计划增量处理
     * @param {Object} changeResults 变更检测结果
     * @param {Object} cacheSystem 缓存系统
     * @returns {Object} 处理计划
     */
    async planIncrementalProcessing(changeResults, cacheSystem) {
        this.log('开始规划增量处理');
        
        try {
            // 重置统计
            this.resetStats();
            
            // 如果没有变更，返回空计划
            if (!changeResults.hasChanges) {
                return this.createEmptyPlan();
            }
            
            // 分析变更文件
            const fileAnalysis = await this.analyzeChangedFiles(changeResults.changedFiles);
            
            // 构建处理计划
            const processingPlan = await this.buildProcessingPlan(fileAnalysis, cacheSystem);
            
            // 优化处理顺序
            const optimizedPlan = this.optimizeProcessingOrder(processingPlan);
            
            this.log(`处理计划已生成: ${optimizedPlan.totalFiles} 个文件待处理`);
            return optimizedPlan;
            
        } catch (error) {
            this.error('规划增量处理失败:', error);
            throw error;
        }
    }

    /**
     * 创建处理计划（别名方法，兼容性）
     * @param {Object} changeResults - 变更结果
     * @param {Object} cacheSystem - 缓存系统
     * @returns {Object} 处理计划
     */
    async createProcessingPlan(changeResults, cacheSystem) {
        // 调用实际的方法
        if (changeResults && changeResults.changedFiles) {
            const fileAnalysis = await this.analyzeChangedFiles(changeResults.changedFiles);
            return await this.buildProcessingPlan(fileAnalysis, cacheSystem);
        }
        return this.createEmptyPlan();
    }

    /**
     * 执行增量处理
     * @param {Object} processingPlan 处理计划
     * @param {Function} processor 文件处理器函数
     * @returns {Object} 处理结果
     */
    async executeIncrementalProcessing(processingPlan, processor) {
        const startTime = performance.now();
        
        try {
            this.log(`开始执行增量处理: ${processingPlan.totalFiles} 个文件`);
            
            // 预加载缓存（如果启用）
            if (this.config.enableCachePreload && processingPlan.cachePreloadList) {
                await this.preloadCache(processingPlan.cachePreloadList);
            }
            
            // 处理高优先级文件
            const priorityResults = await this.processPriorityFiles(
                processingPlan.priorityFiles, 
                processor
            );
            
            // 批量处理普通文件
            const batchResults = await this.processBatchFiles(
                processingPlan.batchFiles, 
                processor
            );
            
            // 合并结果
            const allResults = [...priorityResults, ...batchResults];
            
            // 生成处理报告
            const processingReport = this.generateProcessingReport(allResults, startTime);
            
            this.log(`增量处理完成: ${allResults.length} 个文件处理完毕`);
            return processingReport;
            
        } catch (error) {
            this.error('执行增量处理失败:', error);
            throw error;
        }
    }

    /**
     * 分析变更文件
     * @private
     */
    async analyzeChangedFiles(changedFiles) {
        const analysis = {
            highPriority: [],
            mediumPriority: [],
            lowPriority: [],
            dependencies: new Map(),
            totalSize: 0
        };
        
        for (const change of changedFiles) {
            // 分析文件优先级
            const priority = this.getFilePriority(change.path, change.changeType);
            
            const fileInfo = {
                ...change,
                priority,
                estimatedSize: change.metadata?.size || 0,
                processingWeight: this.calculateProcessingWeight(change)
            };
            
            // 按优先级分类
            if (priority >= 8) {
                analysis.highPriority.push(fileInfo);
            } else if (priority >= 5) {
                analysis.mediumPriority.push(fileInfo);
            } else {
                analysis.lowPriority.push(fileInfo);
            }
            
            analysis.totalSize += fileInfo.estimatedSize;
            
            // 分析依赖关系（如果启用）
            if (this.config.enableDependencyAnalysis) {
                const dependencies = await this.analyzeDependencies(change.path);
                if (dependencies.length > 0) {
                    analysis.dependencies.set(change.path, dependencies);
                }
            }
        }
        
        this.log(`文件分析完成: 高优先级 ${analysis.highPriority.length}, 中优先级 ${analysis.mediumPriority.length}, 低优先级 ${analysis.lowPriority.length}`);
        return analysis;
    }

    /**
     * 构建处理计划
     * @private
     */
    async buildProcessingPlan(fileAnalysis, cacheSystem) {
        const plan = {
            priorityFiles: [],
            batchFiles: [],
            cachePreloadList: [],
            totalFiles: 0,
            estimatedTime: 0,
            optimizations: []
        };
        
        // 高优先级文件单独处理
        plan.priorityFiles = fileAnalysis.highPriority;
        
        // 中低优先级文件批量处理
        const regularFiles = [
            ...fileAnalysis.mediumPriority,
            ...fileAnalysis.lowPriority
        ];
        
        // 创建批次
        plan.batchFiles = this.createProcessingBatches(regularFiles);
        plan.batches = plan.batchFiles; // 添加兼容性属性
        
        // 计算总文件数
        plan.totalFiles = fileAnalysis.highPriority.length + regularFiles.length;
        
        // 估算处理时间
        plan.estimatedTime = this.estimateProcessingTime(fileAnalysis);
        
        // 缓存预加载列表
        if (this.config.enableCachePreload && cacheSystem) {
            plan.cachePreloadList = await this.buildCachePreloadList(fileAnalysis, cacheSystem);
        }
        
        // 记录优化策略
        plan.optimizations = this.identifyOptimizations(fileAnalysis);
        
        return plan;
    }

    /**
     * 识别优化策略
     * @private
     */
    identifyOptimizations(fileAnalysis) {
        const optimizations = [];
        
        if (!fileAnalysis || !fileAnalysis.changes) {
            return optimizations;
        }
        
        const changes = fileAnalysis.changes;
        
        // 批量处理优化
        if (changes.length > this.config.batchSize) {
            optimizations.push({
                type: 'batch_processing',
                description: `批量处理 ${changes.length} 个文件`,
                estimatedSaving: Math.floor(changes.length * 0.1) + 'ms'
            });
        }
        
        // 缓存优化
        const cacheHitCount = changes.filter(c => c.cacheHit).length;
        if (cacheHitCount > 0) {
            optimizations.push({
                type: 'cache_optimization',
                description: `缓存命中 ${cacheHitCount} 个文件`,
                estimatedSaving: Math.floor(cacheHitCount * 50) + 'ms'
            });
        }
        
        // 并行处理优化
        if (this.config.enableParallelProcessing && changes.length > 5) {
            optimizations.push({
                type: 'parallel_processing',
                description: `并行处理优化`,
                estimatedSaving: Math.floor(changes.length * 0.3) + 'ms'
            });
        }
        
        return optimizations;
    }

    /**
     * 构建缓存预加载列表
     * @private
     */
    async buildCachePreloadList(fileAnalysis, cacheSystem) {
        const preloadList = [];
        
        if (!fileAnalysis || !fileAnalysis.changes) {
            return preloadList;
        }
        
        try {
            // 基于文件优先级和依赖关系构建预加载列表
            const highPriorityFiles = fileAnalysis.highPriority || [];
            const regularFiles = fileAnalysis.regularFiles || [];
            
            // 添加高优先级文件到预加载列表
            for (const file of highPriorityFiles) {
                if (file.path) {
                    preloadList.push({
                        path: file.path,
                        priority: 'high',
                        reason: 'high_priority_file'
                    });
                }
            }
            
            // 添加前几个常规文件到预加载列表
            const regularPreloadCount = Math.min(5, regularFiles.length);
            for (let i = 0; i < regularPreloadCount; i++) {
                const file = regularFiles[i];
                if (file.path) {
                    preloadList.push({
                        path: file.path,
                        priority: 'normal',
                        reason: 'regular_file'
                    });
                }
            }
            
            this.log(`构建缓存预加载列表: ${preloadList.length} 个文件`);
            
        } catch (error) {
            this.warn('构建缓存预加载列表失败:', error);
        }
        
        return preloadList;
    }

    /**
     * 优化处理顺序
     * @private
     */
    optimizeProcessingOrder(plan) {
        // 按依赖关系排序高优先级文件
        if (this.config.enableDependencyAnalysis) {
            plan.priorityFiles = this.sortByDependencies(plan.priorityFiles);
        }
        
        // 优化批次内文件顺序
        for (const batch of plan.batchFiles) {
            batch.files.sort((a, b) => {
                // 按处理权重排序
                return b.processingWeight - a.processingWeight;
            });
        }
        
        return plan;
    }

    /**
     * 计算文件优先级
     * @private
     */
    getFilePriority(filePath, changeType) {
        let priority = 1;
        
        // 输入验证
        if (!filePath || typeof filePath !== 'string') {
            return priority;
        }
        
        // 根据变更类型调整优先级
        if (changeType === 'added') priority += 2;
        if (changeType === 'modified') priority += 1;
        if (changeType === 'deleted') priority += 0;
        
        // 根据文件类型调整优先级
        const ext = filePath.split('.').pop()?.toLowerCase();
        if (['js', 'ts', 'jsx', 'tsx'].includes(ext)) priority += 5;
        if (['py', 'java', 'cpp', 'c'].includes(ext)) priority += 4;
        if (['css', 'scss', 'html'].includes(ext)) priority += 2;
        
        // 根据文件名调整优先级
        const fileName = filePath.split('/').pop();
        if (['index.js', 'main.js', 'app.js'].includes(fileName)) priority += 3;
        if (fileName && fileName.includes('config')) priority += 2;
        
        return Math.min(priority, 10); // 限制最大优先级
    }

    /**
     * 计算处理权重
     * @private
     */
    calculateProcessingWeight(change) {
        let weight = 1;
        
        // 文件大小影响
        const size = change.metadata?.size || 0;
        if (size > 100000) weight += 3; // 大文件
        else if (size > 10000) weight += 1; // 中等文件
        
        // 变更类型影响
        if (change.changeType === 'added') weight += 2;
        if (change.changeType === 'modified') weight += 1;
        
        return weight;
    }

    /**
     * 创建处理批次
     * @private
     */
    createProcessingBatches(files) {
        const batches = [];
        const sortedFiles = files.sort((a, b) => b.processingWeight - a.processingWeight);
        
        for (let i = 0; i < sortedFiles.length; i += this.config.batchSize) {
            const batchFiles = sortedFiles.slice(i, i + this.config.batchSize);
            batches.push({
                id: Math.floor(i / this.config.batchSize) + 1,
                files: batchFiles,
                estimatedTime: this.estimateBatchTime(batchFiles)
            });
        }
        
        return batches;
    }

    /**
     * 创建空处理计划
     * @private
     */
    createEmptyPlan() {
        return {
            priorityFiles: [],
            batchFiles: [],
            batches: [], // 添加 batches 属性以兼容测试
            totalFiles: 0,
            estimatedTime: 0,
            optimizations: ['no_changes_detected'],
            message: '无变更检测到，跳过处理'
        };
    }

    /**
     * 估算处理时间
     * @private
     */
    estimateProcessingTime(fileAnalysis) {
        const avgTimePerFile = 50; // 假设每个文件平均50ms
        const totalFiles = fileAnalysis.highPriority.length + 
                          fileAnalysis.mediumPriority.length + 
                          fileAnalysis.lowPriority.length;
        return totalFiles * avgTimePerFile;
    }

    /**
     * 估算批次时间
     * @private
     */
    estimateBatchTime(files) {
        return files.reduce((total, file) => total + (file.processingWeight * 20), 0);
    }

    /**
     * 获取统计信息
     */
    getStats() {
        return { ...this.stats };
    }

    /**
     * 重置统计信息
     * @private
     */
    resetStats() {
        this.stats = {
            totalFiles: 0,
            processedFiles: 0,
            skippedFiles: 0,
            batchesProcessed: 0,
            cacheHits: 0,
            cacheMisses: 0,
            processingTime: 0,
            optimizationsSaved: 0
        };
    }

    // 日志方法
    log(message) {
        if (this.config.verbose) {
            console.log(`[IncrementalProcessor] ${message}`);
        }
    }

    warn(message, error) {
        console.warn(`[IncrementalProcessor] ⚠️ ${message}`, error ? error.message : '');
    }

    error(message, error) {
        console.error(`[IncrementalProcessor] ❌ ${message}`, error);
    }
}

module.exports = IncrementalProcessor; 