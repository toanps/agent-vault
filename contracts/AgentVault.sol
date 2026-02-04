// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./IAgentVault.sol";

/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║                           AGENT VAULT v1.0                               ║
 * ║              AI-Managed Wealth Wallet for Family Finance                  ║
 * ╠═══════════════════════════════════════════════════════════════════════════╣
 * ║                                                                           ║
 * ║  An on-chain vault that holds USDC and allows an AI agent (Clawdbot)      ║
 * ║  to autonomously distribute funds to whitelisted family members within    ║
 * ║  configurable daily and monthly spending limits.                          ║
 * ║                                                                           ║
 * ║  Architecture:                                                            ║
 * ║  ┌──────────┐    agentTransfer()    ┌───────────┐    USDC    ┌──────────┐║
 * ║  │ AI Agent  │ ──────────────────► │ AgentVault │ ────────► │ Family   │║
 * ║  │ (Clawdbot)│  (within limits)     │  (this)    │           │ Members  │║
 * ║  └──────────┘                       └───────────┘           └──────────┘║
 * ║       │                                  ▲                               ║
 * ║       │ can ONLY call                    │ full admin                     ║
 * ║       │ agentTransfer()                  │ controls                       ║
 * ║       ▼                             ┌────┴─────┐                         ║
 * ║  Guardrails:                        │  Owner   │                         ║
 * ║  • Whitelist only                   │ (Human)  │                         ║
 * ║  • Daily limits                     └──────────┘                         ║
 * ║  • Monthly limits                                                         ║
 * ║  • Vault-wide daily cap                                                   ║
 * ║  • Pausable                                                               ║
 * ║                                                                           ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * @title AgentVault
 * @author AgentVault Team — USDC Moltbook Hackathon
 * @notice A USDC vault with AI agent-controlled disbursements and human-set guardrails
 * @dev Built on OpenZeppelin v5 (Ownable, Pausable, ReentrancyGuard)
 */
