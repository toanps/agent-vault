const { ethers } = require("hardhat");

const VAULT_ADDRESS = "0xe52727A328Ff9C2bB394B821C2b762D1a147910C";
const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const USDC_DECIMALS = 6;
const toUSDC = (amount) => ethers.parseUnits(amount.toString(), USDC_DECIMALS);

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("╔═══════════════════════════════════════════════════════╗");
  console.log("║         🏦 AgentVault — Demo Transactions             ║");
  console.log("╚═══════════════════════════════════════════════════════╝");
  console.log();
  console.log("Signer:", signer.address);

  const vault = await ethers.getContractAt("AgentVault", VAULT_ADDRESS);
  const usdc = await ethers.getContractAt("IERC20", USDC_ADDRESS);

  // Check initial balance
  const walletBalance = await usdc.balanceOf(signer.address);
  console.log("Wallet USDC:", ethers.formatUnits(walletBalance, USDC_DECIMALS));

  if (walletBalance === 0n) {
    console.log("❌ No USDC in wallet. Get some from the faucet first.");
    return;
  }

  const txHashes = {};

  // ── Step 1: Approve USDC to vault ──
  console.log("\n🔑 Step 1: Approving USDC to vault...");
  const approveAmount = toUSDC(10); // Approve 10 USDC
  const approveTx = await usdc.approve(VAULT_ADDRESS, approveAmount);
  const approveReceipt = await approveTx.wait();
  txHashes.approve = approveReceipt.hash;
  console.log("✅ Approved! Tx:", approveReceipt.hash);

  // ── Step 2: Deposit USDC into vault ──
  console.log("\n💰 Step 2: Depositing USDC into vault...");
  const depositAmount = toUSDC(10); // Deposit 10 USDC
  const depositTx = await vault.deposit(depositAmount);
  const depositReceipt = await depositTx.wait();
  txHashes.deposit = depositReceipt.hash;
  console.log("✅ Deposited! Tx:", depositReceipt.hash);

  // Check vault balance
  const vaultBalance = await vault.getVaultBalance();
  console.log("Vault balance:", ethers.formatUnits(vaultBalance, USDC_DECIMALS), "USDC");

  // ── Step 3: Agent Transfer to recipient ──
  console.log("\n🤖 Step 3: Agent transferring USDC to recipient...");
  const recipient = "0x1111111111111111111111111111111111111111"; // Wife - Alice
  const transferAmount = toUSDC(5); // Send 5 USDC
  const memo = "Monthly allowance payment - approved by AI agent";
  const transferTx = await vault.agentTransfer(recipient, transferAmount, memo);
  const transferReceipt = await transferTx.wait();
  txHashes.agentTransfer = transferReceipt.hash;
  console.log("✅ Agent Transfer! Tx:", transferReceipt.hash);

  // ── Summary ──
  console.log("\n╔═══════════════════════════════════════════════════════╗");
  console.log("║              📋 Transaction Summary                    ║");
  console.log("╠═══════════════════════════════════════════════════════╣");
  console.log(`║  Approve:        ${txHashes.approve}`);
  console.log(`║  Deposit:        ${txHashes.deposit}`);
  console.log(`║  AgentTransfer:  ${txHashes.agentTransfer}`);
  console.log("╚═══════════════════════════════════════════════════════╝");

  // Final state
  const finalVault = await vault.getVaultBalance();
  const finalWallet = await usdc.balanceOf(signer.address);
  console.log("\nFinal vault balance:", ethers.formatUnits(finalVault, USDC_DECIMALS), "USDC");
  console.log("Final wallet balance:", ethers.formatUnits(finalWallet, USDC_DECIMALS), "USDC");

  // Output JSON for easy parsing
  console.log("\n--- TX_HASHES_JSON ---");
  console.log(JSON.stringify(txHashes, null, 2));
  console.log("--- END_TX_HASHES ---");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Error:", error);
    process.exit(1);
  });
