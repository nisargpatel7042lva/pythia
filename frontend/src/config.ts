/**
 * Every address, URL and deployment constant the app uses comes from here, and every value here
 * comes from NEXT_PUBLIC_* environment variables (root .env, see .env.example). Nothing else in
 * the frontend hardcodes an address.
 *
 * Each variable must be referenced literally (process.env.NEXT_PUBLIC_X) so Next can inline it.
 */
function need(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing ${name}. Set it in the root .env (see .env.example).`);
  return value;
}

const addr = (name: string, v: string | undefined) => need(name, v) as `0x${string}`;

export const config = {
  chainId: Number(need("NEXT_PUBLIC_CHAIN_ID", process.env.NEXT_PUBLIC_CHAIN_ID)),
  rpcUrl: need("NEXT_PUBLIC_FUJI_RPC_URL", process.env.NEXT_PUBLIC_FUJI_RPC_URL),
  explorerUrl: need("NEXT_PUBLIC_EXPLORER_URL", process.env.NEXT_PUBLIC_EXPLORER_URL).replace(/\/$/, ""),
  resolverApiUrl: need("NEXT_PUBLIC_RESOLVER_API_URL", process.env.NEXT_PUBLIC_RESOLVER_API_URL).replace(/\/$/, ""),
  deployBlock: Number(need("NEXT_PUBLIC_DEPLOY_BLOCK", process.env.NEXT_PUBLIC_DEPLOY_BLOCK)),
  addresses: {
    encryptedERC: addr("NEXT_PUBLIC_EERC_ADDRESS", process.env.NEXT_PUBLIC_EERC_ADDRESS),
    registrar: addr("NEXT_PUBLIC_REGISTRAR_ADDRESS", process.env.NEXT_PUBLIC_REGISTRAR_ADDRESS),
    token: addr("NEXT_PUBLIC_USDC_ADDRESS", process.env.NEXT_PUBLIC_USDC_ADDRESS),
    markets: addr("NEXT_PUBLIC_PYTHIA_MARKETS_ADDRESS", process.env.NEXT_PUBLIC_PYTHIA_MARKETS_ADDRESS),
  },
  defaultPriceFeed: addr("NEXT_PUBLIC_DEFAULT_PRICE_FEED", process.env.NEXT_PUBLIC_DEFAULT_PRICE_FEED),
  exampleBetTx: need("NEXT_PUBLIC_EXAMPLE_BET_TX", process.env.NEXT_PUBLIC_EXAMPLE_BET_TX),
  examplePlainTx: need("NEXT_PUBLIC_EXAMPLE_PLAIN_TX", process.env.NEXT_PUBLIC_EXAMPLE_PLAIN_TX),
  usdcFaucetUrl: need("NEXT_PUBLIC_USDC_FAUCET_URL", process.env.NEXT_PUBLIC_USDC_FAUCET_URL),
  avaxFaucetUrl: need("NEXT_PUBLIC_AVAX_FAUCET_URL", process.env.NEXT_PUBLIC_AVAX_FAUCET_URL),
};

/** Chain metadata used when asking a wallet to add the network. */
export const chainMeta = {
  name: "Avalanche Fuji C-Chain",
  currency: { name: "Avalanche", symbol: "AVAX", decimals: 18 },
};

export const txUrl = (hash: string) => `${config.explorerUrl}/tx/${hash}`;
export const addressUrl = (a: string) => `${config.explorerUrl}/address/${a}`;
