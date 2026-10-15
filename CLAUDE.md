# PYTHIA

Private prediction markets on Avalanche. Bet sizes are hidden on-chain using eERC
(Encrypted ERC). **Who bet and which side is public. How much is hidden.**

## Working rules (apply to every phase)

- Work only on the scope of the current phase.
- Never fake data, never hardcode mock values in the product.
- Never claim something works without running it.
- At the end of the phase, STOP and report back. Do not start the next phase.

## Network

- Avalanche Fuji, chainId 43113, RPC `https://api.avax-test.network/ext/bc/C/rpc`

## Repo layout

```
Pythia/                (lives in WSL: /home/mysterioxplorer/Pythia)
├── contracts/         Hardhat + TypeScript (Pythia market contracts, later phases)
├── packages/eerc-core/ shared eERC crypto/client, Node + browser (@pythia/eerc-core)
├── resolver/          Node + TypeScript service (@pythia/resolver)
├── frontend/          Next.js 14 App Router + Tailwind (@pythia/frontend)
├── .env.example
├── CLAUDE.md
└── README.md
```

npm workspaces: run `npm install` once at the root. Run commands from WSL (Node 24 via nvm).

## Architecture

- Each market has a **YES pool account** and a **NO pool account**. These are fresh EOAs
  registered on the eERC Registrar. Their private keys and eERC keys are held by the resolver.
- A **bet** = a private eERC transfer from the bettor to the pool account of their chosen side.
- eERC homomorphically accumulates encrypted stakes per pool.
- The resolver publishes decrypted pool totals on-chain **only in batches** (at least K new bets
  since last publish, K configurable via `BATCH_MIN_BETS`, default 3) to prevent differencing
  attacks.
- After resolution, the resolver pays winners via private transfers from the pool accounts
  (parimutuel payout).

### Trust model v1 (honest version)

