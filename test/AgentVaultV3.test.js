const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("AgentVaultV3", function () {
  // ── Constants ──
  const USDC_DECIMALS = 6;
  const toUSDC = (n) => ethers.parseUnits(n.toString(), USDC_DECIMALS);

  const DAILY_VAULT_LIMIT = toUSDC(10_000);
  const MAX_PER_TRANSFER = toUSDC(1_000);
  const TRANSFER_COOLDOWN = 60; // 60 seconds
  const DEADMAN_DAYS = 30;

  // ── Fixtures ──
  let vault, usdc;
  let owner, agent, relayer, recipient1, recipient2, stranger;

  // EIP-712 domain
  const TRANSFER_TYPEHASH = ethers.keccak256(
    ethers.toUtf8Bytes("Transfer(address to,uint256 amount,string memo,uint256 nonce,uint256 deadline)")
  );

  async function signTransfer(signer, vaultAddress, to, amount, memo, nonce, deadline) {
    const domain = {
      name: "AgentVaultV3",
      version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: vaultAddress,
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

    const value = { to, amount, memo, nonce, deadline };
    return signer.signTypedData(domain, types, value);
  }

  beforeEach(async function () {
    [owner, agent, relayer, recipient1, recipient2, stranger] = await ethers.getSigners();

    // Deploy MockUSDC
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    usdc = await MockUSDC.deploy("USD Coin", "USDC", 6);
    await usdc.waitForDeployment();

    // Deploy AgentVaultV3
    const AgentVaultV3 = await ethers.getContractFactory("AgentVaultV3");
    vault = await AgentVaultV3.deploy(
      await usdc.getAddress(),
      DAILY_VAULT_LIMIT,
      MAX_PER_TRANSFER,
      TRANSFER_COOLDOWN,
      DEADMAN_DAYS
    );
    await vault.waitForDeployment();

    // Setup: mint USDC, deposit to vault, set agent, add recipient
    await usdc.mint(owner.address, toUSDC(100_000));
    await usdc.connect(owner).approve(await vault.getAddress(), toUSDC(100_000));
    await vault.deposit(toUSDC(50_000));

    await vault.setAgent(agent.address);

    await vault.addRecipient(
      recipient1.address,
      "Alice",
      "household",
      toUSDC(500),   // daily
      toUSDC(5_000)  // monthly
    );

    await vault.addRecipient(
      recipient2.address,
      "Bob",
      "allowance",
      toUSDC(100),
      toUSDC(1_000)
    );
  });

  // ═══════════════════════════════════════════════════════════════════
  //                     DEPLOYMENT & CONSTRUCTOR
  // ═══════════════════════════════════════════════════════════════════

  describe("Deployment", function () {
    it("should set correct initial values", async function () {
      expect(await vault.owner()).to.equal(owner.address);
      expect(await vault.agent()).to.equal(agent.address);
      expect(await vault.dailyVaultLimit()).to.equal(DAILY_VAULT_LIMIT);
      expect(await vault.maxPerTransfer()).to.equal(MAX_PER_TRANSFER);
      expect(await vault.transferCooldown()).to.equal(TRANSFER_COOLDOWN);
      expect(await vault.deadmanDays()).to.equal(DEADMAN_DAYS);
      expect(await vault.transferNonce()).to.equal(0);
    });

    it("should reject invalid constructor params", async function () {
      const AgentVaultV3 = await ethers.getContractFactory("AgentVaultV3");

      await expect(
        AgentVaultV3.deploy(ethers.ZeroAddress, DAILY_VAULT_LIMIT, MAX_PER_TRANSFER, TRANSFER_COOLDOWN, DEADMAN_DAYS)
      ).to.be.revertedWith("V3: invalid USDC");

      await expect(
        AgentVaultV3.deploy(await usdc.getAddress(), 0, MAX_PER_TRANSFER, TRANSFER_COOLDOWN, DEADMAN_DAYS)
      ).to.be.revertedWith("V3: invalid daily limit");

      await expect(
        AgentVaultV3.deploy(await usdc.getAddress(), DAILY_VAULT_LIMIT, 0, TRANSFER_COOLDOWN, DEADMAN_DAYS)
      ).to.be.revertedWith("V3: invalid max per transfer");

      await expect(
        AgentVaultV3.deploy(await usdc.getAddress(), DAILY_VAULT_LIMIT, MAX_PER_TRANSFER, TRANSFER_COOLDOWN, 0)
      ).to.be.revertedWith("V3: invalid deadman days");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //                     OWNER FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════

  describe("Owner Functions", function () {
    it("should add recipient correctly", async function () {
      const r = await vault.getRecipient(recipient1.address);
      expect(r.label).to.equal("Alice");
      expect(r.purpose).to.equal("household");
      expect(r.dailyLimit).to.equal(toUSDC(500));
      expect(r.monthlyLimit).to.equal(toUSDC(5_000));
      expect(r.active).to.be.true;
    });

    it("should reject duplicate recipients", async function () {
      await expect(
        vault.addRecipient(recipient1.address, "Dup", "test", toUSDC(100), toUSDC(1000))
      ).to.be.revertedWith("V3: recipient exists");
    });

    it("should remove (deactivate) recipient", async function () {
      await vault.removeRecipient(recipient1.address);
      const r = await vault.getRecipient(recipient1.address);
      expect(r.active).to.be.false;
    });

    it("should update limits", async function () {
      await vault.updateLimits(recipient1.address, toUSDC(1000), toUSDC(10000));
      const r = await vault.getRecipient(recipient1.address);
      expect(r.dailyLimit).to.equal(toUSDC(1000));
      expect(r.monthlyLimit).to.equal(toUSDC(10000));
    });

    it("should set daily vault limit", async function () {
      await vault.setDailyVaultLimit(toUSDC(20_000));
      expect(await vault.dailyVaultLimit()).to.equal(toUSDC(20_000));
    });

    it("should set max per transfer", async function () {
      await vault.setMaxPerTransfer(toUSDC(2_000));
      expect(await vault.maxPerTransfer()).to.equal(toUSDC(2_000));
    });

    it("should set transfer cooldown", async function () {
      await vault.setTransferCooldown(120);
      expect(await vault.transferCooldown()).to.equal(120);
    });

    it("should set deadman days", async function () {
      await vault.setDeadmanDays(60);
      expect(await vault.deadmanDays()).to.equal(60);
    });

    it("should reject non-owner calls", async function () {
      await expect(vault.connect(stranger).setAgent(stranger.address))
        .to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");

      await expect(vault.connect(stranger).emergencyDrain())
        .to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");

      await expect(vault.connect(stranger).setMaxPerTransfer(toUSDC(100)))
        .to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //                     EMERGENCY DRAIN
  // ═══════════════════════════════════════════════════════════════════

  describe("Emergency Drain", function () {
    it("should drain ALL USDC to owner", async function () {
      const vaultBalance = await vault.getVaultBalance();
      expect(vaultBalance).to.equal(toUSDC(50_000));

      const ownerBalanceBefore = await usdc.balanceOf(owner.address);
      await vault.emergencyDrain();

      expect(await vault.getVaultBalance()).to.equal(0);
      expect(await usdc.balanceOf(owner.address)).to.equal(ownerBalanceBefore + vaultBalance);
    });

    it("should emit EmergencyDrain event", async function () {
      await expect(vault.emergencyDrain())
        .to.emit(vault, "EmergencyDrain")
        .withArgs(owner.address, toUSDC(50_000));
    });

    it("should revert if vault is empty", async function () {
      await vault.emergencyDrain(); // drain first
      await expect(vault.emergencyDrain()).to.be.revertedWith("V3: vault is empty");
    });

    it("should only be callable by owner", async function () {
      await expect(vault.connect(stranger).emergencyDrain())
        .to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //                     META-TX TRANSFER (EIP-712)
  // ═══════════════════════════════════════════════════════════════════

  describe("Meta-Transaction Transfer", function () {
    it("should execute transfer with valid agent signature", async function () {
      const amount = toUSDC(100);
      const nonce = 0;
      const deadline = (await time.latest()) + 3600;
      const memo = "Grocery money";

      const sig = await signTransfer(
        agent, await vault.getAddress(),
        recipient1.address, amount, memo, nonce, deadline
      );

      // Relayer submits (not the agent!)
      await expect(vault.connect(relayer).executeTransfer(
        recipient1.address, amount, memo, nonce, deadline, sig
      ))
        .to.emit(vault, "TransferExecuted")
        .withArgs(recipient1.address, amount, memo, await time.latest() + 1, nonce);

      expect(await usdc.balanceOf(recipient1.address)).to.equal(amount);
      expect(await vault.transferNonce()).to.equal(1);
    });

    it("should reject signature from non-agent", async function () {
      const amount = toUSDC(100);
      const nonce = 0;
      const deadline = (await time.latest()) + 3600;
      const memo = "Bad sig";

      // Stranger signs instead of agent
      const sig = await signTransfer(
        stranger, await vault.getAddress(),
        recipient1.address, amount, memo, nonce, deadline
      );

      await expect(vault.connect(relayer).executeTransfer(
        recipient1.address, amount, memo, nonce, deadline, sig
      )).to.be.revertedWith("V3: invalid signature");
    });

    it("should reject expired signature", async function () {
      const amount = toUSDC(100);
      const nonce = 0;
      const deadline = (await time.latest()) - 1; // already expired

      const sig = await signTransfer(
        agent, await vault.getAddress(),
        recipient1.address, amount, "expired", nonce, deadline
      );

      await expect(vault.connect(relayer).executeTransfer(
        recipient1.address, amount, "expired", nonce, deadline, sig
      )).to.be.revertedWith("V3: signature expired");
    });

    it("should reject invalid nonce", async function () {
      const amount = toUSDC(100);
      const wrongNonce = 99;
      const deadline = (await time.latest()) + 3600;

      const sig = await signTransfer(
        agent, await vault.getAddress(),
        recipient1.address, amount, "bad nonce", wrongNonce, deadline
      );

      await expect(vault.connect(relayer).executeTransfer(
        recipient1.address, amount, "bad nonce", wrongNonce, deadline, sig
      )).to.be.revertedWith("V3: invalid nonce");
    });

    it("should reject replay (same nonce used twice)", async function () {
      const amount = toUSDC(50);
      const nonce = 0;
      const deadline = (await time.latest()) + 3600;

      const sig = await signTransfer(
        agent, await vault.getAddress(),
        recipient1.address, amount, "first", nonce, deadline
      );

      await vault.connect(relayer).executeTransfer(
        recipient1.address, amount, "first", nonce, deadline, sig
      );

      // Try to replay
      await expect(vault.connect(relayer).executeTransfer(
        recipient1.address, amount, "first", nonce, deadline, sig
      )).to.be.revertedWith("V3: invalid nonce");
    });

    it("should reject transfer exceeding per-transfer cap", async function () {
      const amount = toUSDC(1_001); // exceeds 1000 cap
      const nonce = 0;
      const deadline = (await time.latest()) + 3600;

      // Need to increase recipient daily limit first
      await vault.updateLimits(recipient1.address, toUSDC(5000), toUSDC(50000));

      const sig = await signTransfer(
        agent, await vault.getAddress(),
        recipient1.address, amount, "too much", nonce, deadline
      );

      await expect(vault.connect(relayer).executeTransfer(
        recipient1.address, amount, "too much", nonce, deadline, sig
      )).to.be.revertedWith("V3: exceeds per-transfer cap");
    });

    it("should reject transfer to non-whitelisted address", async function () {
      const amount = toUSDC(100);
      const nonce = 0;
      const deadline = (await time.latest()) + 3600;

      const sig = await signTransfer(
        agent, await vault.getAddress(),
        stranger.address, amount, "not whitelisted", nonce, deadline
      );

      await expect(vault.connect(relayer).executeTransfer(
        stranger.address, amount, "not whitelisted", nonce, deadline, sig
      )).to.be.revertedWith("V3: not whitelisted");
    });

    it("should reject transfer to inactive recipient", async function () {
      await vault.removeRecipient(recipient1.address);

      const amount = toUSDC(100);
      const nonce = 0;
      const deadline = (await time.latest()) + 3600;

      const sig = await signTransfer(
        agent, await vault.getAddress(),
        recipient1.address, amount, "inactive", nonce, deadline
      );

      await expect(vault.connect(relayer).executeTransfer(
        recipient1.address, amount, "inactive", nonce, deadline, sig
      )).to.be.revertedWith("V3: recipient inactive");
    });

    it("should enforce daily recipient limit", async function () {
      // Recipient1 daily limit: 500 USDC
      const nonce0 = 0;
      const deadline = (await time.latest()) + 3600;
      const sig0 = await signTransfer(
        agent, await vault.getAddress(),
        recipient1.address, toUSDC(500), "max daily", nonce0, deadline
      );
      await vault.connect(relayer).executeTransfer(
        recipient1.address, toUSDC(500), "max daily", nonce0, deadline, sig0
      );

      // Wait for cooldown
      await time.increase(TRANSFER_COOLDOWN + 1);

      const nonce1 = 1;
      const deadline2 = (await time.latest()) + 3600;
      const sig1 = await signTransfer(
        agent, await vault.getAddress(),
        recipient1.address, toUSDC(1), "over limit", nonce1, deadline2
      );
      await expect(vault.connect(relayer).executeTransfer(
        recipient1.address, toUSDC(1), "over limit", nonce1, deadline2, sig1
      )).to.be.revertedWith("V3: exceeds daily limit");
    });

    it("should reject when paused", async function () {
      await vault.pause();

      const amount = toUSDC(100);
      const nonce = 0;
      const deadline = (await time.latest()) + 3600;

      const sig = await signTransfer(
        agent, await vault.getAddress(),
        recipient1.address, amount, "paused", nonce, deadline
      );

      await expect(vault.connect(relayer).executeTransfer(
        recipient1.address, amount, "paused", nonce, deadline, sig
      )).to.be.revertedWithCustomError(vault, "EnforcedPause");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //                     TRANSFER COOLDOWN
  // ═══════════════════════════════════════════════════════════════════

  describe("Transfer Cooldown", function () {
    it("should enforce cooldown between transfers", async function () {
      const deadline = (await time.latest()) + 3600;

      // First transfer
      const sig0 = await signTransfer(
        agent, await vault.getAddress(),
        recipient1.address, toUSDC(50), "first", 0, deadline
      );
      await vault.connect(relayer).executeTransfer(
        recipient1.address, toUSDC(50), "first", 0, deadline, sig0
      );

      // Second transfer immediately (should fail)
      const deadline2 = (await time.latest()) + 3600;
      const sig1 = await signTransfer(
        agent, await vault.getAddress(),
        recipient1.address, toUSDC(50), "too soon", 1, deadline2
      );
      await expect(vault.connect(relayer).executeTransfer(
        recipient1.address, toUSDC(50), "too soon", 1, deadline2, sig1
      )).to.be.revertedWith("V3: transfer cooldown active");
    });

    it("should allow transfer after cooldown passes", async function () {
      const deadline = (await time.latest()) + 7200;

      const sig0 = await signTransfer(
        agent, await vault.getAddress(),
        recipient1.address, toUSDC(50), "first", 0, deadline
      );
      await vault.connect(relayer).executeTransfer(
        recipient1.address, toUSDC(50), "first", 0, deadline, sig0
      );

      // Wait for cooldown
      await time.increase(TRANSFER_COOLDOWN + 1);

      const deadline2 = (await time.latest()) + 7200;
      const sig1 = await signTransfer(
        agent, await vault.getAddress(),
        recipient1.address, toUSDC(50), "second", 1, deadline2
      );
      await vault.connect(relayer).executeTransfer(
        recipient1.address, toUSDC(50), "second", 1, deadline2, sig1
      );

      expect(await usdc.balanceOf(recipient1.address)).to.equal(toUSDC(100));
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //                     DEADMAN SWITCH
  // ═══════════════════════════════════════════════════════════════════

  describe("Deadman Switch", function () {
    it("should report correct status initially", async function () {
      const [, , isExpired] = await vault.getDeadmanStatus();
      expect(isExpired).to.be.false;
    });

    it("should block transfers after deadman expires", async function () {
      // Fast forward past deadman days
      await time.increase(DEADMAN_DAYS * 86400 + 1);

      const [, , isExpired] = await vault.getDeadmanStatus();
      expect(isExpired).to.be.true;

      const deadline = (await time.latest()) + 3600;
      const sig = await signTransfer(
        agent, await vault.getAddress(),
        recipient1.address, toUSDC(50), "deadman", 0, deadline
      );
      await expect(vault.connect(relayer).executeTransfer(
        recipient1.address, toUSDC(50), "deadman", 0, deadline, sig
      )).to.be.revertedWith("V3: deadman switch triggered");
    });

    it("should allow transfers after owner heartbeat resets deadman", async function () {
      // Fast forward to almost expired
      await time.increase(DEADMAN_DAYS * 86400 - 100);

      // Owner heartbeats
      await vault.ownerHeartbeat();

      const [, , isExpired] = await vault.getDeadmanStatus();
      expect(isExpired).to.be.false;

      // Should still work
      const deadline = (await time.latest()) + 3600;
      const sig = await signTransfer(
        agent, await vault.getAddress(),
        recipient1.address, toUSDC(50), "alive", 0, deadline
      );
      await vault.connect(relayer).executeTransfer(
        recipient1.address, toUSDC(50), "alive", 0, deadline, sig
      );
      expect(await usdc.balanceOf(recipient1.address)).to.equal(toUSDC(50));
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //                     AGENT ROTATION WITH TIMELOCK
  // ═══════════════════════════════════════════════════════════════════

  describe("Agent Rotation", function () {
    it("should propose new agent with 24h timelock", async function () {
      await vault.rotateAgent(stranger.address);

      const [pending, activationTime] = await vault.getPendingAgentRotation();
      expect(pending).to.equal(stranger.address);

      const now = await time.latest();
      expect(activationTime).to.equal(now + 86400); // 24h
    });

    it("should not activate before timelock", async function () {
      await vault.rotateAgent(stranger.address);
      await expect(vault.activateAgent()).to.be.revertedWith("V3: timelock not expired");
    });

    it("should activate after timelock", async function () {
      await vault.rotateAgent(stranger.address);

      // Fast forward 24h
      await time.increase(86400 + 1);

      await vault.activateAgent();
      expect(await vault.agent()).to.equal(stranger.address);

      const [pending,] = await vault.getPendingAgentRotation();
      expect(pending).to.equal(ethers.ZeroAddress);
    });

    it("should allow cancellation of pending rotation", async function () {
      await vault.rotateAgent(stranger.address);
      await vault.cancelAgentRotation();

      const [pending,] = await vault.getPendingAgentRotation();
      expect(pending).to.equal(ethers.ZeroAddress);
    });

    it("should reject rotation to same agent", async function () {
      await expect(vault.rotateAgent(agent.address)).to.be.revertedWith("V3: same agent");
    });

    it("should reject activating when no pending agent", async function () {
      await expect(vault.activateAgent()).to.be.revertedWith("V3: no pending agent");
    });

    it("should emit correct events", async function () {
      await expect(vault.rotateAgent(stranger.address))
        .to.emit(vault, "AgentRotationProposed");

      await time.increase(86400 + 1);

      await expect(vault.activateAgent())
        .to.emit(vault, "AgentRotationActivated")
        .withArgs(stranger.address);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //                     ON-CHAIN TRANSFER HISTORY
  // ═══════════════════════════════════════════════════════════════════

  describe("Transfer History", function () {
    it("should record transfers in history", async function () {
      const deadline = (await time.latest()) + 7200;

      const sig0 = await signTransfer(
        agent, await vault.getAddress(),
        recipient1.address, toUSDC(50), "first tx", 0, deadline
      );
      await vault.connect(relayer).executeTransfer(
        recipient1.address, toUSDC(50), "first tx", 0, deadline, sig0
      );

      await time.increase(TRANSFER_COOLDOWN + 1);
      const deadline2 = (await time.latest()) + 7200;
      const sig1 = await signTransfer(
        agent, await vault.getAddress(),
        recipient1.address, toUSDC(75), "second tx", 1, deadline2
      );
      await vault.connect(relayer).executeTransfer(
        recipient1.address, toUSDC(75), "second tx", 1, deadline2, sig1
      );

      const history = await vault.getTransferHistory(2);
      expect(history.length).to.equal(2);
      expect(history[0].amount).to.equal(toUSDC(50));
      expect(history[0].memo).to.equal("first tx");
      expect(history[1].amount).to.equal(toUSDC(75));
      expect(history[1].memo).to.equal("second tx");
    });

    it("should return empty array when no transfers", async function () {
      const history = await vault.getTransferHistory(5);
      expect(history.length).to.equal(0);
    });

    it("should cap returned count to actual history length", async function () {
      const deadline = (await time.latest()) + 7200;
      const sig = await signTransfer(
        agent, await vault.getAddress(),
        recipient1.address, toUSDC(50), "only one", 0, deadline
      );
      await vault.connect(relayer).executeTransfer(
        recipient1.address, toUSDC(50), "only one", 0, deadline, sig
      );

      const history = await vault.getTransferHistory(100);
      expect(history.length).to.equal(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //                     DEPOSIT
  // ═══════════════════════════════════════════════════════════════════

  describe("Deposit", function () {
    it("should accept USDC deposits", async function () {
      await usdc.mint(stranger.address, toUSDC(1_000));
      await usdc.connect(stranger).approve(await vault.getAddress(), toUSDC(1_000));
      await vault.connect(stranger).deposit(toUSDC(1_000));

      expect(await vault.getVaultBalance()).to.equal(toUSDC(51_000));
    });

    it("should reject zero deposit", async function () {
      await expect(vault.deposit(0)).to.be.revertedWith("V3: amount must be > 0");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //                     VIEW FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════

  describe("View Functions", function () {
    it("should return recipient list", async function () {
      const list = await vault.getRecipientList();
      expect(list.length).to.equal(2);
      expect(list[0]).to.equal(recipient1.address);
      expect(list[1]).to.equal(recipient2.address);
    });

    it("should return vault balance", async function () {
      expect(await vault.getVaultBalance()).to.equal(toUSDC(50_000));
    });

    it("should return domain separator", async function () {
      const sep = await vault.getDomainSeparator();
      expect(sep).to.not.equal(ethers.ZeroHash);
    });

    it("should return remaining daily allowance", async function () {
      expect(await vault.getRemainingDailyAllowance(recipient1.address)).to.equal(toUSDC(500));
    });

    it("should return remaining monthly allowance", async function () {
      expect(await vault.getRemainingMonthlyAllowance(recipient1.address)).to.equal(toUSDC(5_000));
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //                     OWNER HEARTBEAT
  // ═══════════════════════════════════════════════════════════════════

  describe("Owner Heartbeat", function () {
    it("should update last heartbeat timestamp", async function () {
      await time.increase(86400); // 1 day
      await vault.ownerHeartbeat();

      const [lastHb, ,] = await vault.getDeadmanStatus();
      const now = await time.latest();
      expect(lastHb).to.equal(now);
    });

    it("should emit event", async function () {
      await expect(vault.ownerHeartbeat()).to.emit(vault, "OwnerHeartbeatRecorded");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //                     PAUSE / UNPAUSE
  // ═══════════════════════════════════════════════════════════════════

  describe("Pause / Unpause", function () {
    it("should allow owner to pause and unpause", async function () {
      await vault.pause();
      expect(await vault.paused()).to.be.true;

      await vault.unpause();
      expect(await vault.paused()).to.be.false;
    });

    it("should block transfers when paused", async function () {
      await vault.pause();

      const deadline = (await time.latest()) + 3600;
      const sig = await signTransfer(
        agent, await vault.getAddress(),
        recipient1.address, toUSDC(50), "paused test", 0, deadline
      );

      await expect(vault.connect(relayer).executeTransfer(
        recipient1.address, toUSDC(50), "paused test", 0, deadline, sig
      )).to.be.revertedWithCustomError(vault, "EnforcedPause");
    });

    it("should allow emergency drain even when paused", async function () {
      await vault.pause();
      await vault.emergencyDrain(); // should not revert
      expect(await vault.getVaultBalance()).to.equal(0);
    });
  });
});
