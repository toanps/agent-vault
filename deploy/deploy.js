const { ethers } = require("hardhat");

/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║              AgentVault Deployment Script                     ║
 * ║                    Base Sepolia                               ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

// ── Base Sepolia USDC address ──
const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

// ── Configuration ──
const USDC_DECIMALS = 6;
const toUSDC = (amount) => ethers.parseUnits(amount.toString(), USDC_DECIMALS);

const DAILY_VAULT_LIMIT = toUSDC(10_000); // $10,000/day vault-wide limit

// ── Example recipients (update these before deploying!) ──
const EXAMPLE_RECIPIENTS = [
  {
    address: "0x0000000000000000000000000000000000000001", // Replace with real address
    label: "Wife - Alice",
    purpose: "household",
    dailyLimit: toUSDC(500),
    monthlyLimit: toUSDC(5_000),
  },
  {
    address: "0x0000000000000000000000000000000000000002", // Replace with real address
    label: "Son - Bob",
    purpose: "allowance",
    dailyLimit: toUSDC(100),
    monthlyLimit: toUSDC(1_000),
  },
  {
    address: "0x0000000000000000000000000000000000000003", // Replace with real address
    label: "Savings - Cold Wallet",
    purpose: "savings",
    dailyLimit: toUSDC(2_000),
    monthlyLimit: toUSDC(20_000),
  },
];

// ── Agent address (Clawdbot wallet — update before deploying!) ──
const AGENT_ADDRESS = "0x0000000000000000000000000000000000000000"; // Replace with real agent address

async function main() {
  console.log("╔═══════════════════════════════════════════════════════╗");
  console.log("║         🏦 AgentVault — Deploying to Base Sepolia     ║");
  console.log("╚═══════════════════════════════════════════════════════╝");
  console.log();

  const [deployer] = await ethers.getSigners();
  console.log("📍 Deployer:", deployer.address);
  console.log("💰 Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");
  console.log("🪙 USDC Token:", BASE_SEPOLIA_USDC);
  console.log();

  // ── Step 1: Deploy AgentVault ──
  console.log("🚀 Deploying AgentVault...");
  const AgentVault = await ethers.getContractFactory("AgentVault");
  const vault = await AgentVault.deploy(BASE_SEPOLIA_USDC, DAILY_VAULT_LIMIT);
  await vault.waitForDeployment();

  const vaultAddress = await vault.getAddress();
  console.log("✅ AgentVault deployed to:", vaultAddress);
  console.log();

  // ── Step 2: Set Agent ──
  if (AGENT_ADDRESS !== "0x0000000000000000000000000000000000000000") {
    console.log("🤖 Setting agent to:", AGENT_ADDRESS);
    const tx1 = await vault.setAgent(AGENT_ADDRESS);
    await tx1.wait();
    console.log("✅ Agent set successfully");
  } else {
    console.log("⚠️  Skipping agent setup — update AGENT_ADDRESS in deploy script");
  }
  console.log();

  // ── Step 3: Add Example Recipients ──
  console.log("👥 Adding recipients...");
  for (const r of EXAMPLE_RECIPIENTS) {
    // Skip placeholder addresses in production
    if (r.address.startsWith("0x000000000000000000000000000000000000000")) {
      console.log(`   ⚠️  Skipping placeholder: ${r.label}`);
      continue;
    }
    const tx = await vault.addRecipient(
      r.address,
      r.label,
      r.purpose,
      r.dailyLimit,
      r.monthlyLimit
    );
    await tx.wait();
    console.log(`   ✅ ${r.label} (${r.address})`);
    console.log(`      Daily: $${ethers.formatUnits(r.dailyLimit, USDC_DECIMALS)} | Monthly: $${ethers.formatUnits(r.monthlyLimit, USDC_DECIMALS)}`);
  }
  console.log();

  // ── Summary ──
  console.log("╔═══════════════════════════════════════════════════════╗");
  console.log("║                 📋 Deployment Summary                 ║");
  console.log("╠═══════════════════════════════════════════════════════╣");
  console.log(`║  AgentVault:  ${vaultAddress}`);
  console.log(`║  USDC Token:  ${BASE_SEPOLIA_USDC}`);
  console.log(`║  Owner:       ${deployer.address}`);
  console.log(`║  Agent:       ${AGENT_ADDRESS}`);
  console.log(`║  Vault Limit: $${ethers.formatUnits(DAILY_VAULT_LIMIT, USDC_DECIMALS)}/day`);
  console.log("╚═══════════════════════════════════════════════════════╝");
  console.log();
  console.log("📝 Next steps:");
  console.log("   1. Approve USDC spending: usdc.approve(vaultAddress, amount)");
  console.log("   2. Deposit USDC: vault.deposit(amount)");
  console.log("   3. Update recipient addresses in deploy script");
  console.log("   4. Verify contract: npx hardhat verify --network baseSepolia", vaultAddress, BASE_SEPOLIA_USDC, DAILY_VAULT_LIMIT.toString());
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });
