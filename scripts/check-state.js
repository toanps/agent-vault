const { ethers } = require("hardhat");

const VAULT_ADDRESS = "0xe52727A328Ff9C2bB394B821C2b762D1a147910C";
const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("Signer:", signer.address);

  const vault = await ethers.getContractAt("AgentVault", VAULT_ADDRESS);
  const usdc = await ethers.getContractAt("IERC20", USDC_ADDRESS);

  // Check balances
  const walletBalance = await usdc.balanceOf(signer.address);
  const vaultBalance = await vault.getVaultBalance();
  console.log("Wallet USDC:", ethers.formatUnits(walletBalance, 6));
  console.log("Vault USDC:", ethers.formatUnits(vaultBalance, 6));

  // Check agent
  const agent = await vault.agent();
  console.log("Agent:", agent);

  // Check owner
  const owner = await vault.owner();
  console.log("Owner:", owner);

  // Check recipients
  const recipientList = await vault.getRecipientList();
  console.log("Recipients:", recipientList.length);
  for (const addr of recipientList) {
    const r = await vault.getRecipient(addr);
    console.log(`  ${addr}: ${r.label} (${r.purpose}) active=${r.active} daily=${ethers.formatUnits(r.dailyLimit, 6)} monthly=${ethers.formatUnits(r.monthlyLimit, 6)}`);
  }

  // Check daily vault limit
  const dailyLimit = await vault.dailyVaultLimit();
  console.log("Daily Vault Limit:", ethers.formatUnits(dailyLimit, 6));
}

main().catch(console.error);
