# AgentVault — AI-Managed Wealth Wallet

## Overview
Smart contract vault where a human sets rules, and their AI agent (Clawdbot) autonomously manages USDC fund distribution to whitelisted recipients via chat requests.

## Hackathon
- **Event:** USDC OpenClaw Hackathon on Moltbook
- **Prize:** $30,000 USDC ($10K per track)
- **Deadline:** Sun Feb 8, 12:00 PM PST (Mon Feb 9, 5:00 AM JST)
- **Submit to:** m/usdc on Moltbook
- **Tracks:** SmartContract + AgenticCommerce

## Architecture

### Layer 1: Smart Contract (`AgentVault.sol`)
- Chain: Base Sepolia testnet
- Token: Test USDC
- Roles: Owner (human), Agent (Clawdbot), Recipients (whitelisted)
- Guardrails: whitelist-only, daily/monthly limits, pause, emergency withdraw

### Layer 2: Clawdbot Skill (`agent-vault`)
- Condition engine: human writes rules in natural language
- Contract interaction: ethers.js + Base Sepolia RPC
- Chat flow: recipients request funds via Telegram/any channel
- Auto-approve/deny based on conditions + onchain limits

### Layer 3: Easy Deployment
- Any Clawdbot/OpenClaw agent can install the skill
- Simple config: set contract address, private key, conditions
- `clawhub install agent-vault` ready

## Project Structure
```
agent-vault/
├── agent.md                    # This file
├── contracts/
│   ├── AgentVault.sol          # Main vault contract
│   ├── IAgentVault.sol         # Interface
│   └── test/
│       └── AgentVault.test.js  # Contract tests
├── deploy/
│   ├── deploy.js               # Deployment script
│   └── verify.js               # Verify on explorer
├── skill/
│   ├── SKILL.md                # Clawdbot skill definition
│   ├── agent-vault.js          # Main skill logic
│   ├── condition-engine.js     # Natural language condition evaluator
│   ├── vault-contract.js       # Contract interaction layer
│   ├── config-template.json    # Template config for new users
│   └── README.md               # Setup guide
├── hardhat.config.js           # Hardhat config
├── package.json
└── README.md                   # Full documentation
```

## Use Cases
1. **Family Wealth Management** — family members request funds, AI evaluates
2. **Company Payroll/Expenses** — employees request reimbursements
3. **DAO Treasury** — proposals auto-funded if conditions met
4. **Charity/Grants** — applicants request funding, AI screens

## Timeline
- Day 1: Smart contract + deploy
- Day 2: Clawdbot skill + condition engine
- Day 3: Chat integration + end-to-end demo
- Day 4: Polish, docs, submit to Moltbook
