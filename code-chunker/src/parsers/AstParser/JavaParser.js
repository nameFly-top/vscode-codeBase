const Parser = require('tree-sitter');
const Java = require('tree-sitter-java');
const BaseParser = require('../BaseParser');
const crypto = require('crypto');
const path = require('path');

class JavaParser extends BaseParser {
    constructor(config) {
        super(config);
        // Java节点类型分类，基于tree-sitter-java的AST节点
        this.nodeTypes = {
            module: ['package_declaration', 'import_declaration'],
            class: [
                'class_declaration',
                'enum_declaration',
                'interface_declaration',
                'annotation_type_declaration',
            ],
            method: ['method_declaration', 'constructor_declaration'],
            field: ['field_declaration', 'enum_constant', 'annotation_type_element_declaration'],
            comment: ['line_comment', 'block_comment', 'javadoc'],
        };

        // 初始化tree-sitter Java解析器
        this.parser = new Parser();
        this.parser.setLanguage(Java);

        // 10KB限制（留1KB余量）
        this.maxChunkSize = 9 * 1024;
    }

    // 插件元数据
    static getMetadata() {
        return {
            name: 'java',
            displayName: 'Java',
            extensions: ['.java'],
            version: '1.0.0',
            description: 'Java语言AST解析器',
            nodeTypes: {
                module: ['module_declaration'],
                import: ['import_declaration'],
                class: ['class_declaration'],
                interface: ['interface_declaration'],
                method: ['method_declaration'],
                field: ['field_declaration'],
                comment: ['comment'],
            },
        };
    }

    // 修复多字节字符处理问题的辅助方法
    _extractNodeCode(code, startByte, endByte) {
        // 将字符串转换为Buffer，使用字节索引进行切片，然后转换回字符串
        const buffer = Buffer.from(code, 'utf-8');
        return buffer.slice(startByte, endByte).toString('utf-8');
    }

