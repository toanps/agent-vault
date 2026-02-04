const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║                  AgentVault Test Suite                        ║
 * ║          Comprehensive tests for AI-managed USDC vault       ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */
describe("AgentVault", function () {
  // ── Test constants ──
  const USDC_DECIMALS = 6;
  const toUSDC = (amount) => ethers.parseUnits(amount.toString(), USDC_DECIMALS);

  const DAILY_VAULT_LIMIT = toUSDC(10_000);   // $10,000/day vault-wide
  const DAILY_LIMIT = toUSDC(500);             // $500/day per recipient
  const MONTHLY_LIMIT = toUSDC(5_000);         // $5,000/month per recipient

  const DAY = 86400;     // 1 day in seconds
  const MONTH = 30 * DAY; // 30 days in seconds

  // ── Test accounts ──
  let owner, agent, alice, bob, stranger, treasury;
  let vault, usdc;

  /**
   * Deploy a mock USDC token and the AgentVault before each test
   */
  beforeEach(async function () {
    [owner, agent, alice, bob, stranger, treasury] = await ethers.getSigners();

    // Deploy mock USDC (standard ERC20)
    const MockERC20 = await ethers.getContractFactory("MockUSDC");
    usdc = await MockERC20.deploy("USD Coin", "USDC", USDC_DECIMALS);
    await usdc.waitForDeployment();

    // Deploy AgentVault
    const AgentVault = await ethers.getContractFactory("AgentVault");
    vault = await AgentVault.deploy(await usdc.getAddress(), DAILY_VAULT_LIMIT);
    await vault.waitForDeployment();

    // Set agent
    await vault.setAgent(agent.address);

    // Mint USDC to owner and deposit into vault
    await usdc.mint(owner.address, toUSDC(100_000));
    await usdc.approve(await vault.getAddress(), toUSDC(50_000));
    await vault.deposit(toUSDC(50_000));
  });

  // ═══════════════════════════════════════════════════════════════════════
  //                        DEPLOYMENT & ROLES
  // ═══════════════════════════════════════════════════════════════════════

  describe("Deployment", function () {
    it("should set the correct owner", async function () {
      expect(await vault.owner()).to.equal(owner.address);
    });

    it("should set the correct agent", async function () {
      expect(await vault.agent()).to.equal(agent.address);
    });

    it("should set the correct USDC address", async function () {
      expect(await vault.usdc()).to.equal(await usdc.getAddress());
    });

    it("should set the correct daily vault limit", async function () {
      expect(await vault.dailyVaultLimit()).to.equal(DAILY_VAULT_LIMIT);
    });

    it("should have the correct initial balance", async function () {
      expect(await vault.getVaultBalance()).to.equal(toUSDC(50_000));
    });

    it("should revert with zero USDC address", async function () {
      const AgentVault = await ethers.getContractFactory("AgentVault");
      await expect(
        AgentVault.deploy(ethers.ZeroAddress, DAILY_VAULT_LIMIT)
      ).to.be.revertedWith("AgentVault: invalid USDC address");
    });

    it("should revert with zero daily vault limit", async function () {
      const AgentVault = await ethers.getContractFactory("AgentVault");
      await expect(
        AgentVault.deploy(await usdc.getAddress(), 0)
      ).to.be.revertedWith("AgentVault: invalid daily vault limit");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //                      RECIPIENT MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════

  describe("Recipient Management", function () {
    it("should add a recipient", async function () {
      await expect(
        vault.addRecipient(alice.address, "Wife - Alice", "household", DAILY_LIMIT, MONTHLY_LIMIT)
      ).to.emit(vault, "RecipientAdded")
        .withArgs(alice.address, "Wife - Alice");

      const recipient = await vault.getRecipient(alice.address);
      expect(recipient.label).to.equal("Wife - Alice");
      expect(recipient.purpose).to.equal("household");
      expect(recipient.dailyLimit).to.equal(DAILY_LIMIT);
      expect(recipient.monthlyLimit).to.equal(MONTHLY_LIMIT);
      expect(recipient.active).to.be.true;
    });

    it("should return the recipient list", async function () {
      await vault.addRecipient(alice.address, "Alice", "household", DAILY_LIMIT, MONTHLY_LIMIT);
      await vault.addRecipient(bob.address, "Bob", "allowance", DAILY_LIMIT, MONTHLY_LIMIT);

      const list = await vault.getRecipientList();
      expect(list.length).to.equal(2);
      expect(list[0]).to.equal(alice.address);
      expect(list[1]).to.equal(bob.address);
    });

    it("should revert adding duplicate recipient", async function () {
      await vault.addRecipient(alice.address, "Alice", "household", DAILY_LIMIT, MONTHLY_LIMIT);
      await expect(
        vault.addRecipient(alice.address, "Alice2", "other", DAILY_LIMIT, MONTHLY_LIMIT)
      ).to.be.revertedWith("AgentVault: recipient already exists");
    });

    it("should revert adding recipient with zero address", async function () {
      await expect(
        vault.addRecipient(ethers.ZeroAddress, "Nobody", "n/a", DAILY_LIMIT, MONTHLY_LIMIT)
      ).to.be.revertedWith("AgentVault: invalid recipient address");
    });

    it("should revert if monthly limit < daily limit", async function () {
      await expect(
        vault.addRecipient(alice.address, "Alice", "household", MONTHLY_LIMIT, DAILY_LIMIT)
      ).to.be.revertedWith("AgentVault: monthly limit must be >= daily limit");
    });

    it("should remove (deactivate) a recipient", async function () {
      await vault.addRecipient(alice.address, "Alice", "household", DAILY_LIMIT, MONTHLY_LIMIT);
      await expect(vault.removeRecipient(alice.address))
        .to.emit(vault, "RecipientRemoved")
        .withArgs(alice.address);

      const recipient = await vault.getRecipient(alice.address);
      expect(recipient.active).to.be.false;
    });

    it("should revert removing non-existent recipient", async function () {
      await expect(
        vault.removeRecipient(alice.address)
      ).to.be.revertedWith("AgentVault: recipient does not exist");
    });

    it("should update limits", async function () {
      await vault.addRecipient(alice.address, "Alice", "household", DAILY_LIMIT, MONTHLY_LIMIT);

      const newDaily = toUSDC(1_000);
      const newMonthly = toUSDC(10_000);
      await vault.updateLimits(alice.address, newDaily, newMonthly);

      const recipient = await vault.getRecipient(alice.address);
      expect(recipient.dailyLimit).to.equal(newDaily);
      expect(recipient.monthlyLimit).to.equal(newMonthly);
    });

    it("should only allow owner to add recipients", async function () {
      await expect(
        vault.connect(agent).addRecipient(alice.address, "Alice", "household", DAILY_LIMIT, MONTHLY_LIMIT)
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });

    it("should only allow owner to remove recipients", async function () {
      await vault.addRecipient(alice.address, "Alice", "household", DAILY_LIMIT, MONTHLY_LIMIT);
      await expect(
        vault.connect(stranger).removeRecipient(alice.address)
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //                        AGENT TRANSFERS
  // ═══════════════════════════════════════════════════════════════════════

  describe("Agent Transfers", function () {
    beforeEach(async function () {
      await vault.addRecipient(alice.address, "Wife - Alice", "household", DAILY_LIMIT, MONTHLY_LIMIT);
      await vault.addRecipient(bob.address, "Son - Bob", "allowance", toUSDC(200), toUSDC(2_000));
    });

    it("should execute a transfer within limits", async function () {
      const amount = toUSDC(100);
      await expect(
        vault.connect(agent).agentTransfer(alice.address, amount, "Groceries")
      ).to.emit(vault, "TransferExecuted");

      // Check Alice received USDC
      expect(await usdc.balanceOf(alice.address)).to.equal(amount);

      // Check vault balance decreased
      expect(await vault.getVaultBalance()).to.equal(toUSDC(50_000) - amount);

      // Check spend tracking
      const recipient = await vault.getRecipient(alice.address);
      expect(recipient.dailySpent).to.equal(amount);
      expect(recipient.monthlySpent).to.equal(amount);
    });

    it("should allow multiple transfers within daily limit", async function () {
      await vault.connect(agent).agentTransfer(alice.address, toUSDC(200), "Groceries");
      await vault.connect(agent).agentTransfer(alice.address, toUSDC(200), "Utilities");

      const recipient = await vault.getRecipient(alice.address);
      expect(recipient.dailySpent).to.equal(toUSDC(400));
    });

    it("should revert when exceeding daily limit", async function () {
      await vault.connect(agent).agentTransfer(alice.address, toUSDC(400), "Big purchase");
      await expect(
        vault.connect(agent).agentTransfer(alice.address, toUSDC(200), "Over limit")
      ).to.be.revertedWith("AgentVault: exceeds recipient daily limit");
    });

    it("should revert when exceeding monthly limit", async function () {
      // Transfer daily limit across multiple days to hit monthly limit
      for (let i = 0; i < 10; i++) {
        await vault.connect(agent).agentTransfer(alice.address, DAILY_LIMIT, `Day ${i}`);
        await time.increase(DAY);
      }
      // Now at $5000 monthly. One more should fail.
      await expect(
        vault.connect(agent).agentTransfer(alice.address, toUSDC(1), "Over monthly")
      ).to.be.revertedWith("AgentVault: exceeds recipient monthly limit");
    });

    it("should revert when exceeding vault daily limit", async function () {
      // Set a very low vault daily limit
      await vault.setDailyVaultLimit(toUSDC(300));

      await vault.connect(agent).agentTransfer(alice.address, toUSDC(200), "Transfer 1");
      await expect(
        vault.connect(agent).agentTransfer(bob.address, toUSDC(200), "Transfer 2")
      ).to.be.revertedWith("AgentVault: exceeds vault daily limit");
    });

    it("should revert for non-whitelisted recipient", async function () {
      await expect(
        vault.connect(agent).agentTransfer(stranger.address, toUSDC(100), "Bad transfer")
      ).to.be.revertedWith("AgentVault: recipient not whitelisted");
    });

    it("should revert for inactive recipient", async function () {
      await vault.removeRecipient(alice.address);
      await expect(
        vault.connect(agent).agentTransfer(alice.address, toUSDC(100), "Inactive")
      ).to.be.revertedWith("AgentVault: recipient is inactive");
    });

    it("should revert for zero amount", async function () {
      await expect(
        vault.connect(agent).agentTransfer(alice.address, 0, "Zero")
      ).to.be.revertedWith("AgentVault: amount must be > 0");
    });

    it("should revert when non-agent calls agentTransfer", async function () {
      await expect(
        vault.connect(owner).agentTransfer(alice.address, toUSDC(100), "Not agent")
      ).to.be.revertedWith("AgentVault: caller is not the agent");
    });

    it("should revert when stranger calls agentTransfer", async function () {
      await expect(
        vault.connect(stranger).agentTransfer(alice.address, toUSDC(100), "Hacker")
      ).to.be.revertedWith("AgentVault: caller is not the agent");
    });

    it("should revert when vault balance is insufficient", async function () {
      // Deploy a fresh vault with minimal balance
      const AgentVault = await ethers.getContractFactory("AgentVault");
      const emptyVault = await AgentVault.deploy(await usdc.getAddress(), DAILY_VAULT_LIMIT);
      await emptyVault.setAgent(agent.address);
      await emptyVault.addRecipient(alice.address, "Alice", "household", DAILY_LIMIT, MONTHLY_LIMIT);

      // Deposit only $10
      await usdc.approve(await emptyVault.getAddress(), toUSDC(10));
      await emptyVault.deposit(toUSDC(10));

      await expect(
        emptyVault.connect(agent).agentTransfer(alice.address, toUSDC(100), "No funds")
      ).to.be.revertedWith("AgentVault: insufficient vault balance");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //                    DAILY / MONTHLY RESET LOGIC
  // ═══════════════════════════════════════════════════════════════════════

  describe("Daily/Monthly Reset Logic", function () {
    beforeEach(async function () {
      await vault.addRecipient(alice.address, "Alice", "household", DAILY_LIMIT, MONTHLY_LIMIT);
    });

    it("should reset daily spent after 1 day", async function () {
      // Spend daily limit
      await vault.connect(agent).agentTransfer(alice.address, DAILY_LIMIT, "Day 1");

      // Verify at limit
      await expect(
        vault.connect(agent).agentTransfer(alice.address, toUSDC(1), "Should fail")
      ).to.be.revertedWith("AgentVault: exceeds recipient daily limit");

      // Advance time by 1 day
      await time.increase(DAY);

      // Should succeed now
      await vault.connect(agent).agentTransfer(alice.address, toUSDC(100), "Day 2");
      const recipient = await vault.getRecipient(alice.address);
      expect(recipient.dailySpent).to.equal(toUSDC(100));
    });

    it("should reset monthly spent after 30 days", async function () {
      // Spend across multiple days to approach monthly limit
      for (let i = 0; i < 10; i++) {
        await vault.connect(agent).agentTransfer(alice.address, DAILY_LIMIT, `Day ${i}`);
        await time.increase(DAY);
      }

      // Monthly limit reached ($5,000), verify it fails
      await expect(
        vault.connect(agent).agentTransfer(alice.address, toUSDC(1), "Over monthly")
      ).to.be.revertedWith("AgentVault: exceeds recipient monthly limit");

      // Advance to month boundary (30 days from start)
      await time.increase(20 * DAY);

      // Should succeed — monthly reset
      await vault.connect(agent).agentTransfer(alice.address, toUSDC(100), "New month");
      const recipient = await vault.getRecipient(alice.address);
      expect(recipient.monthlySpent).to.equal(toUSDC(100));
    });

    it("should reset vault daily limit after 1 day", async function () {
      await vault.setDailyVaultLimit(toUSDC(500));
      await vault.connect(agent).agentTransfer(alice.address, toUSDC(500), "Max vault");

      // Vault limit reached
      await vault.addRecipient(bob.address, "Bob", "allowance", toUSDC(200), toUSDC(2_000));
      await expect(
        vault.connect(agent).agentTransfer(bob.address, toUSDC(1), "Over vault")
      ).to.be.revertedWith("AgentVault: exceeds vault daily limit");

      // Next day
      await time.increase(DAY);
      await vault.connect(agent).agentTransfer(bob.address, toUSDC(100), "New day");
      expect(await vault.dailyVaultSpent()).to.equal(toUSDC(100));
    });

    it("should return correct remaining daily allowance", async function () {
      await vault.connect(agent).agentTransfer(alice.address, toUSDC(200), "Partial");
      expect(await vault.getRemainingDailyAllowance(alice.address)).to.equal(toUSDC(300));

      // After day reset
      await time.increase(DAY);
      expect(await vault.getRemainingDailyAllowance(alice.address)).to.equal(DAILY_LIMIT);
    });

    it("should return correct remaining monthly allowance", async function () {
      await vault.connect(agent).agentTransfer(alice.address, toUSDC(200), "Partial");
      expect(await vault.getRemainingMonthlyAllowance(alice.address)).to.equal(toUSDC(4_800));

      // After month reset
      await time.increase(MONTH);
      expect(await vault.getRemainingMonthlyAllowance(alice.address)).to.equal(MONTHLY_LIMIT);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //                        PAUSE / UNPAUSE
  // ═══════════════════════════════════════════════════════════════════════

  describe("Pause / Unpause", function () {
    beforeEach(async function () {
      await vault.addRecipient(alice.address, "Alice", "household", DAILY_LIMIT, MONTHLY_LIMIT);
    });

    it("should pause and block agent transfers", async function () {
      await vault.pause();
      await expect(
        vault.connect(agent).agentTransfer(alice.address, toUSDC(100), "Paused")
      ).to.be.revertedWithCustomError(vault, "EnforcedPause");
    });

    it("should unpause and allow agent transfers", async function () {
      await vault.pause();
      await vault.unpause();
      await vault.connect(agent).agentTransfer(alice.address, toUSDC(100), "Unpaused");
      expect(await usdc.balanceOf(alice.address)).to.equal(toUSDC(100));
    });

    it("should only allow owner to pause", async function () {
      await expect(
        vault.connect(agent).pause()
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });

    it("should only allow owner to unpause", async function () {
      await vault.pause();
      await expect(
        vault.connect(stranger).unpause()
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //                       DEPOSIT & WITHDRAW
  // ═══════════════════════════════════════════════════════════════════════

  describe("Deposit & Emergency Withdraw", function () {
    it("should accept deposits from anyone", async function () {
      await usdc.mint(stranger.address, toUSDC(1_000));
      await usdc.connect(stranger).approve(await vault.getAddress(), toUSDC(1_000));

      await expect(vault.connect(stranger).deposit(toUSDC(1_000)))
        .to.emit(vault, "Deposited")
        .withArgs(stranger.address, toUSDC(1_000));

      expect(await vault.getVaultBalance()).to.equal(toUSDC(51_000));
    });

    it("should revert deposit of zero", async function () {
      await expect(vault.deposit(0)).to.be.revertedWith("AgentVault: amount must be > 0");
    });

    it("should allow owner to emergency withdraw", async function () {
      const before = await usdc.balanceOf(treasury.address);
      await vault.emergencyWithdraw(treasury.address, toUSDC(10_000));
      const after_ = await usdc.balanceOf(treasury.address);
      expect(after_ - before).to.equal(toUSDC(10_000));
    });

    it("should revert emergency withdraw from non-owner", async function () {
      await expect(
        vault.connect(agent).emergencyWithdraw(agent.address, toUSDC(100))
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });

    it("should revert emergency withdraw to zero address", async function () {
      await expect(
        vault.emergencyWithdraw(ethers.ZeroAddress, toUSDC(100))
      ).to.be.revertedWith("AgentVault: invalid destination");
    });

    it("should revert emergency withdraw exceeding balance", async function () {
      await expect(
        vault.emergencyWithdraw(owner.address, toUSDC(999_999))
      ).to.be.revertedWith("AgentVault: insufficient balance");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //                        AGENT MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════

  describe("Agent Management", function () {
    it("should update agent address", async function () {
      await expect(vault.setAgent(stranger.address))
        .to.emit(vault, "AgentUpdated")
        .withArgs(stranger.address);
      expect(await vault.agent()).to.equal(stranger.address);
    });

    it("should revert setting zero address as agent", async function () {
      await expect(
        vault.setAgent(ethers.ZeroAddress)
      ).to.be.revertedWith("AgentVault: invalid agent address");
    });

    it("should only allow owner to set agent", async function () {
      await expect(
        vault.connect(stranger).setAgent(stranger.address)
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });

    it("should allow new agent to transfer after update", async function () {
      await vault.addRecipient(alice.address, "Alice", "household", DAILY_LIMIT, MONTHLY_LIMIT);
      await vault.setAgent(stranger.address);

      // Old agent should fail
      await expect(
        vault.connect(agent).agentTransfer(alice.address, toUSDC(100), "Old agent")
      ).to.be.revertedWith("AgentVault: caller is not the agent");

      // New agent should succeed
      await vault.connect(stranger).agentTransfer(alice.address, toUSDC(100), "New agent");
      expect(await usdc.balanceOf(alice.address)).to.equal(toUSDC(100));
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //                     MULTIPLE RECIPIENTS
  // ═══════════════════════════════════════════════════════════════════════

  describe("Multiple Recipients", function () {
    it("should track limits independently per recipient", async function () {
      await vault.addRecipient(alice.address, "Alice", "household", toUSDC(500), toUSDC(5_000));
      await vault.addRecipient(bob.address, "Bob", "allowance", toUSDC(200), toUSDC(2_000));

      // Max out Alice's daily
      await vault.connect(agent).agentTransfer(alice.address, toUSDC(500), "Alice max");

      // Alice should be blocked
      await expect(
        vault.connect(agent).agentTransfer(alice.address, toUSDC(1), "Alice over")
      ).to.be.revertedWith("AgentVault: exceeds recipient daily limit");

      // Bob should still work
      await vault.connect(agent).agentTransfer(bob.address, toUSDC(200), "Bob ok");
      expect(await usdc.balanceOf(bob.address)).to.equal(toUSDC(200));
    });

    it("should track vault-wide daily spending across recipients", async function () {
      await vault.setDailyVaultLimit(toUSDC(600));
      await vault.addRecipient(alice.address, "Alice", "household", toUSDC(500), toUSDC(5_000));
      await vault.addRecipient(bob.address, "Bob", "allowance", toUSDC(500), toUSDC(5_000));

      await vault.connect(agent).agentTransfer(alice.address, toUSDC(400), "Alice");
      await vault.connect(agent).agentTransfer(bob.address, toUSDC(200), "Bob");

      // Vault limit hit (600), even though Bob has daily budget left
      await expect(
        vault.connect(agent).agentTransfer(bob.address, toUSDC(1), "Over vault")
      ).to.be.revertedWith("AgentVault: exceeds vault daily limit");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //                      VAULT LIMIT MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════

  describe("Vault Limit Management", function () {
    it("should update daily vault limit", async function () {
      await expect(vault.setDailyVaultLimit(toUSDC(20_000)))
        .to.emit(vault, "DailyVaultLimitUpdated")
        .withArgs(toUSDC(20_000));
      expect(await vault.dailyVaultLimit()).to.equal(toUSDC(20_000));
    });

    it("should revert setting zero vault limit", async function () {
      await expect(
        vault.setDailyVaultLimit(0)
      ).to.be.revertedWith("AgentVault: invalid daily vault limit");
    });

    it("should only allow owner to set vault limit", async function () {
      await expect(
        vault.connect(agent).setDailyVaultLimit(toUSDC(999))
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });
  });
});
