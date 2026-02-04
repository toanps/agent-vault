// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./IAgentVaultV3.sol";

/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║                        AGENT VAULT v3.0                                   ║
 * ║              Zero-Trust Meta-Transaction Vault                            ║
 * ╠═══════════════════════════════════════════════════════════════════════════╣
 * ║                                                                           ║
 * ║  v3 adds meta-transactions: AI agent signs off-chain, anyone relays.      ║
 * ║  Agent needs ZERO ETH. Plus: deadman switch, agent rotation timelock,     ║
 * ║  per-transfer cap, transfer cooldown, on-chain history.                   ║
 * ║                                                                           ║
 * ║  Architecture:                                                            ║
 * ║  ┌──────────┐  EIP-712 sig   ┌─────────┐  relay   ┌───────────┐         ║
 * ║  │ AI Agent  │ ────────────► │ Relayer  │ ───────► │ AgentVault│         ║
 * ║  │ (no ETH!) │  off-chain     │ (anyone) │ on-chain │   V3      │         ║
 * ║  └──────────┘                └─────────┘          └───────────┘         ║
 * ║                                                                           ║
 * ║  New Guardrails:                                                          ║
 * ║  • Meta-tx with EIP-712 signatures                                        ║
 * ║  • Per-transfer cap                                                       ║
 * ║  • Transfer cooldown                                                      ║
 * ║  • Deadman switch (auto-pause)                                            ║
 * ║  • Agent rotation with 24h timelock                                       ║
 * ║  • Transfer nonce + deadline (replay protection)                          ║
 * ║  • On-chain transfer history                                              ║
 * ║  • Emergency drain (one-call)                                             ║
 * ║                                                                           ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * @title AgentVaultV3
 * @author AgentVault Team
 * @notice A zero-trust USDC vault with meta-transaction support
 */
