# Deployments and on-chain evidence (Avalanche Fuji, chain id 43113)

Everything below is a real transaction or contract on Fuji testnet. Nothing is simulated.

## Contracts

| What | Link |
| --- | --- |
| PythiaMarkets (verified) | [0xe21D…ef44](https://testnet.snowtrace.io/address/0xe21D7327eAd6E53AF7549Bd82942C03DF8c7eF44#code) |
| EncryptedERC (converter) | [0xFd9E…63D8](https://testnet.snowtrace.io/address/0xFd9E9E078341f18bA29c14404D17D2f7ef1d63D8) |
| Registrar | [0x281D…E6c9](https://testnet.snowtrace.io/address/0x281D95Fbe23b4Ec33EcF6d4e174F57AA2A0bE6c9) |
| Fuji USDC (wrapped token) | [0x5425…1Bc65](https://testnet.snowtrace.io/address/0x5425890298aed601595a70AB815c96711a31Bc65) |
| Chainlink AVAX/USD feed | [0x5498…06aD](https://testnet.snowtrace.io/address/0x5498BB86BC934c8D34FDA08E81D444153d0D06aD) |
| Transfer / Registration / Withdraw verifiers | [0x73eC…A403](https://testnet.snowtrace.io/address/0x73eC5bC3aABBda8D1d57A9077E3e0AC7905eA403) / [0x104A…AAB6](https://testnet.snowtrace.io/address/0x104A97a3f139ccC316591BF8AFcFfC90b8e3AAB6) / [0x4b8D…fDB0](https://testnet.snowtrace.io/address/0x4b8Da05B98650348312178Deaf9cFcd76637fDB0) |

The machine-readable copy is in [`contracts/deployments/fuji.json`](../contracts/deployments/fuji.json).

## A private bet next to a plain transfer

The private bet has native value 0, and its calldata is proof plus ciphertext. The amount appears nowhere:
[0xad1b97…31c9](https://testnet.snowtrace.io/tx/0xad1b973a3982a55955e07b6b4e3093ed9ed7d04a6768d1dd03dbd98bd30b31c9).
A plain transfer, for contrast, shows its amount in the Value field:
[1 AVAX](https://testnet.snowtrace.io/tx/0xc39293588097a5624cffdbfaf85e491bca51cf3a305f88f39f2e7fbae748b2ca).

## A full manual-market lifecycle (market 2, settled with private payouts)

| Step | Tx |
| --- | --- |
| Market created | [0x2839c8…a5059](https://testnet.snowtrace.io/tx/0x2839c85f4434c8a1c39e674310b280299cc08814a8379cfe63d9ce688f2a5059) |
| Batched odds published (3 bets) | [0x3ad051…c4a](https://testnet.snowtrace.io/tx/0x3ad051f0a51d064ae508af38c4072b8ef05d12063caa045c587dc71690e09c4a) |
| Closed | [0xc74e1e…d0a](https://testnet.snowtrace.io/tx/0xc74e1ea545e7187659c6f9ceb9416320aa34acb39c89e7426f2a0cc2b7323d0a) |
| Final publish (5 bets) | [0xb16e19…6e5](https://testnet.snowtrace.io/tx/0xb16e19ad6f8bb34c08d123801a00a5115bf45827fc82946abe9037e8ee1486e5) |
| Resolved YES | [0xd248d2…642](https://testnet.snowtrace.io/tx/0xd248d21ae3aaba512f97e236b6f6e10fcb9c4fbcd04cbfb2fd013ddbd056f642) |
| Payouts (4 private transfers) | [1](https://testnet.snowtrace.io/tx/0x2f8038835f85b896770bf8794f17f37e532ce5f86190d68378d7bc30bb04a617) · [2](https://testnet.snowtrace.io/tx/0x8d42f0fe23293d5809839c7cfe1ed4362d5b5262c7b9058b91dcf121b56c1ed8) · [3](https://testnet.snowtrace.io/tx/0x8562f68ee45aa44891caa0ef93499ec61ce063a9d626cc34e925e61b9739f6f5) · [4](https://testnet.snowtrace.io/tx/0x465419a94464209cdc1059697710e4fa6c6ff89b4d83bae3225196e808615bba) |
| Marked Settled | [0xeeddd3…fd58](https://testnet.snowtrace.io/tx/0xeeddd33d56df2a670617343ba68b84e4635e59cd55553f0c263fa208eea9fd58) |

Payouts 3 and 4 survived two forced process kills (one mid-proof, one right after broadcast) without paying twice.

## Other lifecycles

- **Market 4, price-feed market**, run end to end with no manual step: closed
  ([tx](https://testnet.snowtrace.io/tx/0x0788ed49aacf34bcf2a2f2dcf51eee9f8947e63dfbb77579f9c607f18f614aef)),
  resolved from Chainlink ([tx](https://testnet.snowtrace.io/tx/0x49eb5cbba7d5f6e2ed2940832cb903699a0fc5bbf17ba9019b5cfd4a1b037297)),
  paid out in 4 private transfers
  ([1](https://testnet.snowtrace.io/tx/0xe4f01f891404a6e371f62e1b0b15dd25efe48d765a0c640763612c3d437ee785) ·
  [2](https://testnet.snowtrace.io/tx/0xfa7d4e5caab1945193610678dbff403e7c2938d0361e068918c73958ab1fba44) ·
  [3](https://testnet.snowtrace.io/tx/0x3a0036a7a99609333191185aedea37902f0394380046c872d96e8c601cd4f970) ·
  [4](https://testnet.snowtrace.io/tx/0x3bd536286e1c1efb0d3dfdcefb6e642739c34f989dfe275e1817d301e4049721)),
  then [marked Settled](https://testnet.snowtrace.io/tx/0xcbd1bad6776a70c57359c39078c27c5fc1a641eb0a92233274c906cbbbaa08f0).
- **Market 1, cancel and refund path**: [settled](https://testnet.snowtrace.io/tx/0x5e7b1832b3ec49a0c6f2aee687e36bf855b3e48867f88987af93a01153f57872).

## About the demo data

Every market, bet, odds update and payout shown in the app is a **real transaction on Avalanche Fuji testnet**, not mock data. They were created by the team with the repo's own scripts and UI: two funded test wallets placed the seed bets through the same private-transfer flow a user goes through (`resolver/scripts/placeBet.ts`), and the resolver service published odds, resolved markets and paid out on its own. The money is testnet USDC with no value, the questions are demo questions, and the bettors are our test wallets, not independent users.
