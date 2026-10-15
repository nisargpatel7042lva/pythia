import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  // Keep heavy crypto deps external; consumers (Node / Next.js) resolve them.
  external: ["@avalabs/ac-eerc-sdk/dist/index.js","ethers", "viem", "maci-crypto", "@zk-kit/baby-jubjub"],
});
