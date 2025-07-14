const AstParser = require('../parsers/AstParser');
const IndexCache = require('./IndexCache');
const crypto = require('crypto');
const { performance } = require('perf_hooks');

/**
 * 带缓存功能的AST解析器
 * 在原有AstParser基础上增加缓存层，避免重复解析
 */
class CachedAstParser {
    constructor(cacheConfig = {}) {
        this.astParser = new AstParser();
        this.cache = new IndexCache(cacheConfig);
        this.initialized = false;
        this.stats = {
            totalRequests: 0,
            cacheHits: 0,
            cacheMisses: 0,
            parseTime: 0,
            cacheTime: 0
        };
        
        console.log('[CachedAstParser] 创建带缓存的AST解析器');
    }
    
    /**
     * 初始化缓存系统
     */
    async initialize() {
        if (this.initialized) {
            return;
        }
        
        await this.cache.initialize();
        this.initialized = true;
        console.log('[CachedAstParser] 缓存系统初始化完成');
    }
    
    /**
     * 确保缓存系统已初始化
     */
    async ensureInitialized() {
        if (!this.initialized) {
            await this.initialize();
        }
    }
    
    /**
     * 修复：统一解析方法，支持文件路径和内容参数
     * @param {string} filePath 文件路径
     * @param {string} content 文件内容
     * @returns {Object} 解析结果
     */
    async parse(filePath, content) {
        await this.ensureInitialized();
        
        this.stats.totalRequests++;
        const startTime = performance.now();
        
        try {
            // 验证参数
            if (!filePath || !content || typeof content !== 'string') {
                console.warn(`[CachedAstParser] 无效的参数: filePath=${filePath}, content=${typeof content}`);
                return [];
            }
            
            // 生成文件哈希
            const fileHash = this.generateFileHash(content);
            const cacheKey = `${filePath}_${fileHash}`;
            
            // 尝试从缓存获取
            const cacheStartTime = performance.now();
            const cached = await this.cache.get(cacheKey, fileHash);
            this.stats.cacheTime += performance.now() - cacheStartTime;
            
            if (cached) {
                this.stats.cacheHits++;
                console.log(`[CachedAstParser] 缓存命中: ${filePath}`);
                return cached.result || [];
            }
            
            // 缓存未命中，执行解析
            this.stats.cacheMisses++;
            const parseStartTime = performance.now();
            
            let result;
            try {
                result = await this.astParser.parse(filePath, content);
            } catch (error) {
                console.warn(`[CachedAstParser] 解析失败，但继续处理: ${filePath}`, error.message);
                // 返回空结果而不是抛出错误，让系统继续运行
                result = [];
            }
            
            this.stats.parseTime += performance.now() - parseStartTime;
            
            // 存储到缓存
            const cacheData = {
                result,
                metadata: {
                    filePath,
                    fileSize: content.length,
                    parsedAt: new Date().toISOString(),
                    parser: 'CachedAstParser'
                }
            };
            
            try {
                await this.cache.set(cacheKey, fileHash, cacheData);
            } catch (cacheError) {
                console.warn(`[CachedAstParser] 缓存存储失败: ${filePath}`, cacheError.message);
            }
            
            return result;
            
        } catch (error) {
            console.error(`[CachedAstParser] 解析错误: ${filePath}`, error);
            return [];
        }
    }
    
    /**
     * 原有的parse方法，保持向后兼容
     * @param {string} code 代码内容
     * @param {string} language 编程语言
     * @param {string} filePath 文件路径（可选，用于缓存标识）
     * @returns {Object} 解析结果
     */
    async parseByLanguage(code, language, filePath = null) {
        await this.ensureInitialized();
        
        this.stats.totalRequests++;
        const startTime = performance.now();
        
        try {
            // 生成文件哈希
            const fileHash = this.generateFileHash(code);
            const cacheKey = filePath || `${language}_${fileHash}`;
            
            // 尝试从缓存获取
            const cacheStartTime = performance.now();
            const cached = await this.cache.get(cacheKey, fileHash);
            this.stats.cacheTime += performance.now() - cacheStartTime;
            
            if (cached) {
                this.stats.cacheHits++;
                console.log(`[CachedAstParser] 缓存命中: ${cacheKey}`);
                return cached.result || [];
            }
            
            // 缓存未命中，执行解析
            this.stats.cacheMisses++;
            const parseStartTime = performance.now();
            
            let result;
            try {
                result = await this.astParser.parseByLanguage(code, language);
            } catch (error) {
                console.warn(`[CachedAstParser] 解析失败，但继续处理: ${language}`, error.message);
                // 返回空结果而不是抛出错误，让系统继续运行
                result = [];
            }
            
            this.stats.parseTime += performance.now() - parseStartTime;
            
            // 存储到缓存
            const cacheData = {
                result,
                metadata: {
                    language,
                    fileSize: code.length,
                    parsedAt: new Date().toISOString(),
                    parser: 'CachedAstParser'
                }
            };
            
            try {
                await this.cache.set(cacheKey, fileHash, cacheData);
            } catch (cacheError) {
                console.warn(`[CachedAstParser] 缓存存储失败: ${cacheKey}`, cacheError.message);
            }
            
            return result;
            
        } catch (error) {
            console.error(`[CachedAstParser] 解析错误: ${language}`, error);
            return [];
        }
    }
    
