// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AxonRegistry
 * @notice Immutable onchain ledger for Sky Protocol governance spell executions.
 *         Records are append-only; no owner, no upgradability, no admin keys.
 */
contract AxonRegistry {
    struct ExecutionRecord {
        address protocol;
        address spellAddress;
        bytes32 actionType;
        bytes32 txHash;
        uint256 executedAt;
        uint256 gasUsed;
        address executor;
        uint8 simulationScore; // 0=RED 1=YELLOW 2=GREEN
    }

    mapping(uint256 => ExecutionRecord) public records;
    uint256 public recordCount;

    event ExecutionLogged(
        address indexed protocol,
        address indexed spell,
        bytes32 txHash,
        uint256 executedAt,
        uint8 simulationScore
    );

    function logExecution(
        address protocol,
        address spellAddress,
        bytes32 actionType,
        bytes32 txHash,
        uint256 executedAt,
        uint256 gasUsed,
        address executor,
        uint8 simulationScore
    ) external {
        uint256 id = recordCount++;
        records[id] = ExecutionRecord({
            protocol: protocol,
            spellAddress: spellAddress,
            actionType: actionType,
            txHash: txHash,
            executedAt: executedAt,
            gasUsed: gasUsed,
            executor: executor,
            simulationScore: simulationScore
        });
        emit ExecutionLogged(protocol, spellAddress, txHash, executedAt, simulationScore);
    }

    function getRecord(uint256 id) external view returns (ExecutionRecord memory) {
        require(id < recordCount, "Record does not exist");
        return records[id];
    }

    function getRecordsByProtocol(address protocol, uint256 limit)
        external view returns (ExecutionRecord[] memory)
    {
        ExecutionRecord[] memory result = new ExecutionRecord[](limit);
        uint256 found = 0;
        for (uint256 i = 0; i < recordCount && found < limit; i++) {
            if (records[i].protocol == protocol) {
                result[found++] = records[i];
            }
        }
        // Resize result array to the actual number of matches found
        assembly { mstore(result, found) }
        return result;
    }
}
