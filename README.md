# 🏦 AgentVault

> **AI-Managed Wealth Wallet** — An on-chain USDC vault that lets an AI agent autonomously distribute funds to family members within human-defined guardrails.

Built for the **USDC Moltbook Hackathon** on **Base Sepolia**.

---

## 🧠 Architecture

```
┌──────────────┐    agentTransfer()    ┌───────────────┐    USDC    ┌──────────────┐
│   AI Agent   │ ────────────────────► │  AgentVault   │ ────────► │   Family     │
│  (Clawdbot)  │   (within limits)     │  (on-chain)   │           │  Members     │
└──────────────┘                       └───────────────┘           └──────────────┘
      │                                       ▲
      │ can ONLY call                         │ full admin
      │ agentTransfer()                       │ controls
      ▼                                  ┌────┴──────┐
 Guardrails:                             │   Owner   │
 • Whitelist only                        │  (Human)  │
 • Daily limits per recipient            └───────────┘
 • Monthly limits per recipient
 • Vault-wide daily cap
 • Pausable (emergency stop)
```

## 🔑 Key Concepts

### Two Roles, Clear Separation

| Role | Who | Can Do |
|------|-----|--------|
| **Owner** (human) | Vault creator | Add/remove recipients, set limits, pause, emergency withdraw, change agent |
| **Agent** (AI) | Clawdbot wallet | ONLY `agentTransfer()` — send USDC to whitelisted addresses within limits |

### Recipient Whitelist

Each recipient has:
- **Label** — Human-readable name ("Wife - Alice")
- **Purpose** — Category ("household", "allowance", "salary")
- **Daily Limit** — Max USDC per day (auto-resets every 24h)
- **Monthly Limit** — Max USDC per 30 days (auto-resets)
- **Spend Tracking** — On-chain daily and monthly spend counters
- **Active Flag** — Can be deactivated without deletion

### Multi-Layer Security

1. **Agent Role** — Only the designated agent wallet can call `agentTransfer()`
2. **Whitelist** — Can only send to pre-approved recipients
3. **Per-Recipient Limits** — Daily and monthly caps per person
4. **Vault-Wide Limit** — Total daily cap across all recipients
5. **Pausable** — Owner can freeze all transfers instantly
6. **OpenZeppelin** — Built on battle-tested Ownable, Pausable, ReentrancyGuard

---

## 📋 Contract Interface

### Owner Functions

```solidity
// Recipient management
addRecipient(address, label, purpose, dailyLimit, monthlyLimit)
removeRecipient(address)
updateLimits(address, dailyLimit, monthlyLimit)

// Agent management
setAgent(address)

// Vault controls
setDailyVaultLimit(uint256)
emergencyWithdraw(address to, uint256 amount)
pause()
unpause()
```

### Agent Functions

```solidity
// The ONLY function the AI agent can call
agentTransfer(address to, uint256 amount, string memo)
```

### Public Functions

```solidity
deposit(uint256 amount)  // Anyone can fund the vault (requires USDC approval)
```

### View Functions

```solidity
getRecipient(address)              // Full recipient details
getRecipientList()                 // All recipient addresses
getVaultBalance()                  // Current USDC balance
getRemainingDailyAllowance(addr)   // How much a recipient can receive today
getRemainingMonthlyAllowance(addr) // How much a recipient can receive this month
```

### Events

```solidity
TransferExecuted(address indexed to, uint256 amount, string memo, uint256 timestamp)
RecipientAdded(address indexed recipient, string label)
RecipientRemoved(address indexed recipient)
AgentUpdated(address indexed newAgent)
Deposited(address indexed from, uint256 amount)
DailyVaultLimitUpdated(uint256 newLimit)
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js >= 18
- npm or yarn

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
npm test

# With gas reporting
npm run test:gas
```

### Deploy to Base Sepolia

1. Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

2. Update recipient addresses and agent address in `deploy/deploy.js`

3. Deploy:

```bash
npm run deploy:base-sepolia
```

4. Verify on Basescan:

```bash
npx hardhat verify --network baseSepolia <VAULT_ADDRESS> <USDC_ADDRESS> <DAILY_VAULT_LIMIT>
```

---

## 🧪 Test Coverage

The test suite covers:

| Category | Tests |
|----------|-------|
| Deployment & Roles | Constructor validation, owner/agent setup |
| Recipient Management | Add, remove, update limits, access control |
| Agent Transfers | Within limits, exceeding limits, multi-recipient |
| Daily/Monthly Resets | Auto-reset after time periods |
| Pause/Unpause | Emergency stop and resume |
| Deposits & Withdrawals | Funding vault, emergency withdraw |
| Agent Management | Change agent, old agent blocked |
| Vault Limits | Vault-wide daily cap enforcement |

---

## 🔧 Configuration

### Base Sepolia

| Parameter | Value |
|-----------|-------|
| Chain ID | 84532 |
| RPC | `https://sepolia.base.org` |
| USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Block Explorer | `https://sepolia.basescan.org` |

### Default Limits

| Limit | Value |
|-------|-------|
| Vault Daily Limit | $10,000 |
| Example Recipient Daily | $100 — $2,000 |
| Example Recipient Monthly | $1,000 — $20,000 |

---

## 📁 Project Structure

```
agent-vault/
├── contracts/
│   ├── AgentVault.sol        # Main vault contract
│   ├── IAgentVault.sol       # Interface
│   └── test/
│       └── MockUSDC.sol      # Mock token for tests
├── test/
│   └── AgentVault.test.js    # Comprehensive test suite
├── deploy/
│   └── deploy.js             # Base Sepolia deployment
├── hardhat.config.js         # Hardhat configuration
├── package.json
├── .env.example
└── README.md
```

---

## 🏆 Hackathon Notes

**Why AgentVault?**

Traditional wallets require manual transactions. AgentVault introduces a new paradigm: **AI-managed finance with on-chain guardrails**. The human sets the rules, the AI executes within them.

**Use Cases:**
- 👨‍👩‍👧‍👦 Family expense management — AI pays allowances, bills, groceries
- 💼 Payroll distribution — AI handles recurring salary payments
- 🏢 Treasury management — AI optimizes fund allocation within budget
- 🎓 Education funds — AI distributes tuition and living expenses

**Built with:**
- Solidity ^0.8.20
- OpenZeppelin v5 (Ownable, Pausable, ReentrancyGuard, SafeERC20)
- Hardhat
- Base Sepolia (L2 for low gas costs)
- USDC (stable, trusted, 6 decimals)

---

## 📄 License

MIT
