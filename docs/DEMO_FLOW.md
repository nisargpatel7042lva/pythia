# DEMO_FLOW: 3-minute screen recording

Target length 3:00. One browser window (desktop width), a wallet with Fuji AVAX and an eERC balance
(or Fuji USDC to shield), plus two extra browser tabs pre-opened as described.

## Before recording (5 minutes)

1. Start services from the repo root:
   `npm run resolver` and `npm run build:frontend && npm start -w @pythia/frontend` (or `npm run dev -w @pythia/frontend`).
2. Seed three states (resolver scripts, see README "Create a market"):
   - **Live price-feed market closing in ~20 min:** `npx tsx scripts/createMarket.ts --type pricefeed --direction above --close-in 20`, then 3 bets with `placeBet.ts` so it has published odds.
   - **Open manual market with a few bets and published odds** (4 hours out, 4 bets).
   - **Settled manual market with payouts:** create with `--close-in 5`, place bets, then `npm run resolve -- <id> yes` and let the service pay out.
3. Open two background tabs:
   - Tab A: the example private bet on Snowtrace
     `https://testnet.snowtrace.io/tx/0xad1b973a3982a55955e07b6b4e3093ed9ed7d04a6768d1dd03dbd98bd30b31c9` (scroll to the "Input Data / Value" area).
   - Tab B: a plain transfer for contrast
     `https://testnet.snowtrace.io/tx/0xc39293588097a5624cffdbfaf85e491bca51cf3a305f88f39f2e7fbae748b2ca` (shows "Value: 1 AVAX").
4. Connect the wallet to the app once (so the recording starts connected), keep the wallet popup ready.

## Click order

| Time | Action | Say |
| --- | --- | --- |
| 0:00 | Landing page `/`. Hold on the headline. | "On Polymarket your bet size is public. On PYTHIA it isn't." |
| 0:15 | Scroll to **How it works** (3 cards), then **A real bet, on-chain**. | "Bet privately, odds in batches, private payouts. This card reads a real bet from the chain live." |
| 0:30 | **Snowtrace comparison.** Click "View on Snowtrace". Show Tab A: Value 0, Input Data is opaque hex. Switch to Tab B: "Value: 1 AVAX" in plain sight. Back to the app. | "A normal transfer shows the amount. A PYTHIA bet shows who and where, never how much." |
| 0:55 | Click **Launch App** → `/markets`. Point at the note "Odds update in batches to protect bettors". Click filter **Open**, then category. | "Odds only update when enough new bets arrive, so nobody can back out one person's stake." |
| 1:10 | Open the **open manual market**. Show countdown, odds bar, activity list: bettor + side + **HIDDEN**. | "Everyone sees who bet and which side. The amount column is always HIDDEN." |
| 1:30 | In the bet panel choose **YES**, type `0.50`, click **Bet 0.50 on YES**. Watch the step list: unlock key, balance, **Generating zero-knowledge proof** (the page stays responsive), then approve in the wallet. | "The proof is generated in a background worker in about two seconds; the amount is encrypted before it leaves my browser." |
| 1:55 | When "Bet placed privately" appears, click the tx link → Snowtrace. Show Value 0, opaque input. | "Here is my bet on-chain. No amount. Second Snowtrace moment." |
| 2:10 | Back in the app, open **Portfolio** → **Decrypt my activity**. Show the stake `0.50 USDC`. | "Only I can read this. It is decrypted locally in my browser with my own key; nothing is sent to a server." |
| 2:30 | Open the **settled market**. Show the outcome banner "paid out in N private transfers" and the activity list. Optionally Portfolio → payouts received. | "Resolved by the resolver; winners paid with private transfers too." |
| 2:45 | Open the **live price-feed market** (closing soon): show the Chainlink resolution line and countdown. | "Price-feed markets resolve themselves from Chainlink." |
| 2:52 | Return to the landing page "Honest about trust" card. | "v1 trusts the resolver for custody. Threshold keys and decryption proofs are next." |

## If something goes wrong on camera

- **Wallet on the wrong network:** the app shows "Switch to Avalanche Fuji"; click it.
- **"Encrypted balance too low … public USDC":** fund the wallet first (Circle faucet) or send eUSDC privately with `resolver/scripts/sendPrivate.ts`.
- **Activity list says the feed is unavailable:** the resolver is not running; start `npm run resolver`.
- **RPC timeout:** the app retries automatically; wait a few seconds.
