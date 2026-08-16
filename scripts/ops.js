#!/usr/bin/env node
/**
 * LVAIR Protocol - Sovereign Operator CLI Tool
 * Professional protocol control script for founders & validators.
 * Run directly in terminal: node scripts/ops.js <command>
 */

import { Blockchain } from '../src/core/blockchain.js';
import { AMMPool } from '../src/core/amm.js';
import readline from 'readline';

const command = process.argv[2];

async function runOps() {
  console.log('\x1b[34m%s\x1b[0m', '═══════════════════════════════════════════════════════');
  console.log('\x1b[1m\x1b[36m%s\x1b[0m', '       ⚡ LVAIR PROTOCOL - OPERATOR CONSOLE ⚡        ');
  console.log('\x1b[34m%s\x1b[0m', '═══════════════════════════════════════════════════════');

  const blockchain = new Blockchain(2);
  await blockchain.init();
  const ammPool = new AMMPool(blockchain, 100000, 25000);

  switch (command) {
    case 'status':
    case 'info':
      console.log(`\x1b[32m✔ Protocol Status:\x1b[0m Mainnet Online`);
      console.log(`• Chain Height      : #${blockchain.chain.length} Blocks`);
      console.log(`• Spot Price        : $${ammPool.getCurrentPrice().toFixed(4)} USDT`);
      console.log(`• AMM Pool Reserves : ${ammPool.lvairReserve.toLocaleString()} LVAIR / $${ammPool.usdtReserve.toLocaleString()} USDT`);
      console.log(`• Airdrop Claimed   : ${blockchain.claimedAddresses.size} Wallets`);
      console.log(`• Pending Mempool   : ${blockchain.pendingTransactions.length} Transactions`);
      break;

    case 'mine':
      console.log('⛏️  Mining new block to ledger...');
      const start = Date.now();
      await blockchain.minePendingTransactions(blockchain.systemAddress);
      console.log(`\x1b[32m✔ Block #${blockchain.chain.length} successfully mined in ${Date.now() - start}ms!\x1b[0m`);
      break;

    case 'reset-airdrop':
      blockchain.claimedAddresses.clear();
      console.log('\x1b[32m✔ Airdrop claims whitelist has been completely reset!\x1b[0m');
      break;

    case 'rebalance':
      const airAmount = parseFloat(process.argv[3]) || 100000;
      const usdtAmount = parseFloat(process.argv[4]) || 25000;
      ammPool.lvairReserve = airAmount;
      ammPool.usdtReserve = usdtAmount;
      ammPool.k = airAmount * usdtAmount;
      console.log(`\x1b[32m✔ AMM Pool Rebalanced to ${airAmount.toLocaleString()} LVAIR / $${usdtAmount.toLocaleString()} USDT\x1b[0m`);
      break;

    default:
      console.log('Usage: node scripts/ops.js <command> [args]');
      console.log('\nAvailable Operator Commands:');
      console.log('  \x1b[33mstatus\x1b[0m          : View live ledger metrics, block height, and pool reserves');
      console.log('  \x1b[33mmine\x1b[0m            : Force mine pending transactions into a new block');
      console.log('  \x1b[33mreset-airdrop\x1b[0m   : Reset all claimed airdrop addresses');
      console.log('  \x1b[33mrebalance <air> <usdt>\x1b[0m : Rebalance liquidity reserves (e.g. node scripts/ops.js rebalance 150000 37500)');
      break;
  }
  console.log('\x1b[34m%s\x1b[0m', '═══════════════════════════════════════════════════════\n');
}

runOps().catch(console.error);
