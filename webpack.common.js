const GitRevisionPlugin = require('git-revision-webpack-plugin');
const gitRevision = new GitRevisionPlugin();
const HtmlWebpackPlugin = require('html-webpack-plugin');
const {CleanWebpackPlugin} = require('clean-webpack-plugin');
const WasmPackPlugin = require("@wasm-tool/wasm-pack-plugin");
const CopyPlugin = require('copy-webpack-plugin');
const path = require('path');
const webpack = require('webpack');

module.exports = {
  entry: {
    main: './src/main.ts',
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name]-[contenthash].js',
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      // ts-loader defined in dev and prod separately
      {
        test: /\.(png|woff2)$/,
        type: 'asset/resource',
      },
      {
        test: /\.glsl$/,
        loader: 'raw-loader',
      },
      {
        test: /\.d\.ts$/,
        loader: 'declaration-loader'
    },
    ],
  },
  plugins: [
    new webpack.DefinePlugin({
      '__COMMIT_HASH': JSON.stringify(gitRevision.commithash()),
    }),
    new webpack.IgnorePlugin({
      // Workaround for broken libraries
      resourceRegExp: /^(fs|path)$/,
    }),
    new CleanWebpackPlugin({
      cleanOnceBeforeBuildPatterns: [
        '**/*',
        '!data',
        '!data/**/*',
        '!.htaccess',
      ],
    }),
    new HtmlWebpackPlugin({
      chunks: ['main'],
      filename: 'index.html',
      template: './src/index.html',
    }),
    new HtmlWebpackPlugin({
      chunks: ['main'],
      filename: 'embed.html',
      template: './src/index.html',
    }),
    new CopyPlugin({
      // All .wasm files are currently expected to be at the root
      patterns: [
        { from: 'src/**/*.wasm', to: '[name].[ext]' },
        { from: 'node_modules/librw/lib/librw.wasm', to: '[name].[ext]' },
      ],
    }),
    new WasmPackPlugin({
      crateDirectory: path.join(__dirname, 'rust'),
      forceMode: "production",
    }),
  ],
  experiments: {
    syncWebAssembly: true,
  },
  target: 'web',
};
