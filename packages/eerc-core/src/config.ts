/**
 * Fuji deployment of the eERC converter, taken from
 * ~/eerc-backend-converter/deployments/converter/latest-converter.json
 * (deployed 2026-07-08). The EncryptedERC wraps Fuji USDC (tokenIds[USDC] == 1,
 * verified on-chain). The backend's `testERC20` (0x669f...) is unused.
 */
export const FUJI_CHAIN_ID = 43113;
export const FUJI_RPC_URL = "https://api.avax-test.network/ext/bc/C/rpc";

export interface EercAddresses {
  encryptedERC: `0x${string}`;
  registrar: `0x${string}`;
  /** The ERC20 wrapped by the converter (Fuji USDC). */
  token: `0x${string}`;
}

export const FUJI_EERC: EercAddresses & {
  deployer: `0x${string}`;
  verifiers: Record<"registration" | "mint" | "withdraw" | "transfer" | "burn", `0x${string}`>;
  babyJubJub: `0x${string}`;
} = {
  encryptedERC: "0xFd9E9E078341f18bA29c14404D17D2f7ef1d63D8",
  registrar: "0x281D95Fbe23b4Ec33EcF6d4e174F57AA2A0bE6c9",
  token: "0x5425890298aed601595a70AB815c96711a31Bc65",
  deployer: "0x637A24C97c8e8a3631c6bcdc4B5A62cF2Ca908b7",
  verifiers: {
    registration: "0x104A97a3f139ccC316591BF8AFcFfC90b8e3AAB6",
    mint: "0x3fA69AfC6A81d69411A859343D74c83eEbAfAbD9",
    withdraw: "0x4b8Da05B98650348312178Deaf9cFcd76637fDB0",
    transfer: "0x73eC5bC3aABBda8D1d57A9077E3e0AC7905eA403",
    burn: "0x8a3F5D64eCe01854343713C01b7F40c738201caE",
  },
  babyJubJub: "0xa3684E4754e606B7EFC315800355be882177eDaD",
};

/** Token decimals of Fuji USDC. The eERC itself uses its own `decimals()` (2). */
export const USDC_DECIMALS = 6;
/** Fallback only: the real value is always read from EncryptedERC.decimals(). */
export const FALLBACK_EERC_DECIMALS = 2n;
