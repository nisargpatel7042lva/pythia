# Mainnet readiness check

**Nothing has been deployed to mainnet.** This lists exactly what must exist or change first.
Items are blockers unless marked optional.

## 1. Cryptography and eERC (blockers)

- [ ] **Proving keys from a real ceremony.** The current Fuji circuits were set up with
      `hardhat-zkit` and `contributions: 0` (no multi-party contribution), so whoever ran the setup
      could forge proofs. Mainnet needs either Avalanche's audited eERC deployment and its published
      keys, or a proper multi-party Groth16 ceremony for all circuits.
- [ ] **Deploy (or adopt) the eERC converter on C-Chain mainnet** (EncryptedERC, Registrar, verifiers,
      BabyJubJub) and confirm the wrapped token address with Circle's documentation. Do not reuse
      the Fuji addresses; update `NEXT_PUBLIC_*` / `.env`.
- [ ] **Auditor key.** Today the deployer is the eERC auditor and can read every amount. Choose who
      holds that power, move it to a threshold/MPC or compliance entity, and document it.
- [ ] Re-verify the SDK pin (`@avalabs/ac-eerc-sdk@2.0.61`, viem 1.x) against the mainnet contracts.

## 2. Smart contract (blockers)

- [ ] Independent **security audit** of `PythiaMarkets.sol`.
- [ ] **Owner = multisig** (Safe) with a timelock for `setResolver`, `setMinBatchSize`, `setMaxPriceAge`,
      `cancelMarket`. The owner is currently one EOA.
- [ ] Decide resolver rotation / pause / emergency cancel policy; add a pause switch if wanted.
- [ ] Price-feed markets: use the mainnet Chainlink AVAX/USD proxy
      (`0x0A77230d17318075983913bC2145DB16C7366156`, from Avalanche's Chainlink docs; re-confirm on
      docs.chain.link), set `maxPriceAge` from the feed's heartbeat, and decide whether resolution
      must use the price **at** `closeTime` (today it uses the latest fresh price when called).
- [ ] Optional: enforce a bet cutoff on-chain (today late bets are only refunded off-chain).
- [ ] Deploy with the mainnet RPC, verify on Snowtrace mainnet, pin compiler/settings.

## 3. Resolver and custody (blockers)

- [ ] **Remove the single custodian.** Pool keys currently sit in an encrypted file on one machine.
      Minimum for real funds: KMS/HSM-held resolver key and pool keys; target: threshold keys.
- [ ] Secret management for `POOL_KEYSTORE_PASSPHRASE` and `RESOLVER_PRIVATE_KEY` (no `.env` files).
- [ ] **High availability and durability.** SQLite on one disk is a single point of failure: use a
      replicated database, backups, and tested restore; run more than one resolver safely.
- [ ] Monitoring and alerting (ledger/chain mismatch, stuck payouts, low gas, RPC failures), plus a
      runbook for the "refusing to pay" condition.
- [ ] Dedicated, paid RPC endpoints with failover (the public endpoint times out).
- [ ] Harden the HTTP API: restrict CORS to the app's origin, rate limit, TLS, auth on `/admin/pools`
      nonce/replay protection beyond the 5-minute window.
- [ ] Pool accounts need real gas funding at mainnet gas prices (a private transfer is about 1M gas;
      Fuji's price is near zero, mainnet's is not). Budget per bet and per payout.

## 4. Frontend (blockers unless noted)

- [ ] Production domain, CSP, dependency audit (`npm audit` reports advisories from the wallet/SDK tree).
- [ ] Host the circuit files (about 28 MB) on a CDN with caching; confirm Web Worker proving on
      Safari/iOS and low-end Android (memory).
- [ ] Wallet coverage testing (MetaMask, Core, WalletConnect) with real wallets.
- [ ] Optional: indexer instead of scanning logs from the deploy block in the portfolio.

## 5. Legal and operations (blockers)

- [ ] Legal review: prediction markets are regulated or banned in many jurisdictions; decide
      geofencing, KYC/AML position, terms, and who the operator is.
- [ ] Disclose the trust model to users in the product (resolver sees stakes; auditor sees stakes).
- [ ] Incident response, bug bounty, and a staged launch with caps on pool size.

## Not required to change

Parimutuel math, the K-batch rule, payout crash-recovery and the ledger cross-check are covered by
tests and ran on Fuji; they should be re-run on a mainnet fork before launch.
