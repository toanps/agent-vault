const { ethers } = require("hardhat");

/**
 * AgentVault V3 Demo Script
 * - Add recipients
 * - Set agent
 * - Deposit USDC
 * - Execute meta-tx transfer (EIP-712 signed)
 * - Emergency drain
 */

const VAULT_ADDRESS = "0x9b8606cE2F194b0B487fB857533d70451157978e";
const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const USDC_DECIMALS = 6;
const toUSDC = (n) => ethers.parseUnits(n.toString(), USDC_DECIMALS);

// Generate a deterministic agent wallet for demo
const AGENT_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForTx(tx, label) {
  console.log(`   ⏳ ${label}... tx: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`   ✅ ${label} confirmed (block ${receipt.blockNumber})`);
  return receipt;
}

async function main() {
  console.log("╔═══════════════════════════════════════════════════════╗");
  console.log("║        🎬 AgentVault V3 — Demo Transactions          ║");
  console.log("╚═══════════════════════════════════════════════════════╝\n");

  const [owner] = await ethers.getSigners();
  const agentWallet = new ethers.Wallet(AGENT_PRIVATE_KEY, ethers.provider);

  console.log("📍 Owner:", owner.address);
  console.log("🤖 Agent:", agentWallet.address);
  console.log("🏦 Vault:", VAULT_ADDRESS);
  console.log();

  const vault = await ethers.getContractAt("AgentVaultV3", VAULT_ADDRESS);
  const usdc = await ethers.getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", BASE_SEPOLIA_USDC);

  // ── Check current state ──
  const currentAgent = await vault.agent();
  const recipientList = await vault.getRecipientList();
  const vaultBalance = await vault.getVaultBalance();
  
  console.log("📊 Current State:");
  console.log(`   Agent: ${currentAgent}`);
  console.log(`   Recipients: ${recipientList.length}`);
  console.log(`   Vault Balance: $${ethers.formatUnits(vaultBalance, USDC_DECIMALS)} USDC`);
  console.log();

  // ── Step 1: Add recipients if needed ──
  if (recipientList.length === 0) {
    console.log("── Step 1: Adding Recipients ──");
    
    const recipient1 = "0x92F709dDC4D633D3D95b29e7c3C10668e04dDCE8";
    let tx = await vault.addRecipient(
      recipient1,
      "Son - Bob",
      "allowance",
      toUSDC(100),
      toUSDC(1_000)
    );
    await waitForTx(tx, "Add recipient: Son - Bob");
    await sleep(3000);

    console.log();
  } else {
    console.log("✅ Recipients already configured\n");
  }

  // ── Step 2: Set Agent ──
  if (currentAgent === ethers.ZeroAddress || currentAgent !== agentWallet.address) {
    console.log("── Step 2: Setting Agent ──");
    const tx = await vault.setAgent(agentWallet.address);
    await waitForTx(tx, "Set agent");
    await sleep(3000);
    console.log();
  } else {
    console.log("✅ Agent already set\n");
  }

  // ── Step 3: Deposit USDC ──
  const ownerUsdcBalance = await usdc.balanceOf(owner.address);
  console.log("── Step 3: Deposit USDC ──");
  console.log(`   Owner USDC balance: $${ethers.formatUnits(ownerUsdcBalance, USDC_DECIMALS)}`);

  if (ownerUsdcBalance > 0n) {
    const depositAmount = ownerUsdcBalance < toUSDC(10) ? ownerUsdcBalance : toUSDC(10);
    
    const tx1 = await usdc.approve(VAULT_ADDRESS, depositAmount);
    await waitForTx(tx1, `Approve ${ethers.formatUnits(depositAmount, USDC_DECIMALS)} USDC`);
    await sleep(3000);

    const tx2 = await vault.deposit(depositAmount);
    await waitForTx(tx2, `Deposit ${ethers.formatUnits(depositAmount, USDC_DECIMALS)} USDC`);
    await sleep(3000);
    console.log();
  } else {
    console.log("   ⚠️  No USDC balance to deposit. Skipping...\n");
  }

  // ── Step 4: Meta-Tx Transfer (EIP-712) ──
  const currentVaultBalance = await vault.getVaultBalance();
  const recipients = await vault.getRecipientList();
  
  if (currentVaultBalance > 0n && recipients.length > 0) {
    console.log("── Step 4: Meta-Transaction Transfer (EIP-712) ──");
    
    const recipientAddr = recipients[0];
    const transferAmount = currentVaultBalance < toUSDC(1) ? currentVaultBalance : toUSDC(1);
    const nonce = await vault.transferNonce();
    const latestBlock = await ethers.provider.getBlock("latest");
    const deadline = latestBlock.timestamp + 3600;
    const memo = "V3 demo: meta-tx transfer";

    console.log(`   To: ${recipientAddr}`);
    console.log(`   Amount: $${ethers.formatUnits(transferAmount, USDC_DECIMALS)} USDC`);
    console.log(`   Nonce: ${nonce}`);
    console.log(`   Deadline: ${deadline}`);

    // Agent signs EIP-712 off-chain
    const domain = {
      name: "AgentVaultV3",
      version: "1",
      chainId: 84532, // Base Sepolia
      verifyingContract: VAULT_ADDRESS,
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

    const value = {
      to: recipientAddr,
      amount: transferAmount,
      memo: memo,
      nonce: nonce,
      deadline: deadline,
    };

    console.log("   🔏 Agent signing EIP-712 message off-chain...");
    const signature = await agentWallet.signTypedData(domain, types, value);
    console.log(`   ✅ Signature: ${signature.slice(0, 20)}...`);

    // Owner relays the signed transfer (agent needs no ETH!)
    console.log("   📡 Owner relaying signed transfer on-chain...");
    const tx = await vault.executeTransfer(
      recipientAddr,
      transferAmount,
      memo,
      nonce,
      deadline,
      signature
    );
    await waitForTx(tx, "Meta-tx transfer executed");
    await sleep(3000);
    console.log();
  } else {
    console.log("── Step 4: Skipping meta-tx (no balance or no recipients) ──\n");
  }

  // ── Step 5: Owner Heartbeat ──
  console.log("── Step 5: Owner Heartbeat ──");
  const txHb = await vault.ownerHeartbeat();
  await waitForTx(txHb, "Owner heartbeat recorded");
  await sleep(3000);
  console.log();

  // ── Step 6: Emergency Drain ──
  const balanceBefore = await vault.getVaultBalance();
  if (balanceBefore > 0n) {
    console.log("── Step 6: Emergency Drain ──");
    console.log(`   Vault balance before: $${ethers.formatUnits(balanceBefore, USDC_DECIMALS)}`);
    const txDrain = await vault.emergencyDrain();
    await waitForTx(txDrain, "Emergency drain");
    console.log(`   Vault balance after: $${ethers.formatUnits(await vault.getVaultBalance(), USDC_DECIMALS)}`);
    console.log();
  } else {
    console.log("── Step 6: Skip emergency drain (vault empty) ──\n");
  }

  // ── Final Summary ──
  console.log("╔═══════════════════════════════════════════════════════════════╗");
  console.log("║                   🎯 Demo Complete!                           ║");
  console.log("╠═══════════════════════════════════════════════════════════════╣");
  console.log(`║  Vault:     ${VAULT_ADDRESS}`);
  console.log(`║  Agent:     ${agentWallet.address}`);
  console.log(`║  Balance:   $${ethers.formatUnits(await vault.getVaultBalance(), USDC_DECIMALS)} USDC`);
  
  const deadman = await vault.getDeadmanStatus();
  console.log(`║  Deadman:   ${deadman[2] ? "⚠️  EXPIRED" : "✅ Active"}`);
  
  const history = await vault.getTransferHistory(5);
  console.log(`║  Transfers: ${history.length} recorded`);
  console.log("╚═══════════════════════════════════════════════════════════════╝");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Demo failed:", error);
    process.exit(1);
  });
