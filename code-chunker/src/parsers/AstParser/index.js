const PluginManager = require('./PluginManager');
const path = require('path');

class AstParser {
    constructor() {
        this.pluginManager = new PluginManager();
        
        // 显示插件系统状态
        const stats = this.pluginManager.getPluginStats();
        console.log(`🔌 插件系统已启动 - 发现 ${stats.totalPlugins} 个语言解析器:`);
        stats.supportedLanguages.forEach(lang => {
            const plugin = this.pluginManager.getPlugin(lang);
            console.log(`  - ${lang}: ${plugin.metadata.extensions?.join(', ') || 'N/A'}`);
        });
    }
    
    // 修复：统一解析方法，支持文件路径和内容参数
    async parse(filePath, content) {
        try {
            // 如果只有一个参数，可能是旧的调用方式
            if (arguments.length === 1 && typeof filePath === 'string') {
                // 这可能是旧的 parse(code) 调用
                throw new Error('AstParser.parse 需要 filePath 和 content 两个参数');
            }
            
            // 如果content为空，返回空数组
            if (!content || typeof content !== 'string') {
                console.warn(`[AstParser] 无效的内容参数: ${filePath}`);
                return [];
            }
            
            // 根据文件扩展名确定语言
            const language = this.detectLanguageFromFile(filePath);
            if (!language) {
                console.warn(`[AstParser] 无法识别文件语言: ${filePath}`);
                return [];
            }
            
            // 检查是否支持该语言
            if (!this.isLanguageSupported(language)) {
                console.warn(`[AstParser] 不支持的语言: ${language} (文件: ${filePath})`);
                return [];
            }
            
            // 获取对应的解析器
            const plugin = this.pluginManager.getPlugin(language);
            if (!plugin) {
                console.warn(`[AstParser] 找不到解析器: ${language}`);
                return [];
            }
            
            // 创建解析器实例并解析
            const parser = new plugin.parser();
            return await parser.parseContent(content, filePath);
            
        } catch (error) {
            console.error(`[AstParser] 解析文件失败 (${filePath}):`, error.message);
            return [];
        }
    }
    
    // 从文件路径检测语言
    detectLanguageFromFile(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        const plugin = this.pluginManager.getParserForExtension(ext);
        return plugin ? plugin.metadata.name : null;
    }
    
    // 原有的parse方法，保持向后兼容
    async parseByLanguage(code, language) {
        const plugin = this.pluginManager.getPlugin(language);
        if (!plugin) {
            throw new Error(`不支持的语言: ${language}`);
        }
        
        try {
            const parser = new plugin.parser();
            return await parser.parseContent(code);
        } catch (error) {
            throw new Error(`解析失败 (${language}): ${error.message}`);
        }
    }
    
    // 根据文件扩展名获取解析器
    getParserForFile(filename) {
        const ext = '.' + filename.split('.').pop().toLowerCase();
        const plugin = this.pluginManager.getParserForExtension(ext);
        return plugin ? plugin.parser : null;
    }
    
    // 根据文件扩展名解析代码
    async parseFile(code, filename) {
        const ext = '.' + filename.split('.').pop().toLowerCase();
        const plugin = this.pluginManager.getParserForExtension(ext);
        
        if (!plugin) {
            throw new Error(`不支持的文件类型: ${ext}`);
        }
        
        try {
            const parser = new plugin.parser();
            return await parser.parseContent(code, filename);
        } catch (error) {
            throw new Error(`解析文件失败 (${filename}): ${error.message}`);
        }
    }
    
    // 检查语言是否受支持
    isLanguageSupported(language) {
        return this.pluginManager.getPlugin(language) !== null;
    }
    
    // 获取所有支持的语言
    getSupportedLanguages() {
        return this.pluginManager.getSupportedLanguages();
    }
    
    // 获取插件统计信息
    getPluginStats() {
        return this.pluginManager.getPluginStats();
    }
    
    // 获取特定语言的解析器
    getParser(language) {
        const plugin = this.pluginManager.getPlugin(language);
        return plugin ? plugin.parser : null;
    }
}

module.exports = AstParser; 