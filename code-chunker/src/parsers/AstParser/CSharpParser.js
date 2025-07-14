const Parser = require('tree-sitter');
const CSharp = require('tree-sitter-c-sharp');
const BaseParser = require('../BaseParser');
const crypto = require('crypto');
const path = require('path');

class CSharpParser extends BaseParser {
    constructor(config) {
        super(config);
        // C#节点类型分类，基于tree-sitter-c-sharp的AST节点
        this.nodeTypes = {
            using: ['using_directive'],
            namespace: ['namespace_declaration'],
            method: ['method_declaration', 'constructor_declaration', 'destructor_declaration', 'operator_declaration', 'conversion_operator_declaration'],
            comment: ['comment', 'preproc_pragma'],
            field: ['field_declaration', 'enum_declaration', 'property_declaration', 'event_field_declaration', 'indexer_declaration']
        };
        
        // 初始化tree-sitter C#解析器
        this.parser = new Parser();
        this.parser.setLanguage(CSharp);
        
        // 10KB限制（留1KB余量）
        this.maxChunkSize = 9 * 1024;
    }

    // 插件元数据
    static getMetadata() {
        return {
            name: 'csharp',
            displayName: 'C#',
            extensions: ['.cs'],
            version: '1.0.0',
            description: 'C#语言AST解析器',
            nodeTypes: {
                using: ['using_directive'],
                namespace: ['namespace_declaration'],
                method: ['method_declaration'],
                field: ['field_declaration'],
                comment: ['comment']
            }
        };
    }

    // 修复多字节字符处理问题的辅助方法
    _extractNodeCode(code, startByte, endByte) {
        const buffer = Buffer.from(code, 'utf-8');
        return buffer.slice(startByte, endByte).toString('utf-8');
    }

    async parse(content, filePath = null) {
        return this.parseContent(content, filePath);
    }

