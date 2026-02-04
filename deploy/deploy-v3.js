const { ethers } = require("hardhat");

/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║           AgentVault V3 Deployment Script                     ║
 * ║                    Base Sepolia                               ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

// ── Base Sepolia USDC address ──
const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

// ── Configuration ──
const USDC_DECIMALS = 6;
const toUSDC = (amount) => ethers.parseUnits(amount.toString(), USDC_DECIMALS);

const DAILY_VAULT_LIMIT = toUSDC(10_000);  // $10,000/day
const MAX_PER_TRANSFER = toUSDC(1_000);    // $1,000 per single tx
const TRANSFER_COOLDOWN = 60;               // 60 seconds between transfers
const DEADMAN_DAYS = 30;                    // 30 days deadman switch

// ── Recipients ──
const RECIPIENTS = [
  {
    address: "0xecaa4579251a9A67f20b3e3b51be3253E36497d1",
    label: "Wife - Alice",
    purpose: "household",
    dailyLimit: toUSDC(500),
    monthlyLimit: toUSDC(5_000),
  },
  {
    address: "0x92F709dDC4D633D3D95b29e7c3C10668e04dDCE8",
    label: "Son - Bob",
    purpose: "allowance",
    dailyLimit: toUSDC(100),
    monthlyLimit: toUSDC(1_000),
  },
];

async function main() {
  console.log("╔═══════════════════════════════════════════════════════╗");
  console.log("║      🏦 AgentVault V3 — Deploying to Base Sepolia    ║");
  console.log("╚═══════════════════════════════════════════════════════╝\n");

  const [deployer] = await ethers.getSigners();
  console.log("📍 Deployer:", deployer.address);
  console.log("💰 Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");
  console.log("🪙 USDC Token:", BASE_SEPOLIA_USDC);
  console.log();

  // ── Deploy ──
  console.log("🚀 Deploying AgentVaultV3...");
  const AgentVaultV3 = await ethers.getContractFactory("AgentVaultV3");
  const vault = await AgentVaultV3.deploy(
    BASE_SEPOLIA_USDC,
    DAILY_VAULT_LIMIT,
    MAX_PER_TRANSFER,
    TRANSFER_COOLDOWN,
    DEADMAN_DAYS
  );
  await vault.waitForDeployment();

  const vaultAddress = await vault.getAddress();
  console.log("✅ AgentVaultV3 deployed to:", vaultAddress);
  console.log();

  // ── Add Recipients ──
  console.log("👥 Adding recipients...");
  for (const r of RECIPIENTS) {
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
  console.log("╔═══════════════════════════════════════════════════════════════╗");
  console.log("║                   📋 V3 Deployment Summary                    ║");
  console.log("╠═══════════════════════════════════════════════════════════════╣");
  console.log(`║  AgentVaultV3:     ${vaultAddress}`);
  console.log(`║  USDC Token:       ${BASE_SEPOLIA_USDC}`);
  console.log(`║  Owner:            ${deployer.address}`);
  console.log(`║  Daily Vault Limit: $${ethers.formatUnits(DAILY_VAULT_LIMIT, USDC_DECIMALS)}`);
  console.log(`║  Max Per Transfer:  $${ethers.formatUnits(MAX_PER_TRANSFER, USDC_DECIMALS)}`);
  console.log(`║  Transfer Cooldown: ${TRANSFER_COOLDOWN}s`);
  console.log(`║  Deadman Days:      ${DEADMAN_DAYS}`);
  console.log("╚═══════════════════════════════════════════════════════════════╝");
  console.log();
  console.log("📝 Next: run demo script to deposit USDC, set agent, and test meta-tx");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });
