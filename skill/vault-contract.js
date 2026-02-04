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

  // ── Events ──────────────────────────────────────────────────────────────
  "event TransferExecuted(address indexed to, uint256 amount, string memo, uint256 timestamp)",
  "event RecipientAdded(address indexed recipient, string label)",
  "event RecipientRemoved(address indexed recipient)",
  "event AgentUpdated(address indexed newAgent)",
  "event Deposited(address indexed from, uint256 amount)",
  "event DailyVaultLimitUpdated(uint256 newLimit)",

  // ── Owner Functions ─────────────────────────────────────────────────────
  "function addRecipient(address _recipient, string _label, string _purpose, uint256 _dailyLimit, uint256 _monthlyLimit) external",
  "function removeRecipient(address _recipient) external",
  "function updateLimits(address _recipient, uint256 _dailyLimit, uint256 _monthlyLimit) external",
  "function setAgent(address _agent) external",
  "function setDailyVaultLimit(uint256 _limit) external",
  "function emergencyWithdraw(address _to, uint256 _amount) external",
  "function pause() external",
  "function unpause() external",

  // ── Agent Functions ─────────────────────────────────────────────────────
  "function agentTransfer(address _to, uint256 _amount, string _memo) external",

  // ── Public Functions ────────────────────────────────────────────────────
  "function deposit(uint256 _amount) external",

  // ── View Functions ──────────────────────────────────────────────────────
  "function getRecipient(address _recipient) external view returns (tuple(string label, string purpose, uint256 dailyLimit, uint256 monthlyLimit, uint256 dailySpent, uint256 monthlySpent, uint256 lastDayReset, uint256 lastMonthReset, bool active))",
  "function getRecipientList() external view returns (address[])",
  "function getVaultBalance() external view returns (uint256)",

  // ── Standard (likely present in implementation) ─────────────────────────
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
   * Execute a USDC transfer from the vault to a recipient.
   * Only callable by the agent.
   *
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

  // ═══════════════════════════════════════════════════════════════════════
  //  Write Functions (Owner)
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

    // Common Solidity revert reasons
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
      'ERC20: transfer amount exceeds balance': 'Insufficient USDC balance.'
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