    async parseContent(content, filePath = null) {
        try {
            // 验证输入内容
            if (!content || typeof content !== 'string') {
                console.warn(`Invalid content for C# parsing in file: ${filePath || 'unknown'}`);
                return [];
            }

            if (content.length === 0) {
                console.warn(`Empty content for C# parsing in file: ${filePath || 'unknown'}`);
                return [];
            }

            if (content.length > 10 * 1024 * 1024) { // 10MB限制
                console.warn(`Content too large for C# parsing in file: ${filePath || 'unknown'} (${content.length} bytes)`);
                return [];
            }

            // 清理可能导致解析器问题的字符
            let cleanContent = content.replace(/\0/g, '');
            
            if (cleanContent.length > 1024 * 1024) { // 1MB
                console.warn(`Large C# file detected: ${filePath || 'unknown'} (${cleanContent.length} bytes), truncating for parsing`);
                cleanContent = cleanContent.substring(0, 1024 * 1024);
            }

            // 尝试解析AST
            let tree;
            try {
                tree = this.parser.parse(cleanContent);
            } catch (parseError) {
                console.warn(`Direct parsing failed for ${filePath || 'unknown'}: ${parseError.message}`);
                
                cleanContent = cleanContent
                    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
                    .replace(/\r\n/g, '\n')
                    .replace(/\r/g, '\n');
                
                try {
                    tree = this.parser.parse(cleanContent);
                } catch (secondError) {
                    console.warn(`Second parsing attempt failed for ${filePath || 'unknown'}: ${secondError.message}`);
                    
                    const lines = cleanContent.split('\n').slice(0, 100);
                    const truncatedContent = lines.join('\n');
                    try {
                        tree = this.parser.parse(truncatedContent);
                        console.warn(`Successfully parsed truncated version of ${filePath || 'unknown'} (first 100 lines)`);
                    } catch (finalError) {
                        console.error(`All parsing attempts failed for ${filePath || 'unknown'}: ${finalError.message}`);
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
            const usings = this._extractUsings(tree, cleanContent);
            const namespaces = this._extractNamespaces(tree, cleanContent);
            const methods = this._extractMethods(tree, cleanContent);
            const fields = this._extractFields(tree, cleanContent);
            const comments = this._extractComments(tree, cleanContent);
            const other = this._extractOther(tree, cleanContent);

            // 合并所有chunks并按类型合并相邻的chunks
            const allChunks = [...usings, ...namespaces, ...methods, ...fields, ...comments, ...other];
            const mergedChunks = this._mergeAdjacentChunks(allChunks);

            // 格式化chunks
            return mergedChunks.map(chunk => ({
                chunkId: this.generateChunkId(relativePath, chunk.startLine, chunk.endLine),
                filePath: relativePath,
                language: 'csharp',
                startLine: chunk.startLine,
                endLine: chunk.endLine,
                content: chunk.content,
                parser: 'csharp_parser',
                type: chunk.type,
                ...(chunk.name && { name: chunk.name })
            }));

        } catch (error) {
            console.error(`Error parsing C# content in file: ${filePath || 'unknown'}:`, error);
            return [];
        }
    }

    _extractUsings(tree, code) {
        const usings = [];
        
        this._traverseNodes(tree.rootNode, (node) => {
            if (this.nodeTypes.using.includes(node.type)) {
                const nodeCode = this._extractNodeCode(code, node.startIndex, node.endIndex);
                usings.push({
                    type: 'using',
                    content: nodeCode,
                    startLine: node.startPosition.row + 1,
                    endLine: node.endPosition.row + 1
                });
            }
        });
        
        return usings;
    }

    _extractNamespaces(tree, code) {
        const namespaces = [];
        
        this._traverseNodes(tree.rootNode, (node) => {
            if (this.nodeTypes.namespace.includes(node.type)) {
                const namespaceName = this._getDefinitionName(node);
                const nodeCode = this._extractNodeCode(code, node.startIndex, node.endIndex);
                
                namespaces.push({
                    type: 'namespace',
                    name: namespaceName,
                    content: nodeCode,
                    startLine: node.startPosition.row + 1,
                    endLine: node.endPosition.row + 1
                });
            }
        });
        
        return namespaces;
    }

    _extractMethods(tree, code) {
        const methods = [];
        
        this._traverseNodes(tree.rootNode, (node) => {
            if (this.nodeTypes.method.includes(node.type)) {
                const methodName = this._getDefinitionName(node);
                const nodeCode = this._extractNodeCode(code, node.startIndex, node.endIndex);
                
                methods.push({
                    type: 'method',
                    name: methodName,
                    content: nodeCode,
                    startLine: node.startPosition.row + 1,
                    endLine: node.endPosition.row + 1
                });
            }
        });
        
        return methods;
    }

    _extractFields(tree, code) {
        const fields = [];
        
        this._traverseNodes(tree.rootNode, (node) => {
            if (this.nodeTypes.field.includes(node.type)) {
                const fieldName = this._getDefinitionName(node);
                const nodeCode = this._extractNodeCode(code, node.startIndex, node.endIndex);
                
                fields.push({
                    type: 'field',
                    name: fieldName,
                    content: nodeCode,
                    startLine: node.startPosition.row + 1,
                    endLine: node.endPosition.row + 1
                });
            }
        });
        
        return fields;
    }

    _extractComments(tree, code) {
        const comments = [];
        
        this._traverseNodes(tree.rootNode, (node) => {
            if (this.nodeTypes.comment.includes(node.type)) {
                const nodeCode = this._extractNodeCode(code, node.startIndex, node.endIndex);
                
                comments.push({
                    type: 'comment',
                    content: nodeCode,
                    startLine: node.startPosition.row + 1,
                    endLine: node.endPosition.row + 1
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
                    endLine: child.endPosition.row + 1
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
                    ...(next.name && !current.name && { name: next.name })
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

module.exports = CSharpParser; 