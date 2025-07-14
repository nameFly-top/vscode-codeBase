const Parser = require('tree-sitter');
const JavaScript = require('tree-sitter-javascript');
const BaseParser = require('../BaseParser');
const crypto = require('crypto');
const path = require('path');

class JavaScriptParser extends BaseParser {
    constructor(config) {
        super(config);
        // JavaScript节点类型分类，基于tree-sitter-javascript的AST节点
        this.nodeTypes = {
            import: ['import_statement', 'import_clause'],
            export: ['export_statement', 'export_declaration'],
            function: ['function_declaration', 'arrow_function', 'method_definition', 'function_expression'],
            variable: ['variable_declaration', 'lexical_declaration'],
            class: ['class_declaration'],
            comment: ['comment']
        };
        
        // 初始化tree-sitter JavaScript解析器
        this.parser = new Parser();
        this.parser.setLanguage(JavaScript);
        
        // 10KB限制（留1KB余量）
        this.maxChunkSize = 9 * 1024;
    }

    static getMetadata() {
        return {
            name: 'javascript',
            extensions: ['.js', '.jsx', '.ts', '.tsx'],
            description: 'JavaScript/TypeScript parser using tree-sitter'
        };
    }

    async parseContent(content, filePath = null) {
        try {
            if (!content || typeof content !== 'string') {
                console.warn(`Invalid content for JavaScript parsing in file: ${filePath || 'unknown'}`);
                return [];
            }

            if (content.length === 0) {
                console.warn(`Empty content for JavaScript parsing in file: ${filePath || 'unknown'}`);
                return [];
            }

            if (content.length > 10 * 1024 * 1024) {
                console.warn(`Content too large for JavaScript parsing in file: ${filePath || 'unknown'} (${content.length} bytes)`);
                return [];
            }

            let cleanContent = content.replace(/\0/g, '');
            
            if (cleanContent.length > 1024 * 1024) {
                console.warn(`Large JavaScript file detected: ${filePath || 'unknown'} (${cleanContent.length} bytes), truncating for parsing`);
                cleanContent = cleanContent.substring(0, 1024 * 1024);
            }

            let tree;
            try {
                tree = this.parser.parse(cleanContent);
            } catch (parseError) {
                console.warn(`Direct parsing failed for ${filePath || 'unknown'}: ${parseError.message}`);
                
                // 特殊处理"Invalid argument"错误
                if (parseError.message.includes('Invalid argument')) {
                    // 尝试更激进的内容清理
                    cleanContent = this._aggressiveContentCleaning(cleanContent, filePath);
                }
                
                cleanContent = cleanContent
                    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
                    .replace(/\r\n/g, '\n')
                    .replace(/\r/g, '\n');
                
                try {
                    tree = this.parser.parse(cleanContent);
                } catch (secondError) {
                    console.warn(`Second parsing attempt failed for ${filePath || 'unknown'}: ${secondError.message}`);
                    
                    // 对于"Invalid argument"错误，尝试更小的块
                    const lines = cleanContent.split('\n');
                    const chunkSize = secondError.message.includes('Invalid argument') ? 50 : 100;
                    const truncatedLines = lines.slice(0, chunkSize);
                    const truncatedContent = truncatedLines.join('\n');
                    
                    try {
                        tree = this.parser.parse(truncatedContent);
                        console.warn(`Successfully parsed truncated version of ${filePath || 'unknown'} (first ${chunkSize} lines)`);
                    } catch (finalError) {
                        console.error(`All parsing attempts failed for ${filePath || 'unknown'}: ${finalError.message}`);
                        
                        // 最后的容错：返回基于行的解析结果
                        console.warn(`Falling back to line-based parsing for ${filePath || 'unknown'}`);
                        return this._fallbackLineParsing(content, filePath);
                    }
                }
            }
            
            if (!tree || !tree.rootNode) {
                console.warn(`Failed to parse AST for file: ${filePath || 'unknown'}`);
                return this._fallbackLineParsing(content, filePath);
            }

            const relativePath = filePath ? path.basename(filePath) : 'unknown';

            // 提取不同类型的代码块
            const imports = this._extractImports(tree, cleanContent);
            const exports = this._extractExports(tree, cleanContent);
            const functions = this._extractFunctions(tree, cleanContent);
            const variables = this._extractVariables(tree, cleanContent);
            const classes = this._extractClasses(tree, cleanContent);
            const comments = this._extractComments(tree, cleanContent);

            const allChunks = [
                ...imports,
                ...exports, 
                ...functions,
                ...variables,
                ...classes,
                ...comments
            ].filter(chunk => chunk && chunk.content && chunk.content.trim().length > 0);

            if (allChunks.length === 0) {
                console.warn(`No valid chunks extracted for ${relativePath}, using fallback parsing`);
                return this._fallbackLineParsing(content, filePath);
            }

            return allChunks;

        } catch (error) {
            console.error(`JavaScript parsing error for ${filePath || 'unknown'}:`, error);
            return this._fallbackLineParsing(content, filePath);
        }
    }

