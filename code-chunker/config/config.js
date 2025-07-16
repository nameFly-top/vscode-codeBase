/**
 * 应用配置文件
 * 支持多环境配置和完整的应用配置
 */

class AppConfig {
    constructor() {
        this.config = this._loadConfig();
    }

    _loadConfig() {
        // 从环境变量获取服务器IP，如果没有则使用默认值
        const serverIP = process.env.BACKEND_API_SERVER_IP || '42.193.14.136:8087';
        const protocol = process.env.BACKEND_API_PROTOCOL || 'http';

        // 构建基础URL
        const baseURL = `${protocol}://${serverIP}`;

        return {
            // ==================== 基础应用配置 ====================
            application: {
                // 文件扫描配置
                maxFileSize: 5242880, // 5MB

                // 🔥 支持多语言项目的文件扫描白名单
                scanFileExtensions: [
                    // 🐍 Python文件
                    '.py',
                    '.pyx',
                    '.pyi',
                    '.pyw',
                    // 🔧 C/C++文件
                    '.c',
                    '.cpp',
                    '.cc',
                    '.cxx',
                    '.c++',
                    '.h',
                    '.hpp',
                    '.hh',
                    '.hxx',
                    '.h++',
                    // 🚀 CUDA文件
                    '.cu',
                    '.cuh',
                    // ⚙️ 配置文件
                    '.yaml',
                    '.yml',
                    '.json',
                    '.toml',
                    '.ini',
                    '.cfg',
                    '.conf',
                    // 🏗️ 构建文件
                    '.cmake',
                    '.txt',
                    '.mk',
                    '.make',
                    // 📚 文档文件
                    '.md',
                    '.rst',
                    // 🐚 脚本文件
                    '.sh',
                    '.bash',
                    '.zsh',
                    '.fish',
                    // ☕ Java文件
                    '.java',
                    '.xml',
                    '.properties',
                    // 🌐 Web文件
                    '.js',
                    '.ts',
                    '.jsx',
                    '.tsx',
                    // 🔍 其他常见格式
                    '.proto',
                    '.proto3',
                ],

                // 🔥 忽略目录列表
                ignoredDirectories: [
                    'node_modules',
                    '.git',
                    '.vscode',
                    '.idea',
                    'target',
                    'build',
                    'out',
                    'bin',
                    'classes',
                    '__pycache__',
                    '.pytest_cache',
                    '.coverage',
                    'cmake-build-debug',
                    'cmake-build-release',
                    'test',
                    'tests',
                    'src/test',
                    'doc',
                    'docs',
                    'documentation',
                    'sql',
                    'database',
                    'db',
                    'migration',
                    'migrations',
                    'schema',
                    'data',
                    'flowable-patch',
                    'patch',
                    'patches',
                    'lib',
                    'libs',
                    'vendor',
                    'third-party',
                    '3rdparty',
                    'ui',
                    'frontend',
                    'static',
                    'resources/static',
                    'public',
                    'assets',
                    'dist',
                    'script',
                    'scripts',
                    'tools',
                    'deploy',
                    'devops',
                    'coverage',
                    '.nyc_output',
                    '.tox',
                    'venv',
                    'env',
                    '.env',
                    '.vector-cache',
                    '.cache',
                    'temp',
                    'tmp',
                    '.tmp',
                    'logs',
                    'log',
                ],

                // 🔥 忽略模式
                ignorePatterns: [
                    '**/node_modules/**',
                    '**/.git/**',
                    '**/.vscode/**',
                    '**/.idea/**',
                    '**/target/**',
                    '**/build/**',
                    '**/out/**',
                    '**/bin/**',
                    // 排除SQL文件
                    '**/*.sql',
                    '**/sql/**',
                    '**/database/**',
                    '**/db/**',
                    '**/*migration*/**',
                    // 排除第三方和补丁文件
                    '**/flowable-patch/**',
                    '**/third-party/**',
                    '**/3rdparty/**',
                    '**/vendor/**',
                    '**/lib/**',
                    '**/libs/**',
                    // 排除测试文件
                    '**/test/**',
                    '**/tests/**',
                    '**/src/test/**',
                    '**/*Test.java',
                    '**/*Tests.java',
                    '**/*TestCase.java',
                    '**/*test*.py',
                    '**/test_*.py',
                    '**/*_test.py',
                    '**/conftest.py',
                    // 前端和静态资源
                    '**/ui/**',
                    '**/frontend/**',
                    '**/static/**',
                    '**/public/**',
                    '**/assets/**',
                    '**/dist/**',
                    '**/resources/static/**',
                    // 脚本和文档
                    '**/script/**',
                    '**/scripts/**',
                    '**/doc/**',
                    '**/docs/**',
                    '**/documentation/**',
                    // 编译和构建产物
                    '**/*.class',
                    '**/*.jar',
                    '**/*.war',
                    '**/*.ear',
                    '**/*.zip',
                    '**/*.tar.gz',
                    '**/*.so',
                    '**/*.dll',
                    '**/*.dylib',
                    '**/*.a',
                    '**/*.lib',
                    '**/*.o',
                    '**/*.obj',
                    '**/*.pyc',
                    '**/*.pyo',
                    '**/*.pyd',
                    '**/*.whl',
                    // 日志和临时文件
                    '**/*.log',
                    '**/logs/**',
                    '**/log/**',
                    '**/temp/**',
                    '**/tmp/**',
                    '**/.tmp/**',
                    // 特定大文件模式
                    '**/*quartz.sql',
                    '**/*ruoyi-vue-pro*.sql',
                    '**/*flowable*.sql',
                    '**/*data*.sql',
                    '**/*schema*.sql',
                    // 深度学习和AI项目特有忽略模式
                    '**/models/**',
                    '**/weights/**',
                    '**/checkpoints/**',
                    '**/data/**',
                    '**/datasets/**',
                    '**/*.bin',
                    '**/*.onnx',
                    '**/*.pb',
                    '**/*.pth',
                    '**/*.safetensors',
                    '**/*.engine',
                    '**/*.plan',
                    '**/wandb/**',
                    '**/runs/**',
                    '**/.pytest_cache/**',
                    '**/__pycache__/**',
                    '**/venv/**',
                    '**/env/**',
                    // CUDA和TensorRT生成文件
                    '**/cubin/**',
                    '**/*.cubin',
                    '**/*.cubin.cpp',
                    '**/*.ptx',
                    '**/*.fatbin',
                    '**/generated/**',
                ],

                // 🔥 并发处理参数优化
                maxWorkers: 1,
                batchSize: 100,
                linesPerChunk: 50,
                useWorkers: false,

                // 性能优化配置
                performance: {
                    maxMemoryUsage: 0.6,
                    enableGC: true,
                    gcInterval: 100,
                },

                // API锁定机制配置
                userId: 'user123',
                deviceId: 'device123',
                workspacePath: '',

                // 语言映射配置
                languageMapping: {
                    '.py': 'python',
                    '.java': 'java',
                    '.cs': 'csharp',
                    '.rs': 'rust',
                    '.go': 'go',
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
                },
            },

            // ==================== VectorManager配置 ====================
            vectorManager: {
                enabled: true,
                cleanupInterval: 1800000, // 30分钟清理一次
                security: {
                    enabled: false,
                    keyPath: './keys/vector.key',
                },
                database: {
                    type: 'api_only',
                    enabled: false,
                },
                embedding: {
                    baseURL: baseURL,
                    timeout: 60000,
                    token: process.env.BACKEND_API_TOKEN || 'your_api_token',
                    maxRetries: 2,
                    retryDelay: 2000,
                    endpoints: {
                        embed: '/api/v1/codebase/embed',
                        upsert: '/api/v1/codebase/upsert',
                    },
                },
            },

            // ==================== 环境相关的API配置 ====================
            environments: {
                development: {
                    baseURL: baseURL,
                    endpoints: {
                        health: '/healthz',
                        version: '/version',
                        embed: '/api/v1/codebase/embed',
                        embedStatus: '/api/v1/codebase/embed/status',
                        embedResults: '/api/v1/codebase/embed/results',
                    },
                    auth: {
                        token: process.env.BACKEND_API_TOKEN || 'test_auth_token',
                    },
                    processing: {
                        mode: 'auto', // 'sync', 'async', 'auto'
                        syncThreshold: 20,
                        batchSize: 15,
                        maxConcurrency: 3,
                        timeout: 30000,
                    },
                    retry: {
                        maxAttempts: 3,
                        delay: 1000,
                        backoffMultiplier: 2,
                    },
                    async: {
                        pollInterval: 2000,
                        maxPollAttempts: 30,
                    },
                    monitoring: {
                        enabled: true,
                        logLevel: 'info',
                        metrics: {
                            collectResponseTimes: true,
                            collectErrorRates: true,
                        },
                    },
                },
                production: {
                    baseURL: baseURL,
                    endpoints: {
                        health: '/healthz',
                        version: '/version',
                        embed: '/api/v1/codebase/embed',
                        embedStatus: '/api/v1/codebase/embed/status',
                        embedResults: '/api/v1/codebase/embed/results',
                    },
                    auth: {
                        token: process.env.BACKEND_API_TOKEN || 'test_auth_token',
                    },
                    processing: {
                        mode: 'auto',
                        syncThreshold: 20,
                        batchSize: 15,
                        maxConcurrency: 5,
                        timeout: 45000,
                    },
                    retry: {
                        maxAttempts: 5,
                        delay: 2000,
                        backoffMultiplier: 2,
                    },
                    async: {
                        pollInterval: 3000,
                        maxPollAttempts: 50,
                    },
                    monitoring: {
                        enabled: true,
                        logLevel: 'warn',
                        metrics: {
                            collectResponseTimes: true,
                            collectErrorRates: true,
                        },
                    },
                },
                test: {
                    baseURL: baseURL,
                    endpoints: {
                        health: '/healthz',
                        version: '/version',
                        embed: '/api/v1/codebase/embed',
                        embedStatus: '/api/v1/codebase/embed/status',
                        embedResults: '/api/v1/codebase/embed/results',
                    },
                    auth: {
                        token: process.env.BACKEND_API_TOKEN || 'test_auth_token',
                    },
                    processing: {
                        mode: 'sync',
                        syncThreshold: 10,
                        batchSize: 5,
                        maxConcurrency: 2,
                        timeout: 15000,
                    },
                    retry: {
                        maxAttempts: 2,
                        delay: 500,
                        backoffMultiplier: 1.5,
                    },
                    async: {
                        pollInterval: 1000,
                        maxPollAttempts: 10,
                    },
                    monitoring: {
                        enabled: true,
                        logLevel: 'debug',
                        metrics: {
                            collectResponseTimes: true,
                            collectErrorRates: true,
                        },
                    },
                },
            },
        };
    }

