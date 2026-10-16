# Manual test checklist (about 25 minutes)

Run this yourself with a real wallet. Each line says what to do and what you should see. If something
differs, note the **step number**, a screenshot, and the browser console (F12 > Console).

## 0. Before you start

- [ ] Wallet extension installed (MetaMask or Core). Use a **fresh/throwaway account**, not one with real funds.
- [ ] Test AVAX on Fuji: <https://core.app/tools/testnet-faucet/?subnet=c&token=c>
- [ ] Test USDC on Fuji (needed for the "shield" step): <https://faucet.circle.com> (choose Avalanche Fuji)
- [ ] Services are up. From WSL: `curl localhost:8787/health` returns `"ok":true`, and `http://localhost:3000` loads in your browser.
      (If they are not running: `cd ~/Pythia && npm run resolver` and, in another terminal, `npm run build:frontend && npm start -w @pythia/frontend`.)
- [ ] Do not run heavy scripts at the same time: the public Fuji RPC bans bursty clients and the app then shows CORS/network errors.

## 1. Wallet button

1. **Connect with one wallet installed** → one click opens the wallet prompt; after approving, the header shows your short address with a green dot.
2. **Wrong network:** switch the wallet to another network first, then click Connect → it asks to switch/add **Avalanche Fuji** and ends up on Fuji. If you refuse the switch you stay connected and see a gold "Switch to Fuji" button plus a banner.
3. **Address menu:** click your address → menu with *Copy address*, *View on Snowtrace*, *Disconnect*. Click outside or press Esc → it closes. *Disconnect* returns to "Connect wallet".
4. **Reject the connection** in the wallet → red banner "You rejected the request…", header stays on "Connect wallet", Dismiss works.
5. **Several wallets installed** (e.g. MetaMask + Core) → Connect shows a list to choose from. **No wallet installed** → "No wallet detected" with install links.
6. Reload the page → you stay connected (silent reconnect).

## 2. Browse

1. **/** landing: headline, 3 steps, and the "A real bet, on-chain" card showing *Native value 0 wei*, *Bet amount: not present anywhere*. Click "View on Snowtrace" and confirm the input data is opaque hex.
2. **/markets:** 6 markets. Status chips and category filter work. The note "Odds update in batches to protect bettors" is shown. Odds bars match: market 6 is **Open** with published odds; the others are Settled/Cancelled.
3. **Mobile:** narrow the window to phone width (or use device mode): no horizontal scrolling, menu (☰) works.

## 3. Placing a bet (the main test)

Open market **#6** (Open). Use a wallet that has Fuji AVAX.

1. Pick YES, type `0.50`, click **Bet**. The step list appears: network → key → *(register)* → balance → *(shield)* → proof → wallet → confirm.
2. **First time with a new wallet:** you are asked to sign one message (unlocking your private key). Then a **registration** transaction is requested (one-time).
3. **No USDC yet:** you should get a clear message *"…your encrypted balance is too low and you only hold 0.0 public USDC… Get Fuji USDC at …"* with a faucet link. (Nothing was sent.)
4. **After getting Fuji USDC:** repeat. You are asked to **approve** USDC and then **deposit** (shield) before the bet. Then the proof step runs (a few seconds; the page stays responsive) and you confirm the bet transaction.
5. **Success:** green box "Bet placed privately" with a tx link and "proof generated in X s". Click the link on Snowtrace: **Value 0**, input data is opaque, **no 0.50 anywhere**.
6. **Reject** the wallet prompt at any step → calm message, nothing sent, you can retry.
7. On the market page, after ~10–20 s your bet appears in **Activity** with your address, your side, and **HIDDEN** instead of an amount.
8. Odds do **not** change after a single bet (they update only in batches of 3+ new bets). Place 2 more small bets from the same wallet and the odds bar should update after a few seconds (this is the batching rule).

## 4. Portfolio

1. Go to **/portfolio**, click **Decrypt my activity**. One signature at most (it may reuse the earlier one).
2. Your bets show the **exact amounts you entered**; totals add up. Nothing is requested from any server for amounts.
3. A wallet with no bets shows "No bets found for this wallet yet".
4. (Settled markets only) *Payouts received* lists stake and share transfers once a market you bet on is settled.

## 5. Settled / closed markets

1. Open market **#3**: banner "Outcome: YES · paid out in 6 private transfers", bet panel says *Betting closed*.
2. Open market **#1**: banner says *cancelled*; **#4** and **#5**: price-feed markets (resolution line mentions Chainlink).

## 6. Admin (owner wallet only)

The contract owner is the deployer `0x637A24C97c8e8a3631c6bcdc4B5A62cF2Ca908b7` (its key is `PRIVATE_KEY` in `~/eerc-backend-converter/.env`; import it into a **testnet-only** wallet profile to test).

1. With any other wallet: no **Admin** link; opening `/admin` says "only available to the contract owner".
2. With the owner wallet: **Admin** link appears. Create a market:
   - Manual: question + category + close time → sign → wait ~30 s (resolver creates and registers the pools) → confirm the transaction → green box with the new market id. It appears in /markets.
   - Price feed: pick "Chainlink price feed", strike e.g. `9.50`, "above". Closes → the resolver resolves it by itself.

## 7. Resolver offline

1. Stop the resolver (`Ctrl+C` in its terminal, or `pkill -INT -f "node.*src/index.ts"`).
2. Header shows **resolver offline**; a market's Activity shows a yellow "feed unavailable" banner; /portfolio shows a network error; **betting still works**.
3. Start it again; everything recovers within about a minute.

## 8. Things to report to me

- Anything that is red, blank, or spinning for more than 60 s, with the step number.
- The **proof time** shown in the green box (you will see your hardware's number).
- Any wallet-specific oddity (which wallet, which browser).

## Known limits (not bugs)

- Nothing on-chain stops a bet after a market closes; the resolver refunds late bets.
- The resolver is trusted for custody, and the eERC auditor can read amounts (see README).
- Public Fuji RPC can rate-limit; wait a minute and retry.
