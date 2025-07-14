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
        const extension = path.extname(filePath).toLowerCase();
        const languageMapping = this.config.languageMapping || {
            '.py': 'python',
            '.java': 'java',
            '.cs': 'csharp',
            '.rs': 'rust',
            '.go': 'go',
            // '.c': 'c',     // 暂时禁用
            // '.h': 'c',     // 暂时禁用
            '.js': 'javascript',
            '.jsx': 'javascript',
            '.ts': 'javascript',
            '.tsx': 'javascript',
            '.php': 'php',
            '.cpp': 'cpp',
            '.cxx': 'cpp',
            '.cc': 'cpp',
            '.hpp': 'cpp',
            '.hxx': 'cpp'
        };

        const language = languageMapping[extension];
        if (!language) {
            return this.parsers.get('readline'); // 默认使用行解析器
        }

        // 使用插件系统检查语言支持
        if (this.astParser.isLanguageSupported(language)) {
            return this.parsers.get('ast');
        }

        return this.parsers.get('readline');
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