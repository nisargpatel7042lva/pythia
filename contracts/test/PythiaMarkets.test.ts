import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

// Enum mirrors
const Status = { Open: 0, Closed: 1, Resolved: 2, Settled: 3, Cancelled: 4 } as const;
const Outcome = { Unresolved: 0, Yes: 1, No: 2, Invalid: 3 } as const;
const Res = { Manual: 0, PriceFeed: 1 } as const;

const PRICE_DECIMALS = 8;
const usd = (n: number) => BigInt(Math.round(n * 10 ** PRICE_DECIMALS));
const STRIKE = usd(10);

async function deployFixture() {
  const [owner, resolver, other, yesPool, noPool, yesPool2, noPool2] = await ethers.getSigners();
  const feed = await (await ethers.getContractFactory("MockAggregator")).deploy(PRICE_DECIMALS, usd(10));
  const markets = await (await ethers.getContractFactory("PythiaMarkets")).deploy(owner.address, resolver.address);
  return { markets, feed, owner, resolver, other, yesPool, noPool, yesPool2, noPool2 };
}

type Fx = Awaited<ReturnType<typeof deployFixture>>;

async function createManual(fx: Fx, closeIn = 1000, pools?: [string, string]) {
  const closeTime = (await time.latest()) + closeIn;
  const [y, n] = pools ?? [fx.yesPool.address, fx.noPool.address];
  await fx.markets.createMarket(
    "Will it rain?",
    "weather",
    y,
    n,
    closeTime,
    Res.Manual,
    ethers.ZeroAddress,
    0,
    false,
  );
  return { id: (await fx.markets.getMarketCount()) - 1n, closeTime };
}

async function createFeedMarket(fx: Fx, priceAbove = true, strike = STRIKE, closeIn = 1000, pools?: [string, string]) {
  const closeTime = (await time.latest()) + closeIn;
  const [y, n] = pools ?? [fx.yesPool.address, fx.noPool.address];
  await fx.markets.createMarket(
    "AVAX above $10?",
    "crypto",
    y,
    n,
    closeTime,
    Res.PriceFeed,
    await fx.feed.getAddress(),
    strike,
    priceAbove,
  );
  return { id: (await fx.markets.getMarketCount()) - 1n, closeTime };
}