    /**
     * 解析文件（带缓存）
     * @param {string} code 代码内容
     * @param {string} filename 文件名
     * @returns {Object} 解析结果
     */
    async parseFile(code, filename) {
        await this.ensureInitialized();
        
        this.stats.totalRequests++;
        const startTime = performance.now();
        
        try {
            // 生成文件哈希
            const fileHash = this.generateFileHash(code);
            
            // 尝试从缓存获取
            const cacheStartTime = performance.now();
            const cached = await this.cache.get(filename, fileHash);
            this.stats.cacheTime += performance.now() - cacheStartTime;
            
            if (cached) {
                this.stats.cacheHits++;
                console.log(`[CachedAstParser] 文件缓存命中: ${filename}`);
                return cached.result;
            }
            
            // 缓存未命中，执行解析
            this.stats.cacheMisses++;
            const parseStartTime = performance.now();
            
            let result;
            try {
                result = await this.astParser.parseFile(code, filename);
            } catch (error) {
                console.warn(`[CachedAstParser] 解析失败，但继续处理: ${filename}`, error.message);
                // 返回空结果而不是抛出错误，让系统继续运行
                result = [];
            }
            
            this.stats.parseTime += performance.now() - parseStartTime;
            
            // 推断语言
            const language = this.astParser.inferLanguage(code, filename);
            
            // 存储到缓存
            const cacheData = {
                result,
                metadata: {
                    filename,
                    language,
                    fileSize: code.length,
                    parsedAt: new Date().toISOString(),
                    parser: 'AstParser'
                }
            };
            
            await this.cache.set(filename, fileHash, cacheData);
            console.log(`[CachedAstParser] 解析并缓存文件: ${filename}`);
            
            return result;
            
        } catch (error) {
            console.error(`[CachedAstParser] 解析文件失败 (${filename}):`, error);
            throw error;
        }
    }
    
    /**
     * 批量解析文件（带缓存优化）
     * @param {Array} fileList 文件列表 [{path, content, hash}]
     * @returns {Array} 解析结果列表
     */
    async batchParseFiles(fileList) {
        await this.ensureInitialized();
        
        console.log(`[CachedAstParser] 开始批量解析 ${fileList.length} 个文件`);
        
        // 批量检查缓存状态
        const cacheCheckStart = performance.now();
        const cacheStatus = await this.cache.batchCheck(
            fileList.map(file => ({
                path: file.path,
                hash: file.hash || this.generateFileHash(file.content)
            }))
        );
        this.stats.cacheTime += performance.now() - cacheCheckStart;
        
        console.log(`[CachedAstParser] 缓存状态: ${cacheStatus.cached.length} 命中, ${cacheStatus.uncached.length} 未命中`);
        
        const results = [];
        
        // 处理缓存命中的文件
        for (const file of cacheStatus.cached) {
            const cached = await this.cache.get(file.path, file.hash);
            if (cached) {
                results.push({
                    filePath: file.path,
                    result: cached.result,
                    fromCache: true,
                    metadata: cached.metadata
                });
                this.stats.cacheHits++;
            }
        }
        
        // 并行处理缓存未命中的文件
        const uncachedFiles = fileList.filter(file => 
            cacheStatus.uncached.some(uncached => uncached.path === file.path)
        );
        
        const parsePromises = uncachedFiles.map(async (file) => {
            try {
                const parseStartTime = performance.now();
                
                let result;
                try {
                    result = await this.astParser.parseFile(file.content, file.path);
                } catch (parseError) {
                    console.warn(`[CachedAstParser] 解析失败，但继续处理: ${file.path}`, parseError.message);
                    result = []; // 使用空结果继续处理
                }
                
                this.stats.parseTime += performance.now() - parseStartTime;
                
                const fileHash = file.hash || this.generateFileHash(file.content);
                const language = this.astParser.inferLanguage(file.content, file.path);
                
                const cacheData = {
                    result,
                    metadata: {
                        filename: file.path,
                        language,
                        fileSize: file.content.length,
                        parsedAt: new Date().toISOString(),
                        parser: 'AstParser'
                    }
                };
                
                // 异步存储到缓存
                this.cache.set(file.path, fileHash, cacheData).catch(error => {
                    console.error(`[CachedAstParser] 缓存存储失败 (${file.path}):`, error);
                });
                
                this.stats.cacheMisses++;
                this.stats.totalRequests++;
                
                return {
                    filePath: file.path,
                    result,
                    fromCache: false,
                    metadata: cacheData.metadata
                };
                
            } catch (error) {
                console.error(`[CachedAstParser] 批量解析失败 (${file.path}):`, error);
                return {
                    filePath: file.path,
                    error: error.message,
                    fromCache: false
                };
            }
        });
        
        const parseResults = await Promise.all(parsePromises);
        results.push(...parseResults);
        
        console.log(`[CachedAstParser] 批量解析完成: ${results.length} 个文件`);
        
        return results;
    }
    
    /**
     * 检查文件是否有有效缓存
     * @param {string} filePath 文件路径
     * @param {string} content 文件内容
     * @returns {boolean} 是否有有效缓存
     */
    async hasValidCache(filePath, content) {
        await this.ensureInitialized();
        
        const fileHash = this.generateFileHash(content);
        return await this.cache.has(filePath, fileHash);
    }
    
    /**
     * 清理指定文件的缓存
     * @param {string} filePath 文件路径
     */
    async invalidateCache(filePath) {
        await this.ensureInitialized();
        
        await this.cache.invalidateFile(filePath);
        console.log(`[CachedAstParser] 已清理文件缓存: ${filePath}`);
    }
    
    /**
     * 批量清理缓存
     * @param {Array} filePaths 文件路径列表
     */
    async batchInvalidateCache(filePaths) {
        await this.ensureInitialized();
        
        const promises = filePaths.map(filePath => this.cache.invalidateFile(filePath));
        await Promise.all(promises);
        console.log(`[CachedAstParser] 已批量清理 ${filePaths.length} 个文件的缓存`);
    }
    
    /**
     * 生成文件哈希
     */
    generateFileHash(content) {
        return crypto.createHash('md5').update(content, 'utf8').digest('hex');
    }
    
    /**
     * 获取缓存统计信息
     */
    async getCacheStats() {
        const cacheStats = await this.cache.getStats();
        
        return {
            parser: {
                totalRequests: this.stats.totalRequests,
                cacheHits: this.stats.cacheHits,
                cacheMisses: this.stats.cacheMisses,
                hitRate: this.stats.totalRequests > 0 ? 
                    (this.stats.cacheHits / this.stats.totalRequests * 100).toFixed(2) + '%' : '0%',
                avgParseTime: this.stats.cacheMisses > 0 ? 
                    (this.stats.parseTime / this.stats.cacheMisses).toFixed(2) + 'ms' : '0ms',
                avgCacheTime: this.stats.totalRequests > 0 ? 
                    (this.stats.cacheTime / this.stats.totalRequests).toFixed(2) + 'ms' : '0ms'
            },
            cache: cacheStats
        };
    }
    
    /**
     * 清除缓存
     */
    async clearCache() {
        await this.cache.clear();
        this.stats = {
            totalRequests: 0,
            cacheHits: 0,
            cacheMisses: 0,
            parseTime: 0,
            cacheTime: 0
        };
        console.log('[CachedAstParser] 缓存已清除');
    }
    
    /**
     * 预热缓存 - 对指定文件进行预解析
     * @param {Array} fileList 要预热的文件列表
     */
    async warmupCache(fileList) {
        await this.ensureInitialized();
        
        console.log(`[CachedAstParser] 开始缓存预热: ${fileList.length} 个文件`);
        
        const warmupPromises = fileList.map(async (file) => {
            try {
                if (!await this.hasValidCache(file.path, file.content)) {
                    await this.parseFile(file.content, file.path);
                    console.log(`[CachedAstParser] 预热完成: ${file.path}`);
                }
            } catch (error) {
                console.warn(`[CachedAstParser] 预热失败: ${file.path}`, error.message);
            }
        });
        
        await Promise.all(warmupPromises);
        console.log('[CachedAstParser] 缓存预热完成');
    }
    
    /**
     * 清理过期缓存
     */
    async cleanExpiredCache() {
        await this.ensureInitialized();
        
        await this.cache.cleanExpiredEntries();
        console.log('[CachedAstParser] 过期缓存清理完成');
    }
    
    /**
     * 关闭缓存系统
     */
    async shutdown() {
        await this.cache.shutdown();
        this.initialized = false;
        console.log('[CachedAstParser] 缓存系统已关闭');
    }
    
    // ==================== 委托方法 ====================
    // 将其他方法委托给原始AstParser
    
    getSupportedLanguages() {
        return this.astParser.getSupportedLanguages();
    }
    
    getSupportedExtensions() {
        return this.astParser.getSupportedExtensions();
    }
    
    isLanguageSupported(language) {
        return this.astParser.isLanguageSupported(language);
    }
    
    isFileSupported(filename) {
        return this.astParser.isFileSupported(filename);
    }
    
    getPluginStats() {
        return this.astParser.getPluginStats();
    }
    
    getParser(language) {
        return this.astParser.getParser(language);
    }
    
    getLanguageMetadata(language) {
        return this.astParser.getLanguageMetadata(language);
    }
    
    inferLanguage(code, filename = null) {
        return this.astParser.inferLanguage(code, filename);
    }
}

module.exports = CachedAstParser; 