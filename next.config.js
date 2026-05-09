/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["face-api.js", "@tensorflow/tfjs"],
  turbopack: {
    root: __dirname,
  },
};
module.exports = nextConfig;
