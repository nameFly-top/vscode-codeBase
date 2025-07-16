const Parser = require('tree-sitter');
let C;
try {
    C = require('tree-sitter-c');
} catch (error) {
    console.warn('tree-sitter-c not available:', error.message);
}
const BaseParser = require('../BaseParser');
const crypto = require('crypto');
const path = require('path');

class CParser extends BaseParser {
    constructor(config) {
        super(config);
        // C节点类型分类，基于tree-sitter-c的AST节点
        this.nodeTypes = {
            include: ['preproc_include'],
            macro: ['preproc_def', 'preproc_function_def'],
            comment: ['comment'],
            type: ['type_definition'],
            function: ['function_definition'],
            variable: ['declaration'],
        };

        // 延迟初始化tree-sitter C解析器
        this.parser = null;
        this.languageAvailable = false;

        // 10KB限制（留1KB余量）
        this.maxChunkSize = 9 * 1024;
    }

    // 插件元数据
    static getMetadata() {
        return {
            name: 'c',
            displayName: 'C',
            extensions: ['.c', '.h'],
            version: '1.0.0',
            description: 'C语言AST解析器',
            nodeTypes: {
                include: ['preproc_include'],
                macro: ['preproc_def', 'preproc_function_def'],
                comment: ['comment'],
                type: ['type_definition'],
                function: ['function_definition'],
                variable: ['declaration'],
            },
        };
    }

    _ensureParserInitialized() {
        if (!this.parser) {
            this.parser = new Parser();

            if (C && C.language) {
                // C直接就是语言对象，有language属性
                try {
                    this.parser.setLanguage(C);
                    this.languageAvailable = true;
                } catch (error) {
                    console.warn('Failed to set C language:', error.message);
                    this.languageAvailable = false;
                }
            } else {
                console.warn('C language parser not available');
                this.languageAvailable = false;
            }
        }

        if (!this.languageAvailable) {
            throw new Error('C language parser not available');
        }
    }

    _extractNodeCode(code, startByte, endByte) {
        const buffer = Buffer.from(code, 'utf-8');
        return buffer.slice(startByte, endByte).toString('utf-8');
    }

    async parseContent(content, filePath = null) {
        try {
            // 确保解析器已初始化
            this._ensureParserInitialized();

            if (!content || typeof content !== 'string') {
                console.warn(`Invalid content for C parsing in file: ${filePath || 'unknown'}`);
                return [];
            }

            if (content.length === 0) {
                console.warn(`Empty content for C parsing in file: ${filePath || 'unknown'}`);
                return [];
            }

            if (content.length > 10 * 1024 * 1024) {
                console.warn(
                    `Content too large for C parsing in file: ${filePath || 'unknown'} (${content.length} bytes)`
                );
                return [];
            }

            let cleanContent = content.replace(/\0/g, '');

            if (cleanContent.length > 1024 * 1024) {
                console.warn(
                    `Large C file detected: ${filePath || 'unknown'} (${cleanContent.length} bytes), truncating for parsing`
                );
                cleanContent = cleanContent.substring(0, 1024 * 1024);
            }

            let tree;
            try {
                tree = this.parser.parse(cleanContent);
            } catch (parseError) {
                console.warn(
                    `Direct parsing failed for ${filePath || 'unknown'}: ${parseError.message}`
                );

                cleanContent = cleanContent
                    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
                    .replace(/\r\n/g, '\n')
                    .replace(/\r/g, '\n');

                try {
                    tree = this.parser.parse(cleanContent);
                } catch (secondError) {
                    console.warn(
                        `Second parsing attempt failed for ${filePath || 'unknown'}: ${secondError.message}`
                    );

                    const lines = cleanContent.split('\n').slice(0, 100);
                    const truncatedContent = lines.join('\n');
                    try {
                        tree = this.parser.parse(truncatedContent);
                        console.warn(
                            `Successfully parsed truncated version of ${filePath || 'unknown'} (first 100 lines)`
                        );
                    } catch (finalError) {
                        console.error(
                            `All parsing attempts failed for ${filePath || 'unknown'}: ${finalError.message}`
                        );
                        return [];
                    }
                }
            }

            if (!tree || !tree.rootNode) {
                console.warn(`Failed to parse AST for file: ${filePath || 'unknown'}`);
                return [];
            }

            const relativePath = filePath ? path.basename(filePath) : 'unknown';

            // 提取不同类型的代码块
            const includes = this._extractIncludes(tree, cleanContent);
            const macros = this._extractMacros(tree, cleanContent);
            const comments = this._extractComments(tree, cleanContent);
            const types = this._extractTypes(tree, cleanContent);
            const functions = this._extractFunctions(tree, cleanContent);
            const variables = this._extractVariables(tree, cleanContent);
            const other = this._extractOther(tree, cleanContent);

            const allChunks = [
                ...includes,
                ...macros,
                ...comments,
                ...types,
                ...functions,
                ...variables,
                ...other,
            ];
            const mergedChunks = this._mergeAdjacentChunks(allChunks);

            return mergedChunks.map(chunk => ({
                chunkId: this.generateChunkId(relativePath, chunk.startLine, chunk.endLine),
                filePath: relativePath,
                language: 'c',
                startLine: chunk.startLine,
                endLine: chunk.endLine,
                content: chunk.content,
                parser: 'c_parser',
                type: chunk.type,
                ...(chunk.name && { name: chunk.name }),
            }));
        } catch (error) {
            console.error(`Error parsing C content in file: ${filePath || 'unknown'}:`, error);
            return [];
        }
    }

