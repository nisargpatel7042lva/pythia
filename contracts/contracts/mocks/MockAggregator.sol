// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AggregatorV3Interface} from "../interfaces/AggregatorV3Interface.sol";

/// @notice TEST ONLY. Controllable Chainlink-style aggregator. Never deployed to a live network.
contract MockAggregator is AggregatorV3Interface {
    uint8 public immutable override decimals;
    int256 private _answer;
    uint256 private _updatedAt;
    uint80 private _roundId;

    constructor(uint8 decimals_, int256 initialAnswer) {
        decimals = decimals_;
        _set(initialAnswer, block.timestamp);
    }

    function description() external pure override returns (string memory) {
        return "MockAggregator";
    }

    function setAnswer(int256 answer) external {
        _set(answer, block.timestamp);
    }

    function setAnswerAt(int256 answer, uint256 updatedAt) external {
        _set(answer, updatedAt);
    }

    function latestRoundData() external view override returns (uint80, int256, uint256, uint256, uint80) {
        return (_roundId, _answer, _updatedAt, _updatedAt, _roundId);
    }

    function _set(int256 answer, uint256 updatedAt) private {
        _roundId++;
        _answer = answer;
        _updatedAt = updatedAt;
    }
}