    async parseContent(content, filePath = null) {
        try {
            // 验证输入内容
            if (!content || typeof content !== 'string') {
                console.warn(`Invalid content for Java parsing in file: ${filePath || 'unknown'}`);
                return [];
            }

            // 检查内容是否为空或过大
            if (content.length === 0) {
                console.warn(`Empty content for Java parsing in file: ${filePath || 'unknown'}`);
                return [];
            }

            if (content.length > 10 * 1024 * 1024) {
                // 10MB限制
                console.warn(
                    `Content too large for Java parsing in file: ${filePath || 'unknown'} (${content.length} bytes)`
                );
                return [];
            }

            // 清理可能导致解析器问题的字符
            let cleanContent = content.replace(/\0/g, ''); // 移除null字符

            // 如果文件很大，先尝试截取前面部分进行解析
            if (cleanContent.length > 1024 * 1024) {
                // 1MB
                console.warn(
                    `Large Java file detected: ${filePath || 'unknown'} (${cleanContent.length} bytes), truncating for parsing`
                );
                cleanContent = cleanContent.substring(0, 1024 * 1024); // 截取前1MB
            }

            // 尝试解析AST，使用更强的错误处理
            let tree;
            try {
                tree = this.parser.parse(cleanContent);
            } catch (parseError) {
                console.warn(
                    `Direct parsing failed for ${filePath || 'unknown'}: ${parseError.message}`
                );

                // 尝试进一步清理内容
                cleanContent = cleanContent
                    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // 移除控制字符
                    .replace(/\r\n/g, '\n') // 标准化换行符
                    .replace(/\r/g, '\n');

                try {
                    tree = this.parser.parse(cleanContent);
                } catch (secondError) {
                    console.warn(
                        `Second parsing attempt failed for ${filePath || 'unknown'}: ${secondError.message}`
                    );

                    // 最后尝试：只解析前几行
                    const lines = cleanContent.split('\n').slice(0, 100); // 只取前100行
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

            // 检查解析结果
            if (!tree || !tree.rootNode) {
                console.warn(`Failed to parse AST for file: ${filePath || 'unknown'}`);
                return [];
            }

            const relativePath = filePath ? path.basename(filePath) : 'unknown';

            // 提取不同类型的代码块
            const modules = this._extractModules(tree, cleanContent);
            const classes = this._extractClasses(tree, cleanContent);
            const methods = this._extractMethods(tree, cleanContent);
            const fields = this._extractFields(tree, cleanContent);
            const comments = this._extractComments(tree, cleanContent);
            const other = this._extractOther(tree, cleanContent);

            // 合并所有chunks并按类型合并相邻的chunks
            const allChunks = [
                ...modules,
                ...classes,
                ...methods,
                ...fields,
                ...comments,
                ...other,
            ];
            const mergedChunks = this._mergeAdjacentChunks(allChunks);

            // 格式化chunks
            return mergedChunks.map(chunk => ({
                chunkId: this.generateChunkId(relativePath, chunk.startLine, chunk.endLine),
                filePath: relativePath,
                language: 'java',
                startLine: chunk.startLine,
                endLine: chunk.endLine,
                content: chunk.content,
                parser: 'java_parser',
                type: chunk.type,
                ...(chunk.name && { name: chunk.name }),
            }));
        } catch (error) {
            console.error(`Error parsing Java content in file: ${filePath || 'unknown'}:`, error);
            // 返回空数组而不是抛出错误，让处理继续进行
            return [];
        }
    }

    _extractModules(tree, code) {
        const modules = [];

        for (const child of tree.rootNode.children) {
            if (this.nodeTypes.module.includes(child.type)) {
                // 使用字节索引和Buffer进行正确的多字节字符处理
                const nodeCode = this._extractNodeCode(code, child.startIndex, child.endIndex);
                modules.push({
                    type: 'module',
                    content: nodeCode,
                    startLine: child.startPosition.row + 1,
                    endLine: child.endPosition.row + 1,
                });
            }
        }

        return modules;
    }

    _extractClasses(tree, code) {
        const classes = [];

        for (const child of tree.rootNode.children) {
            if (this.nodeTypes.class.includes(child.type)) {
                const className = this._getDefinitionName(child);
                // 使用字节索引和Buffer进行正确的多字节字符处理
                const nodeCode = this._extractNodeCode(code, child.startIndex, child.endIndex);

                classes.push({
                    type: 'class',
                    name: className,
                    content: nodeCode,
                    startLine: child.startPosition.row + 1,
                    endLine: child.endPosition.row + 1,
                });
            }
        }

        return classes;
    }

    _extractMethods(tree, code) {
        const methods = [];

        // 遍历所有节点，包括类内部的方法
        this._traverseNodes(tree.rootNode, node => {
            if (this.nodeTypes.method.includes(node.type)) {
                const methodName = this._getDefinitionName(node);
                // 使用字节索引和Buffer进行正确的多字节字符处理
                const nodeCode = this._extractNodeCode(code, node.startIndex, node.endIndex);

                methods.push({
                    type: 'method',
                    name: methodName,
                    content: nodeCode,
                    startLine: node.startPosition.row + 1,
                    endLine: node.endPosition.row + 1,
                });
            }
        });

        return methods;
    }

    _extractFields(tree, code) {
        const fields = [];

        // 遍历所有节点，包括类内部的字段
        this._traverseNodes(tree.rootNode, node => {
            if (this.nodeTypes.field.includes(node.type)) {
                const fieldName = this._getDefinitionName(node);
                // 使用字节索引和Buffer进行正确的多字节字符处理
                const nodeCode = this._extractNodeCode(code, node.startIndex, node.endIndex);

                fields.push({
                    type: 'field',
                    name: fieldName,
                    content: nodeCode,
                    startLine: node.startPosition.row + 1,
                    endLine: node.endPosition.row + 1,
                });
            }
        });

        return fields;
    }

    _extractComments(tree, code) {
        const comments = [];

        // 遍历所有节点，包括嵌套的注释
        this._traverseNodes(tree.rootNode, node => {
            if (this.nodeTypes.comment.includes(node.type)) {
                // 使用字节索引和Buffer进行正确的多字节字符处理
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
        // 获取所有已定义的节点类型
        const allDefinedTypes = Object.values(this.nodeTypes).flat();

        for (const child of tree.rootNode.children) {
            if (!allDefinedTypes.includes(child.type)) {
                // 使用字节索引和Buffer进行正确的多字节字符处理
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

    // 递归遍历AST节点的辅助方法
    _traverseNodes(node, callback) {
        callback(node);
        for (const child of node.children) {
            this._traverseNodes(child, callback);
        }
    }

    _mergeAdjacentChunks(chunks) {
        if (!chunks.length) return [];

        // 按起始行排序
        const sortedChunks = chunks.sort((a, b) => a.startLine - b.startLine);
        const merged = [];
        let current = sortedChunks[0];

        for (let i = 1; i < sortedChunks.length; i++) {
            const next = sortedChunks[i];

            // 如果是相同类型且相邻或非常接近（最多1行间隔）
            if (current.type === next.type && next.startLine <= current.endLine + 2) {
                // 合并chunks
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
        // 对于Java，identifier通常在不同的位置，需要递归查找
        const identifiers = [];
        this._findIdentifiers(node, identifiers);

        // 返回第一个identifier作为名称
        return identifiers.length > 0 ? identifiers[0] : '';
    }

    _findIdentifiers(node, identifiers) {
        if (node.type === 'identifier') {
            identifiers.push(node.text);
            return;
        }

        for (const child of node.children) {
            this._findIdentifiers(child, identifiers);
            // 只取第一个identifier
            if (identifiers.length > 0) break;
        }
    }

    generateChunkId(filePath, startLine, endLine) {
        const identifier = `${filePath}:${startLine}:${endLine}`;
        return crypto.createHash('sha256').update(identifier).digest('hex');
    }
}

module.exports = JavaParser;