    _extractIncludes(tree, code) {
        const includes = [];
        this._traverseNodes(tree.rootNode, node => {
            if (this.nodeTypes.include.includes(node.type)) {
                const nodeCode = this._extractNodeCode(code, node.startIndex, node.endIndex);
                includes.push({
                    type: 'include',
                    content: nodeCode,
                    startLine: node.startPosition.row + 1,
                    endLine: node.endPosition.row + 1,
                });
            }
        });
        return includes;
    }

    _extractMacros(tree, code) {
        const macros = [];
        this._traverseNodes(tree.rootNode, node => {
            if (this.nodeTypes.macro.includes(node.type)) {
                const macroName = this._getDefinitionName(node);
                const nodeCode = this._extractNodeCode(code, node.startIndex, node.endIndex);

                macros.push({
                    type: 'macro',
                    name: macroName,
                    content: nodeCode,
                    startLine: node.startPosition.row + 1,
                    endLine: node.endPosition.row + 1,
                });
            }
        });
        return macros;
    }

    _extractComments(tree, code) {
        const comments = [];
        this._traverseNodes(tree.rootNode, node => {
            if (this.nodeTypes.comment.includes(node.type)) {
                const nodeCode = this._extractNodeCode(code, node.startIndex, node.endIndex);

                comments.push({
                    type: 'comment',
                    content: nodeCode,
                    startLine: node.startPosition.row + 1,
                    endLine: node.endPosition.row + 1,
                });
            }
        });
        return comments;
    }

    _extractTypes(tree, code) {
        const types = [];
        this._traverseNodes(tree.rootNode, node => {
            if (this.nodeTypes.type.includes(node.type)) {
                const typeName = this._getDefinitionName(node);
                const nodeCode = this._extractNodeCode(code, node.startIndex, node.endIndex);

                types.push({
                    type: 'type',
                    name: typeName,
                    content: nodeCode,
                    startLine: node.startPosition.row + 1,
                    endLine: node.endPosition.row + 1,
                });
            }
        });
        return types;
    }

    _extractFunctions(tree, code) {
        const functions = [];
        this._traverseNodes(tree.rootNode, node => {
            if (this.nodeTypes.function.includes(node.type)) {
                const functionName = this._getDefinitionName(node);
                const nodeCode = this._extractNodeCode(code, node.startIndex, node.endIndex);

                functions.push({
                    type: 'function',
                    name: functionName,
                    content: nodeCode,
                    startLine: node.startPosition.row + 1,
                    endLine: node.endPosition.row + 1,
                });
            }
        });
        return functions;
    }

    _extractVariables(tree, code) {
        const variables = [];
        this._traverseNodes(tree.rootNode, node => {
            if (this.nodeTypes.variable.includes(node.type)) {
                const variableName = this._getDefinitionName(node);
                const nodeCode = this._extractNodeCode(code, node.startIndex, node.endIndex);

                variables.push({
                    type: 'variable',
                    name: variableName,
                    content: nodeCode,
                    startLine: node.startPosition.row + 1,
                    endLine: node.endPosition.row + 1,
                });
            }
        });
        return variables;
    }

    _extractOther(tree, code) {
        const other = [];
        const allDefinedTypes = Object.values(this.nodeTypes).flat();

        for (const child of tree.rootNode.children) {
            if (!allDefinedTypes.includes(child.type)) {
                const nodeCode = this._extractNodeCode(code, child.startIndex, child.endIndex);

                other.push({
                    type: 'other',
                    content: nodeCode,
                    startLine: child.startPosition.row + 1,
                    endLine: child.endPosition.row + 1,
                });
            }
        }
        return other;
    }

    _traverseNodes(node, callback) {
        callback(node);
        for (const child of node.children) {
            this._traverseNodes(child, callback);
        }
    }

    _mergeAdjacentChunks(chunks) {
        if (!chunks.length) return [];

        const sortedChunks = chunks.sort((a, b) => a.startLine - b.startLine);
        const merged = [];
        let current = sortedChunks[0];

        for (let i = 1; i < sortedChunks.length; i++) {
            const next = sortedChunks[i];

            if (current.type === next.type && next.startLine <= current.endLine + 2) {
                let content = current.content;
                if (next.startLine > current.endLine) {
                    content += '\n'.repeat(next.startLine - current.endLine);
                }
                content += next.content;

                current = {
                    type: current.type,
                    content: content,
                    startLine: current.startLine,
                    endLine: next.endLine,
                    ...(current.name && { name: current.name }),
                    ...(next.name && !current.name && { name: next.name }),
                };
            } else {
                merged.push(current);
                current = next;
            }
        }

        merged.push(current);
        return merged;
    }

    _getDefinitionName(node) {
        const identifiers = [];
        this._findIdentifiers(node, identifiers);
        return identifiers.length > 0 ? identifiers[0] : '';
    }

    _findIdentifiers(node, identifiers) {
        if (node.type === 'identifier') {
            identifiers.push(node.text);
            return;
        }

        for (const child of node.children) {
            this._findIdentifiers(child, identifiers);
            if (identifiers.length > 0) break;
        }
    }

    generateChunkId(filePath, startLine, endLine) {
        const identifier = `${filePath}:${startLine}:${endLine}`;
        return crypto.createHash('sha256').update(identifier).digest('hex');
    }
}

module.exports = CParser;