    // ==================== 公共方法 ====================

    /**
     * 获取应用配置
     */
    getApplication() {
        return this.config.application;
    }

    /**
     * 获取VectorManager配置
     */
    getVectorManager() {
        return this.config.vectorManager;
    }

    /**
     * 获取指定环境的配置
     */
    getEnvironment(env = 'development') {
        return this.config.environments[env] || this.config.environments.development;
    }

    /**
     * 获取完整的API URL
     */
    getApiUrl(env = 'development', endpoint = 'embed') {
        const envConfig = this.getEnvironment(env);
        return `${envConfig.baseURL}${envConfig.endpoints[endpoint]}`;
    }

    /**
     * 从配置字符串中解析服务器IP（支持现有的<SERVER_IP>格式）
     */
    static parseServerIP(apiEndpoint) {
        if (typeof apiEndpoint !== 'string') {
            return null;
        }

        // 如果包含<SERVER_IP>占位符，使用环境变量替换
        if (apiEndpoint.includes('<SERVER_IP>')) {
            const serverIP = process.env.BACKEND_API_SERVER_IP || '42.193.14.136:8087';
            return apiEndpoint.replace('<SERVER_IP>', serverIP);
        }

        return apiEndpoint;
    }

    /**
     * 验证配置
     */
    validate(env = 'development') {
        const envConfig = this.getEnvironment(env);
        const errors = [];

        if (!envConfig.baseURL) {
            errors.push('baseURL is required');
        }

        if (!envConfig.auth.token) {
            errors.push('auth.token is required');
        }

        if (!envConfig.endpoints.embed) {
            errors.push('endpoints.embed is required');
        }

        if (errors.length > 0) {
            throw new Error(`Configuration validation failed for ${env}: ${errors.join(', ')}`);
        }

        return true;
    }

    /**
     * 获取所有配置（用于向后兼容）
     */
    getAll() {
        const env = process.env.NODE_ENV || 'development';
        const envConfig = this.getEnvironment(env);

        // 合并应用配置和环境配置，保持向后兼容性
        return {
            ...this.config.application,
            ...envConfig,
            vectorManager: this.config.vectorManager,
            // 为了兼容旧代码，添加一些别名
            token: envConfig.auth.token,
            apiEndpoint: envConfig.baseURL + envConfig.endpoints.embed,
            timeout: envConfig.processing.timeout,
            maxRetries: envConfig.retry.maxAttempts,
            retryDelay: envConfig.retry.delay,
        };
    }

    /**
     * 获取配置摘要（用于调试）
     */
    getConfigSummary() {
        return {
            hasApplicationConfig: Object.keys(this.config.application).length > 0,
            hasVectorManagerConfig: Object.keys(this.config.vectorManager).length > 0,
            availableEnvironments: Object.keys(this.config.environments),
            currentEnvironment: process.env.NODE_ENV || 'development',
        };
    }
}

module.exports = new AppConfig();
