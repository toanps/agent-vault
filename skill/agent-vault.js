/**
 * agent-vault.js — Main Skill Logic for AgentVault
 *
 * The core module that Clawdbot uses to manage an AI-powered USDC wealth
 * vault on Base Sepolia. Orchestrates condition evaluation, contract
 * interaction, and chat-friendly response formatting.
 *
 * @module agent-vault
 */

const { VaultContract, VaultError } = require('./vault-contract');
const { ConditionEngine } = require('./condition-engine');

// ═══════════════════════════════════════════════════════════════════════════════
//  AgentVaultManager
// ═══════════════════════════════════════════════════════════════════════════════

class AgentVaultManager {
  /**
   * @param {Object} config - Full configuration object (from config.json)
   * @param {string} config.rpcUrl - Base Sepolia RPC URL
   * @param {string} config.agentPrivateKey - Agent's private key
   * @param {string} config.contractAddress - Deployed AgentVault contract
   * @param {string} [config.usdcAddress] - USDC token address
   * @param {Object} config.recipients - Recipient config map (address → details)
   * @param {string[]} [config.globalRules] - Global vault rules
   * @param {Object} [config.ownerNotification] - Notification preferences
   */
  constructor(config) {
    this.config = config;

    // Initialize contract layer
    this.vault = new VaultContract({
      rpcUrl: config.rpcUrl,
      privateKey: config.agentPrivateKey,
      contractAddress: config.contractAddress,
      usdcAddress: config.usdcAddress
    });

    // Build per-recipient condition engines
    this.recipientEngines = {};
    for (const [address, details] of Object.entries(config.recipients || {})) {
      const normalizedAddr = address.toLowerCase();
      this.recipientEngines[normalizedAddr] = {
        engine: new ConditionEngine(details.conditions || []),
        config: details
      };
    }

    this.globalRules = config.globalRules || [];
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Core: Process a Fund Request
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Process a funding request from a recipient via chat.
   *
   * @param {string} senderAddress - Recipient's Ethereum address
   * @param {number} amount - Amount requested in USD
   * @param {string} reason - Reason / purpose for the request
   * @param {Object} [chatContext] - Additional context from the chat
   * @param {string} [chatContext.telegramId] - Sender's Telegram ID
   * @param {string} [chatContext.messageId] - Original message ID
   *
   * @returns {Object} Result with one of:
   *   - { approved: true, txHash, explorerUrl, message }
   *   - { approved: false, denied: true, message }
   *   - { approved: false, needsEscalation: true, message }
   */
  async processRequest(senderAddress, amount, reason, chatContext = {}) {
    const normalizedAddr = senderAddress.toLowerCase();

    try {
      // ── Step 1: Check if sender is whitelisted ──────────────────────
      const recipientEntry = this.recipientEngines[normalizedAddr];
      if (!recipientEntry) {
        return this._formatDenial({
          amount,
          reason,
          senderAddress,
          denyReason: 'Address is not whitelisted in this vault.',
          suggestion: 'Ask the vault owner to add you as a recipient.'
        });
      }

      const { engine, config: recipientConfig } = recipientEntry;

      // ── Step 2: Check if vault is paused ────────────────────────────
      const isPaused = await this.vault.isPaused();
      if (isPaused) {
        return this._formatDenial({
          amount,
          reason,
          label: recipientConfig.label,
          senderAddress,
          denyReason: 'The vault is currently paused by the owner.',
          suggestion: 'Please try again later or contact the vault owner.'
        });
      }

      // ── Step 3: Fetch on-chain recipient data ───────────────────────
      const onchain = await this.vault.getRecipient(senderAddress);
      if (!onchain.active) {
        return this._formatDenial({
          amount,
          reason,
          label: recipientConfig.label,
          senderAddress,
          denyReason: 'Your account has been deactivated in the vault contract.',
          suggestion: 'Contact the vault owner.'
        });
      }

      // ── Step 4: Check on-chain limits ───────────────────────────────
      const dailyRemaining = parseFloat(this.vault.fromUsdcUnits(onchain.dailyRemaining));
      const monthlyRemaining = parseFloat(this.vault.fromUsdcUnits(onchain.monthlyRemaining));

      if (amount > dailyRemaining) {
        return this._formatDenial({
          amount,
          reason,
          label: recipientConfig.label,
          senderAddress,
          denyReason: `Would exceed your daily limit. Remaining today: $${dailyRemaining.toFixed(2)}.`,
          dailyInfo: this._formatLimitInfo(onchain)
        });
      }

      if (amount > monthlyRemaining) {
        return this._formatDenial({
          amount,
          reason,
          label: recipientConfig.label,
          senderAddress,
          denyReason: `Would exceed your monthly limit. Remaining this month: $${monthlyRemaining.toFixed(2)}.`,
          dailyInfo: this._formatLimitInfo(onchain)
        });
      }

      // ── Step 5: Check vault balance ─────────────────────────────────
      const vaultBalance = await this.vault.getVaultBalance();
      const vaultBalanceUsd = parseFloat(this.vault.fromUsdcUnits(vaultBalance));
      if (amount > vaultBalanceUsd) {
        return this._formatDenial({
          amount,
          reason,
          label: recipientConfig.label,
          senderAddress,
          denyReason: `Insufficient vault balance. Available: $${vaultBalanceUsd.toFixed(2)}.`
        });
      }

      // ── Step 6: Evaluate global rules ───────────────────────────────
      let dailyVaultSpent = 0;
      try {
        const spent = await this.vault.getDailyVaultSpent();
        dailyVaultSpent = parseFloat(this.vault.fromUsdcUnits(spent));
      } catch (e) { /* may not exist in all implementations */ }

      const globalResult = ConditionEngine.evaluateGlobalRules(
        { amount, dailyVaultSpent },
        this.globalRules
      );

      if (globalResult) {
        if (globalResult.needsEscalation) {
          return this._formatEscalation({
            amount,
            reason,
            label: recipientConfig.label,
            senderAddress,
            escalationReason: globalResult.reason,
            matchedRule: globalResult.matchedRule
          });
        }
        if (globalResult.denied) {
          return this._formatDenial({
            amount,
            reason,
            label: recipientConfig.label,
            senderAddress,
            denyReason: globalResult.reason,
            matchedRule: globalResult.matchedRule
          });
        }
      }

      // ── Step 7: Evaluate per-recipient conditions ───────────────────
      const history = {
        dailySpent: parseFloat(this.vault.fromUsdcUnits(onchain.effectiveDailySpent)),
        monthlySpent: parseFloat(this.vault.fromUsdcUnits(onchain.effectiveMonthlySpent)),
        weeklySpent: parseFloat(this.vault.fromUsdcUnits(onchain.effectiveMonthlySpent)) / 4, // Estimate
        dailyLimit: parseFloat(this.vault.fromUsdcUnits(onchain.dailyLimit)),
        monthlyLimit: parseFloat(this.vault.fromUsdcUnits(onchain.monthlyLimit))
      };

      const conditionResult = engine.evaluate({
        address: senderAddress,
        amount,
        reason: reason || '',
        purpose: recipientConfig.purpose || '',
        history
      });

      if (conditionResult.needsEscalation) {
        return this._formatEscalation({
          amount,
          reason,
          label: recipientConfig.label,
          senderAddress,
          escalationReason: conditionResult.reason,
          matchedRule: conditionResult.matchedRule
        });
      }

      if (conditionResult.denied || !conditionResult.approved) {
        return this._formatDenial({
          amount,
          reason,
          label: recipientConfig.label,
          senderAddress,
          denyReason: conditionResult.reason,
          matchedRule: conditionResult.matchedRule,
          dailyInfo: this._formatLimitInfo(onchain)
        });
      }

      // ── Step 8: Execute the transfer ────────────────────────────────
      const memo = this._buildMemo(reason, recipientConfig.label);
      const txResult = await this.vault.agentTransfer(senderAddress, amount, memo);

      // ── Step 9: Format success response ─────────────────────────────
      return this._formatApproval({
        amount,
        reason,
        label: recipientConfig.label,
        senderAddress,
        txHash: txResult.txHash,
        explorerUrl: txResult.explorerUrl,
        conditionReason: conditionResult.reason,
        onchain,
        amountSpentAfter: history.dailySpent + amount,
        monthlySpentAfter: history.monthlySpent + amount
      });

    } catch (err) {
      if (err instanceof VaultError) {
        return {
          approved: false,
          denied: true,
          error: true,
          message: `⚠️ Transaction Error\n\n${err.message}\n\nError code: ${err.code}`
        };
      }
      return {
        approved: false,
        denied: true,
        error: true,
        message: `⚠️ Unexpected Error\n\n${err.message}`
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Vault Status
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Get comprehensive vault status.
   * @returns {Object} { balance, recipientCount, recipients, dailySpent, dailyLimit, formatted }
   */
  async getVaultStatus() {
    try {
      const balance = await this.vault.getVaultBalance();
      const recipientAddresses = await this.vault.getRecipientList();
      const isPaused = await this.vault.isPaused();

      let dailyVaultSpent = 0n;
      let dailyVaultLimit = 0n;
      try {
        dailyVaultSpent = await this.vault.getDailyVaultSpent();
        dailyVaultLimit = await this.vault.getDailyVaultLimit();
      } catch (e) { /* optional fields */ }

      // Fetch all recipient details
      const recipients = [];
      for (const addr of recipientAddresses) {
        try {
          const onchain = await this.vault.getRecipient(addr);
          const normalizedAddr = addr.toLowerCase();
          const offchain = this.recipientEngines[normalizedAddr]?.config || {};

          recipients.push({
            address: addr,
            label: offchain.label || onchain.label,
            purpose: offchain.purpose || onchain.purpose,
            dailyLimit: this.vault.formatUsd(onchain.dailyLimit),
            monthlyLimit: this.vault.formatUsd(onchain.monthlyLimit),
            dailySpent: this.vault.formatUsd(onchain.effectiveDailySpent),
            monthlySpent: this.vault.formatUsd(onchain.effectiveMonthlySpent),
            dailyRemaining: this.vault.formatUsd(onchain.dailyRemaining),
            monthlyRemaining: this.vault.formatUsd(onchain.monthlyRemaining),
            active: onchain.active
          });
        } catch (e) {
          recipients.push({ address: addr, error: e.message });
        }
      }

      // Format for Telegram
      let formatted = `🏦 AgentVault Status${isPaused ? ' ⏸️ PAUSED' : ''}\n\n`;
      formatted += `💰 Balance: ${this.vault.formatUsd(balance)} USDC\n`;

      if (dailyVaultLimit > 0n) {
        formatted += `📊 Today's spending: ${this.vault.formatUsd(dailyVaultSpent)} / ${this.vault.formatUsd(dailyVaultLimit)} limit\n`;
      }

      formatted += `👥 Active recipients: ${recipients.filter(r => r.active).length}\n\n`;

      for (const r of recipients) {
        if (r.error) {
          formatted += `⚠️ ${r.address.slice(0, 8)}... — Error: ${r.error}\n\n`;
          continue;
        }
        formatted += `👤 ${r.label} (${r.purpose})${r.active ? '' : ' ❌ INACTIVE'}\n`;
        formatted += `   Daily: ${r.dailySpent}/${r.dailyLimit} | Monthly: ${r.monthlySpent}/${r.monthlyLimit}\n\n`;
      }

      return {
        balance: this.vault.formatUsd(balance),
        balanceRaw: balance,
        recipientCount: recipientAddresses.length,
        recipients,
        isPaused,
        formatted
      };
    } catch (err) {
      throw new VaultError(`Failed to get vault status: ${err.message}`, 'STATUS_ERROR');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Recipient Info
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Get detailed info about a specific recipient.
   * @param {string} address
   * @returns {Object} Detailed recipient info with formatted output
   */
  async getRecipientInfo(address) {
    try {
      const onchain = await this.vault.getRecipient(address);
      const normalizedAddr = address.toLowerCase();
      const offchain = this.recipientEngines[normalizedAddr]?.config || {};
      const conditions = offchain.conditions || [];

      const info = {
        address,
        label: offchain.label || onchain.label,
        purpose: offchain.purpose || onchain.purpose,
        telegramId: offchain.telegramId,
        active: onchain.active,
        limits: {
          daily: this.vault.formatUsd(onchain.dailyLimit),
          monthly: this.vault.formatUsd(onchain.monthlyLimit)
        },
        spent: {
          daily: this.vault.formatUsd(onchain.effectiveDailySpent),
          monthly: this.vault.formatUsd(onchain.effectiveMonthlySpent)
        },
        remaining: {
          daily: this.vault.formatUsd(onchain.dailyRemaining),
          monthly: this.vault.formatUsd(onchain.monthlyRemaining)
        },
        conditions
      };

      // Format for Telegram
      let formatted = `👤 ${info.label}\n`;
      formatted += `📋 Purpose: ${info.purpose}\n`;
      formatted += `${info.active ? '✅ Active' : '❌ Inactive'}\n\n`;
      formatted += `📊 Spending:\n`;
      formatted += `   Daily:   ${info.spent.daily} / ${info.limits.daily} (${info.remaining.daily} left)\n`;
      formatted += `   Monthly: ${info.spent.monthly} / ${info.limits.monthly} (${info.remaining.monthly} left)\n\n`;

      if (conditions.length > 0) {
        formatted += `📜 Conditions:\n`;
        conditions.forEach((c, i) => {
          formatted += `   ${i + 1}. ${c}\n`;
        });
      }

      info.formatted = formatted;
      return info;
    } catch (err) {
      throw new VaultError(`Failed to get recipient info: ${err.message}`, 'RECIPIENT_ERROR');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Transaction History
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Get transaction history with formatted output.
   * @param {Object} [options]
   * @param {string} [options.recipient] - Filter by recipient address
   * @param {number} [options.fromBlock]
   * @param {number} [options.limit=20]
   * @returns {Object} { transactions, formatted }
   */
  async getTransactionHistory(options = {}) {
    try {
      const { recipient, fromBlock = 0, limit = 20 } = options;
      const txs = await this.vault.getTransferHistory({ recipient, fromBlock, limit });

      let formatted = `📜 Transaction History (${txs.length} transfers)\n\n`;

      if (txs.length === 0) {
        formatted += 'No transfers found.';
      } else {
        for (const tx of txs) {
          const normalizedAddr = tx.to.toLowerCase();
          const label = this.recipientEngines[normalizedAddr]?.config?.label || tx.to.slice(0, 10) + '...';
          const date = new Date(tx.timestamp * 1000);
          const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

          formatted += `💸 ${tx.amountFormatted} → ${label}\n`;
          formatted += `   📝 ${tx.memo}\n`;
          formatted += `   🕐 ${dateStr} ${timeStr}\n`;
          formatted += `   🔗 ${tx.explorerUrl}\n\n`;
        }
      }

      return { transactions: txs, formatted };
    } catch (err) {
      throw new VaultError(`Failed to get transaction history: ${err.message}`, 'HISTORY_ERROR');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Resolve Telegram ID → Address
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Find a recipient address by Telegram ID.
   * @param {string} telegramId
   * @returns {Object|null} { address, label, config } or null
   */
  resolveByTelegramId(telegramId) {
    for (const [address, details] of Object.entries(this.config.recipients || {})) {
      if (details.telegramId === telegramId) {
        return { address, label: details.label, config: details };
      }
    }
    return null;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Internal: Response Formatters (Telegram-friendly)
  // ═══════════════════════════════════════════════════════════════════════

  _formatApproval({ amount, reason, label, senderAddress, txHash, explorerUrl, conditionReason, onchain, amountSpentAfter, monthlySpentAfter }) {
    const dailyLimit = parseFloat(this.vault.fromUsdcUnits(onchain.dailyLimit));
    const monthlyLimit = parseFloat(this.vault.fromUsdcUnits(onchain.monthlyLimit));

    let message = `✅ Transfer Approved\n\n`;
    message += `💰 Amount: $${amount.toFixed(2)} USDC\n`;
    message += `👤 To: ${label}\n`;
    message += `📝 Reason: ${reason || 'N/A'}\n`;
    message += `🔗 TX: ${explorerUrl}\n\n`;

    if (conditionReason) {
      message += `📋 ${conditionReason}\n`;
    }

    message += `📊 Daily: $${amountSpentAfter.toFixed(2)}/$${dailyLimit.toFixed(2)} | `;
    message += `Monthly: $${monthlySpentAfter.toFixed(2)}/$${monthlyLimit.toFixed(2)}`;

    return {
      approved: true,
      denied: false,
      needsEscalation: false,
      txHash,
      explorerUrl,
      message
    };
  }

  _formatDenial({ amount, reason, label, senderAddress, denyReason, matchedRule, dailyInfo, suggestion }) {
    let message = `❌ Transfer Denied\n\n`;
    message += `💰 Requested: $${amount.toFixed(2)} USDC\n`;
    if (label) message += `👤 From: ${label}\n`;
    if (reason) message += `📝 Reason: ${reason}\n`;
    message += `🚫 ${denyReason}\n`;

    if (matchedRule) {
      message += `📋 Rule: "${matchedRule}"\n`;
    }

    if (dailyInfo) {
      message += `\n${dailyInfo}`;
    }

    if (suggestion) {
      message += `\n💡 ${suggestion}`;
    }

    return {
      approved: false,
      denied: true,
      needsEscalation: false,
      message
    };
  }

  _formatEscalation({ amount, reason, label, senderAddress, escalationReason, matchedRule }) {
    let message = `⏳ Escalation Required\n\n`;
    message += `💰 Amount: $${amount.toFixed(2)} USDC\n`;
    message += `👤 From: ${label}\n`;
    message += `📝 Reason: ${reason || 'N/A'}\n`;
    message += `📋 Rule: "${matchedRule || 'Escalation threshold'}"\n\n`;
    message += `${escalationReason}\n\n`;
    message += `I've notified the vault owner for approval. I'll let you know once they respond!`;

    // Owner notification message
    const ownerMessage = `🔔 Approval needed: ${label} requests $${amount.toFixed(2)} for "${reason || 'unspecified'}". Reply "approve" or "deny".`;

    return {
      approved: false,
      denied: false,
      needsEscalation: true,
      message,
      ownerMessage,
      pendingRequest: { senderAddress, amount, reason, label }
    };
  }

  _formatLimitInfo(onchain) {
    const dailySpent = this.vault.formatUsd(onchain.effectiveDailySpent);
    const dailyLimit = this.vault.formatUsd(onchain.dailyLimit);
    const dailyRemaining = this.vault.formatUsd(onchain.dailyRemaining);
    const monthlyRemaining = this.vault.formatUsd(onchain.monthlyRemaining);

    return `💡 Daily: ${dailySpent}/${dailyLimit} used. Remaining today: ${dailyRemaining}. Monthly remaining: ${monthlyRemaining}.`;
  }

  _buildMemo(reason, label) {
    const truncatedReason = (reason || 'No reason provided').slice(0, 80);
    return `${label}: ${truncatedReason}`;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Exports
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = { AgentVaultManager };