    /**
     * 激进的内容清理，专门处理可能导致"Invalid argument"的问题
     */
    _aggressiveContentCleaning(content, filePath) {
        try {
            // 移除可能有问题的字符序列
            let cleaned = content
                // 移除BOM
                .replace(/^\uFEFF/, '')
                // 移除零宽字符
                .replace(/[\u200B-\u200D\uFEFF]/g, '')
                // 移除其他可能有问题的Unicode字符
                .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
                // 标准化引号
                .replace(/[\u2018\u2019]/g, "'")
                .replace(/[\u201C\u201D]/g, '"')
                // 移除可能有问题的空白字符
                .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ');

            // 尝试修复可能损坏的字符串
            cleaned = this._fixBrokenStrings(cleaned);
            
            console.log(`[JavaScriptParser] Applied aggressive cleaning for ${filePath || 'unknown'}`);
            return cleaned;
        } catch (error) {
            console.warn(`[JavaScriptParser] Aggressive cleaning failed: ${error.message}`);
            return content;
        }
    }

    /**
     * 修复可能损坏的字符串
     */
    _fixBrokenStrings(content) {
        try {
            // 查找未闭合的字符串
            const lines = content.split('\n');
            const fixedLines = lines.map(line => {
                // 修复未闭合的单引号字符串
                if (line.split("'").length % 2 === 0) {
                    line += "'";
                }
                // 修复未闭合的双引号字符串
                if (line.split('"').length % 2 === 0) {
                    line += '"';
                }
                return line;
            });
            return fixedLines.join('\n');
        } catch (error) {
            return content;
        }
    }

    /**
     * 容错的基于行的解析
     */
    _fallbackLineParsing(content, filePath) {
        try {
            console.log(`[JavaScriptParser] Using fallback line-based parsing for ${filePath || 'unknown'}`);
            
            // 使用BaseParser的通用分割方法
            return this._splitIntoChunks(content, filePath, 'javascript');
        } catch (error) {
            console.error(`[JavaScriptParser] Fallback parsing failed: ${error.message}`);
            // 最后的最后：返回单个块
            return [{
                chunkId: this.generateChunkId(filePath || 'unknown', 1, 1),
                filePath: filePath || 'unknown',
                language: 'javascript',
                startLine: 1,
                endLine: 1,
                content: content.substring(0, Math.min(content.length, 8192)), // 最多8KB
                parser: 'javascript_parser',
                type: 'fallback'
            }];
        }
    }

    // 其余的提取方法保持不变...
    _extractImports(tree, content) {
        return this._extractNodesByType(tree, content, this.nodeTypes.import, 'import');
    }

    _extractExports(tree, content) {
        return this._extractNodesByType(tree, content, this.nodeTypes.export, 'export');
    }

    _extractFunctions(tree, content) {
        return this._extractNodesByType(tree, content, this.nodeTypes.function, 'function');
    }

    _extractVariables(tree, content) {
        return this._extractNodesByType(tree, content, this.nodeTypes.variable, 'variable');
    }

    _extractClasses(tree, content) {
        return this._extractNodesByType(tree, content, this.nodeTypes.class, 'class');
    }

    _extractComments(tree, content) {
        return this._extractNodesByType(tree, content, this.nodeTypes.comment, 'comment');
    }

    _extractNodesByType(tree, content, nodeTypes, chunkType) {
        const chunks = [];
        const lines = content.split('\n');

        try {
            tree.rootNode.descendantsOfType(nodeTypes).forEach(node => {
                if (node.startPosition && node.endPosition) {
                    const startLine = node.startPosition.row + 1;
                    const endLine = node.endPosition.row + 1;
                    const nodeContent = lines.slice(startLine - 1, endLine).join('\n');

                    if (nodeContent.trim() && Buffer.byteLength(nodeContent, 'utf8') <= this.maxChunkSize) {
                        chunks.push(this._createChunk(
                            nodeContent,
                            startLine,
                            endLine,
                            'javascript_file',
                            'javascript',
                            chunkType
                        ));
                    }
                }
            });
        } catch (error) {
            console.warn(`Failed to extract ${chunkType} nodes:`, error.message);
        }

        return chunks;
    }
}

module.exports = JavaScriptParser; 