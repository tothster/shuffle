/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Polyfill Node.js modules for browser compatibility
      // The shuffle-sdk and @arcium-hq/client use Node.js APIs
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        os: false,
        path: false,
        crypto: require.resolve("crypto-browserify"),
        stream: require.resolve("stream-browserify"),
        buffer: require.resolve("buffer/"),
        process: require.resolve("process/browser"),
        vm: false,
        net: false,
        tls: false,
        child_process: false,
        "pino-pretty": false,
      };

      // Provide global polyfills
      const webpack = require("webpack");
      config.plugins.push(
        new webpack.ProvidePlugin({
          Buffer: ["buffer", "Buffer"],
          process: "process/browser",
        })
      );
    }
    return config;
  },
  // Transpile the local SDK package
  transpilePackages: ["shuffle-sdk"],
};

module.exports = nextConfig;