contract AgentVaultV3 is IAgentVaultV3, Ownable, Pausable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    // ═══════════════════════════════════════════════════════════════════════
    //                           STATE VARIABLES
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice The USDC token contract
    IERC20 public immutable usdc;

    /// @notice The AI agent address authorized to sign transfers
    address public agent;

    /// @notice Maximum total USDC the agent can transfer per day across ALL recipients
    uint256 public dailyVaultLimit;

    /// @notice Total USDC transferred today
    uint256 public dailyVaultSpent;

    /// @notice Timestamp of last vault-wide daily reset
    uint256 public lastVaultDayReset;

    /// @notice Recipient configurations
    mapping(address => Recipient) public recipients;

    /// @notice Array of all recipient addresses
    address[] public recipientList;

    /// @notice Quick lookup for recipients
    mapping(address => bool) private _isRecipient;

    // ── V3 State Variables ──

    /// @notice Maximum USDC per single transfer
    uint256 public maxPerTransfer;

    /// @notice Minimum seconds between agent transfers
    uint256 public transferCooldown;

    /// @notice Timestamp of last agent transfer
    uint256 public lastTransferTime;

    /// @notice Current transfer nonce (replay protection)
    uint256 public transferNonce;

    /// @notice Days before auto-pause if owner doesn't heartbeat
    uint256 public deadmanDays;

    /// @notice Last time owner called ownerHeartbeat()
    uint256 public lastOwnerHeartbeat;

    /// @notice Pending agent address for rotation
    address public pendingAgent;

    /// @notice Timestamp when pending agent can be activated
    uint256 public pendingAgentActivation;

    /// @notice On-chain transfer history (circular buffer)
    TransferRecord[] private _transferHistory;

    /// @notice Max records to keep in history
    uint256 public constant MAX_HISTORY = 50;

    // ═══════════════════════════════════════════════════════════════════════
    //                             CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════

    uint256 private constant DAY = 1 days;
    uint256 private constant MONTH = 30 days;
    uint256 public constant AGENT_ROTATION_DELAY = 24 hours;

    /// @dev EIP-712 typehash for Transfer struct
    bytes32 public constant TRANSFER_TYPEHASH = keccak256(
        "Transfer(address to,uint256 amount,string memo,uint256 nonce,uint256 deadline)"
    );

    // ═══════════════════════════════════════════════════════════════════════
    //                            CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Deploy AgentVaultV3
     * @param _usdc Address of the USDC token contract
     * @param _dailyVaultLimit Maximum total USDC transferable per day (6 decimals)
     * @param _maxPerTransfer Maximum USDC per single transfer (6 decimals)
     * @param _transferCooldown Minimum seconds between transfers
     * @param _deadmanDays Days before auto-pause without owner heartbeat
     */
    constructor(
        address _usdc,
        uint256 _dailyVaultLimit,
        uint256 _maxPerTransfer,
        uint256 _transferCooldown,
        uint256 _deadmanDays
    ) Ownable(msg.sender) EIP712("AgentVaultV3", "1") {
        require(_usdc != address(0), "V3: invalid USDC");
        require(_dailyVaultLimit > 0, "V3: invalid daily limit");
        require(_maxPerTransfer > 0, "V3: invalid max per transfer");
        require(_deadmanDays > 0, "V3: invalid deadman days");

        usdc = IERC20(_usdc);
        dailyVaultLimit = _dailyVaultLimit;
        maxPerTransfer = _maxPerTransfer;
        transferCooldown = _transferCooldown;
        deadmanDays = _deadmanDays;
        lastVaultDayReset = block.timestamp;
        lastOwnerHeartbeat = block.timestamp;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         OWNER FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Add a new recipient to the whitelist
     */
    function addRecipient(
        address _recipient,
        string calldata _label,
        string calldata _purpose,
        uint256 _dailyLimit,
        uint256 _monthlyLimit
    ) external onlyOwner {
        require(_recipient != address(0), "V3: invalid recipient");
        require(!_isRecipient[_recipient], "V3: recipient exists");
        require(_dailyLimit > 0, "V3: daily limit must be > 0");
        require(_monthlyLimit >= _dailyLimit, "V3: monthly >= daily");

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
     * @notice Deactivate a recipient
     */
    function removeRecipient(address _recipient) external onlyOwner {
        require(_isRecipient[_recipient], "V3: recipient not found");
        recipients[_recipient].active = false;
        emit RecipientRemoved(_recipient);
    }

    /**
     * @notice Update spending limits for a recipient
     */
    function updateLimits(
        address _recipient,
        uint256 _dailyLimit,
        uint256 _monthlyLimit
    ) external onlyOwner {
        require(_isRecipient[_recipient], "V3: recipient not found");
        require(_dailyLimit > 0, "V3: daily limit must be > 0");
        require(_monthlyLimit >= _dailyLimit, "V3: monthly >= daily");

        recipients[_recipient].dailyLimit = _dailyLimit;
        recipients[_recipient].monthlyLimit = _monthlyLimit;
    }

    /**
     * @notice Set the AI agent address directly (no timelock)
     * @dev Use rotateAgent() for production changes
     */
    function setAgent(address _agent) external onlyOwner {
        require(_agent != address(0), "V3: invalid agent");
        agent = _agent;
        emit AgentUpdated(_agent);
    }

    /**
     * @notice Update vault-wide daily limit
     */
    function setDailyVaultLimit(uint256 _limit) external onlyOwner {
        require(_limit > 0, "V3: invalid limit");
        dailyVaultLimit = _limit;
        emit DailyVaultLimitUpdated(_limit);
    }

    /**
     * @notice Emergency drain — sends ALL USDC to owner, one call, no params
     */
    function emergencyDrain() external onlyOwner nonReentrant {
        uint256 balance = usdc.balanceOf(address(this));
        require(balance > 0, "V3: vault is empty");

        usdc.safeTransfer(owner(), balance);
        emit EmergencyDrain(owner(), balance);
    }

    /**
     * @notice Set maximum USDC per single transfer
     */
    function setMaxPerTransfer(uint256 _amount) external onlyOwner {
        require(_amount > 0, "V3: invalid max");
        maxPerTransfer = _amount;
        emit MaxPerTransferUpdated(_amount);
    }

    /**
     * @notice Set minimum seconds between agent transfers
     */
    function setTransferCooldown(uint256 _seconds) external onlyOwner {
        transferCooldown = _seconds;
        emit TransferCooldownUpdated(_seconds);
    }

    /**
     * @notice Set deadman switch days
     */
    function setDeadmanDays(uint256 _days) external onlyOwner {
        require(_days > 0, "V3: invalid days");
        deadmanDays = _days;
        emit DeadmanDaysUpdated(_days);
    }

    /**
     * @notice Owner heartbeat — resets deadman switch timer
     */
    function ownerHeartbeat() external onlyOwner {
        lastOwnerHeartbeat = block.timestamp;
        emit OwnerHeartbeatRecorded(block.timestamp);
    }

    /**
     * @notice Propose a new agent with 24h timelock
     */
    function rotateAgent(address _newAgent) external onlyOwner {
        require(_newAgent != address(0), "V3: invalid agent");
        require(_newAgent != agent, "V3: same agent");

        pendingAgent = _newAgent;
        pendingAgentActivation = block.timestamp + AGENT_ROTATION_DELAY;

        emit AgentRotationProposed(_newAgent, pendingAgentActivation);
    }

    /**
     * @notice Activate the pending agent after timelock passes
     */
    function activateAgent() external onlyOwner {
        require(pendingAgent != address(0), "V3: no pending agent");
        require(block.timestamp >= pendingAgentActivation, "V3: timelock not expired");

        address newAgent = pendingAgent;
        agent = newAgent;
        pendingAgent = address(0);
        pendingAgentActivation = 0;

        emit AgentRotationActivated(newAgent);
    }

    /**
     * @notice Cancel a pending agent rotation
     */
    function cancelAgentRotation() external onlyOwner {
        require(pendingAgent != address(0), "V3: no pending rotation");

        address cancelled = pendingAgent;
        pendingAgent = address(0);
        pendingAgentActivation = 0;

        emit AgentRotationCancelled(cancelled);
    }

    /// @notice Pause all transfers
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpause transfers
    function unpause() external onlyOwner {
        _unpause();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                     META-TX TRANSFER FUNCTION
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Execute a USDC transfer using agent's EIP-712 signature
     * @dev Anyone can call this (relayer). The agent signs off-chain.
     *      Enforces: whitelist, limits, cooldown, cap, nonce, deadline, deadman
     *
     * @param _to Recipient address (must be whitelisted)
     * @param _amount USDC amount (6 decimals)
     * @param _memo Reason for transfer
     * @param _nonce Must match current transferNonce
     * @param _deadline Signature expiration timestamp
     * @param _signature Agent's EIP-712 signature
     */
    function executeTransfer(
        address _to,
        uint256 _amount,
        string calldata _memo,
        uint256 _nonce,
        uint256 _deadline,
        bytes calldata _signature
    ) external whenNotPaused nonReentrant {
        // ── Deadline check ──
        require(block.timestamp <= _deadline, "V3: signature expired");

        // ── Nonce check ──
        require(_nonce == transferNonce, "V3: invalid nonce");

        // ── Deadman switch check ──
        require(!_isDeadmanExpired(), "V3: deadman switch triggered");

        // ── Verify EIP-712 signature from agent ──
        bytes32 structHash = keccak256(abi.encode(
            TRANSFER_TYPEHASH,
            _to,
            _amount,
            keccak256(bytes(_memo)),
            _nonce,
            _deadline
        ));
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, _signature);
        require(signer == agent, "V3: invalid signature");

        // ── Amount checks ──
        require(_amount > 0, "V3: amount must be > 0");
        require(_amount <= maxPerTransfer, "V3: exceeds per-transfer cap");

        // ── Cooldown check ──
        require(
            block.timestamp >= lastTransferTime + transferCooldown,
            "V3: transfer cooldown active"
        );

        // ── Recipient checks ──
        require(_isRecipient[_to], "V3: not whitelisted");
        Recipient storage r = recipients[_to];
        require(r.active, "V3: recipient inactive");

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
        require(r.dailySpent + _amount <= r.dailyLimit, "V3: exceeds daily limit");
        require(r.monthlySpent + _amount <= r.monthlyLimit, "V3: exceeds monthly limit");

        // ── Reset vault-wide daily counter if new day ──
        if (block.timestamp >= lastVaultDayReset + DAY) {
            dailyVaultSpent = 0;
            lastVaultDayReset = block.timestamp;
        }

        // ── Check vault-wide daily limit ──
        require(dailyVaultSpent + _amount <= dailyVaultLimit, "V3: exceeds vault daily limit");

        // ── Check balance ──
        require(_amount <= usdc.balanceOf(address(this)), "V3: insufficient balance");

        // ── Update state ──
        r.dailySpent += _amount;
        r.monthlySpent += _amount;
        dailyVaultSpent += _amount;
        lastTransferTime = block.timestamp;
        transferNonce++;

        // ── Record history ──
        _recordTransfer(_to, _amount, _memo, _nonce);

        // ── Execute transfer ──
        usdc.safeTransfer(_to, _amount);

        emit TransferExecuted(_to, _amount, _memo, block.timestamp, _nonce);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         PUBLIC FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Deposit USDC into the vault
     */
    function deposit(uint256 _amount) external nonReentrant {
        require(_amount > 0, "V3: amount must be > 0");
        usdc.safeTransferFrom(msg.sender, address(this), _amount);
        emit Deposited(msg.sender, _amount);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    function getRecipient(address _recipient) external view returns (Recipient memory) {
        require(_isRecipient[_recipient], "V3: recipient not found");
        return recipients[_recipient];
    }

    function getRecipientList() external view returns (address[] memory) {
        return recipientList;
    }

    function getVaultBalance() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    /**
     * @notice Get the last N transfer records
     * @param count Number of records to return (capped at history length)
     */
    function getTransferHistory(uint256 count) external view returns (TransferRecord[] memory) {
        uint256 total = _transferHistory.length;
        if (count > total) count = total;

        TransferRecord[] memory result = new TransferRecord[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = _transferHistory[total - count + i];
        }
        return result;
    }

    /**
     * @notice Get pending agent rotation details
     */
    function getPendingAgentRotation() external view returns (address, uint256) {
        return (pendingAgent, pendingAgentActivation);
    }

    /**
     * @notice Get deadman switch status
     */
    function getDeadmanStatus() external view returns (
        uint256 lastHeartbeat,
        uint256 deadmanDaysVal,
        bool isExpired
    ) {
        return (lastOwnerHeartbeat, deadmanDays, _isDeadmanExpired());
    }

    /**
     * @notice Get remaining daily allowance for a recipient
     */
    function getRemainingDailyAllowance(address _recipient) external view returns (uint256) {
        require(_isRecipient[_recipient], "V3: recipient not found");
        Recipient memory r = recipients[_recipient];
        if (block.timestamp >= r.lastDayReset + DAY) return r.dailyLimit;
        return r.dailyLimit - r.dailySpent;
    }

    /**
     * @notice Get remaining monthly allowance for a recipient
     */
    function getRemainingMonthlyAllowance(address _recipient) external view returns (uint256) {
        require(_isRecipient[_recipient], "V3: recipient not found");
        Recipient memory r = recipients[_recipient];
        if (block.timestamp >= r.lastMonthReset + MONTH) return r.monthlyLimit;
        return r.monthlyLimit - r.monthlySpent;
    }

    /**
     * @notice Get the EIP-712 domain separator (useful for off-chain signing)
     */
    function getDomainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                        INTERNAL FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @dev Check if the deadman switch has expired
     */
    function _isDeadmanExpired() internal view returns (bool) {
        return block.timestamp > lastOwnerHeartbeat + (deadmanDays * 1 days);
    }

    /**
     * @dev Record a transfer in the on-chain history (circular buffer)
     */
    function _recordTransfer(
        address _to,
        uint256 _amount,
        string calldata _memo,
        uint256 _nonce
    ) internal {
        TransferRecord memory record = TransferRecord({
            to: _to,
            amount: _amount,
            memo: _memo,
            timestamp: block.timestamp,
            nonce: _nonce
        });

        if (_transferHistory.length < MAX_HISTORY) {
            _transferHistory.push(record);
        } else {
            // Overwrite oldest record (circular buffer)
            _transferHistory[_nonce % MAX_HISTORY] = record;
        }
    }
}
