# 🏦 AgentVault

> **AI-Managed Wealth Wallet** — An on-chain USDC vault that lets an AI agent autonomously distribute funds to family members within human-defined guardrails.

Built for the **USDC Moltbook Hackathon** on **Base Sepolia**.

---

## 📦 Versions

| Version | Address | Key Features |
|---------|---------|--------------|
| **v1** | [`0xe52727A328Ff9C2bB394B821C2b762D1a147910C`](https://sepolia.basescan.org/address/0xe52727A328Ff9C2bB394B821C2b762D1a147910C) | Basic vault: whitelist, daily/monthly limits, agent transfers |
| **v3** | [`0x9b8606cE2F194b0B487fB857533d70451157978e`](https://sepolia.basescan.org/address/0x9b8606cE2F194b0B487fB857533d70451157978e) | Zero-Trust Meta-Tx: EIP-712 signatures, deadman switch, agent rotation timelock |

---

## 🧠 Architecture

### V3 — Zero-Trust Meta-Transaction Architecture

```
┌──────────────┐  EIP-712 sig   ┌─────────────┐  relay   ┌───────────────┐
│   AI Agent   │ ────────────► │   Relayer    │ ───────► │ AgentVaultV3  │
│  (no ETH!)   │  off-chain     │  (anyone)    │ on-chain │  (on-chain)   │
└──────────────┘                └─────────────┘          └───────────────┘
                                                                ▲
     Agent signs, never submits tx                              │ full admin
     → Needs ZERO gas/ETH                                 ┌────┴──────┐
                                                           │   Owner   │
 V3 Guardrails:                                            │  (Human)  │
 • EIP-712 meta-transactions                               └───────────┘
 • Per-transfer cap
 • Transfer cooldown
 • Deadman switch (auto-pause)
 • Agent rotation with 24h timelock
 • Transfer nonce + deadline (replay protection)
 • On-chain transfer history (last 50)
 • Emergency drain (one call)
 • + All v1 guardrails (whitelist, daily/monthly limits, pause)
```

---

## 🔑 Key Concepts

### Two Roles, Clear Separation

| Role | Who | Can Do |
|------|-----|--------|
| **Owner** (human) | Vault creator | Full admin: recipients, limits, pause, drain, agent rotation |
| **Agent** (AI) | Clawdbot wallet | Sign EIP-712 transfer intents (needs no ETH) |
| **Relayer** (anyone) | Any wallet | Submit agent-signed transfers on-chain |

### V3 Security Features

| Feature | Description |
|---------|-------------|
| **Meta-Transactions** | Agent signs off-chain via EIP-712. Anyone can relay. Agent needs zero ETH. |
| **Per-Transfer Cap** | Hard limit on any single transfer amount |
| **Transfer Cooldown** | Minimum seconds between consecutive transfers |
| **Deadman Switch** | Auto-blocks transfers if owner doesn't heartbeat within N days |
| **Agent Rotation Timelock** | 24-hour delay before new agent activates (cancel anytime) |
| **Nonce + Deadline** | Replay protection + signatures expire after deadline |
| **On-Chain History** | Last 50 transfers stored on-chain for auditing |
| **Emergency Drain** | One-call, no-params: sends ALL USDC to owner instantly |

---

## 📋 V3 Contract Interface

### Owner Functions

```solidity
// Recipient management
addRecipient(address, label, purpose, dailyLimit, monthlyLimit)
removeRecipient(address)
updateLimits(address, dailyLimit, monthlyLimit)

// Agent management
setAgent(address)                  // Direct set (initial setup)
rotateAgent(address newAgent)      // 24h timelock rotation
activateAgent()                    // After timelock passes
cancelAgentRotation()              // Cancel pending rotation

// Vault controls
setDailyVaultLimit(uint256)
setMaxPerTransfer(uint256)
setTransferCooldown(uint256 seconds)
setDeadmanDays(uint256 days)
ownerHeartbeat()                   // Reset deadman switch
emergencyDrain()                   // Drain ALL USDC to owner
pause() / unpause()
```

### Meta-Transaction Transfer

```solidity
// Anyone can call — verifies EIP-712 signature from agent
executeTransfer(
  address to,
  uint256 amount,
  string memo,
  uint256 nonce,       // Must match current transferNonce
  uint256 deadline,    // Signature expiration
  bytes signature      // Agent's EIP-712 signature
)
```

### View Functions

```solidity
getRecipient(address)                     // Full recipient details
getRecipientList()                        // All recipient addresses
getVaultBalance()                         // Current USDC balance
getTransferHistory(uint256 count)         // Last N transfers
getPendingAgentRotation()                 // Pending agent + activation time
getDeadmanStatus()                        // Heartbeat, days, isExpired
getRemainingDailyAllowance(address)       // Today's remaining allowance
getRemainingMonthlyAllowance(address)     // This month's remaining
getDomainSeparator()                      // EIP-712 domain (for off-chain signing)
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js >= 18
- npm

### Install

```bash
cd agent-vault
npm install
```

### Compile

```bash
npm run compile
```

### Test

```bash
# Run all tests (v1 + v3)
npm test

# Run v3 tests only
npx hardhat test test/AgentVaultV3.test.js

# With gas reporting
npm run test:gas
```

### Deploy V3 to Base Sepolia

1. Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

2. Deploy:

```bash
npx hardhat run deploy/deploy-v3.js --network baseSepolia
```

3. Run demo (deposit, meta-tx transfer, emergency drain):

```bash
npx hardhat run scripts/demo-v3.js --network baseSepolia
```

---

## 🧪 Test Coverage

### V3 Tests (52 tests)

| Category | Tests |
|----------|-------|
| Deployment & Constructor | Initialization, invalid params |
| Owner Functions | Recipients, limits, settings, access control |
| Emergency Drain | Full drain, events, empty vault, auth |
| Meta-Tx Transfer (EIP-712) | Valid sig, bad sig, expired, bad nonce, replay, cap, whitelist, inactive, daily limit, paused |
| Transfer Cooldown | Enforce cooldown, allow after cooldown |
| Deadman Switch | Initial status, expired, heartbeat reset |
| Agent Rotation | Propose, timelock, activate, cancel, same-agent, events |
| Transfer History | Record, empty, cap |
| Deposit | Accept, reject zero |
| View Functions | Recipients, balance, domain separator, allowances |
| Owner Heartbeat | Update timestamp, events |
| Pause/Unpause | Pause, block transfers, allow drain when paused |

---

## 🔧 Configuration

### Base Sepolia

| Parameter | Value |
|-----------|-------|
| Chain ID | 84532 |
| RPC | `https://sepolia.base.org` |
| USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Block Explorer | `https://sepolia.basescan.org` |

### V3 Default Parameters

| Parameter | Default |
|-----------|---------|
| Vault Daily Limit | $10,000 |
| Max Per Transfer | $1,000 |
| Transfer Cooldown | 60 seconds |
| Deadman Days | 30 days |
| Agent Rotation Delay | 24 hours |
| Max History | 50 records |

---

## 📁 Project Structure

```
agent-vault/
├── contracts/
│   ├── AgentVault.sol          # V1 vault contract
│   ├── IAgentVault.sol         # V1 interface
│   ├── AgentVaultV3.sol        # V3 zero-trust meta-tx vault
│   ├── IAgentVaultV3.sol       # V3 interface
│   └── test/
│       └── MockUSDC.sol        # Mock token for tests
├── test/
│   ├── AgentVault.test.js      # V1 test suite
│   └── AgentVaultV3.test.js    # V3 test suite (52 tests)
├── deploy/
│   ├── deploy.js               # V1 deployment
│   └── deploy-v3.js            # V3 deployment
├── scripts/
│   └── demo-v3.js              # V3 demo transactions
├── hardhat.config.js
├── package.json
├── .env.example
└── README.md
```

---

## 🏆 Hackathon Notes

**Why AgentVault V3?**

V1 proved the concept. V3 makes it production-grade:

- **Zero-trust**: Agent signs, never touches ETH. If agent wallet is compromised, attacker can only sign (not submit). Relayer is a separate concern.
- **Defense-in-depth**: 8 layers of guardrails, each independently enforceable.
- **Deadman switch**: If the human disappears, the vault auto-freezes. No silent drain.
- **Agent rotation timelock**: 24h to catch a malicious agent change.

**Built with:**
- Solidity ^0.8.20
- OpenZeppelin v5 (Ownable, Pausable, ReentrancyGuard, SafeERC20, EIP712, ECDSA)
- Hardhat
- Base Sepolia (L2 for low gas costs)
- USDC (stable, trusted, 6 decimals)

---

## 📄 License

MIT