contract AgentVault is IAgentVault, Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ═══════════════════════════════════════════════════════════════════════
    //                           STATE VARIABLES
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice The USDC token contract
    IERC20 public immutable usdc;

    /// @notice The AI agent address authorized to execute transfers
    address public agent;

    /// @notice Maximum total USDC the agent can transfer per day across ALL recipients
    uint256 public dailyVaultLimit;

    /// @notice Total USDC transferred by the agent today
    uint256 public dailyVaultSpent;

    /// @notice Timestamp of last vault-wide daily reset
    uint256 public lastVaultDayReset;

    /// @notice Mapping of recipient address → their configuration and spend tracking
    mapping(address => Recipient) public recipients;

    /// @notice Array of all recipient addresses (for enumeration)
    address[] public recipientList;

    /// @notice Quick lookup: is this address in recipientList?
    mapping(address => bool) private _isRecipient;

    // ═══════════════════════════════════════════════════════════════════════
    //                             CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev 1 day in seconds (used for daily limit resets)
    uint256 private constant DAY = 1 days;

    /// @dev 30 days in seconds (used for monthly limit resets)
    uint256 private constant MONTH = 30 days;

    // ═══════════════════════════════════════════════════════════════════════
    //                             MODIFIERS
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev Restricts function access to the designated AI agent
    modifier onlyAgent() {
        require(msg.sender == agent, "AgentVault: caller is not the agent");
        _;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                            CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Deploy AgentVault with USDC token and initial vault-wide daily limit
     * @param _usdc Address of the USDC token contract
     * @param _dailyVaultLimit Maximum total USDC transferable per day (6 decimals)
     */
    constructor(
        address _usdc,
        uint256 _dailyVaultLimit
    ) Ownable(msg.sender) {
        require(_usdc != address(0), "AgentVault: invalid USDC address");
        require(_dailyVaultLimit > 0, "AgentVault: invalid daily vault limit");

        usdc = IERC20(_usdc);
        dailyVaultLimit = _dailyVaultLimit;
        lastVaultDayReset = block.timestamp;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         OWNER FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Add a new recipient to the whitelist
     * @param _recipient Wallet address of the recipient
     * @param _label Human-readable name (e.g., "Wife - Alice")
     * @param _purpose Category of payments (e.g., "household", "allowance")
     * @param _dailyLimit Maximum USDC this recipient can receive per day
     * @param _monthlyLimit Maximum USDC this recipient can receive per month
     */
    function addRecipient(
        address _recipient,
        string calldata _label,
        string calldata _purpose,
        uint256 _dailyLimit,
        uint256 _monthlyLimit
    ) external onlyOwner {
        require(_recipient != address(0), "AgentVault: invalid recipient address");
        require(!_isRecipient[_recipient], "AgentVault: recipient already exists");
        require(_dailyLimit > 0, "AgentVault: daily limit must be > 0");
        require(_monthlyLimit >= _dailyLimit, "AgentVault: monthly limit must be >= daily limit");

        recipients[_recipient] = Recipient({
            label: _label,
            purpose: _purpose,
            dailyLimit: _dailyLimit,
            monthlyLimit: _monthlyLimit,
            dailySpent: 0,
            monthlySpent: 0,
            lastDayReset: block.timestamp,
            lastMonthReset: block.timestamp,
            active: true
        });

        recipientList.push(_recipient);
        _isRecipient[_recipient] = true;

        emit RecipientAdded(_recipient, _label);
    }

    /**
     * @notice Deactivate a recipient (soft delete — preserves history)
     * @param _recipient Address to remove from active whitelist
     */
    function removeRecipient(address _recipient) external onlyOwner {
        require(_isRecipient[_recipient], "AgentVault: recipient does not exist");

        recipients[_recipient].active = false;

        emit RecipientRemoved(_recipient);
    }

    /**
     * @notice Update daily and monthly spending limits for a recipient
     * @param _recipient Address of the recipient to update
     * @param _dailyLimit New daily limit in USDC (6 decimals)
     * @param _monthlyLimit New monthly limit in USDC (6 decimals)
     */
    function updateLimits(
        address _recipient,
        uint256 _dailyLimit,
        uint256 _monthlyLimit
    ) external onlyOwner {
        require(_isRecipient[_recipient], "AgentVault: recipient does not exist");
        require(_dailyLimit > 0, "AgentVault: daily limit must be > 0");
        require(_monthlyLimit >= _dailyLimit, "AgentVault: monthly limit must be >= daily limit");

        recipients[_recipient].dailyLimit = _dailyLimit;
        recipients[_recipient].monthlyLimit = _monthlyLimit;
    }

    /**
     * @notice Set or change the AI agent address
     * @param _agent New agent wallet address
     */
    function setAgent(address _agent) external onlyOwner {
        require(_agent != address(0), "AgentVault: invalid agent address");
        agent = _agent;
        emit AgentUpdated(_agent);
    }

    /**
     * @notice Update the vault-wide daily spending limit
     * @param _limit New daily vault limit in USDC (6 decimals)
     */
    function setDailyVaultLimit(uint256 _limit) external onlyOwner {
        require(_limit > 0, "AgentVault: invalid daily vault limit");
        dailyVaultLimit = _limit;
        emit DailyVaultLimitUpdated(_limit);
    }

    /**
     * @notice Emergency withdraw USDC from the vault (owner only, bypasses all limits)
     * @param _to Destination address for the withdrawn USDC
     * @param _amount Amount of USDC to withdraw (6 decimals)
     */
    function emergencyWithdraw(
        address _to,
        uint256 _amount
    ) external onlyOwner nonReentrant {
        require(_to != address(0), "AgentVault: invalid destination");
        require(_amount > 0, "AgentVault: amount must be > 0");
        require(_amount <= usdc.balanceOf(address(this)), "AgentVault: insufficient balance");

        usdc.safeTransfer(_to, _amount);
    }

    /// @notice Pause all agent transfers (emergency stop)
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resume agent transfers
    function unpause() external onlyOwner {
        _unpause();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         AGENT FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Execute a USDC transfer to a whitelisted recipient
     * @dev Only callable by the designated AI agent. Enforces:
     *      1. Recipient must be whitelisted and active
     *      2. Transfer must be within recipient's daily limit
     *      3. Transfer must be within recipient's monthly limit
     *      4. Transfer must be within vault-wide daily limit
     *      5. Vault must not be paused
     *
     * @param _to Recipient address (must be whitelisted)
     * @param _amount USDC amount to transfer (6 decimals)
     * @param _memo Human-readable reason for the transfer
     */
    function agentTransfer(
        address _to,
        uint256 _amount,
        string calldata _memo
    ) external onlyAgent whenNotPaused nonReentrant {
        require(_amount > 0, "AgentVault: amount must be > 0");
        require(_isRecipient[_to], "AgentVault: recipient not whitelisted");

        Recipient storage r = recipients[_to];
        require(r.active, "AgentVault: recipient is inactive");

        // ── Reset daily counter if new day ──
        if (block.timestamp >= r.lastDayReset + DAY) {
            r.dailySpent = 0;
            r.lastDayReset = block.timestamp;
        }

        // ── Reset monthly counter if new month ──
        if (block.timestamp >= r.lastMonthReset + MONTH) {
            r.monthlySpent = 0;
            r.lastMonthReset = block.timestamp;
        }

        // ── Check recipient limits ──
        require(
            r.dailySpent + _amount <= r.dailyLimit,
            "AgentVault: exceeds recipient daily limit"
        );
        require(
            r.monthlySpent + _amount <= r.monthlyLimit,
            "AgentVault: exceeds recipient monthly limit"
        );

        // ── Reset vault-wide daily counter if new day ──
        if (block.timestamp >= lastVaultDayReset + DAY) {
            dailyVaultSpent = 0;
            lastVaultDayReset = block.timestamp;
        }

        // ── Check vault-wide daily limit ──
        require(
            dailyVaultSpent + _amount <= dailyVaultLimit,
            "AgentVault: exceeds vault daily limit"
        );

        // ── Check sufficient balance ──
        require(
            _amount <= usdc.balanceOf(address(this)),
            "AgentVault: insufficient vault balance"
        );

        // ── Update spend tracking ──
        r.dailySpent += _amount;
        r.monthlySpent += _amount;
        dailyVaultSpent += _amount;

        // ── Execute transfer ──
        usdc.safeTransfer(_to, _amount);

        emit TransferExecuted(_to, _amount, _memo, block.timestamp);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         PUBLIC FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Deposit USDC into the vault
     * @dev Caller must have approved this contract to spend `_amount` USDC first
     * @param _amount Amount of USDC to deposit (6 decimals)
     */
    function deposit(uint256 _amount) external nonReentrant {
        require(_amount > 0, "AgentVault: amount must be > 0");

        usdc.safeTransferFrom(msg.sender, address(this), _amount);

        emit Deposited(msg.sender, _amount);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Get full details of a recipient
     * @param _recipient Address to query
     * @return Recipient struct with all fields
     */
    function getRecipient(
        address _recipient
    ) external view returns (Recipient memory) {
        require(_isRecipient[_recipient], "AgentVault: recipient does not exist");
        return recipients[_recipient];
    }

    /**
     * @notice Get the list of all recipient addresses (active and inactive)
     * @return Array of recipient addresses
     */
    function getRecipientList() external view returns (address[] memory) {
        return recipientList;
    }

    /**
     * @notice Get the current USDC balance held in the vault
     * @return Balance in USDC (6 decimals)
     */
    function getVaultBalance() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    /**
     * @notice Get remaining daily allowance for a recipient (accounts for resets)
     * @param _recipient Address to query
     * @return Remaining USDC the recipient can receive today
     */
    function getRemainingDailyAllowance(
        address _recipient
    ) external view returns (uint256) {
        require(_isRecipient[_recipient], "AgentVault: recipient does not exist");
        Recipient memory r = recipients[_recipient];

        // If a new day has started, full allowance is available
        if (block.timestamp >= r.lastDayReset + DAY) {
            return r.dailyLimit;
        }
        return r.dailyLimit - r.dailySpent;
    }

    /**
     * @notice Get remaining monthly allowance for a recipient (accounts for resets)
     * @param _recipient Address to query
     * @return Remaining USDC the recipient can receive this month
     */
    function getRemainingMonthlyAllowance(
        address _recipient
    ) external view returns (uint256) {
        require(_isRecipient[_recipient], "AgentVault: recipient does not exist");
        Recipient memory r = recipients[_recipient];

        // If a new month has started, full allowance is available
        if (block.timestamp >= r.lastMonthReset + MONTH) {
            return r.monthlyLimit;
        }
        return r.monthlyLimit - r.monthlySpent;
    }
}
