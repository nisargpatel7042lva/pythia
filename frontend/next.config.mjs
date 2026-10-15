import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
// One .env at the repo root serves every package. Only NEXT_PUBLIC_* values reach the browser.
dotenv.config({ path: path.resolve(here, "../.env") });
const publicEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith("NEXT_PUBLIC_")));

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: publicEnv,
  transpilePackages: ["@pythia/eerc-core"],
  webpack: (config, { isServer, webpack }) => {
    if (!isServer) {
      // snarkjs / ffjavascript (inside @avalabs/ac-eerc-sdk) reference Node-only modules on code
      // paths that never run in the browser. Strip the "node:" scheme and stub them for the
      // client bundle (this also applies to the Web Worker bundle).
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
          resource.request = resource.request.replace(/^node:/, "");
        }),
      );
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        crypto: false,
        path: false,
        os: false,
        readline: false,
        child_process: false,
      };
    }
    return config;
  },
};

export default nextConfig;
