# PYTHIA

Private prediction markets on Avalanche. Bet sizes are hidden on-chain with eERC
(Encrypted ERC). Who bet and which side is public; how much is hidden.

See [CLAUDE.md](CLAUDE.md) for architecture, trust model, contract addresses and
what is reused from PHANTOM.

## Setup

```bash
cp .env.example .env     # fill in keys
npm install              # installs all workspaces
npm run build:core
```

## Packages

| Path | Purpose |
| --- | --- |
| `contracts/` | Hardhat + TypeScript (market contracts) |
| `packages/eerc-core/` | eERC keys, registration, transfer, withdraw, balance decrypt (Node + browser) |
| `resolver/` | Settlement service |
| `frontend/` | Next.js 14 app |

Status: Phase 1 (scaffold + eerc-core). Trust model v1: the resolver is trusted for custody and settlement.
