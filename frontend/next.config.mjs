/** @type {import('next').NextConfig} */
const nextConfig = {
  // eerc-core ships TS-built dist, but transpiling keeps workspace linking simple.
  transpilePackages: ["@pythia/eerc-core"],
};

export default nextConfig;
