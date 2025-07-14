const fs = require('fs');
const path = require('path');

// 静态导入所有解析器 - 这样webpack就能在编译时知道这些模块
const CParser = require('./CParser');
const CppParser = require('./CppParser');
const CSharpParser = require('./CSharpParser');
const GoParser = require('./GoParser');
const JavaParser = require('./JavaParser');
const JavaScriptParser = require('./JavaScriptParser');
const PHPParser = require('./PHPParser');
const PythonParser = require('./PythonParser');
const RustParser = require('./RustParser');

class PluginManager {
    constructor() {
        this.plugins = new Map();
        this.languageExtensions = new Map();
        
        // 使用静态导入而不是动态require
        this.availableParsers = {
            'CParser': CParser,
            'CppParser': CppParser,
            'CSharpParser': CSharpParser,
            'GoParser': GoParser,
            'JavaParser': JavaParser,
            'JavaScriptParser': JavaScriptParser,
            'PHPParser': PHPParser,
            'PythonParser': PythonParser,
            'RustParser': RustParser
        };
        
        console.log('🔌 [PluginManager] 初始化插件管理器...');
        this.loadStaticParsers();
    }
    
    loadStaticParsers() {
        console.log('🔌 [PluginManager] 使用静态导入加载解析器...');
        
        let loadedCount = 0;
        
        for (const [parserName, ParserClass] of Object.entries(this.availableParsers)) {
            try {
                // 检查是否有getMetadata方法
                if (typeof ParserClass.getMetadata === 'function') {
                    const metadata = ParserClass.getMetadata();
                    console.log(`✅ [PluginManager] 成功加载插件: ${parserName} (${metadata.name})`);
                    
                    // 注册插件
                    this.plugins.set(metadata.name, {
                        name: metadata.name,
                        parser: ParserClass,
                        metadata: metadata
                    });
                    
                    // 注册文件扩展名
                    if (metadata.extensions) {
                        metadata.extensions.forEach(ext => {
                            this.languageExtensions.set(ext, metadata.name);
                        });
                    }
                    
                    loadedCount++;
                } else {
                    console.log(`⚠️ [PluginManager] ${parserName} 没有getMetadata方法，使用名称推断`);
                    
                    // 从类名推断语言信息
                    const languageName = parserName.replace('Parser', '').toLowerCase();
                    const inferredMetadata = this.inferMetadataFromName(languageName);
                    
                    this.plugins.set(languageName, {
                        name: languageName,
                        parser: ParserClass,
                        metadata: inferredMetadata
                    });
                    
                    // 注册文件扩展名
                    if (inferredMetadata.extensions) {
                        inferredMetadata.extensions.forEach(ext => {
                            this.languageExtensions.set(ext, languageName);
                        });
                    }
                    
                    loadedCount++;
                }
            } catch (error) {
                console.warn(`⚠️ [PluginManager] 插件 ${parserName} 加载失败 (tree-sitter依赖可能未安装): ${error.message}`);
                // 继续加载其他插件，不要因为一个插件失败就停止
                console.warn(`   提示: 如果您不需要 ${parserName}，可以安全忽略此警告`);
            }
        }
        
        console.log(`🔌 [PluginManager] 插件加载完成，成功加载 ${loadedCount} 个插件`);
        
        // 显示加载的插件信息
        console.log('🔌 已加载的语言解析器:');
        for (const [language, plugin] of this.plugins) {
            console.log(`  - ${language}: ${plugin.metadata.extensions?.join(', ') || 'N/A'}`);
        }
    }
    
    // 从文件名推断元数据
    inferMetadataFromName(languageName) {
        const extensionMap = {
            'c': ['.c', '.h'],
            'cpp': ['.cpp', '.cxx', '.cc', '.hpp', '.hxx'],
            'csharp': ['.cs'],
            'go': ['.go'],
            'java': ['.java'],
            'javascript': ['.js', '.mjs', '.ts', '.tsx'],
            'php': ['.php'],
            'python': ['.py', '.pyx', '.pyi', '.pyw'],
            'rust': ['.rs']
        };
        
        return {
            name: languageName,
            extensions: extensionMap[languageName] || [],
            version: '1.0.0'
        };
    }
    
    getPlugin(language) {
        return this.plugins.get(language);
    }
    
    getParserForExtension(extension) {
        const language = this.languageExtensions.get(extension);
        return language ? this.getPlugin(language) : null;
    }
    
    getSupportedLanguages() {
        return Array.from(this.plugins.keys());
    }
    
    getSupportedExtensions() {
        return Array.from(this.languageExtensions.keys());
    }
    
    isLanguageSupported(language) {
        return this.plugins.has(language);
    }
    
    getPluginStats() {
        const stats = {
            totalPlugins: this.plugins.size,
            supportedLanguages: this.getSupportedLanguages(),
            supportedExtensions: this.getSupportedExtensions(),
            plugins: {}
        };
        
        for (const [language, plugin] of this.plugins) {
            stats.plugins[language] = {
                name: plugin.metadata.name,
                extensions: plugin.metadata.extensions || [],
                version: plugin.metadata.version || '1.0.0'
            };
        }
        
        return stats;
    }
    
    // 兼容性方法 - 保持与旧版本的兼容性
    discoverPlugins() {
        // 这个方法现在不需要做任何事情，因为我们使用静态导入
        console.log('🔌 [PluginManager] discoverPlugins() 调用 - 使用静态导入，无需动态发现');
    }
}

module.exports = PluginManager; 