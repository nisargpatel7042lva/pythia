// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AggregatorV3Interface} from "./interfaces/AggregatorV3Interface.sol";

/// @title PythiaMarkets
/// @notice Registry and lifecycle for PYTHIA private prediction markets.
///
/// Money never touches this contract. Bets are private eERC transfers from bettors to
/// each market's YES/NO pool account (fresh EOAs registered on the eERC Registrar, keys held
/// by the resolver). This contract records the markets, the batched pool totals the resolver
/// chooses to publish, the outcome, and that settlement happened.
///
/// Trust model v1: the resolver is trusted. Nothing here can verify that published totals
/// match the encrypted pool balances, or that payouts were made correctly.
contract PythiaMarkets is Ownable, ReentrancyGuard {
    // ───────────────────────────── Types ─────────────────────────────
    enum MarketStatus {
        Open,
        Closed,
        Resolved,
        Settled,
        Cancelled
    }

    enum Outcome {
        Unresolved,
        Yes,
        No,
        Invalid
    }

    enum ResolutionType {
        Manual,
        PriceFeed
    }

    struct Market {
        uint256 id;
        string question;
        string category;
        address yesPool;
        address noPool;
        uint64 closeTime;
        uint64 resolveTime; // timestamp at which the outcome was set (0 until then)
        MarketStatus status;
        Outcome outcome;
        ResolutionType resolutionType;
        address priceFeed;
        int256 strikePrice; // in the feed's decimals
        bool priceAbove; // true: Yes iff price > strike. false: Yes iff price < strike.
        uint256 publishedYesTotal; // eERC base units (EncryptedERC.decimals())
        uint256 publishedNoTotal;
        uint32 publishedBetCount;
        uint64 lastPublishedAt;
        uint32 settlementTxCount;
    }

    // ───────────────────────────── State ─────────────────────────────
    Market[] private _markets;

    /// @notice Address allowed to publish totals, resolve manual markets and mark settlement.
    address public resolver;

    /// @notice K: minimum number of NEW bets (since the last publish) required to publish totals.
    uint32 public minBatchSize = 3;

    /// @notice Max age (seconds) of a Chainlink answer accepted for price-feed resolution.
    uint64 public maxPriceAge = 1 hours;

    /// @dev A pool account may back at most one market, otherwise balances would be mixed.
    mapping(address => bool) public poolUsed;

    /// @dev True once the single "final publish at close" has happened for a market.
    mapping(uint256 => bool) public finalPublished;

    // ───────────────────────────── Events ────────────────────────────
    event MarketCreated(
        uint256 indexed marketId,
        string question,
        string category,
        address yesPool,
        address noPool,
        uint64 closeTime,
        ResolutionType resolutionType,
        address priceFeed,
        int256 strikePrice,
        bool priceAbove
    );
    event TotalsPublished(
        uint256 indexed marketId,
        uint256 yesTotal,
        uint256 noTotal,
        uint32 betCount,
        bool isFinal
    );
    event MarketClosed(uint256 indexed marketId);
    /// @dev `price`/`priceUpdatedAt` are zero for manual resolution.
    event MarketResolved(
        uint256 indexed marketId,
        Outcome outcome,
        ResolutionType resolutionType,
        int256 price,
        uint64 priceUpdatedAt
    );
    event MarketSettled(uint256 indexed marketId, uint32 settlementTxCount);
    event MarketCancelled(uint256 indexed marketId);
    event ResolverUpdated(address indexed previousResolver, address indexed newResolver);
    event MinBatchSizeUpdated(uint32 previousValue, uint32 newValue);
    event MaxPriceAgeUpdated(uint64 previousValue, uint64 newValue);

    // ───────────────────────────── Errors ────────────────────────────
    error NotResolver();
    error ZeroAddress();
    error SamePool();
    error PoolAlreadyUsed(address pool);
    error CloseTimeNotInFuture();
    error EmptyQuestion();
    error InvalidPriceFeed();
    error MarketNotFound(uint256 marketId);
    error InvalidStatus(MarketStatus current);
    error NotYetClosed(uint64 closeTime);
    error WrongResolutionType();
    error InvalidOutcome();
    error BatchTooSmall(uint32 newBets, uint32 required);
    error FinalPublishDone();
    error TotalsDecreased();
    error BetCountNotIncreased();
    error StalePrice(uint256 updatedAt, uint256 maxAge);
    error InvalidPrice(int256 answer);
    error InvalidParameter();

    // ───────────────────────────── Modifiers ─────────────────────────
    modifier onlyResolver() {
        if (msg.sender != resolver) revert NotResolver();
        _;
    }

    constructor(address initialOwner, address initialResolver) Ownable(initialOwner) {
        if (initialResolver == address(0)) revert ZeroAddress();
        resolver = initialResolver;
        emit ResolverUpdated(address(0), initialResolver);
    }

    // ───────────────────────────── Admin ─────────────────────────────
    function setResolver(address newResolver) external onlyOwner {
        if (newResolver == address(0)) revert ZeroAddress();
        emit ResolverUpdated(resolver, newResolver);
        resolver = newResolver;
    }

    function setMinBatchSize(uint32 newValue) external onlyOwner {
        if (newValue == 0) revert InvalidParameter();
        emit MinBatchSizeUpdated(minBatchSize, newValue);
        minBatchSize = newValue;
    }

    function setMaxPriceAge(uint64 newValue) external onlyOwner {
        if (newValue == 0) revert InvalidParameter();
        emit MaxPriceAgeUpdated(maxPriceAge, newValue);
        maxPriceAge = newValue;
    }

    // ───────────────────────────── Create ────────────────────────────
    function createMarket(
        string calldata question,
        string calldata category,
        address yesPool,
        address noPool,
        uint64 closeTime,
        ResolutionType resolutionType,
        address priceFeed,
        int256 strikePrice,
        bool priceAbove
    ) external onlyOwner returns (uint256 marketId) {
        if (bytes(question).length == 0) revert EmptyQuestion();
        if (yesPool == address(0) || noPool == address(0)) revert ZeroAddress();
        if (yesPool == noPool) revert SamePool();
        if (poolUsed[yesPool]) revert PoolAlreadyUsed(yesPool);
        if (poolUsed[noPool]) revert PoolAlreadyUsed(noPool);
        if (closeTime <= block.timestamp) revert CloseTimeNotInFuture();
        if (resolutionType == ResolutionType.PriceFeed && priceFeed == address(0)) {
            revert InvalidPriceFeed();
        }

        poolUsed[yesPool] = true;
        poolUsed[noPool] = true;

        marketId = _markets.length;
        Market storage m = _markets.push();
        m.id = marketId;
        m.question = question;
        m.category = category;
        m.yesPool = yesPool;
        m.noPool = noPool;
        m.closeTime = closeTime;
        m.status = MarketStatus.Open;
        m.outcome = Outcome.Unresolved;
        m.resolutionType = resolutionType;
        if (resolutionType == ResolutionType.PriceFeed) {
            m.priceFeed = priceFeed;
            m.strikePrice = strikePrice;
            m.priceAbove = priceAbove;
        }

        emit MarketCreated(
            marketId,
            question,
            category,
            yesPool,
            noPool,
            closeTime,
            resolutionType,
            m.priceFeed,
            m.strikePrice,
            m.priceAbove
        );
    }

    // ───────────────────────── Publish totals ────────────────────────
    /// @notice Publish decrypted pool totals. While Open, requires at least `minBatchSize`
    /// new bets since the previous publish (anti-differencing). Once Closed, exactly one
    /// "final" publish is allowed without that minimum.
    /// @dev Totals and bet count are cumulative and must never decrease. Bet count must
    /// strictly increase on every publish.
    function publishTotals(uint256 marketId, uint256 yesTotal, uint256 noTotal, uint32 betCount)
        external
        onlyResolver
    {
        Market storage m = _get(marketId);
        bool isFinal;

        if (m.status == MarketStatus.Open) {
            if (betCount <= m.publishedBetCount) revert BetCountNotIncreased();
            uint32 newBets = betCount - m.publishedBetCount;
            if (newBets < minBatchSize) revert BatchTooSmall(newBets, minBatchSize);
        } else if (m.status == MarketStatus.Closed) {
            if (finalPublished[marketId]) revert FinalPublishDone();
            if (betCount <= m.publishedBetCount) revert BetCountNotIncreased();
            finalPublished[marketId] = true;
            isFinal = true;
        } else {
            revert InvalidStatus(m.status);
        }

        if (yesTotal < m.publishedYesTotal || noTotal < m.publishedNoTotal) revert TotalsDecreased();

        m.publishedYesTotal = yesTotal;
        m.publishedNoTotal = noTotal;
        m.publishedBetCount = betCount;
        m.lastPublishedAt = uint64(block.timestamp);

        emit TotalsPublished(marketId, yesTotal, noTotal, betCount, isFinal);
    }

    // ───────────────────────────── Close ─────────────────────────────
    function closeMarket(uint256 marketId) external {
        Market storage m = _get(marketId);
        if (m.status != MarketStatus.Open) revert InvalidStatus(m.status);
        if (block.timestamp < m.closeTime) revert NotYetClosed(m.closeTime);
        m.status = MarketStatus.Closed;
        emit MarketClosed(marketId);
    }

    // ──────────────────────────── Resolve ────────────────────────────
    function resolveManual(uint256 marketId, Outcome outcome) external onlyResolver {
        Market storage m = _get(marketId);
        if (m.resolutionType != ResolutionType.Manual) revert WrongResolutionType();
        if (outcome == Outcome.Unresolved) revert InvalidOutcome();
        _closeIfDue(m);
        _resolve(m, outcome, 0, 0);
    }

    /// @notice Resolve a PriceFeed market from the Chainlink answer. Callable by anyone.
    /// Yes iff (priceAbove ? price > strike : price < strike); a tie resolves No.
    function resolveWithPriceFeed(uint256 marketId) external nonReentrant {
        Market storage m = _get(marketId);
        if (m.resolutionType != ResolutionType.PriceFeed) revert WrongResolutionType();
        _closeIfDue(m);
        if (m.status != MarketStatus.Closed) revert InvalidStatus(m.status);

        (, int256 answer,, uint256 updatedAt,) = AggregatorV3Interface(m.priceFeed).latestRoundData();
        if (answer <= 0) revert InvalidPrice(answer);
        if (updatedAt == 0 || updatedAt > block.timestamp || block.timestamp - updatedAt > maxPriceAge) {
            revert StalePrice(updatedAt, maxPriceAge);
        }

        bool yes = m.priceAbove ? answer > m.strikePrice : answer < m.strikePrice;
        _resolve(m, yes ? Outcome.Yes : Outcome.No, answer, uint64(updatedAt));
    }

    // ─────────────────────────── Settlement ──────────────────────────
    /// @notice Resolver records that payouts (or refunds, for Invalid/cancelled markets) are done.
    function markSettled(uint256 marketId, uint32 txCount) external onlyResolver {
        Market storage m = _get(marketId);
        if (m.status != MarketStatus.Resolved && m.status != MarketStatus.Cancelled) {
            revert InvalidStatus(m.status);
        }
        m.status = MarketStatus.Settled;
        m.settlementTxCount = txCount;
        emit MarketSettled(marketId, txCount);
    }

    /// @notice Owner cancels an unresolved market. Outcome becomes Invalid so the resolver refunds.
    function cancelMarket(uint256 marketId) external onlyOwner {
        Market storage m = _get(marketId);
        if (m.status != MarketStatus.Open && m.status != MarketStatus.Closed) {
            revert InvalidStatus(m.status);
        }
        m.status = MarketStatus.Cancelled;
        m.outcome = Outcome.Invalid;
        m.resolveTime = uint64(block.timestamp);
        emit MarketCancelled(marketId);
    }

    // ───────────────────────────── Views ─────────────────────────────
    function getMarket(uint256 marketId) external view returns (Market memory) {
        return _get(marketId);
    }

    function getMarketCount() external view returns (uint256) {
        return _markets.length;
    }

    function getMarketsByStatus(MarketStatus status) external view returns (uint256[] memory ids) {
        uint256 n = _markets.length;
        uint256 count;
        for (uint256 i; i < n; ++i) {
            if (_markets[i].status == status) ++count;
        }
        ids = new uint256[](count);
        uint256 j;
        for (uint256 i; i < n; ++i) {
            if (_markets[i].status == status) ids[j++] = i;
        }
    }

    // ──────────────────────────── Internal ───────────────────────────
    function _get(uint256 marketId) private view returns (Market storage) {
        if (marketId >= _markets.length) revert MarketNotFound(marketId);
        return _markets[marketId];
    }

    /// @dev Resolution after closeTime implicitly closes an Open market.
    function _closeIfDue(Market storage m) private {
        if (m.status == MarketStatus.Open) {
            if (block.timestamp < m.closeTime) revert NotYetClosed(m.closeTime);
            m.status = MarketStatus.Closed;
            emit MarketClosed(m.id);
        }
    }

    function _resolve(Market storage m, Outcome outcome, int256 price, uint64 priceUpdatedAt) private {
        if (m.status != MarketStatus.Closed) revert InvalidStatus(m.status);
        m.status = MarketStatus.Resolved;
        m.outcome = outcome;
        m.resolveTime = uint64(block.timestamp);
        emit MarketResolved(m.id, outcome, m.resolutionType, price, priceUpdatedAt);
    }
}
