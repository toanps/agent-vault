/**
 * Bridge Sepolia ETH to Base Sepolia via the L1StandardBridge
 * Base Sepolia L1StandardBridge: 0xfd0Bf71F60660E2f608ed56e1659C450eB113120
 */
const ethers = require('ethers');
require('dotenv').config();

const L1_BRIDGE = '0xfd0Bf71F60660E2f608ed56e1659C450eB113120';
const BRIDGE_ABI = [
  'function depositETH(uint32 _minGasLimit, bytes _extraData) payable'
];

async function main() {
  const provider = new ethers.JsonRpcProvider('https://ethereum-sepolia-rpc.publicnode.com');
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  
  console.log('Wallet:', wallet.address);
  const balance = await provider.getBalance(wallet.address);
  console.log('Sepolia balance:', ethers.formatEther(balance), 'ETH');
  
  // Bridge 0.04 ETH (keep some for gas)
  const bridgeAmount = ethers.parseEther('0.04');
  
  const bridge = new ethers.Contract(L1_BRIDGE, BRIDGE_ABI, wallet);
  
  console.log('Bridging 0.04 ETH to Base Sepolia...');
  const tx = await bridge.depositETH(200000, '0x', { value: bridgeAmount, gasLimit: 200000 });
  console.log('Bridge tx:', tx.hash);
  
  const receipt = await tx.wait();
  console.log('Confirmed in block:', receipt.blockNumber);
  console.log('Done! Funds will arrive on Base Sepolia in ~1-5 minutes.');
}

main().catch(console.error);
