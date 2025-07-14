const crypto = require('crypto');
const path = require('path');

class BaseParser {
    constructor(config, workspacePath = null) {
        this.config = config || {};
        this.workspacePath = workspacePath;
        this.linesPerChunk = this.config.linesPerChunk || 15;
        this.maxChunkSize = 9 * 1024;
    }

    // 修复：统一解析方法，支持文件路径和内容参数
    async parse(filePath, content) {
        // 如果子类没有实现parse方法，使用默认的行解析
        if (!content || typeof content !== 'string') {
            console.warn(`[BaseParser] 无效的内容参数: ${filePath}`);
            return [];
        }

        // 使用通用的行分割方法
        return this._splitIntoChunks(content, filePath, this._detectLanguage(filePath));
    }

    // 检测文件语言
    _detectLanguage(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        const languageMap = {
            '.py': 'python',
            '.js': 'javascript',
            '.jsx': 'javascript',
            '.ts': 'typescript',
            '.tsx': 'typescript',
            '.java': 'java',
            '.c': 'c',
            '.h': 'c',
            '.cpp': 'cpp',
            '.cxx': 'cpp',
            '.cc': 'cpp',
            '.hpp': 'cpp',
            '.hxx': 'cpp',
            '.cs': 'csharp',
            '.go': 'go',
            '.rs': 'rust',
            '.php': 'php',
            '.rb': 'ruby',
            '.swift': 'swift',
            '.kt': 'kotlin',
            '.sql': 'sql',
            '.sh': 'shell',
            '.bash': 'shell',
            '.zsh': 'shell',
            '.yaml': 'yaml',
            '.yml': 'yaml',
            '.json': 'json',
            '.xml': 'xml',
            '.html': 'html',
            '.css': 'css',
            '.md': 'markdown',
            '.txt': 'text'
        };
        return languageMap[ext] || 'unknown';
    }

    // 智能分割内容为块
    _splitIntoChunks(content, filePath, language) {
        const lines = content.split('\n');
        const chunks = [];
        let currentChunk = [];
        let currentSize = 0;
        let startLine = 1;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineSize = Buffer.byteLength(line + '\n', 'utf8');
            
            // 检查是否需要开始新的块
            if (currentChunk.length >= this.linesPerChunk || 
                currentSize + lineSize > this.maxChunkSize) {
                
                if (currentChunk.length > 0) {
                    chunks.push(this._createChunk(
                        currentChunk.join('\n'),
                        startLine,
                        startLine + currentChunk.length - 1,
                        filePath,
                        language,
                        'line_based'
                    ));
                }
                
                currentChunk = [];
                currentSize = 0;
                startLine = i + 1;
            }
            
            currentChunk.push(line);
            currentSize += lineSize;
        }

        // 添加最后一个块
        if (currentChunk.length > 0) {
            chunks.push(this._createChunk(
                currentChunk.join('\n'),
                startLine,
                startLine + currentChunk.length - 1,
                filePath,
                language,
                'line_based'
            ));
        }

        return chunks;
    }

    // 生成块ID
    generateChunkId(filePath, startLine, endLine) {
        const identifier = `${filePath}:${startLine}:${endLine}`;
        return crypto.createHash('sha256').update(identifier).digest('hex');
    }

    // 创建块对象
    _createChunk(content, startLine, endLine, filePath = 'unknown', language = 'unknown', type = 'default') {
        return {
            chunkId: this.generateChunkId(filePath, startLine, endLine),    
            filePath: filePath,
            language: language,
            startLine: startLine,
            endLine: endLine,
            content: content,
            parser: this.constructor.name.toLowerCase().replace('parser', '') + '_parser',
            type: type
        };
    }
}

module.exports = BaseParser; 