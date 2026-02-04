/**
 * vault-contract.js — Contract Interaction Layer for AgentVault
 *
 * Thin wrapper around ethers.js for all AgentVault contract calls.
 * Embeds the ABI directly (no hardhat artifacts needed).
 *
 * @module vault-contract
 */

const { ethers } = require('ethers');

// ═══════════════════════════════════════════════════════════════════════════════
//  ABI — Matches IAgentVault.sol interface
// ═══════════════════════════════════════════════════════════════════════════════

const AGENT_VAULT_ABI = [
  // ── Structs (used in function returns) ──────────────────────────────────
  // Recipient struct is returned by getRecipient()

  // ── Events (V3) ────────────────────────────────────────────────────────
  "event TransferExecuted(address indexed to, uint256 amount, string memo, uint256 timestamp, uint256 nonce)",
  "event EmergencyDrain(address indexed to, uint256 amount)",
  "event MaxPerTransferUpdated(uint256 newMax)",
  "event TransferCooldownUpdated(uint256 newCooldown)",
  "event DeadmanDaysUpdated(uint256 newDays)",
  "event OwnerHeartbeatRecorded(uint256 timestamp)",
  "event AgentRotationProposed(address indexed newAgent, uint256 activationTime)",
  "event AgentRotationActivated(address indexed newAgent)",
  "event AgentRotationCancelled()",
  "event RecipientAdded(address indexed recipient, string label)",
  "event RecipientRemoved(address indexed recipient)",
  "event Deposited(address indexed from, uint256 amount)",

  // ── Owner Functions ─────────────────────────────────────────────────────
  "function addRecipient(address _recipient, string _label, string _purpose, uint256 _dailyLimit, uint256 _monthlyLimit) external",
  "function removeRecipient(address _recipient) external",
  "function updateLimits(address _recipient, uint256 _dailyLimit, uint256 _monthlyLimit) external",
  "function setAgent(address _agent) external",
  "function setDailyVaultLimit(uint256 _limit) external",
  "function emergencyWithdraw(address _to, uint256 _amount) external",
  "function pause() external",
  "function unpause() external",

  // ── V3 Owner Functions ──────────────────────────────────────────────────
  "function emergencyDrain() external",
  "function setMaxPerTransfer(uint256 _max) external",
  "function setTransferCooldown(uint256 _seconds) external",
  "function setDeadmanDays(uint256 _days) external",
  "function ownerHeartbeat() external",
  "function rotateAgent(address _newAgent) external",
  "function activateAgent() external",
  "function cancelAgentRotation() external",

  // ── Agent Functions (V3 — EIP-712 meta-tx) ──────────────────────────────
  "function executeTransfer(address _to, uint256 _amount, string _memo, uint256 _nonce, uint256 _deadline, bytes _signature) external",

  // ── Agent Functions (V1 — deprecated) ───────────────────────────────────
  "function agentTransfer(address _to, uint256 _amount, string _memo) external",

  // ── Public Functions ────────────────────────────────────────────────────
  "function deposit(uint256 _amount) external",

  // ── View Functions ──────────────────────────────────────────────────────
  "function getRecipient(address _recipient) external view returns (tuple(string label, string purpose, uint256 dailyLimit, uint256 monthlyLimit, uint256 dailySpent, uint256 monthlySpent, uint256 lastDayReset, uint256 lastMonthReset, bool active))",
  "function getRecipientList() external view returns (address[])",
  "function getVaultBalance() external view returns (uint256)",

  // ── V3 View Functions ──────────────────────────────────────────────────
  "function getTransferHistory(uint256 _count) external view returns (tuple(address to, uint256 amount, string memo, uint256 timestamp, uint256 nonce)[])",
  "function getPendingAgentRotation() external view returns (address newAgent, uint256 activationTime)",
  "function getDeadmanStatus() external view returns (bool triggered, uint256 lastHeartbeat, uint256 deadlineDays, uint256 secondsRemaining)",
  "function getRemainingDailyAllowance(address _recipient) external view returns (uint256)",
  "function getRemainingMonthlyAllowance(address _recipient) external view returns (uint256)",
  "function getDomainSeparator() external view returns (bytes32)",
  "function maxPerTransfer() external view returns (uint256)",
  "function transferCooldown() external view returns (uint256)",
  "function transferNonce() external view returns (uint256)",
  "function deadmanDays() external view returns (uint256)",
  "function lastOwnerHeartbeat() external view returns (uint256)",
  "function pendingAgent() external view returns (address)",
  "function pendingAgentActivation() external view returns (uint256)",

  // ── Standard ────────────────────────────────────────────────────────────
  "function owner() external view returns (address)",
  "function agent() external view returns (address)",
  "function paused() external view returns (bool)",
  "function usdc() external view returns (address)",
  "function dailyVaultLimit() external view returns (uint256)",
  "function dailyVaultSpent() external view returns (uint256)"
];

