const PluginManager = require('./PluginManager');

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

    // 解析代码的主要方法 - 兼容两种调用方式
    async parse(filePathOrCode, contentOrLanguage) {
        let code, language;
        
        // 检测调用方式：如果第一个参数包含路径分隔符，认为是文件路径
        if (typeof filePathOrCode === 'string' && 
            (filePathOrCode.includes('/') || filePathOrCode.includes('\\') || filePathOrCode.includes('.'))) {
            // 文件路径模式：parse(filePath, content)
            const filePath = filePathOrCode;
            code = contentOrLanguage;
            
            // 从文件扩展名推断语言
            const ext = '.' + filePath.split('.').pop().toLowerCase();
            const plugin = this.pluginManager.getParserForExtension(ext);
            if (!plugin) {
                throw new Error(`不支持的文件类型: ${ext}`);
            }
            language = plugin.name;
        } else {
            // 代码模式：parse(code, language)
            code = filePathOrCode;
            language = contentOrLanguage;
        }

        const plugin = this.pluginManager.getPlugin(language);
        if (!plugin) {
            throw new Error(`不支持的语言: ${language}`);
        }

        try {
            const parser = new plugin.parser();
            return await parser.parseContent(code, typeof filePathOrCode === 'string' && 
                (filePathOrCode.includes('/') || filePathOrCode.includes('\\')) ? filePathOrCode : null);
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
    parseFile(code, filename) {
        const ext = '.' + filename.split('.').pop().toLowerCase();
        const plugin = this.pluginManager.getParserForExtension(ext);

        if (!plugin) {
            throw new Error(`不支持的文件类型: ${ext}`);
        }

        try {
            const parser = new plugin.parser();
            return parser.parse(code);
        } catch (error) {
            throw new Error(`解析文件失败 (${filename}): ${error.message}`);
        }
    }

    // 获取支持的语言列表
    getSupportedLanguages() {
        return this.pluginManager.getSupportedLanguages();
    }

    // 获取支持的文件扩展名
    getSupportedExtensions() {
        return this.pluginManager.getSupportedExtensions();
    }

    // 检查是否支持指定语言
    isLanguageSupported(language) {
        return this.pluginManager.isLanguageSupported(language);
    }

    // 检查是否支持指定文件扩展名
    isFileSupported(filename) {
        const ext = '.' + filename.split('.').pop().toLowerCase();
        return this.pluginManager.getParserForExtension(ext) !== null;
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

    // 获取特定语言的元数据
    getLanguageMetadata(language) {
        const plugin = this.pluginManager.getPlugin(language);
        return plugin ? plugin.metadata : null;
    }

    // 根据代码内容推断语言
    inferLanguage(code, filename = null) {
        // 首先尝试从文件名推断
        if (filename) {
            const ext = '.' + filename.split('.').pop().toLowerCase();
            const plugin = this.pluginManager.getParserForExtension(ext);
            if (plugin) {
                return plugin.name;
            }
        }

        // 基于代码内容的简单推断
        const codePatterns = {
            python: [/^import\s+\w+/, /^from\s+\w+\s+import/, /def\s+\w+\s*\(/],
            java: [/^import\s+[\w.]+;/, /public\s+class\s+\w+/, /public\s+static\s+void\s+main/],
            javascript: [/^import\s+.*from/, /^const\s+\w+\s*=/, /function\s+\w+\s*\(/],
            csharp: [/^using\s+[\w.]+;/, /public\s+class\s+\w+/, /namespace\s+\w+/],
            go: [/^package\s+\w+/, /^import\s+\(/, /func\s+\w+\s*\(/],
            rust: [/^use\s+[\w:]+;/, /fn\s+\w+\s*\(/, /struct\s+\w+/],
            c: [/^#include\s*</, /int\s+main\s*\(/, /printf\s*\(/],
            cpp: [/^#include\s*</, /using\s+namespace\s+std;/, /std::/],
            php: [/^<\?php/, /\$\w+\s*=/, /echo\s+/],
        };

        for (const [language, patterns] of Object.entries(codePatterns)) {
            if (this.isLanguageSupported(language)) {
                for (const pattern of patterns) {
                    if (pattern.test(code)) {
                        return language;
                    }
                }
            }
        }

        return null;
    }
}

module.exports = AstParser;
