// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IAgentVault
 * @notice Interface for the AgentVault — an AI-managed wealth wallet
 * @dev Enables autonomous USDC transfers by an AI agent within human-defined guardrails
 */
interface IAgentVault {
    // ═══════════════════════════════════════════════════════════════════════
    //                              STRUCTS
    // ═══════════════════════════════════════════════════════════════════════

    struct Recipient {
        string label;            // Human-readable name: "Wife - Alice"
        string purpose;          // Category: "household", "allowance", "salary"
        uint256 dailyLimit;      // Max USDC per day (6 decimals)
        uint256 monthlyLimit;    // Max USDC per month (6 decimals)
        uint256 dailySpent;      // Amount spent in current day
        uint256 monthlySpent;    // Amount spent in current month
        uint256 lastDayReset;    // Timestamp of last daily reset
        uint256 lastMonthReset;  // Timestamp of last monthly reset
        bool active;             // Whether recipient can receive transfers
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              EVENTS
    // ═══════════════════════════════════════════════════════════════════════

    event TransferExecuted(
        address indexed to,
        uint256 amount,
        string memo,
        uint256 timestamp
    );

    event RecipientAdded(address indexed recipient, string label);
    event RecipientRemoved(address indexed recipient);
    event AgentUpdated(address indexed newAgent);
    event Deposited(address indexed from, uint256 amount);
    event DailyVaultLimitUpdated(uint256 newLimit);

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

    function emergencyWithdraw(address _to, uint256 _amount) external;

    function pause() external;

    function unpause() external;

    // ═══════════════════════════════════════════════════════════════════════
    //                         AGENT FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    function agentTransfer(
        address _to,
        uint256 _amount,
        string calldata _memo
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
}