// ERC-20 ABI (for USDC approve/balance checks)
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)"
];

// USDC uses 6 decimals
const USDC_DECIMALS = 6;

// ═══════════════════════════════════════════════════════════════════════════════
//  VaultContract Class
// ═══════════════════════════════════════════════════════════════════════════════

class VaultContract {
  /**
   * @param {Object} options
   * @param {string} options.rpcUrl - Base Sepolia RPC URL
   * @param {string} options.privateKey - Agent's private key for signing
   * @param {string} options.contractAddress - Deployed AgentVault address
   * @param {string} [options.usdcAddress] - USDC contract address
   */
  constructor({ rpcUrl, privateKey, contractAddress, usdcAddress }) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.signer = new ethers.Wallet(privateKey, this.provider);
    this.contractAddress = contractAddress;
    this.usdcAddress = usdcAddress || '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

    this.contract = new ethers.Contract(contractAddress, AGENT_VAULT_ABI, this.signer);
    this.contractReadOnly = new ethers.Contract(contractAddress, AGENT_VAULT_ABI, this.provider);
    this.usdc = new ethers.Contract(this.usdcAddress, ERC20_ABI, this.signer);
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Helpers
  // ═══════════════════════════════════════════════════════════════════════

  /** Convert USD amount (float) to USDC on-chain units (6 decimals) */
  toUsdcUnits(amount) {
    return ethers.parseUnits(String(amount), USDC_DECIMALS);
  }

  /** Convert USDC on-chain units to human-readable USD string */
  fromUsdcUnits(units) {
    return ethers.formatUnits(units, USDC_DECIMALS);
  }

  /** Format as currency: "$1,234.56" */
  formatUsd(units) {
    const num = parseFloat(this.fromUsdcUnits(units));
    return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /** Get Base Sepolia explorer link for a tx */
  explorerLink(txHash) {
    return `https://sepolia.basescan.org/tx/${txHash}`;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Read Functions
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Get recipient details from the contract.
   * Automatically resets daily/monthly counters if period has elapsed.
   * @param {string} address - Recipient's Ethereum address
   * @returns {Object} Parsed recipient data with computed fields
   */
  async getRecipient(address) {
    try {
      const r = await this.contractReadOnly.getRecipient(address);
      const now = Math.floor(Date.now() / 1000);

      // Parse the struct
      const recipient = {
        label: r.label || r[0],
        purpose: r.purpose || r[1],
        dailyLimit: r.dailyLimit ?? r[2],
        monthlyLimit: r.monthlyLimit ?? r[3],
        dailySpent: r.dailySpent ?? r[4],
        monthlySpent: r.monthlySpent ?? r[5],
        lastDayReset: r.lastDayReset ?? r[6],
        lastMonthReset: r.lastMonthReset ?? r[7],
        active: r.active ?? r[8]
      };

      // Compute remaining allowances
      const oneDaySeconds = 86400;
      const oneMonthSeconds = 30 * 86400;

      // Check if daily counter should be conceptually reset
      const dayElapsed = now - Number(recipient.lastDayReset) >= oneDaySeconds;
      const monthElapsed = now - Number(recipient.lastMonthReset) >= oneMonthSeconds;

      const effectiveDailySpent = dayElapsed ? 0n : recipient.dailySpent;
      const effectiveMonthlySpent = monthElapsed ? 0n : recipient.monthlySpent;

      recipient.dailyRemaining = recipient.dailyLimit - effectiveDailySpent;
      recipient.monthlyRemaining = recipient.monthlyLimit - effectiveMonthlySpent;
      recipient.effectiveDailySpent = effectiveDailySpent;
      recipient.effectiveMonthlySpent = effectiveMonthlySpent;

      return recipient;
    } catch (err) {
      throw new VaultError(`Failed to get recipient ${address}: ${err.message}`, 'READ_ERROR');
    }
  }

  /**
   * Get list of all whitelisted recipient addresses.
   * @returns {string[]}
   */
  async getRecipientList() {
    try {
      return await this.contractReadOnly.getRecipientList();
    } catch (err) {
      throw new VaultError(`Failed to get recipient list: ${err.message}`, 'READ_ERROR');
    }
  }

  /**
   * Get vault's USDC balance.
   * @returns {bigint} Balance in USDC units (6 decimals)
   */
  async getVaultBalance() {
    try {
      return await this.contractReadOnly.getVaultBalance();
    } catch (err) {
      throw new VaultError(`Failed to get vault balance: ${err.message}`, 'READ_ERROR');
    }
  }

  /**
   * Check if the contract is paused.
   * @returns {boolean}
   */
  async isPaused() {
    try {
      return await this.contractReadOnly.paused();
    } catch (err) {
      // If paused() doesn't exist, assume not paused
      return false;
    }
  }

  /**
   * Get the daily vault-wide spending limit.
   * @returns {bigint}
   */
  async getDailyVaultLimit() {
    try {
      return await this.contractReadOnly.dailyVaultLimit();
    } catch (err) {
      return 0n;
    }
  }

  /**
   * Get today's vault-wide spending total.
   * @returns {bigint}
   */
  async getDailyVaultSpent() {
    try {
      return await this.contractReadOnly.dailyVaultSpent();
    } catch (err) {
      return 0n;
    }
  }

  /**
   * Get vault owner address.
   * @returns {string}
   */
  async getOwner() {
    try {
      return await this.contractReadOnly.owner();
    } catch (err) {
      throw new VaultError(`Failed to get owner: ${err.message}`, 'READ_ERROR');
    }
  }

  /**
   * Get current agent address.
   * @returns {string}
   */
  async getAgent() {
    try {
      return await this.contractReadOnly.agent();
    } catch (err) {
      throw new VaultError(`Failed to get agent: ${err.message}`, 'READ_ERROR');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Write Functions (Agent)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * [DEPRECATED] V1 agent transfer — use signAndExecuteTransfer() for V3.
   * Execute a USDC transfer from the vault to a recipient (V1 direct call).
   * Only callable by the agent.
   *
   * @deprecated Use signAndExecuteTransfer() instead (V3 EIP-712 meta-tx).
   * @param {string} to - Recipient address
   * @param {number|string} amount - Amount in USD (e.g. 200 = $200)
   * @param {string} memo - Transaction memo/reason
   * @returns {Object} { txHash, blockNumber, gasUsed, explorerUrl }
   */
  async agentTransfer(to, amount, memo) {
    try {
      const amountUnits = this.toUsdcUnits(amount);

      // Estimate gas first
      const gasEstimate = await this.contract.agentTransfer.estimateGas(to, amountUnits, memo);

      // Execute with 20% gas buffer
      const tx = await this.contract.agentTransfer(to, amountUnits, memo, {
        gasLimit: (gasEstimate * 120n) / 100n
      });

      const receipt = await tx.wait();

      return {
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        explorerUrl: this.explorerLink(receipt.hash),
        success: true
      };
    } catch (err) {
      throw this._parseError(err, 'TRANSFER_ERROR');
    }
  }

  /**
   * V3: Sign and execute a transfer using EIP-712 typed data signature.
   * This is the primary transfer method for V3 contracts.
   *
   * @param {string} to - Recipient address
   * @param {number|string} amount - Amount in USD (e.g. 200 = $200)
   * @param {string} memo - Transaction memo/reason
   * @returns {Object} { txHash, blockNumber, gasUsed, explorerUrl, success }
   */
  async signAndExecuteTransfer(to, amount, memo) {
    try {
      const amountUnits = this.toUsdcUnits(amount);
      const nonce = await this.contract.transferNonce();
      const latestBlock = await this.provider.getBlock('latest');
      const deadline = latestBlock.timestamp + 3600;

      const domain = {
        name: "AgentVaultV3",
        version: "1",
        chainId: 84532,
        verifyingContract: this.contractAddress,
      };
      const types = {
        Transfer: [
          { name: "to", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "memo", type: "string" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };
      const value = { to, amount: amountUnits, memo, nonce, deadline };
      const signature = await this.signer.signTypedData(domain, types, value);

      const tx = await this.contract.executeTransfer(to, amountUnits, memo, nonce, deadline, signature);
      const receipt = await tx.wait();
      return {
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        explorerUrl: this.explorerLink(receipt.hash),
        success: true
      };
    } catch (err) {
      throw this._parseError(err, 'TRANSFER_ERROR');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  V3 Read Functions
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * V3: Get on-chain transfer history.
   * @param {number} count - Number of recent transfers to retrieve
   * @returns {Array} Array of transfer records
   */
  async getTransferHistoryOnChain(count = 10) {
    try {
      const records = await this.contractReadOnly.getTransferHistory(count);
      return records.map(r => ({
        to: r.to || r[0],
        amount: r.amount ?? r[1],
        amountFormatted: this.formatUsd(r.amount ?? r[1]),
        memo: r.memo || r[2],
        timestamp: Number(r.timestamp ?? r[3]),
        date: new Date(Number(r.timestamp ?? r[3]) * 1000).toISOString(),
        nonce: Number(r.nonce ?? r[4])
      }));
    } catch (err) {
      throw new VaultError(`Failed to get on-chain transfer history: ${err.message}`, 'READ_ERROR');
    }
  }

  /**
   * V3: Get deadman switch status.
   * @returns {Object} { triggered, lastHeartbeat, deadlineDays, secondsRemaining }
   */
  async getDeadmanStatus() {
    try {
      const result = await this.contractReadOnly.getDeadmanStatus();
      return {
        triggered: result.triggered ?? result[0],
        lastHeartbeat: Number(result.lastHeartbeat ?? result[1]),
        deadlineDays: Number(result.deadlineDays ?? result[2]),
        secondsRemaining: Number(result.secondsRemaining ?? result[3])
      };
    } catch (err) {
      throw new VaultError(`Failed to get deadman status: ${err.message}`, 'READ_ERROR');
    }
  }

  /**
   * V3: Get pending agent rotation info.
   * @returns {Object} { newAgent, activationTime }
   */
  async getPendingAgentRotation() {
    try {
      const result = await this.contractReadOnly.getPendingAgentRotation();
      return {
        newAgent: result.newAgent ?? result[0],
        activationTime: Number(result.activationTime ?? result[1])
      };
    } catch (err) {
      throw new VaultError(`Failed to get pending agent rotation: ${err.message}`, 'READ_ERROR');
    }
  }

  /**
   * V3: Get remaining daily allowance for a recipient.
   * @param {string} address - Recipient address
   * @returns {bigint}
   */
  async getRemainingDailyAllowance(address) {
    try {
      return await this.contractReadOnly.getRemainingDailyAllowance(address);
    } catch (err) {
      throw new VaultError(`Failed to get daily allowance: ${err.message}`, 'READ_ERROR');
    }
  }

  /**
   * V3: Get remaining monthly allowance for a recipient.
   * @param {string} address - Recipient address
   * @returns {bigint}
   */
  async getRemainingMonthlyAllowance(address) {
    try {
      return await this.contractReadOnly.getRemainingMonthlyAllowance(address);
    } catch (err) {
      throw new VaultError(`Failed to get monthly allowance: ${err.message}`, 'READ_ERROR');
    }
  }

  /**
   * V3: Get max per-transfer cap.
   * @returns {bigint}
   */
  async getMaxPerTransfer() {
    try {
      return await this.contractReadOnly.maxPerTransfer();
    } catch (err) {
      return 0n;
    }
  }

  /**
   * V3: Get transfer cooldown period in seconds.
   * @returns {bigint}
   */
  async getTransferCooldown() {
    try {
      return await this.contractReadOnly.transferCooldown();
    } catch (err) {
      return 0n;
    }
  }

  /**
   * V3: Get current transfer nonce.
   * @returns {bigint}
   */
  async getTransferNonce() {
    try {
      return await this.contractReadOnly.transferNonce();
    } catch (err) {
      return 0n;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  V3 Write Functions (Owner)
  // ═══════════════════════════════════════════════════════════════════════

  /** V3: Emergency drain — withdraws all USDC to owner. */
  async emergencyDrain() {
    try {
      const tx = await this.contract.emergencyDrain();
      const receipt = await tx.wait();
      return { txHash: receipt.hash, explorerUrl: this.explorerLink(receipt.hash), success: true };
    } catch (err) {
      throw this._parseError(err, 'EMERGENCY_DRAIN_ERROR');
    }
  }

  /** V3: Record owner heartbeat for deadman switch. */
  async ownerHeartbeat() {
    try {
      const tx = await this.contract.ownerHeartbeat();
      const receipt = await tx.wait();
      return { txHash: receipt.hash, explorerUrl: this.explorerLink(receipt.hash), success: true };
    } catch (err) {
      throw this._parseError(err, 'HEARTBEAT_ERROR');
    }
  }

  /** V3: Propose agent rotation (timelock). */
  async rotateAgent(newAgent) {
    try {
      const tx = await this.contract.rotateAgent(newAgent);
      const receipt = await tx.wait();
      return { txHash: receipt.hash, explorerUrl: this.explorerLink(receipt.hash), success: true };
    } catch (err) {
      throw this._parseError(err, 'ROTATE_AGENT_ERROR');
    }
  }

  /** V3: Activate a pending agent rotation after timelock. */
  async activateAgent() {
    try {
      const tx = await this.contract.activateAgent();
      const receipt = await tx.wait();
      return { txHash: receipt.hash, explorerUrl: this.explorerLink(receipt.hash), success: true };
    } catch (err) {
      throw this._parseError(err, 'ACTIVATE_AGENT_ERROR');
    }
  }

  /** V3: Cancel a pending agent rotation. */
  async cancelAgentRotation() {
    try {
      const tx = await this.contract.cancelAgentRotation();
      const receipt = await tx.wait();
      return { txHash: receipt.hash, explorerUrl: this.explorerLink(receipt.hash), success: true };
    } catch (err) {
      throw this._parseError(err, 'CANCEL_ROTATION_ERROR');
    }
  }

  /** V3: Set maximum amount per transfer. */
  async setMaxPerTransfer(amount) {
    try {
      const tx = await this.contract.setMaxPerTransfer(this.toUsdcUnits(amount));
      const receipt = await tx.wait();
      return { txHash: receipt.hash, explorerUrl: this.explorerLink(receipt.hash), success: true };
    } catch (err) {
      throw this._parseError(err, 'SET_MAX_PER_TRANSFER_ERROR');
    }
  }

  /** V3: Set cooldown period between transfers (in seconds). */
  async setTransferCooldown(seconds) {
    try {
      const tx = await this.contract.setTransferCooldown(seconds);
      const receipt = await tx.wait();
      return { txHash: receipt.hash, explorerUrl: this.explorerLink(receipt.hash), success: true };
    } catch (err) {
      throw this._parseError(err, 'SET_COOLDOWN_ERROR');
    }
  }

  /** V3: Set deadman switch days. */
  async setDeadmanDays(days) {
    try {
      const tx = await this.contract.setDeadmanDays(days);
      const receipt = await tx.wait();
      return { txHash: receipt.hash, explorerUrl: this.explorerLink(receipt.hash), success: true };
    } catch (err) {
      throw this._parseError(err, 'SET_DEADMAN_DAYS_ERROR');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Write Functions (Owner) — V1
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Add a new recipient to the whitelist.
   * @param {string} address
   * @param {string} label - Human-readable name
   * @param {string} purpose - Category
   * @param {number} dailyLimit - Daily limit in USD
   * @param {number} monthlyLimit - Monthly limit in USD
   */
  async addRecipient(address, label, purpose, dailyLimit, monthlyLimit) {
    try {
      const tx = await this.contract.addRecipient(
        address, label, purpose,
        this.toUsdcUnits(dailyLimit),
        this.toUsdcUnits(monthlyLimit)
      );
      const receipt = await tx.wait();
      return { txHash: receipt.hash, explorerUrl: this.explorerLink(receipt.hash), success: true };
    } catch (err) {
      throw this._parseError(err, 'ADD_RECIPIENT_ERROR');
    }
  }

  /**
   * Remove a recipient from the whitelist.
   * @param {string} address
   */
  async removeRecipient(address) {
    try {
      const tx = await this.contract.removeRecipient(address);
      const receipt = await tx.wait();
      return { txHash: receipt.hash, explorerUrl: this.explorerLink(receipt.hash), success: true };
    } catch (err) {
      throw this._parseError(err, 'REMOVE_RECIPIENT_ERROR');
    }
  }

  /**
   * Update a recipient's spending limits.
   * @param {string} address
   * @param {number} dailyLimit - New daily limit in USD
   * @param {number} monthlyLimit - New monthly limit in USD
   */
  async updateLimits(address, dailyLimit, monthlyLimit) {
    try {
      const tx = await this.contract.updateLimits(
        address,
        this.toUsdcUnits(dailyLimit),
        this.toUsdcUnits(monthlyLimit)
      );
      const receipt = await tx.wait();
      return { txHash: receipt.hash, explorerUrl: this.explorerLink(receipt.hash), success: true };
    } catch (err) {
      throw this._parseError(err, 'UPDATE_LIMITS_ERROR');
    }
  }

  /**
   * Set a new agent address.
   * @param {string} newAgent
   */
  async setAgent(newAgent) {
    try {
      const tx = await this.contract.setAgent(newAgent);
      const receipt = await tx.wait();
      return { txHash: receipt.hash, explorerUrl: this.explorerLink(receipt.hash), success: true };
    } catch (err) {
      throw this._parseError(err, 'SET_AGENT_ERROR');
    }
  }

  /**
   * Emergency withdraw USDC from the vault.
   * @param {string} to - Destination address
   * @param {number} amount - Amount in USD
   */
  async emergencyWithdraw(to, amount) {
    try {
      const tx = await this.contract.emergencyWithdraw(to, this.toUsdcUnits(amount));
      const receipt = await tx.wait();
      return { txHash: receipt.hash, explorerUrl: this.explorerLink(receipt.hash), success: true };
    } catch (err) {
      throw this._parseError(err, 'EMERGENCY_WITHDRAW_ERROR');
    }
  }

  /** Pause the vault. */
  async pause() {
    try {
      const tx = await this.contract.pause();
      const receipt = await tx.wait();
      return { txHash: receipt.hash, success: true };
    } catch (err) {
      throw this._parseError(err, 'PAUSE_ERROR');
    }
  }

  /** Unpause the vault. */
  async unpause() {
    try {
      const tx = await this.contract.unpause();
      const receipt = await tx.wait();
      return { txHash: receipt.hash, success: true };
    } catch (err) {
      throw this._parseError(err, 'UNPAUSE_ERROR');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Public Functions
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Deposit USDC into the vault (requires prior approve).
   * @param {number} amount - Amount in USD
   */
  async deposit(amount) {
    try {
      const amountUnits = this.toUsdcUnits(amount);

      // Check and set allowance if needed
      const currentAllowance = await this.usdc.allowance(
        this.signer.address,
        this.contractAddress
      );
      if (currentAllowance < amountUnits) {
        const approveTx = await this.usdc.approve(this.contractAddress, amountUnits);
        await approveTx.wait();
      }

      const tx = await this.contract.deposit(amountUnits);
      const receipt = await tx.wait();
      return { txHash: receipt.hash, explorerUrl: this.explorerLink(receipt.hash), success: true };
    } catch (err) {
      throw this._parseError(err, 'DEPOSIT_ERROR');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Events / History
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Get transfer history from contract events.
   * @param {Object} options
   * @param {string} [options.recipient] - Filter by recipient address
   * @param {number} [options.fromBlock=0] - Start block
   * @param {number} [options.toBlock='latest'] - End block
   * @param {number} [options.limit=50] - Max events to return
   * @returns {Array} Parsed transfer events
   */
  async getTransferHistory(options = {}) {
    try {
      const { recipient, fromBlock = 0, toBlock = 'latest', limit = 50 } = options;

      const filter = this.contractReadOnly.filters.TransferExecuted(recipient || null);
      const events = await this.contractReadOnly.queryFilter(filter, fromBlock, toBlock);

      // Parse and return most recent first
      const parsed = events
        .map(event => ({
          to: event.args[0],
          amount: event.args[1],
          amountFormatted: this.formatUsd(event.args[1]),
          memo: event.args[2],
          timestamp: Number(event.args[3]),
          date: new Date(Number(event.args[3]) * 1000).toISOString(),
          txHash: event.transactionHash,
          blockNumber: event.blockNumber,
          explorerUrl: this.explorerLink(event.transactionHash)
        }))
        .reverse()
        .slice(0, limit);

      return parsed;
    } catch (err) {
      throw new VaultError(`Failed to get transfer history: ${err.message}`, 'EVENT_ERROR');
    }
  }

  /**
   * Get deposit events.
   */
  async getDepositHistory(fromBlock = 0) {
    try {
      const filter = this.contractReadOnly.filters.Deposited();
      const events = await this.contractReadOnly.queryFilter(filter, fromBlock);
      return events.map(event => ({
        from: event.args[0],
        amount: event.args[1],
        amountFormatted: this.formatUsd(event.args[1]),
        txHash: event.transactionHash,
        blockNumber: event.blockNumber
      })).reverse();
    } catch (err) {
      throw new VaultError(`Failed to get deposit history: ${err.message}`, 'EVENT_ERROR');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Error Handling
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Parse contract errors into human-readable messages.
   */
  _parseError(err, code) {
    const message = err.message || String(err);

    // Common Solidity revert reasons (V1 + V3)
    const revertPatterns = {
      'not the agent': 'Only the authorized agent can execute transfers.',
      'not the owner': 'Only the vault owner can perform this action.',
      'not active': 'This recipient is not active or not whitelisted.',
      'daily limit': 'This transfer would exceed the recipient\'s daily limit.',
      'monthly limit': 'This transfer would exceed the recipient\'s monthly limit.',
      'vault daily limit': 'This transfer would exceed the vault\'s daily spending limit.',
      'insufficient balance': 'The vault doesn\'t have enough USDC for this transfer.',
      'paused': 'The vault is currently paused. No transfers can be made.',
      'zero address': 'Invalid address provided.',
      'already exists': 'This recipient is already whitelisted.',
      'ERC20: insufficient allowance': 'USDC allowance too low. Please approve first.',
      'ERC20: transfer amount exceeds balance': 'Insufficient USDC balance.',
      // V3-specific revert reasons
      'signature expired': 'The EIP-712 signature has expired. Please retry the transfer.',
      'invalid nonce': 'Invalid transfer nonce. The nonce may have been used already.',
      'deadman switch triggered': 'The deadman switch has been triggered. The vault owner must send a heartbeat.',
      'transfer cooldown active': 'Transfer cooldown is active. Please wait before making another transfer.',
      'exceeds per-transfer cap': 'This amount exceeds the per-transfer maximum cap.',
      'invalid signature': 'The EIP-712 signature is invalid. Agent key mismatch or corrupted data.'
    };

    for (const [pattern, humanMessage] of Object.entries(revertPatterns)) {
      if (message.toLowerCase().includes(pattern.toLowerCase())) {
        throw new VaultError(humanMessage, code);
      }
    }

    throw new VaultError(`Transaction failed: ${message}`, code);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Custom Error Class
// ═══════════════════════════════════════════════════════════════════════════════

class VaultError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'VaultError';
    this.code = code;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Exports
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = { VaultContract, VaultError, AGENT_VAULT_ABI, ERC20_ABI, USDC_DECIMALS };