The resolver is **trusted for custody and settlement**. It holds the pool accounts' private keys
and eERC decryption keys, so it can see every individual stake (it can decrypt each incoming
transfer's amount), decide outcomes, withhold or misdirect payouts, and publish incorrect totals.
Nothing on-chain currently lets users verify the published totals or payouts. Privacy holds
against third-party observers, not against the resolver. Also, the eERC auditor (currently the
deployer address) can decrypt all transfer amounts.

Roadmap: threshold-shared pool keys (no single custodian) and zk decryption/correctness proofs
for published totals and payouts.

## Contract addresses (Fuji, 43113)

Source: `~/eerc-backend-converter/deployments/converter/latest-converter.json` (deployed
2026-07-08 by `0x637A24C97c8e8a3631c6bcdc4B5A62cF2Ca908b7`). Verified on-chain in Phase 1.

| Contract | Address |
| --- | --- |
| EncryptedERC (converter, decimals 2) | `0xFd9E9E078341f18bA29c14404D17D2f7ef1d63D8` |
| Registrar | `0x281D95Fbe23b4Ec33EcF6d4e174F57AA2A0bE6c9` |
| Fuji USDC (wrapped token, 6 decimals) | `0x5425890298aed601595a70AB815c96711a31Bc65` |
| RegistrationCircuitGroth16Verifier | `0x104A97a3f139ccC316591BF8AFcFfC90b8e3AAB6` |
| MintCircuitGroth16Verifier | `0x3fA69AfC6A81d69411A859343D74c83eEbAfAbD9` |
| WithdrawCircuitGroth16Verifier | `0x4b8Da05B98650348312178Deaf9cFcd76637fDB0` |
| TransferCircuitGroth16Verifier | `0x73eC5bC3aABBda8D1d57A9077E3e0AC7905eA403` |
| BurnCircuitGroth16Verifier | `0x8a3F5D64eCe01854343713C01b7F40c738201caE` |
| BabyJubJub library | `0xa3684E4754e606B7EFC315800355be882177eDaD` |
| Auditor (= deployer) | `0x637A24C97c8e8a3631c6bcdc4B5A62cF2Ca908b7` |

Notes:
- EncryptedERC `tokenIds[USDC] == 1`, `nextTokenId == 2`. The backend's `testERC20`
  (`0x669f06E63e23d1f1807DA91BD901aBBeD99c108c`, unused) was never deposited.
- eERC amounts have **2 decimals**; USDC has 6. Always read `EncryptedERC.decimals()`.

### Pythia contracts (Fuji)

| Contract | Address |
| --- | --- |
| PythiaMarkets (verified) | `0xe21D7327eAd6E53AF7549Bd82942C03DF8c7eF44` ([Snowtrace](https://testnet.snowtrace.io/address/0xe21D7327eAd6E53AF7549Bd82942C03DF8c7eF44#code)) |
| Chainlink AVAX / USD feed (8 decimals, 600s heartbeat) | `0x5498BB86BC934c8D34FDA08E81D444153d0D06aD` |
| Resolver EOA | `0xa0338cBA659EE4f9bD92cE70811423610cC2BaC2` (key in gitignored `.env`) |

Owner is the deployer `0x637A…08b7`. Details in `contracts/deployments/fuji.json`; ABI copies in
`resolver/abis/` and `frontend/src/abi/`. Market 0 uses pool EOAs whose keys are in the gitignored
`contracts/.pool-keys/market-0.json`; they are NOT yet registered on the eERC Registrar.

PythiaMarkets rules: K (`minBatchSize`, default 3) new bets required per publish while Open; one
final publish allowed once Closed; totals and bet count never decrease; a pool EOA can back only one
market; price-feed ties resolve No; `markSettled` works from Resolved or Cancelled.

## Pre-existing work (reused from PHANTOM / eerc-backend-converter)

PHANTOM (`~/Phantom`, WSL) contains **no crypto code of its own**: it wraps
`@avalabs/ac-eerc-sdk@^2.0.61` and adds key derivation. It has no committed `.env`, so the
deployed addresses come from `eerc-backend-converter`.

Reused in `packages/eerc-core`:
- `circuits/{register,transfer,withdraw}/*.wasm|*.groth16.zkey`: byte-identical copies of
  `Phantom/frontend/public/circuits` (SHA-256 verified; zkeys also identical to
  `eerc-backend-converter/zkit/artifacts`).
- `abis/EncryptedERC.json`, `abis/Registrar.json`: byte-identical from
  `Phantom/frontend/src/contracts/abis`.
- `src/keys.ts`: `i0()`, `toSyntheticDecryptionKeyHex()`, `deriveI0DecryptionKey()` from PHANTOM's
  `useEERC.ts`; `deriveBabyJubKeys()` from the backend's `deriveKeysFromUser` (hardhat-free).
- `src/client.ts`: SDK call sequences for register / deposit / transfer / withdraw /
  balance decrypt from PHANTOM's `useEERC.ts`, with React and localStorage removed.
- `src/circuits.ts`: PHANTOM's `getCircuitURLs()` parameterised on an absolute base URL.

Also available but NOT copied: PHANTOM UI (Navbar, dashboard, wallet hook, injected-provider
resolver, shadcn components) and `scripts/{deploy,test}.mjs` (end-to-end shield/transfer/reveal
test); backend `scripts/converter/*` Hardhat scripts and Solidity sources.

Gotchas learned:
- The SDK's own `generateDecryptionKey()` differs from the backend's `i0()` derivation. Wallets
  registered via the backend need the i0-derived key; verify against `Registrar.getUserPublicKey`.
- The SDK's `main` points to a missing `dist/index.cjs`; import `@avalabs/ac-eerc-sdk/dist/index.js`.
- Circuit URLs must be absolute (snarkjs runs in workers); in Node use `file://` URLs.
- The SDK is built on viem 1.x / wagmi 1.x; keep `viem@^1.21.4`.

## Phase 2: pools, bets, ledger (done)

- `resolver/src/keystore.ts`: pool EOA + eERC key sealed with scrypt + AES-256-GCM in
  `resolver/keystore/` (gitignored); password from `POOL_KEYSTORE_PASSPHRASE`.
- `resolver/src/pools.ts`: `createPoolPair` funds (resolver wallet) and registers both pools.
- `resolver/scripts/{createMarket,placeBet,ledger,inspectTx}.ts`; `npm run create-market|place-bet|ledger -w @pythia/resolver`.
- `resolver/src/ledger.ts`: SQLite (`node:sqlite`, `resolver/data/ledger.sqlite`), UNIQUE(tx_hash, log_index).
  The pool's amount is decrypted from the receiver PCT in the transfer calldata (public signals
  16..22); the `PrivateTransfer` event only carries the auditor's ciphertext.
- Only the PythiaMarkets **owner** (deployer) can call `createMarket`, so createMarket.ts needs
  `DEPLOYER_PRIVATE_KEY` in addition to the resolver key.
- Key schemes: accounts registered by the backend scripts need `backend-i0`; accounts registered
  through the SDK (pools, new users) use the SDK-native key. `resolveDecryptionKey` picks the one
  that matches the on-chain key.
- Node proofs: pass plain filesystem paths as circuit URLs (not `file://`).
- Market 1 (Fuji): pools YES `0x0317378764c143d58F0174371DF0f58D906b9A2c`, NO `0x65A07743Cb7B1cD0F196D728Bd861323CD6b7cCC`.

## Phase 3: resolver service loop (done)

- `npm run resolver` runs `resolver/src/index.ts` (poll loop; SIGINT = graceful stop). `npm run resolve -- <id> <yes|no|invalid>` resolves a Manual market (also does the final publish first). `npm run test:resolver` = 21 unit tests.
- `engine.ts` loop: sync ledger -> Open: publish when >= max(K, on-chain minBatchSize) new bets AFTER cross-checking ledger sums vs decrypted on-chain pool balances (mismatch = log error, no publish) -> close at closeTime -> final publish -> PriceFeed auto-resolve / Manual waits for CLI -> Resolved/Cancelled: plan, pay, assert pools == 0, `markSettled`.
- Payout rules (`payouts.ts`, pure): winning pool returns each winner's stake, losing pool pays `floor(stake*L/W)` shares, last winner (by first-bet order) takes all dust; Invalid/cancelled and no-winner markets refund exact stakes; bets mined at/after `closeTime` are "late" and refunded. Bettors are aggregated, so 1 stake + 1 share transfer per winner.
- Crash safety (`settlement.ts`, `payoutStore.ts`): the plan is persisted once; before each send the pool's real decrypted balance must equal `startBalance - confirmed`. Equal minus the item amount = already sent (never resend); anything else = refuse. Pending pool txs are awaited first. Test-only fault hook: `PYTHIA_FAULT_INJECT=before_record:<marketId>:<itemSeq>`.
- Fuji gas is ~free (a private transfer costs ~2e-10 AVAX); pool gas top-up threshold is tiny.
- Live results: market 1 (cancelled, 4 refunds) and market 2 (manual YES, 5 bets, 4 payouts, crash-resumed) both Settled; pools exactly 0.
- Known limits: nothing on-chain rejects bets after `closeTime` (they are refunded); a bet landing after a payout plan is created would leave funds in the pool (the service refuses to mark Settled and logs an error); price-feed resolution uses the latest fresh price, not the price at closeTime.

## Commands

```bash
npm install                                   # root, all workspaces
npm run build -w @pythia/eerc-core            # tsup, ESM + CJS + d.ts
TEST_PRIVATE_KEY=0x... npm run test:decrypt -w @pythia/eerc-core   # live Fuji decrypt check
```

## Status (end of Phase 5)

- Phases 1-5 complete on Fuji. Docs: README.md, DEMO_FLOW.md, MAINNET_READINESS.md.
- Tests: 70 contract + 29 resolver (all pass in a fresh clone). eerc-core has live scripts only (test-decrypt, test-own-decrypt), no unit suite.
- Frontend: all pages built; bet, portfolio decryption, admin and the six edge cases were exercised in a real browser with an injected test wallet.
- Demo state on Fuji: market 2 (manual, settled), 3 (manual, open, bets + odds), 5 (AVAX/USD price feed, closes 2026-10-15 14:16 UTC), plus settled markets 1 (cancelled/refunded) and 4 (price feed).
- Resolver env: POOL_GAS_FUND=0.02 is plenty (Fuji gas is ~free); a resolver wallet needs a little AVAX for pool funding.
- Not built: threshold keys, decryption proofs, on-chain bet cutoff, mainnet (see MAINNET_READINESS.md).
