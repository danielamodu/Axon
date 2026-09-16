// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AxonRegistry
 * @notice Immutable onchain ledger for Sky Protocol governance spell executions.
 *         Records are append-only; no owner, no upgradability.
 *         Only the designated executor (the Axon backend wallet) may append
 *         records, so strangers cannot forge execution proofs. The executor
 *         key can be rotated by the current executor via setExecutor.
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

    /// @notice Wallet authorized to append execution records (Axon backend).
    address public executor;

    mapping(uint256 => ExecutionRecord) public records;
    uint256 public recordCount;
    /// @notice Per-protocol index: protocol => record ids (insertion order).
    /// Avoids O(recordCount) scans in `getRecordsByProtocol`.
    mapping(address => uint256[]) private protocolRecordIds;

    event ExecutionLogged(
        address indexed protocol,
        address indexed spell,
        bytes32 txHash,
        uint256 executedAt,
        uint8 simulationScore
    );
    event ExecutorUpdated(address indexed oldExecutor, address indexed newExecutor);

    error NotExecutor();

    constructor(address initialExecutor) {
        executor = initialExecutor;
    }

    modifier onlyExecutor() {
        if (msg.sender != executor) revert NotExecutor();
        _;
    }

    /// @notice Rotate the executor key. Callable only by the current executor.
    function setExecutor(address newExecutor) external onlyExecutor {
        address oldExecutor = executor;
        executor = newExecutor;
        emit ExecutorUpdated(oldExecutor, newExecutor);
    }

    function logExecution(
        address protocol,
        address spellAddress,
        bytes32 actionType,
        bytes32 txHash,
        uint256 executedAt,
        uint256 gasUsed,
        address executorAddress,
        uint8 simulationScore
    ) external onlyExecutor {
        uint256 id = recordCount++;
        records[id] = ExecutionRecord({
            protocol: protocol,
            spellAddress: spellAddress,
            actionType: actionType,
            txHash: txHash,
            executedAt: executedAt,
            gasUsed: gasUsed,
            executor: executorAddress,
            simulationScore: simulationScore
        });
        protocolRecordIds[protocol].push(id);
        emit ExecutionLogged(protocol, spellAddress, txHash, executedAt, simulationScore);
    }

    function getRecord(uint256 id) external view returns (ExecutionRecord memory) {
        require(id < recordCount, "Record does not exist");
        return records[id];
    }

    function getRecordsByProtocol(address protocol, uint256 limit)
        external view returns (ExecutionRecord[] memory)
    {
        uint256 total = protocolRecordIds[protocol].length;
        uint256 n = limit < total ? limit : total;
        ExecutionRecord[] memory result = new ExecutionRecord[](n);
        for (uint256 i = 0; i < n; i++) {
            result[i] = records[protocolRecordIds[protocol][i]];
        }
        return result;
    }

    /// @notice Paginated read, newest-first (for dashboards). `offset` skips
    /// the newest `offset` records. Returns at most `limit` entries.
    function getRecordsByProtocolPaginated(address protocol, uint256 limit, uint256 offset)
        external view returns (ExecutionRecord[] memory)
    {
        uint256 total = protocolRecordIds[protocol].length;
        if (offset >= total || limit == 0) {
            return new ExecutionRecord[](0);
        }
        uint256 remaining = total - offset;
        uint256 n = limit < remaining ? limit : remaining;
        ExecutionRecord[] memory result = new ExecutionRecord[](n);
        for (uint256 i = 0; i < n; i++) {
            uint256 id = protocolRecordIds[protocol][total - 1 - offset - i];
            result[i] = records[id];
        }
        return result;
    }

    /// @notice Count of records for a protocol (for pagination UI).
    function getRecordCountByProtocol(address protocol) external view returns (uint256) {
        return protocolRecordIds[protocol].length;
    }
}
