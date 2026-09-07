// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {AxonRegistry} from "../src/AxonRegistry.sol";

contract Deploy is Script {
    function run() external returns (AxonRegistry registry) {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deploying AxonRegistry...");
        console.log("  Deployer:  ", deployer);
        console.log("  Chain ID:  ", block.chainid);
        console.log("  Balance:   ", deployer.balance / 1e18, "ETH");

        vm.startBroadcast(deployerPrivateKey);
        registry = new AxonRegistry();
        vm.stopBroadcast();

        console.log("AxonRegistry deployed at:", address(registry));
        console.log("Record count (sanity):", registry.recordCount());

        // Write address to stdout for CI capture
        console.log("AXON_REGISTRY_ADDRESS=%s", address(registry));
    }
}
