"use client";

import { ethers } from "ethers";
import { useState } from "react";
import { Frame } from "@/components/Nav";
import { PageHead } from "@/components/Page";
import { Banner, Spinner, TxLink } from "@/components/ui";
import { config } from "@/config";
import marketsAbi from "@/abi/PythiaMarkets.abi.json";
import { fetchFeedInfo, provider } from "@/lib/chain";
import { friendlyError } from "@/lib/errors";
import { useOwner } from "@/lib/hooks";
import { adminMessage, requestPools } from "@/lib/resolverApi";
import { useWallet } from "@/lib/wallet";

const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export default function AdminPage() {
  const w = useWallet();
  const owner = useOwner();
  const isOwner = !!w.address && !!owner.data && w.address.toLowerCase() === owner.data.toLowerCase();

  const [question, setQuestion] = useState("");
  const [category, setCategory] = useState("");
  const [closeAt, setCloseAt] = useState(localInput(new Date(Date.now() + 60 * 60 * 1000)));
  const [type, setType] = useState<"manual" | "pricefeed">("manual");
  const [feed, setFeed] = useState<string>(config.defaultPriceFeed);
  const [strike, setStrike] = useState("");
  const [above, setAbove] = useState(true);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: number; hash: string } | null>(null);

  const gate = (c: React.ReactNode) => (<><PageHead tag="Owner only" title="Create market" /><Frame><div className="p-6 sm:p-10">{c}</div></Frame></>);
  if (!w.address) return gate(<Banner>Connect the owner wallet to continue.</Banner>);
  if (owner.loading && !owner.data) return gate(<p className="text-sm text-fog">Checking permissions…</p>);
  if (!isOwner) return gate(<Banner tone="warn">This page is only available to the contract owner.</Banner>);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(null);
    try {
      const closeTime = Math.floor(new Date(closeAt).getTime() / 1000);
      if (closeTime <= Math.floor(Date.now() / 1000) + 60) throw new Error("Close time must be at least a minute in the future.");
      if (!question.trim()) throw new Error("Enter a question.");
      let strikeScaled = 0n;
      if (type === "pricefeed") {
        if (!ethers.isAddress(feed)) throw new Error("Enter a valid price feed address.");
        const info = await fetchFeedInfo(feed);
        if (!/^\d+(\.\d+)?$/.test(strike)) throw new Error("Enter a strike price, e.g. 9.50");
        strikeScaled = ethers.parseUnits(strike, info.decimals);
      }
      await w.ensureNetwork();
      const wc = w.getWalletClient();

      setStage("Sign to authorise creating the pool accounts…");
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = await wc.signMessage({ message: adminMessage(w.address!, timestamp) });

      setStage("The resolver is creating and registering the YES/NO pool accounts (about 30 seconds)…");
      const pools = await requestPools({ address: w.address!, timestamp, signature });

      setStage("Confirm the createMarket transaction in your wallet…");
      const hash = await wc.writeContract({
        address: config.addresses.markets,
        abi: marketsAbi as never,
        functionName: "createMarket",
        args: [question.trim(), category.trim() || "general", pools.yesPool, pools.noPool, BigInt(closeTime), type === "manual" ? 0 : 1, type === "manual" ? ethers.ZeroAddress : feed, strikeScaled, above] as never,
      } as never);
      setStage("Waiting for confirmation…");
      const receipt = await provider.waitForTransaction(hash);
      const iface = new ethers.Interface(marketsAbi);
      const ev = receipt?.logs.map((l) => { try { return iface.parseLog(l); } catch { return null; } }).find((p) => p?.name === "MarketCreated");
      setDone({ id: Number(ev?.args.marketId ?? -1), hash });
      setQuestion("");
    } catch (err) {
      const f = friendlyError(err);
      setError(/fetch/i.test(String((err as Error).message)) ? "The resolver is unreachable, so pool accounts could not be created. Start the resolver service and retry." : f.message);
    } finally {
      setStage(null);
    }
  }

  return (
    <><PageHead tag="Owner only" title="Create market" sub="Creates fresh YES/NO pool accounts through the resolver, then registers the market on-chain." /><Frame><form onSubmit={submit} className="max-w-3xl space-y-6 p-6 sm:p-10">
        <div>
          <label className="label" htmlFor="q">Question</label>
          <input id="q" className="field" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Will AVAX/USD be above $10 at close?" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="c">Category</label>
            <input id="c" className="field" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="crypto" />
          </div>
          <div>
            <label className="label" htmlFor="t">Closes at</label>
            <input id="t" type="datetime-local" className="field" value={closeAt} onChange={(e) => setCloseAt(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="rt">Resolution</label>
          <select id="rt" className="field" value={type} onChange={(e) => setType(e.target.value as "manual" | "pricefeed")}>
            <option value="manual">Manual (resolver decides)</option>
            <option value="pricefeed">Chainlink price feed</option>
          </select>
        </div>
        {type === "pricefeed" && (
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="sm:col-span-3">
              <label className="label" htmlFor="f">Price feed address</label>
              <input id="f" className="field num" value={feed} onChange={(e) => setFeed(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="s">Strike (USD)</label>
              <input id="s" className="field num" value={strike} onChange={(e) => setStrike(e.target.value)} placeholder="9.50" />
            </div>
            <div>
              <label className="label" htmlFor="d">Yes if price is</label>
              <select id="d" className="field" value={above ? "above" : "below"} onChange={(e) => setAbove(e.target.value === "above")}>
                <option value="above">above strike</option>
                <option value="below">below strike</option>
              </select>
            </div>
          </div>
        )}
        <button className="btn-primary w-full py-4 text-base" disabled={!!stage}>
          {stage ? <Spinner /> : null} {stage ?? "Create market"}
        </button>
        {error && <Banner tone="error">{error}</Banner>}
        {done && (
          <Banner tone="ok">
            Market #{done.id} created. <TxLink hash={done.hash} />
          </Banner>
        )}
      </form></Frame></>
  );
}
