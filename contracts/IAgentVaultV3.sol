// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IAgentVaultV3
 * @notice Interface for AgentVault V3 — Zero-Trust Meta-Transaction Vault
 * @dev EIP-712 signed transfers, deadman switch, agent rotation timelock
 */
interface IAgentVaultV3 {
    // ═══════════════════════════════════════════════════════════════════════
    //                              STRUCTS
    // ═══════════════════════════════════════════════════════════════════════

    struct Recipient {
        string label;
        string purpose;
        uint256 dailyLimit;
        uint256 monthlyLimit;
        uint256 dailySpent;
        uint256 monthlySpent;
        uint256 lastDayReset;
        uint256 lastMonthReset;
        bool active;
    }

    struct TransferRecord {
        address to;
        uint256 amount;
        string memo;
        uint256 timestamp;
        uint256 nonce;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              EVENTS
    // ═══════════════════════════════════════════════════════════════════════

    event TransferExecuted(
        address indexed to,
        uint256 amount,
        string memo,
        uint256 timestamp,
        uint256 nonce
    );

    event RecipientAdded(address indexed recipient, string label);
    event RecipientRemoved(address indexed recipient);
    event AgentUpdated(address indexed newAgent);
    event Deposited(address indexed from, uint256 amount);
    event DailyVaultLimitUpdated(uint256 newLimit);
    event EmergencyDrain(address indexed to, uint256 amount);
    event MaxPerTransferUpdated(uint256 newMax);
    event TransferCooldownUpdated(uint256 newCooldown);
    event DeadmanDaysUpdated(uint256 newDays);
    event OwnerHeartbeatRecorded(uint256 timestamp);
    event AgentRotationProposed(address indexed newAgent, uint256 activationTime);
    event AgentRotationActivated(address indexed newAgent);
    event AgentRotationCancelled(address indexed cancelledAgent);

    // ═══════════════════════════════════════════════════════════════════════
    //                         OWNER FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    function addRecipient(
        address _recipient,
        string calldata _label,
        string calldata _purpose,
        uint256 _dailyLimit,
        uint256 _monthlyLimit
    ) external;

    function removeRecipient(address _recipient) external;

    function updateLimits(
        address _recipient,
        uint256 _dailyLimit,
        uint256 _monthlyLimit
    ) external;

    function setAgent(address _agent) external;
    function setDailyVaultLimit(uint256 _limit) external;

    function emergencyDrain() external;
    function setMaxPerTransfer(uint256 _amount) external;
    function setTransferCooldown(uint256 _seconds) external;
    function setDeadmanDays(uint256 _days) external;
    function ownerHeartbeat() external;
    function rotateAgent(address _newAgent) external;
    function activateAgent() external;
    function cancelAgentRotation() external;

    function pause() external;
    function unpause() external;

    // ═══════════════════════════════════════════════════════════════════════
    //                     META-TX TRANSFER FUNCTION
    // ═══════════════════════════════════════════════════════════════════════

    function executeTransfer(
        address _to,
        uint256 _amount,
        string calldata _memo,
        uint256 _nonce,
        uint256 _deadline,
        bytes calldata _signature
    ) external;

    // ═══════════════════════════════════════════════════════════════════════
    //                         PUBLIC FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    function deposit(uint256 _amount) external;

    // ═══════════════════════════════════════════════════════════════════════
    //                         VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    function getRecipient(address _recipient) external view returns (Recipient memory);
    function getRecipientList() external view returns (address[] memory);
    function getVaultBalance() external view returns (uint256);
    function getTransferHistory(uint256 count) external view returns (TransferRecord[] memory);
    function getPendingAgentRotation() external view returns (address, uint256);
    function getDeadmanStatus() external view returns (uint256 lastHeartbeat, uint256 deadmanDaysVal, bool isExpired);
}
