// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import {AxonRegistry} from "../src/AxonRegistry.sol";

contract AxonRegistryTest is Test {
    AxonRegistry registry;

    // Mirror the event signature from AxonRegistry for vm.expectEmit
    event ExecutionLogged(
        address indexed protocol,
        address indexed spell,
        bytes32 txHash,
        uint256 executedAt,
        uint8 simulationScore
    );

    address constant SKY_PROTOCOL  = address(0x1111);
    address constant SPELL_A       = address(0xAAAA);
    address constant SPELL_B       = address(0xBBBB);
    address constant EXECUTOR_ADDR = address(0xEEEE);

    bytes32 constant ACTION_TYPE  = keccak256("GOVERNANCE_CAST");
    bytes32 constant TX_HASH_A    = bytes32(uint256(0xABCD1234));
    bytes32 constant TX_HASH_B    = bytes32(uint256(0xDCBA5678));

    function setUp() public {
        // The test contract deploys and therefore is the authorized executor.
        registry = new AxonRegistry(address(this));
    }

    // -------------------------------------------------------------------------
    // logExecution
    // -------------------------------------------------------------------------

    function test_logExecution_incrementsRecordCount() public {
        assertEq(registry.recordCount(), 0);
        _logRecord(SPELL_A, TX_HASH_A, 2);
        assertEq(registry.recordCount(), 1);
        _logRecord(SPELL_B, TX_HASH_B, 1);
        assertEq(registry.recordCount(), 2);
    }

    function test_logExecution_emitsEvent() public {
        vm.expectEmit(true, true, false, true);
        emit ExecutionLogged(
            SKY_PROTOCOL, SPELL_A, TX_HASH_A, block.timestamp, 2
        );
        _logRecord(SPELL_A, TX_HASH_A, 2);
    }

    function test_logExecution_storesAllFields() public {
        uint256 ts = block.timestamp;
        uint256 gas = 150_000;

        registry.logExecution(
            SKY_PROTOCOL,
            SPELL_A,
            ACTION_TYPE,
            TX_HASH_A,
            ts,
            gas,
            EXECUTOR_ADDR,
            2
        );

        AxonRegistry.ExecutionRecord memory rec = registry.getRecord(0);
        assertEq(rec.protocol,        SKY_PROTOCOL);
        assertEq(rec.spellAddress,    SPELL_A);
        assertEq(rec.actionType,      ACTION_TYPE);
        assertEq(rec.txHash,          TX_HASH_A);
        assertEq(rec.executedAt,      ts);
        assertEq(rec.gasUsed,         gas);
        assertEq(rec.executor,        EXECUTOR_ADDR);
        assertEq(rec.simulationScore, 2);
    }

    function test_logExecution_allowsAnySimulationScore() public {
        _logRecord(SPELL_A, TX_HASH_A, 0); // RED
        _logRecord(SPELL_B, TX_HASH_B, 1); // YELLOW
        _logRecord(address(0xCCCC), bytes32(uint256(0xCC)), 2); // GREEN

        assertEq(registry.getRecord(0).simulationScore, 0);
        assertEq(registry.getRecord(1).simulationScore, 1);
        assertEq(registry.getRecord(2).simulationScore, 2);
    }

    // -------------------------------------------------------------------------
    // getRecord
    // -------------------------------------------------------------------------

    function test_getRecord_revertsOnNonExistentId() public {
        vm.expectRevert("Record does not exist");
        registry.getRecord(0);
    }

    function test_getRecord_revertsWhenIdEqualsRecordCount() public {
        _logRecord(SPELL_A, TX_HASH_A, 2);
        assertEq(registry.recordCount(), 1);
        vm.expectRevert("Record does not exist");
        registry.getRecord(1);
    }

    function test_getRecord_returnsCorrectRecordByIndex() public {
        _logRecord(SPELL_A, TX_HASH_A, 2);
        _logRecord(SPELL_B, TX_HASH_B, 1);

        assertEq(registry.getRecord(0).spellAddress, SPELL_A);
        assertEq(registry.getRecord(1).spellAddress, SPELL_B);
    }

    // -------------------------------------------------------------------------
    // getRecordsByProtocol
    // -------------------------------------------------------------------------

    function test_getRecordsByProtocol_returnsOnlyMatchingRecords() public {
        address OTHER_PROTOCOL = address(0x9999);

        registry.logExecution(SKY_PROTOCOL, SPELL_A, ACTION_TYPE, TX_HASH_A, block.timestamp, 0, EXECUTOR_ADDR, 2);
        registry.logExecution(OTHER_PROTOCOL, SPELL_B, ACTION_TYPE, TX_HASH_B, block.timestamp, 0, EXECUTOR_ADDR, 1);
        registry.logExecution(SKY_PROTOCOL, address(0xCCCC), ACTION_TYPE, bytes32(0), block.timestamp, 0, EXECUTOR_ADDR, 2);

        AxonRegistry.ExecutionRecord[] memory results = registry.getRecordsByProtocol(SKY_PROTOCOL, 10);
        assertEq(results.length, 2);
        assertEq(results[0].spellAddress, SPELL_A);
        assertEq(results[1].spellAddress, address(0xCCCC));
    }

    function test_getRecordsByProtocol_respectsLimit() public {
        _logRecord(SPELL_A, TX_HASH_A, 2);
        _logRecord(SPELL_B, TX_HASH_B, 2);
        _logRecord(address(0xCCCC), bytes32(0), 2);

        // Limit of 2 should return only the first 2 matches
        AxonRegistry.ExecutionRecord[] memory results = registry.getRecordsByProtocol(SKY_PROTOCOL, 2);
        assertEq(results.length, 2);
    }

    function test_getRecordsByProtocol_returnsEmptyForNoMatch() public {
        _logRecord(SPELL_A, TX_HASH_A, 2);

        AxonRegistry.ExecutionRecord[] memory results = registry.getRecordsByProtocol(address(0xDEAD), 10);
        assertEq(results.length, 0);
    }

    function test_getRecordsByProtocol_returnsEmptyWhenNoRecordsExist() public {
        AxonRegistry.ExecutionRecord[] memory results = registry.getRecordsByProtocol(SKY_PROTOCOL, 10);
        assertEq(results.length, 0);
    }

    // -------------------------------------------------------------------------
    // Fuzz
    // -------------------------------------------------------------------------

    function testFuzz_logAndRetrieve(
        address protocol,
        address spell,
        uint256 gas,
        uint8 score
    ) public {
        bytes32 txHash = keccak256(abi.encode(spell, gas, score));
        uint256 ts = block.timestamp;

        registry.logExecution(protocol, spell, ACTION_TYPE, txHash, ts, gas, EXECUTOR_ADDR, score);

        AxonRegistry.ExecutionRecord memory rec = registry.getRecord(0);
        assertEq(rec.protocol,        protocol);
        assertEq(rec.spellAddress,    spell);
        assertEq(rec.txHash,          txHash);
        assertEq(rec.executedAt,      ts);
        assertEq(rec.gasUsed,         gas);
        assertEq(rec.simulationScore, score);
    }

    // -------------------------------------------------------------------------
    // Executor allowlist
    // -------------------------------------------------------------------------

    function test_logExecution_revertsForNonExecutor() public {
        address stranger = address(0xBEEF);
        vm.prank(stranger);
        vm.expectRevert(AxonRegistry.NotExecutor.selector);
        registry.logExecution(
            SKY_PROTOCOL,
            SPELL_A,
            ACTION_TYPE,
            TX_HASH_A,
            block.timestamp,
            150_000,
            EXECUTOR_ADDR,
            2
        );
        assertEq(registry.recordCount(), 0);
    }

    function test_setExecutor_rotatesAndRevokesOld() public {
        address newExecutor = address(0xF00D);

        registry.setExecutor(newExecutor);
        assertEq(registry.executor(), newExecutor);

        // Old executor (this contract) can no longer write
        vm.expectRevert(AxonRegistry.NotExecutor.selector);
        registry.logExecution(
            SKY_PROTOCOL, SPELL_A, ACTION_TYPE, TX_HASH_A, block.timestamp, 150_000, EXECUTOR_ADDR, 2
        );

        // New executor can write
        vm.prank(newExecutor);
        registry.logExecution(
            SKY_PROTOCOL, SPELL_A, ACTION_TYPE, TX_HASH_A, block.timestamp, 150_000, EXECUTOR_ADDR, 2
        );
        assertEq(registry.recordCount(), 1);
    }

    function test_setExecutor_revertsForNonExecutor() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert(AxonRegistry.NotExecutor.selector);
        registry.setExecutor(address(0xBEEF));
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    function _logRecord(address spell, bytes32 txHash, uint8 score) internal {
        registry.logExecution(
            SKY_PROTOCOL,
            spell,
            ACTION_TYPE,
            txHash,
            block.timestamp,
            150_000,
            EXECUTOR_ADDR,
            score
        );
    }
}
