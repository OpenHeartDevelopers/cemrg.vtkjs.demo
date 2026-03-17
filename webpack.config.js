const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = {
    mode: 'production',
    entry: './src/index.js',
    output: {
        filename: 'main.js',
        path: path.resolve(__dirname, 'dist'),
        // Wipe dist on every build so stale artefacts don't accumulate
        clean: true,
    },
    module: {
        rules: [
            {
                test: /\.html$/,
                use: ['html-loader'],
            },
        ],
    },
    plugins: [
        // Generates dist/index.html automatically on every build.
        // No more manual creation or silent loss on clean builds.
        new HtmlWebpackPlugin({
            title: 'CEMRG: VR Model Demo',
            // Injects the <script src="main.js"> automatically
            inject: 'body',
        }),

        // Copies data/ into dist/data/ on every build.
        // The mesh files are fetched at runtime via HTTP (not bundled),
        // so webpack would never discover them through import analysis alone.
        new CopyWebpackPlugin({
            patterns: [
                {
                    from: path.resolve(__dirname, 'data'),
                    to: path.resolve(__dirname, 'dist/data'),
                },
            ],
        }),
    ],
};