// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Counter {
    uint256 public counter;

    event Counted(uint256 newValue, address indexed caller);

    constructor() {
        counter = 0;
    }

    function count() external {
        counter += 1;
        emit Counted(counter, msg.sender);
    }

    function get() external view returns (uint256) {
        return counter;
    }
}