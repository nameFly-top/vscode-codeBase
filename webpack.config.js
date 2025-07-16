//@ts-check

'use strict';

const path = require('path');

//@ts-check
/** @typedef {import('webpack').Configuration} WebpackConfig **/

/** @type WebpackConfig */
const extensionConfig = {
    target: 'node', // VS Code extensions run in a Node.js-context 📖 -> https://webpack.js.org/configuration/node/
    mode: 'none', // this leaves the source code as close as possible to the original (when packaging we set this to 'production')

    entry: './src/extension.ts', // the entry point of this extension, 📖 -> https://webpack.js.org/configuration/entry-context/
    output: {
        // the bundle is stored in the 'dist' folder (check package.json), 📖 -> https://webpack.js.org/configuration/output/
        path: path.resolve(__dirname, 'dist'),
        filename: 'extension.js',
        libraryTarget: 'commonjs2',
    },
    externals: {
        vscode: 'commonjs vscode', // the vscode-module is created on-the-fly and must be excluded. Add other modules that cannot be webpack'ed, 📖 -> https://webpack.js.org/configuration/externals/
        // modules added here also need to be added in the .vscodeignore file
        // Tree-sitter core
        'tree-sitter': 'commonjs tree-sitter',
        // Tree-sitter language parsers - 排除所有包含.node文件的语言包
        'tree-sitter-c': 'commonjs tree-sitter-c',
        'tree-sitter-cpp': 'commonjs tree-sitter-cpp',
        'tree-sitter-c-sharp': 'commonjs tree-sitter-c-sharp',
        'tree-sitter-css': 'commonjs tree-sitter-css',
        'tree-sitter-go': 'commonjs tree-sitter-go',
        'tree-sitter-html': 'commonjs tree-sitter-html',
        'tree-sitter-java': 'commonjs tree-sitter-java',
        'tree-sitter-javascript': 'commonjs tree-sitter-javascript',
        'tree-sitter-php': 'commonjs tree-sitter-php',
        'tree-sitter-python': 'commonjs tree-sitter-python',
        'tree-sitter-ruby': 'commonjs tree-sitter-ruby',
        'tree-sitter-rust': 'commonjs tree-sitter-rust',
        'tree-sitter-typescript': 'commonjs tree-sitter-typescript',
    },
    resolve: {
        // support reading TypeScript and JavaScript files, 📖 -> https://github.com/TypeStrong/ts-loader
        extensions: ['.ts', '.js'],
        alias: {
            '@code-chunker': path.resolve(__dirname, 'code-chunker'),
        },
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                exclude: /node_modules/,
                use: [
                    {
                        loader: 'ts-loader',
                    },
                ],
            },
        ],
    },
    devtool: 'nosources-source-map',
    infrastructureLogging: {
        level: 'log', // enables logging required for problem matchers
    },
    node: {
        __dirname: false,
        __filename: false,
    },
};
module.exports = [extensionConfig];
