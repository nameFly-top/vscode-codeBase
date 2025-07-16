const path = require('path');
const BaseParser = require('./parsers/BaseParser');
const AstParser = require('./parsers/AstParser');
const ReadlineParser = require('./parsers/ReadlineParser');
const FilenameParser = require('./parsers/FilenameParser');

class ParserSelector {
    constructor(config) {
        this.config = config;
        this.parsers = new Map();
        this._initializeParsers();
    }

    _initializeParsers() {
        // 初始化所有可用的解析器
        this.astParser = new AstParser(this.config);
        this.parsers.set('ast', this.astParser);
        this.parsers.set('readline', new ReadlineParser(this.config));
        this.parsers.set('filename', new FilenameParser(this.config));
    }

    selectParser(filePath) {
        try {
        const extension = path.extname(filePath).toLowerCase();
            console.log(`[ParserSelector] 选择解析器 for ${filePath} (ext: ${extension})`);
            
        const languageMapping = this.config.languageMapping || {
            '.py': 'python',
            '.java': 'java',
            '.cs': 'csharp',
            '.rs': 'rust',
            '.go': 'go',
                '.c': 'c',
                '.h': 'c',
            '.js': 'javascript',
            '.jsx': 'javascript',
            '.ts': 'javascript',
            '.tsx': 'javascript',
            '.php': 'php',
            '.cpp': 'cpp',
            '.cxx': 'cpp',
            '.cc': 'cpp',
            '.hpp': 'cpp',
            '.hxx': 'cpp',
                // 添加更多文件类型支持
                '.json': null,     // JSON文件使用readline解析器
                '.yaml': null,     // YAML文件使用readline解析器
                '.yml': null,      // YAML文件使用readline解析器
                '.xml': null,      // XML文件使用readline解析器
                '.html': null,     // HTML文件使用readline解析器
                '.css': null,      // CSS文件使用readline解析器
                '.md': null,       // Markdown文件使用readline解析器
                '.txt': null,      // 文本文件使用readline解析器
                '.log': null,      // 日志文件使用readline解析器
                '.conf': null,     // 配置文件使用readline解析器
                '.config': null,   // 配置文件使用readline解析器
                '.ini': null,      // INI文件使用readline解析器
                '.toml': null,     // TOML文件使用readline解析器
                '.sh': null,       // Shell脚本使用readline解析器
                '.bat': null,      // 批处理文件使用readline解析器
                '.ps1': null,      // PowerShell脚本使用readline解析器
                '.sql': null,      // SQL文件使用readline解析器
                '.dockerfile': null, // Dockerfile使用readline解析器
                '.gitignore': null,  // gitignore文件使用readline解析器
                '.env': null,        // 环境变量文件使用readline解析器
                '': null,            // 无扩展名文件使用readline解析器
        };

        const language = languageMapping[extension];
            
            // 如果明确设置为null，使用readline解析器
            if (language === null) {
                console.log(`[ParserSelector] 使用readline解析器 for ${extension} 文件`);
                return this.parsers.get('readline');
            }
            
            // 如果没有找到语言映射，使用readline解析器
        if (!language) {
                console.log(`[ParserSelector] 未知文件类型 ${extension}，使用readline解析器`);
                return this.parsers.get('readline');
        }

        // 使用插件系统检查语言支持
        if (this.astParser.isLanguageSupported(language)) {
                console.log(`[ParserSelector] 使用AST解析器 for ${language}`);
            return this.parsers.get('ast');
        }

            console.log(`[ParserSelector] AST不支持 ${language}，使用readline解析器`);
        return this.parsers.get('readline');
        } catch (error) {
            console.error(`[ParserSelector] 选择解析器出错 for ${filePath}:`, error);
            return this.parsers.get('readline'); // 出错时返回默认解析器
        }
    }

    // 获取支持的语言列表
    getSupportedLanguages() {
        return this.astParser.getSupportedLanguages();
    }

    // 获取支持的文件扩展名
    getSupportedExtensions() {
        return this.astParser.getSupportedExtensions();
    }

    // 获取插件统计信息
    getPluginStats() {
        return this.astParser.getPluginStats();
    }
}

module.exports = ParserSelector;