describe("PythiaMarkets", () => {
  describe("deployment & admin", () => {
    it("sets owner, resolver and defaults, and emits ResolverUpdated", async () => {
      const fx = await loadFixture(deployFixture);
      expect(await fx.markets.owner()).to.equal(fx.owner.address);
      expect(await fx.markets.resolver()).to.equal(fx.resolver.address);
      expect(await fx.markets.minBatchSize()).to.equal(3);
      expect(await fx.markets.maxPriceAge()).to.equal(3600);
      expect(await fx.markets.getMarketCount()).to.equal(0);
      await expect(fx.markets.deploymentTransaction())
        .to.emit(fx.markets, "ResolverUpdated")
        .withArgs(ethers.ZeroAddress, fx.resolver.address);
    });

    it("rejects a zero resolver at deployment", async () => {
      const [owner] = await ethers.getSigners();
      const F = await ethers.getContractFactory("PythiaMarkets");
      await expect(F.deploy(owner.address, ethers.ZeroAddress)).to.be.revertedWithCustomError(F, "ZeroAddress");
    });

    it("setResolver: owner only, nonzero, emits", async () => {
      const fx = await loadFixture(deployFixture);
      await expect(fx.markets.connect(fx.other).setResolver(fx.other.address)).to.be.revertedWithCustomError(
        fx.markets,
        "OwnableUnauthorizedAccount",
      );
      await expect(fx.markets.setResolver(ethers.ZeroAddress)).to.be.revertedWithCustomError(fx.markets, "ZeroAddress");
      await expect(fx.markets.setResolver(fx.other.address))
        .to.emit(fx.markets, "ResolverUpdated")
        .withArgs(fx.resolver.address, fx.other.address);
      expect(await fx.markets.resolver()).to.equal(fx.other.address);
    });

    it("setMinBatchSize: owner only, nonzero, emits", async () => {
      const fx = await loadFixture(deployFixture);
      await expect(fx.markets.connect(fx.other).setMinBatchSize(5)).to.be.revertedWithCustomError(
        fx.markets,
        "OwnableUnauthorizedAccount",
      );
      await expect(fx.markets.setMinBatchSize(0)).to.be.revertedWithCustomError(fx.markets, "InvalidParameter");
      await expect(fx.markets.setMinBatchSize(5)).to.emit(fx.markets, "MinBatchSizeUpdated").withArgs(3, 5);
      expect(await fx.markets.minBatchSize()).to.equal(5);
    });

    it("setMaxPriceAge: owner only, nonzero, emits", async () => {
      const fx = await loadFixture(deployFixture);
      await expect(fx.markets.connect(fx.other).setMaxPriceAge(60)).to.be.revertedWithCustomError(
        fx.markets,
        "OwnableUnauthorizedAccount",
      );
      await expect(fx.markets.setMaxPriceAge(0)).to.be.revertedWithCustomError(fx.markets, "InvalidParameter");
      await expect(fx.markets.setMaxPriceAge(60)).to.emit(fx.markets, "MaxPriceAgeUpdated").withArgs(3600, 60);
      expect(await fx.markets.maxPriceAge()).to.equal(60);
    });
  });

  describe("createMarket", () => {
    it("creates a manual market, stores every field and emits MarketCreated", async () => {
      const fx = await loadFixture(deployFixture);
      const closeTime = (await time.latest()) + 1000;
      await expect(
        fx.markets.createMarket(
          "Will it rain?",
          "weather",
          fx.yesPool.address,
          fx.noPool.address,
          closeTime,
          Res.Manual,
          ethers.ZeroAddress,
          0,
          false,
        ),
      )
        .to.emit(fx.markets, "MarketCreated")
        .withArgs(
          0,
          "Will it rain?",
          "weather",
          fx.yesPool.address,
          fx.noPool.address,
          closeTime,
          Res.Manual,
          ethers.ZeroAddress,
          0,
          false,
        );
      const m = await fx.markets.getMarket(0);
      expect(m.id).to.equal(0);
      expect(m.question).to.equal("Will it rain?");
      expect(m.category).to.equal("weather");
      expect(m.yesPool).to.equal(fx.yesPool.address);
      expect(m.noPool).to.equal(fx.noPool.address);
      expect(m.closeTime).to.equal(closeTime);
      expect(m.resolveTime).to.equal(0);
      expect(m.status).to.equal(Status.Open);
      expect(m.outcome).to.equal(Outcome.Unresolved);
      expect(m.resolutionType).to.equal(Res.Manual);
      expect(m.priceFeed).to.equal(ethers.ZeroAddress);
      expect(m.publishedYesTotal).to.equal(0);
      expect(m.publishedNoTotal).to.equal(0);
      expect(m.publishedBetCount).to.equal(0);
      expect(m.lastPublishedAt).to.equal(0);
      expect(m.settlementTxCount).to.equal(0);
      expect(await fx.markets.getMarketCount()).to.equal(1);
      expect(await fx.markets.poolUsed(fx.yesPool.address)).to.equal(true);
    });

    it("creates a price-feed market with feed, strike and direction", async () => {
      const fx = await loadFixture(deployFixture);
      const { id } = await createFeedMarket(fx, false, usd(12.5));
      const m = await fx.markets.getMarket(id);
      expect(m.resolutionType).to.equal(Res.PriceFeed);
      expect(m.priceFeed).to.equal(await fx.feed.getAddress());
      expect(m.strikePrice).to.equal(usd(12.5));
      expect(m.priceAbove).to.equal(false);
    });

    it("ignores feed fields on manual markets", async () => {
      const fx = await loadFixture(deployFixture);
      const closeTime = (await time.latest()) + 1000;
      await fx.markets.createMarket(
        "q",
        "c",
        fx.yesPool.address,
        fx.noPool.address,
        closeTime,
        Res.Manual,
        fx.other.address,
        123,
        true,
      );
      const m = await fx.markets.getMarket(0);
      expect(m.priceFeed).to.equal(ethers.ZeroAddress);
      expect(m.strikePrice).to.equal(0);
      expect(m.priceAbove).to.equal(false);
    });

    it("assigns sequential ids", async () => {
      const fx = await loadFixture(deployFixture);
      const a = await createManual(fx);
      const b = await createManual(fx, 1000, [fx.yesPool2.address, fx.noPool2.address]);
      expect(a.id).to.equal(0);
      expect(b.id).to.equal(1);
    });

    it("reverts: non-owner", async () => {
      const fx = await loadFixture(deployFixture);
      const closeTime = (await time.latest()) + 1000;
      await expect(
        fx.markets
          .connect(fx.other)
          .createMarket("q", "c", fx.yesPool.address, fx.noPool.address, closeTime, Res.Manual, ethers.ZeroAddress, 0, false),
      ).to.be.revertedWithCustomError(fx.markets, "OwnableUnauthorizedAccount");
    });

    it("reverts: empty question", async () => {
      const fx = await loadFixture(deployFixture);
      const closeTime = (await time.latest()) + 1000;
      await expect(
        fx.markets.createMarket("", "c", fx.yesPool.address, fx.noPool.address, closeTime, Res.Manual, ethers.ZeroAddress, 0, false),
      ).to.be.revertedWithCustomError(fx.markets, "EmptyQuestion");
    });

    it("reverts: zero yes pool / zero no pool", async () => {
      const fx = await loadFixture(deployFixture);
      const closeTime = (await time.latest()) + 1000;
      await expect(
        fx.markets.createMarket("q", "c", ethers.ZeroAddress, fx.noPool.address, closeTime, Res.Manual, ethers.ZeroAddress, 0, false),
      ).to.be.revertedWithCustomError(fx.markets, "ZeroAddress");
      await expect(
        fx.markets.createMarket("q", "c", fx.yesPool.address, ethers.ZeroAddress, closeTime, Res.Manual, ethers.ZeroAddress, 0, false),
      ).to.be.revertedWithCustomError(fx.markets, "ZeroAddress");
    });

    it("reverts: identical pools", async () => {
      const fx = await loadFixture(deployFixture);
      const closeTime = (await time.latest()) + 1000;
      await expect(
        fx.markets.createMarket("q", "c", fx.yesPool.address, fx.yesPool.address, closeTime, Res.Manual, ethers.ZeroAddress, 0, false),
      ).to.be.revertedWithCustomError(fx.markets, "SamePool");
    });

    it("reverts: pool already used by another market", async () => {
      const fx = await loadFixture(deployFixture);
      await createManual(fx);
      const closeTime = (await time.latest()) + 1000;
      await expect(
        fx.markets.createMarket("q", "c", fx.yesPool.address, fx.noPool2.address, closeTime, Res.Manual, ethers.ZeroAddress, 0, false),
      )
        .to.be.revertedWithCustomError(fx.markets, "PoolAlreadyUsed")
        .withArgs(fx.yesPool.address);
      await expect(
        fx.markets.createMarket("q", "c", fx.yesPool2.address, fx.noPool.address, closeTime, Res.Manual, ethers.ZeroAddress, 0, false),
      )
        .to.be.revertedWithCustomError(fx.markets, "PoolAlreadyUsed")
        .withArgs(fx.noPool.address);
    });

    it("reverts: closeTime not in the future", async () => {
      const fx = await loadFixture(deployFixture);
      const now = await time.latest();
      await expect(
        fx.markets.createMarket("q", "c", fx.yesPool.address, fx.noPool.address, now - 1, Res.Manual, ethers.ZeroAddress, 0, false),
      ).to.be.revertedWithCustomError(fx.markets, "CloseTimeNotInFuture");
      // exactly "now" is also rejected (next block timestamp is > now)
      await expect(
        fx.markets.createMarket("q", "c", fx.yesPool.address, fx.noPool.address, now, Res.Manual, ethers.ZeroAddress, 0, false),
      ).to.be.revertedWithCustomError(fx.markets, "CloseTimeNotInFuture");
    });

    it("reverts: price-feed market without a feed", async () => {
      const fx = await loadFixture(deployFixture);
      const closeTime = (await time.latest()) + 1000;
      await expect(
        fx.markets.createMarket("q", "c", fx.yesPool.address, fx.noPool.address, closeTime, Res.PriceFeed, ethers.ZeroAddress, STRIKE, true),
      ).to.be.revertedWithCustomError(fx.markets, "InvalidPriceFeed");
    });
  });

  describe("publishTotals & the K-batch rule", () => {
    it("only the resolver can publish", async () => {
      const fx = await loadFixture(deployFixture);
      const { id } = await createManual(fx);
      await expect(fx.markets.connect(fx.other).publishTotals(id, 1, 1, 3)).to.be.revertedWithCustomError(fx.markets, "NotResolver");
      await expect(fx.markets.publishTotals(id, 1, 1, 3)).to.be.revertedWithCustomError(fx.markets, "NotResolver"); // owner != resolver
    });

    it("reverts for a nonexistent market", async () => {
      const fx = await loadFixture(deployFixture);
      await expect(fx.markets.connect(fx.resolver).publishTotals(7, 1, 1, 3))
        .to.be.revertedWithCustomError(fx.markets, "MarketNotFound")
        .withArgs(7);
    });

    it("rejects fewer than K new bets (default 3) and accepts exactly K", async () => {
      const fx = await loadFixture(deployFixture);
      const { id } = await createManual(fx);
      const r = fx.markets.connect(fx.resolver);
      await expect(r.publishTotals(id, 100, 50, 1)).to.be.revertedWithCustomError(fx.markets, "BatchTooSmall").withArgs(1, 3);
      await expect(r.publishTotals(id, 100, 50, 2)).to.be.revertedWithCustomError(fx.markets, "BatchTooSmall").withArgs(2, 3);
      await expect(r.publishTotals(id, 100, 50, 3)).to.emit(fx.markets, "TotalsPublished").withArgs(id, 100, 50, 3, false);
      const m = await fx.markets.getMarket(id);
      expect(m.publishedYesTotal).to.equal(100);
      expect(m.publishedNoTotal).to.equal(50);
      expect(m.publishedBetCount).to.equal(3);
      expect(m.lastPublishedAt).to.equal(await time.latest());
    });

    it("applies K relative to the previous publish, not from zero", async () => {
      const fx = await loadFixture(deployFixture);
      const { id } = await createManual(fx);
      const r = fx.markets.connect(fx.resolver);
      await r.publishTotals(id, 100, 50, 3);
      await expect(r.publishTotals(id, 120, 60, 5)).to.be.revertedWithCustomError(fx.markets, "BatchTooSmall").withArgs(2, 3);
      await r.publishTotals(id, 120, 60, 6);
      expect((await fx.markets.getMarket(id)).publishedBetCount).to.equal(6);
    });

    it("rejects a bet count that does not increase", async () => {
      const fx = await loadFixture(deployFixture);
      const { id } = await createManual(fx);
      const r = fx.markets.connect(fx.resolver);
      await r.publishTotals(id, 100, 50, 3);
      await expect(r.publishTotals(id, 100, 50, 3)).to.be.revertedWithCustomError(fx.markets, "BetCountNotIncreased");
      await expect(r.publishTotals(id, 100, 50, 2)).to.be.revertedWithCustomError(fx.markets, "BetCountNotIncreased");
    });

    it("rejects decreasing totals", async () => {
      const fx = await loadFixture(deployFixture);
      const { id } = await createManual(fx);
      const r = fx.markets.connect(fx.resolver);
      await r.publishTotals(id, 100, 50, 3);
      await expect(r.publishTotals(id, 99, 60, 6)).to.be.revertedWithCustomError(fx.markets, "TotalsDecreased");
      await expect(r.publishTotals(id, 110, 49, 6)).to.be.revertedWithCustomError(fx.markets, "TotalsDecreased");
    });

    it("honours a reconfigured K", async () => {
      const fx = await loadFixture(deployFixture);
      const { id } = await createManual(fx);
      await fx.markets.setMinBatchSize(5);
      const r = fx.markets.connect(fx.resolver);
      await expect(r.publishTotals(id, 1, 1, 4)).to.be.revertedWithCustomError(fx.markets, "BatchTooSmall").withArgs(4, 5);
      await r.publishTotals(id, 1, 1, 5);
      await fx.markets.setMinBatchSize(1);
      await r.publishTotals(id, 2, 1, 6);
    });

    it("allows one final publish at close with fewer than K new bets", async () => {
      const fx = await loadFixture(deployFixture);
      const { id, closeTime } = await createManual(fx);
      const r = fx.markets.connect(fx.resolver);
      await r.publishTotals(id, 100, 50, 3);
      await time.increaseTo(closeTime);
      await fx.markets.closeMarket(id);
      await expect(r.publishTotals(id, 110, 50, 4)).to.emit(fx.markets, "TotalsPublished").withArgs(id, 110, 50, 4, true);
      expect(await fx.markets.finalPublished(id)).to.equal(true);
      // only once
      await expect(r.publishTotals(id, 120, 50, 9)).to.be.revertedWithCustomError(fx.markets, "FinalPublishDone");
    });

    it("final publish still requires a larger bet count and non-decreasing totals", async () => {
      const fx = await loadFixture(deployFixture);
      const { id, closeTime } = await createManual(fx);
      const r = fx.markets.connect(fx.resolver);
      await r.publishTotals(id, 100, 50, 3);
      await time.increaseTo(closeTime);
      await fx.markets.closeMarket(id);
      await expect(r.publishTotals(id, 100, 50, 3)).to.be.revertedWithCustomError(fx.markets, "BetCountNotIncreased");
      await expect(r.publishTotals(id, 90, 50, 4)).to.be.revertedWithCustomError(fx.markets, "TotalsDecreased");
      // failed attempts must not burn the one-shot final publish
      expect(await fx.markets.finalPublished(id)).to.equal(false);
      await r.publishTotals(id, 100, 55, 4);
    });

    it("allows the first-ever publish to be the final one", async () => {
      const fx = await loadFixture(deployFixture);
      const { id, closeTime } = await createManual(fx);
      await time.increaseTo(closeTime);
      await fx.markets.closeMarket(id);
      await fx.markets.connect(fx.resolver).publishTotals(id, 5, 5, 1);
      expect((await fx.markets.getMarket(id)).publishedBetCount).to.equal(1);
    });

    it("enforces K in Open state even after closeTime until the market is closed", async () => {
      const fx = await loadFixture(deployFixture);
      const { id, closeTime } = await createManual(fx);
      await time.increaseTo(closeTime + 1);
      await expect(fx.markets.connect(fx.resolver).publishTotals(id, 5, 5, 1)).to.be.revertedWithCustomError(
        fx.markets,
        "BatchTooSmall",
      );
    });

    it("reverts once Resolved, Settled or Cancelled", async () => {
      const fx = await loadFixture(deployFixture);
      const r = fx.markets.connect(fx.resolver);

      const a = await createManual(fx);
      await time.increaseTo(a.closeTime);
      await r.resolveManual(a.id, Outcome.Yes);
      await expect(r.publishTotals(a.id, 1, 1, 3))
        .to.be.revertedWithCustomError(fx.markets, "InvalidStatus")
        .withArgs(Status.Resolved);
      await r.markSettled(a.id, 0);
      await expect(r.publishTotals(a.id, 1, 1, 3))
        .to.be.revertedWithCustomError(fx.markets, "InvalidStatus")
        .withArgs(Status.Settled);

      const b = await createManual(fx, 1000, [fx.yesPool2.address, fx.noPool2.address]);
      await fx.markets.cancelMarket(b.id);
      await expect(r.publishTotals(b.id, 1, 1, 3))
        .to.be.revertedWithCustomError(fx.markets, "InvalidStatus")
        .withArgs(Status.Cancelled);
    });
  });

  describe("closeMarket", () => {
    it("reverts before closeTime", async () => {
      const fx = await loadFixture(deployFixture);
      const { id, closeTime } = await createManual(fx);
      await expect(fx.markets.closeMarket(id)).to.be.revertedWithCustomError(fx.markets, "NotYetClosed").withArgs(closeTime);
    });

    it("anyone can close after closeTime, emitting MarketClosed", async () => {
      const fx = await loadFixture(deployFixture);
      const { id, closeTime } = await createManual(fx);
      await time.increaseTo(closeTime);
      await expect(fx.markets.connect(fx.other).closeMarket(id)).to.emit(fx.markets, "MarketClosed").withArgs(id);
      expect((await fx.markets.getMarket(id)).status).to.equal(Status.Closed);
    });

    it("cannot close twice or close a non-Open market", async () => {
      const fx = await loadFixture(deployFixture);
      const { id, closeTime } = await createManual(fx);
      await time.increaseTo(closeTime);
      await fx.markets.closeMarket(id);
      await expect(fx.markets.closeMarket(id)).to.be.revertedWithCustomError(fx.markets, "InvalidStatus").withArgs(Status.Closed);
    });

    it("reverts for a nonexistent market", async () => {
      const fx = await loadFixture(deployFixture);
      await expect(fx.markets.closeMarket(0)).to.be.revertedWithCustomError(fx.markets, "MarketNotFound");
    });
  });

  describe("resolveManual", () => {
    it("only the resolver", async () => {
      const fx = await loadFixture(deployFixture);
      const { id, closeTime } = await createManual(fx);
      await time.increaseTo(closeTime);
      await expect(fx.markets.connect(fx.other).resolveManual(id, Outcome.Yes)).to.be.revertedWithCustomError(fx.markets, "NotResolver");
    });

    it("reverts before closeTime", async () => {
      const fx = await loadFixture(deployFixture);
      const { id, closeTime } = await createManual(fx);
      await expect(fx.markets.connect(fx.resolver).resolveManual(id, Outcome.Yes))
        .to.be.revertedWithCustomError(fx.markets, "NotYetClosed")
        .withArgs(closeTime);
    });

    it("reverts for price-feed markets", async () => {
      const fx = await loadFixture(deployFixture);
      const { id, closeTime } = await createFeedMarket(fx);
      await time.increaseTo(closeTime);
      await expect(fx.markets.connect(fx.resolver).resolveManual(id, Outcome.Yes)).to.be.revertedWithCustomError(
        fx.markets,
        "WrongResolutionType",
      );
    });

    it("rejects Unresolved as an outcome", async () => {
      const fx = await loadFixture(deployFixture);
      const { id, closeTime } = await createManual(fx);
      await time.increaseTo(closeTime);
      await expect(fx.markets.connect(fx.resolver).resolveManual(id, Outcome.Unresolved)).to.be.revertedWithCustomError(
        fx.markets,
        "InvalidOutcome",
      );
    });

    for (const [name, outcome] of [
      ["Yes", Outcome.Yes],
      ["No", Outcome.No],
      ["Invalid", Outcome.Invalid],
    ] as const) {
      it(`resolves ${name} (implicitly closing an Open market) and emits both events`, async () => {
        const fx = await loadFixture(deployFixture);
        const { id, closeTime } = await createManual(fx);
        await time.increaseTo(closeTime);
        const tx = fx.markets.connect(fx.resolver).resolveManual(id, outcome);
        await expect(tx).to.emit(fx.markets, "MarketClosed").withArgs(id);
        await expect(tx).to.emit(fx.markets, "MarketResolved").withArgs(id, outcome, Res.Manual, 0, 0);
        const m = await fx.markets.getMarket(id);
        expect(m.status).to.equal(Status.Resolved);
        expect(m.outcome).to.equal(outcome);
        expect(m.resolveTime).to.equal(await time.latest());
      });
    }

    it("resolves an already-closed market without a second MarketClosed", async () => {
      const fx = await loadFixture(deployFixture);
      const { id, closeTime } = await createManual(fx);
      await time.increaseTo(closeTime);
      await fx.markets.closeMarket(id);
      await expect(fx.markets.connect(fx.resolver).resolveManual(id, Outcome.Yes)).not.to.emit(fx.markets, "MarketClosed");
    });

    it("cannot resolve twice or resolve a cancelled market", async () => {
      const fx = await loadFixture(deployFixture);
      const r = fx.markets.connect(fx.resolver);
      const a = await createManual(fx);
      await time.increaseTo(a.closeTime);
      await r.resolveManual(a.id, Outcome.Yes);
      await expect(r.resolveManual(a.id, Outcome.No)).to.be.revertedWithCustomError(fx.markets, "InvalidStatus").withArgs(Status.Resolved);

      const b = await createManual(fx, 1000, [fx.yesPool2.address, fx.noPool2.address]);
      await fx.markets.cancelMarket(b.id);
      await time.increase(2000);
      await expect(r.resolveManual(b.id, Outcome.No)).to.be.revertedWithCustomError(fx.markets, "InvalidStatus").withArgs(Status.Cancelled);
    });
  });

  describe("resolveWithPriceFeed", () => {
    it("reverts for manual markets", async () => {
      const fx = await loadFixture(deployFixture);
      const { id, closeTime } = await createManual(fx);
      await time.increaseTo(closeTime);
      await expect(fx.markets.resolveWithPriceFeed(id)).to.be.revertedWithCustomError(fx.markets, "WrongResolutionType");
    });

    it("reverts before closeTime", async () => {
      const fx = await loadFixture(deployFixture);
      const { id, closeTime } = await createFeedMarket(fx);
      await expect(fx.markets.resolveWithPriceFeed(id)).to.be.revertedWithCustomError(fx.markets, "NotYetClosed").withArgs(closeTime);
    });

    it("priceAbove: Yes when price > strike, callable by anyone, emits price data", async () => {
      const fx = await loadFixture(deployFixture);
      const { id, closeTime } = await createFeedMarket(fx, true);
      await time.increaseTo(closeTime);
      await fx.feed.setAnswer(usd(10.01));
      const updatedAt = BigInt(await time.latest());
      await expect(fx.markets.connect(fx.other).resolveWithPriceFeed(id))
        .to.emit(fx.markets, "MarketResolved")
        .withArgs(id, Outcome.Yes, Res.PriceFeed, usd(10.01), updatedAt);
      const m = await fx.markets.getMarket(id);
      expect(m.status).to.equal(Status.Resolved);
      expect(m.outcome).to.equal(Outcome.Yes);
    });

    it("priceAbove: No when price < strike", async () => {
      const fx = await loadFixture(deployFixture);
      const { id, closeTime } = await createFeedMarket(fx, true);
      await time.increaseTo(closeTime);
      await fx.feed.setAnswer(usd(9.99));
      await fx.markets.resolveWithPriceFeed(id);
      expect((await fx.markets.getMarket(id)).outcome).to.equal(Outcome.No);
    });

    it("a price exactly at the strike resolves No in both directions", async () => {
      const fx = await loadFixture(deployFixture);
      const a = await createFeedMarket(fx, true);
      const b = await createFeedMarket(fx, false, STRIKE, 1000, [fx.yesPool2.address, fx.noPool2.address]);
      await time.increaseTo(a.closeTime + 5);
      await fx.feed.setAnswer(STRIKE);
      await fx.markets.resolveWithPriceFeed(a.id);
      await fx.markets.resolveWithPriceFeed(b.id);
      expect((await fx.markets.getMarket(a.id)).outcome).to.equal(Outcome.No);
      expect((await fx.markets.getMarket(b.id)).outcome).to.equal(Outcome.No);
    });

    it("priceBelow (priceAbove=false): Yes when price < strike, No when above", async () => {
      const fx = await loadFixture(deployFixture);
      const a = await createFeedMarket(fx, false);
      const b = await createFeedMarket(fx, false, STRIKE, 1000, [fx.yesPool2.address, fx.noPool2.address]);
      await time.increaseTo(a.closeTime + 5);
      await fx.feed.setAnswer(usd(9));
      await fx.markets.resolveWithPriceFeed(a.id);
      expect((await fx.markets.getMarket(a.id)).outcome).to.equal(Outcome.Yes);
      await fx.feed.setAnswer(usd(11));
      await fx.markets.resolveWithPriceFeed(b.id);
      expect((await fx.markets.getMarket(b.id)).outcome).to.equal(Outcome.No);
    });

    it("rejects a stale price and accepts it again once refreshed", async () => {
      const fx = await loadFixture(deployFixture);
      const { id, closeTime } = await createFeedMarket(fx, true);
      await time.increaseTo(closeTime + 3601 + 5); // feed last updated before creation, > 1h old
      const [, , , updatedAt] = await fx.feed.latestRoundData();
      await expect(fx.markets.resolveWithPriceFeed(id))
        .to.be.revertedWithCustomError(fx.markets, "StalePrice")
        .withArgs(updatedAt, 3600);
      await fx.feed.setAnswer(usd(11));
      await fx.markets.resolveWithPriceFeed(id);
      expect((await fx.markets.getMarket(id)).outcome).to.equal(Outcome.Yes);
    });

    it("staleness boundary: exactly maxPriceAge old is accepted, one second more is rejected", async () => {
      const fx = await loadFixture(deployFixture);
      const { id, closeTime } = await createFeedMarket(fx, true);
      await time.increaseTo(closeTime);
      // pin the resolve block's timestamp so the age is exact
      const t1 = (await time.latest()) + 100;
      await fx.feed.setAnswerAt(usd(11), t1 - 3600);
      await time.setNextBlockTimestamp(t1);
      await fx.markets.resolveWithPriceFeed(id); // age == 3600 -> ok

      const b = await createFeedMarket(fx, true, STRIKE, 1000, [fx.yesPool2.address, fx.noPool2.address]);
      await time.increaseTo(b.closeTime);
      const t2 = (await time.latest()) + 100;
      await fx.feed.setAnswerAt(usd(11), t2 - 3601);
      await time.setNextBlockTimestamp(t2);
      await expect(fx.markets.resolveWithPriceFeed(b.id)).to.be.revertedWithCustomError(fx.markets, "StalePrice");
    });

    it("respects a reconfigured maxPriceAge", async () => {
      const fx = await loadFixture(deployFixture);
      const { id, closeTime } = await createFeedMarket(fx, true);
      await time.increaseTo(closeTime);
      await fx.feed.setAnswer(usd(11));
      await time.increase(120);
      await fx.markets.setMaxPriceAge(60);
      await expect(fx.markets.resolveWithPriceFeed(id)).to.be.revertedWithCustomError(fx.markets, "StalePrice");
      await fx.markets.setMaxPriceAge(600);
      await fx.markets.resolveWithPriceFeed(id);
    });

    it("rejects a price timestamp in the future", async () => {
      const fx = await loadFixture(deployFixture);
      const { id, closeTime } = await createFeedMarket(fx, true);
      await time.increaseTo(closeTime);
      await fx.feed.setAnswerAt(usd(11), (await time.latest()) + 1000);
      await expect(fx.markets.resolveWithPriceFeed(id)).to.be.revertedWithCustomError(fx.markets, "StalePrice");
    });

    it("rejects a zero updatedAt", async () => {
      const fx = await loadFixture(deployFixture);
      const { id, closeTime } = await createFeedMarket(fx, true);
      await time.increaseTo(closeTime);
      await fx.feed.setAnswerAt(usd(11), 0);
      await expect(fx.markets.resolveWithPriceFeed(id)).to.be.revertedWithCustomError(fx.markets, "StalePrice");
    });

    it("rejects non-positive answers", async () => {
      const fx = await loadFixture(deployFixture);
      const { id, closeTime } = await createFeedMarket(fx, false);
      await time.increaseTo(closeTime);
      await fx.feed.setAnswer(0);
      await expect(fx.markets.resolveWithPriceFeed(id)).to.be.revertedWithCustomError(fx.markets, "InvalidPrice").withArgs(0);
      await fx.feed.setAnswer(-5);
      await expect(fx.markets.resolveWithPriceFeed(id)).to.be.revertedWithCustomError(fx.markets, "InvalidPrice").withArgs(-5);
    });

    it("cannot resolve twice or after cancellation", async () => {
      const fx = await loadFixture(deployFixture);
      const a = await createFeedMarket(fx, true);
      await time.increaseTo(a.closeTime);
      await fx.feed.setAnswer(usd(11));
      await fx.markets.resolveWithPriceFeed(a.id);
      await expect(fx.markets.resolveWithPriceFeed(a.id))
        .to.be.revertedWithCustomError(fx.markets, "InvalidStatus")
        .withArgs(Status.Resolved);

      const b = await createFeedMarket(fx, true, STRIKE, 1000, [fx.yesPool2.address, fx.noPool2.address]);
      await fx.markets.cancelMarket(b.id);
      await time.increaseTo(b.closeTime);
      await fx.feed.setAnswer(usd(11));
      await expect(fx.markets.resolveWithPriceFeed(b.id))
        .to.be.revertedWithCustomError(fx.markets, "InvalidStatus")
        .withArgs(Status.Cancelled);
    });

    it("works on an already-closed market", async () => {
      const fx = await loadFixture(deployFixture);
      const { id, closeTime } = await createFeedMarket(fx, true);
      await time.increaseTo(closeTime);
      await fx.markets.closeMarket(id);
      await fx.feed.setAnswer(usd(11));
      await expect(fx.markets.resolveWithPriceFeed(id)).not.to.emit(fx.markets, "MarketClosed");
    });
  });

  describe("markSettled", () => {
    it("only the resolver", async () => {
      const fx = await loadFixture(deployFixture);
      const { id, closeTime } = await createManual(fx);
      await time.increaseTo(closeTime);
      await fx.markets.connect(fx.resolver).resolveManual(id, Outcome.Yes);
      await expect(fx.markets.connect(fx.other).markSettled(id, 4)).to.be.revertedWithCustomError(fx.markets, "NotResolver");
    });

    it("reverts before resolution (Open and Closed)", async () => {
      const fx = await loadFixture(deployFixture);
      const { id, closeTime } = await createManual(fx);
      const r = fx.markets.connect(fx.resolver);
      await expect(r.markSettled(id, 1)).to.be.revertedWithCustomError(fx.markets, "InvalidStatus").withArgs(Status.Open);
      await time.increaseTo(closeTime);
      await fx.markets.closeMarket(id);
      await expect(r.markSettled(id, 1)).to.be.revertedWithCustomError(fx.markets, "InvalidStatus").withArgs(Status.Closed);
    });

    it("settles a resolved market, stores the tx count and emits", async () => {
      const fx = await loadFixture(deployFixture);
      const { id, closeTime } = await createManual(fx);
      await time.increaseTo(closeTime);
      const r = fx.markets.connect(fx.resolver);
      await r.resolveManual(id, Outcome.Yes);
      await expect(r.markSettled(id, 7)).to.emit(fx.markets, "MarketSettled").withArgs(id, 7);
      const m = await fx.markets.getMarket(id);
      expect(m.status).to.equal(Status.Settled);
      expect(m.settlementTxCount).to.equal(7);
      expect(m.outcome).to.equal(Outcome.Yes); // outcome preserved
    });

    it("settles a cancelled market (refunds) and keeps outcome Invalid", async () => {
      const fx = await loadFixture(deployFixture);
      const { id } = await createManual(fx);
      await fx.markets.cancelMarket(id);
      await fx.markets.connect(fx.resolver).markSettled(id, 3);
      const m = await fx.markets.getMarket(id);
      expect(m.status).to.equal(Status.Settled);
      expect(m.outcome).to.equal(Outcome.Invalid);
    });

    it("cannot settle twice", async () => {
      const fx = await loadFixture(deployFixture);
      const { id, closeTime } = await createManual(fx);
      await time.increaseTo(closeTime);
      const r = fx.markets.connect(fx.resolver);
      await r.resolveManual(id, Outcome.No);
      await r.markSettled(id, 1);
      await expect(r.markSettled(id, 2)).to.be.revertedWithCustomError(fx.markets, "InvalidStatus").withArgs(Status.Settled);
    });
  });

  describe("cancelMarket", () => {
    it("only the owner", async () => {
      const fx = await loadFixture(deployFixture);
      const { id } = await createManual(fx);
      await expect(fx.markets.connect(fx.resolver).cancelMarket(id)).to.be.revertedWithCustomError(
        fx.markets,
        "OwnableUnauthorizedAccount",
      );
    });

    it("cancels an Open market: status Cancelled, outcome Invalid, emits", async () => {
      const fx = await loadFixture(deployFixture);
      const { id } = await createManual(fx);
      await expect(fx.markets.cancelMarket(id)).to.emit(fx.markets, "MarketCancelled").withArgs(id);
      const m = await fx.markets.getMarket(id);
      expect(m.status).to.equal(Status.Cancelled);
      expect(m.outcome).to.equal(Outcome.Invalid);
      expect(m.resolveTime).to.equal(await time.latest());
    });

    it("cancels a Closed market", async () => {
      const fx = await loadFixture(deployFixture);
      const { id, closeTime } = await createManual(fx);
      await time.increaseTo(closeTime);
      await fx.markets.closeMarket(id);
      await fx.markets.cancelMarket(id);
      expect((await fx.markets.getMarket(id)).status).to.equal(Status.Cancelled);
    });

    it("cannot cancel Resolved, Settled or Cancelled markets", async () => {
      const fx = await loadFixture(deployFixture);
      const r = fx.markets.connect(fx.resolver);
      const a = await createManual(fx);
      await time.increaseTo(a.closeTime);
      await r.resolveManual(a.id, Outcome.Yes);
      await expect(fx.markets.cancelMarket(a.id)).to.be.revertedWithCustomError(fx.markets, "InvalidStatus").withArgs(Status.Resolved);
      await r.markSettled(a.id, 0);
      await expect(fx.markets.cancelMarket(a.id)).to.be.revertedWithCustomError(fx.markets, "InvalidStatus").withArgs(Status.Settled);

      const b = await createManual(fx, 1000, [fx.yesPool2.address, fx.noPool2.address]);
      await fx.markets.cancelMarket(b.id);
      await expect(fx.markets.cancelMarket(b.id)).to.be.revertedWithCustomError(fx.markets, "InvalidStatus").withArgs(Status.Cancelled);
    });

    it("closeMarket reverts on a cancelled market", async () => {
      const fx = await loadFixture(deployFixture);
      const { id, closeTime } = await createManual(fx);
      await fx.markets.cancelMarket(id);
      await time.increaseTo(closeTime);
      await expect(fx.markets.closeMarket(id)).to.be.revertedWithCustomError(fx.markets, "InvalidStatus").withArgs(Status.Cancelled);
    });
  });

  describe("views", () => {
    it("getMarket reverts for unknown ids", async () => {
      const fx = await loadFixture(deployFixture);
      await expect(fx.markets.getMarket(0)).to.be.revertedWithCustomError(fx.markets, "MarketNotFound").withArgs(0);
    });

    it("getMarketsByStatus returns the right ids per status", async () => {
      const fx = await loadFixture(deployFixture);
      const r = fx.markets.connect(fx.resolver);
      const signers = await ethers.getSigners();
      const pools = (i: number): [string, string] => [signers[8 + i * 2].address, signers[9 + i * 2].address];

      const m0 = await createManual(fx, 1000, pools(0)); // stays Open
      const m1 = await createManual(fx, 1000, pools(1)); // Closed
      const m2 = await createManual(fx, 1000, pools(2)); // Resolved
      const m3 = await createManual(fx, 1000, pools(3)); // Settled
      const m4 = await createManual(fx, 1000, pools(4)); // Cancelled
      await fx.markets.cancelMarket(m4.id);
      await time.increase(1001);
      await fx.markets.closeMarket(m1.id);
      await r.resolveManual(m2.id, Outcome.Yes);
      await r.resolveManual(m3.id, Outcome.No);
      await r.markSettled(m3.id, 2);
      await fx.markets.closeMarket(m0.id); // close m0 as well, then check below

      const ids = async (s: number) => (await fx.markets.getMarketsByStatus(s)).map(Number);
      expect(await ids(Status.Open)).to.deep.equal([]);
      expect(await ids(Status.Closed)).to.deep.equal([0, 1]);
      expect(await ids(Status.Resolved)).to.deep.equal([2]);
      expect(await ids(Status.Settled)).to.deep.equal([3]);
      expect(await ids(Status.Cancelled)).to.deep.equal([4]);
      expect(await fx.markets.getMarketCount()).to.equal(5);
    });

    it("getMarketsByStatus returns an empty array when there are no markets", async () => {
      const fx = await loadFixture(deployFixture);
      expect(await fx.markets.getMarketsByStatus(Status.Open)).to.deep.equal([]);
    });
  });

  describe("full lifecycle: Open -> Closed -> Resolved -> Settled", () => {
    it("manual market", async () => {
      const fx = await loadFixture(deployFixture);
      const r = fx.markets.connect(fx.resolver);
      const { id, closeTime } = await createManual(fx);
      expect((await fx.markets.getMarket(id)).status).to.equal(Status.Open);

      await r.publishTotals(id, 300, 100, 3);
      await r.publishTotals(id, 500, 150, 7);

      await time.increaseTo(closeTime);
      await fx.markets.connect(fx.other).closeMarket(id);
      expect((await fx.markets.getMarket(id)).status).to.equal(Status.Closed);

      await r.publishTotals(id, 520, 150, 8); // final publish
      await r.resolveManual(id, Outcome.Yes);
      expect((await fx.markets.getMarket(id)).status).to.equal(Status.Resolved);

      await r.markSettled(id, 6);
      const m = await fx.markets.getMarket(id);
      expect(m.status).to.equal(Status.Settled);
      expect(m.outcome).to.equal(Outcome.Yes);
      expect(m.publishedYesTotal).to.equal(520);
      expect(m.publishedNoTotal).to.equal(150);
      expect(m.publishedBetCount).to.equal(8);
      expect(m.settlementTxCount).to.equal(6);
    });

    it("price-feed market", async () => {
      const fx = await loadFixture(deployFixture);
      const r = fx.markets.connect(fx.resolver);
      const { id, closeTime } = await createFeedMarket(fx, true);
      await r.publishTotals(id, 10, 20, 3);
      await time.increaseTo(closeTime);
      await fx.markets.closeMarket(id);
      await fx.feed.setAnswer(usd(8));
      await fx.markets.resolveWithPriceFeed(id);
      expect((await fx.markets.getMarket(id)).outcome).to.equal(Outcome.No);
      await r.markSettled(id, 1);
      expect((await fx.markets.getMarket(id)).status).to.equal(Status.Settled);
    });
  });
});
