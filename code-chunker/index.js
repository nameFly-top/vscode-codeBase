const CodeChunker = require('./src/main');

// 全局CodeChunker实例缓存
const chunkerInstances = new Map();

/**
 * 获取或创建CodeChunker实例
 */
function getChunkerInstance(userId, deviceId, workspacePath, token) {
    const key = `${userId}_${deviceId}_${workspacePath}`;

    if (!chunkerInstances.has(key)) {
        try {
            // 加载完整的配置模块
            const configModule = require('./config/config');
            const appConfig = configModule.getApplication();
            const vectorManagerConfig = configModule.getVectorManager();

            // 合并配置：应用配置 + 运行时配置
            const config = {
                ...appConfig,
                workspacePath,
                userId,
                deviceId,
                token,
                vectorManager: vectorManagerConfig,
            };

            const chunkerInstance = new CodeChunker(config);
            chunkerInstances.set(key, chunkerInstance);

            return chunkerInstance;
        } catch (error) {
            console.error('[CodeChunker] ❌ 创建实例失败:', error.message);
            throw error;
        }
    }

    return chunkerInstances.get(key);
}

/**
 * 统一签名的入口函数 - 使用缓存实例
 */
async function processWorkspace(userId, deviceId, workspacePath, token, ignorePatterns) {
    // 使用缓存的实例，确保与进度查询使用同一个实例
    const chunker = getChunkerInstance(userId, deviceId, workspacePath, token);

    // 执行处理
    const result = await chunker.processWorkspace(
        userId,
        deviceId,
        workspacePath,
        token,
        ignorePatterns
    );

    return result;
}

module.exports = {
    processWorkspace,
    getChunkerInstance,
    chunkerInstances,
    CodeChunker,
};
