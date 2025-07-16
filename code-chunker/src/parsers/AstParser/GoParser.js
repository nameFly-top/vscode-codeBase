const Parser = require('tree-sitter');
const Go = require('tree-sitter-go');
const BaseParser = require('../BaseParser');
const crypto = require('crypto');
const path = require('path');

class GoParser extends BaseParser {
    constructor(config) {
        super(config);
        // Go节点类型分类，基于tree-sitter-go的AST节点
        this.nodeTypes = {
            module: ['package_clause', 'import_declaration'],
            constant: ['const_declaration'],
            variable: ['var_declaration', 'short_var_declaration'],
            type: ['type_declaration'],
            function: ['function_declaration', 'method_declaration'],
            comment: ['comment'],
        };

        // 初始化tree-sitter Go解析器
        this.parser = new Parser();
        this.parser.setLanguage(Go);

        // 10KB限制（留1KB余量）
        this.maxChunkSize = 9 * 1024;
    }

    // 插件元数据
    static getMetadata() {
        return {
            name: 'go',
            displayName: 'Go',
            extensions: ['.go'],
            version: '1.0.0',
            description: 'Go语言AST解析器',
            nodeTypes: {
                package: ['package_clause'],
                import: ['import_declaration'],
                const: ['const_declaration'],
                function: ['function_declaration'],
                type: ['type_declaration'],
                variable: ['var_declaration'],
            },
        };
    }

    _extractNodeCode(code, startByte, endByte) {
        const buffer = Buffer.from(code, 'utf-8');
        return buffer.slice(startByte, endByte).toString('utf-8');
    }

    async parseContent(content, filePath = null) {
        try {
            if (!content || typeof content !== 'string') {
                console.warn(`Invalid content for Go parsing in file: ${filePath || 'unknown'}`);
                return [];
            }

            if (content.length === 0) {
                console.warn(`Empty content for Go parsing in file: ${filePath || 'unknown'}`);
                return [];
            }

            if (content.length > 10 * 1024 * 1024) {
                console.warn(
                    `Content too large for Go parsing in file: ${filePath || 'unknown'} (${content.length} bytes)`
                );
                return [];
            }

            let cleanContent = content.replace(/\0/g, '');

            if (cleanContent.length > 1024 * 1024) {
                console.warn(
                    `Large Go file detected: ${filePath || 'unknown'} (${cleanContent.length} bytes), truncating for parsing`
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
            const modules = this._extractModules(tree, cleanContent);
            const constants = this._extractConstants(tree, cleanContent);
            const variables = this._extractVariables(tree, cleanContent);
            const types = this._extractTypes(tree, cleanContent);
            const functions = this._extractFunctions(tree, cleanContent);
            const comments = this._extractComments(tree, cleanContent);
            const other = this._extractOther(tree, cleanContent);

            const allChunks = [
                ...modules,
                ...constants,
                ...variables,
                ...types,
                ...functions,
                ...comments,
                ...other,
            ];
            const mergedChunks = this._mergeAdjacentChunks(allChunks);

            return mergedChunks.map(chunk => ({
                chunkId: this.generateChunkId(relativePath, chunk.startLine, chunk.endLine),
                filePath: relativePath,
                language: 'go',
                startLine: chunk.startLine,
                endLine: chunk.endLine,
                content: chunk.content,
                parser: 'go_parser',
                type: chunk.type,
                ...(chunk.name && { name: chunk.name }),
            }));
        } catch (error) {
            console.error(`Error parsing Go content in file: ${filePath || 'unknown'}:`, error);
            return [];
        }
    }

    _extractModules(tree, code) {
        const modules = [];
        this._traverseNodes(tree.rootNode, node => {
            if (this.nodeTypes.module.includes(node.type)) {
                const nodeCode = this._extractNodeCode(code, node.startIndex, node.endIndex);
                modules.push({
                    type: 'module',
                    content: nodeCode,
                    startLine: node.startPosition.row + 1,
                    endLine: node.endPosition.row + 1,
                });
            }
        });
        return modules;
    }

    _extractConstants(tree, code) {
        const constants = [];
        this._traverseNodes(tree.rootNode, node => {
            if (this.nodeTypes.constant.includes(node.type)) {
                const constantName = this._getDefinitionName(node);
                const nodeCode = this._extractNodeCode(code, node.startIndex, node.endIndex);

                constants.push({
                    type: 'constant',
                    name: constantName,
                    content: nodeCode,
                    startLine: node.startPosition.row + 1,
                    endLine: node.endPosition.row + 1,
                });
            }
        });
        return constants;
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

module.exports = GoParser;
