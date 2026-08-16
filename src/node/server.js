import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import { Blockchain } from '../core/blockchain.js';
import { AMMPool } from '../core/amm.js';
import { TradingBotEngine } from '../core/market-maker.js';
import { NodeStorageEngine } from './storage.js';
import { Transaction, Block } from '../core/block.js';
import { P2PNetwork } from './p2p.js';
import {
  rebuildPoolState, rebuildClaimedAddresses, applyBlockToPool,
  validateBlock, chainIsValid, sameChain
} from './consensus.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(__dirname, '../../data');
const LOGS_DIR = path.resolve(DATA_DIR, 'logs');
const LOG_FILE = path.resolve(LOGS_DIR, 'node.log');
const DIST_DIR = path.resolve(__dirname, '../../dist');
const PEERS_FILE = path.resolve(DATA_DIR, 'peers.json');

const HTTP_PORT = Number(process.env.HTTP_PORT) || 3001;
const P2P_PORT = Number(process.env.P2P_PORT) || 6001;
const DIFFICULTY = Number(process.env.DIFFICULTY) || 2;
const AIRDROP_AMOUNT = Number(process.env.AIRDROP_AMOUNT) || 250;
const MINING_REWARD = Number(process.env.MINING_REWARD) || 10;
const ENABLE_BOT = process.env.ENABLE_BOT !== '0';
const MINER_INTERVAL = Number(process.env.MINER_INTERVAL) || 2000;

const rawHost = process.env.NODE_HOST || '';
const advertisedP2P = rawHost
  ? (rawHost.includes('://') ? rawHost : `ws://${rawHost}:${P2P_PORT}`)
  : '';
const seedNodes = (process.env.SEED_NODES || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

let botEngine = null;

if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

const broadcastLogs = [];
function logEvent(type, tag, message, data = {}) {
  const item = {
    id: Date.now() + Math.random(),
    timestamp: Date.now(),
    type,
    tag,
    message,
    data
  };
  broadcastLogs.unshift(item);
  if (broadcastLogs.length > 200) broadcastLogs.pop();
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(item) + '\n', 'utf8');
  } catch (e) {}
  console.log(`[${type}] ${message}`);
  return item;
}

function loadPeersFile() {
  try {
    if (fs.existsSync(PEERS_FILE)) return JSON.parse(fs.readFileSync(PEERS_FILE, 'utf8'));
  } catch (e) {}
  return [];
}

function savePeersFile(urls) {
  try {
    fs.writeFileSync(PEERS_FILE, JSON.stringify(urls, null, 2), 'utf8');
  } catch (e) {}
}

async function startFullNode() {
  console.log('===================================================');
  console.log('  LVAIR PROTOCOL FULL-NODE (L1 ENGINE)');
  console.log('===================================================');

  const storage = new NodeStorageEngine(DATA_DIR);
  await storage.open();
  console.log(`Database storage initialized at: ${DATA_DIR}`);
  console.log(`Telemetry ledger: ${LOG_FILE}`);

  const blockchain = new Blockchain(DIFFICULTY);
  blockchain.airdropClaimAmount = AIRDROP_AMOUNT;
  blockchain.miningReward = MINING_REWARD;

  const existingBlocks = await storage.readAllRawBlocks();
  if (existingBlocks.length > 0) {
    blockchain.chain = existingBlocks.map(b => Block.fromJSON(b));
    console.log(`Loaded ${existingBlocks.length} blocks from physical LevelDB & blk00000.dat ledger`);
  } else {
    await blockchain.init();
    await storage.appendRawBlock(blockchain.chain[0]);
    console.log('Genesis Block created and stored into LevelDB!');
  }

  const pool = rebuildPoolState(blockchain.chain);
  const ammPool = new AMMPool(blockchain, pool.lvairReserve, pool.usdtReserve);
  ammPool.priceHistory = pool.priceHistory;
  ammPool.trades = pool.trades;
  blockchain.claimedAddresses = rebuildClaimedAddresses(blockchain.chain);

  const seedSet = new Set([...seedNodes, ...loadPeersFile()]);
  const seenBlocks = new Set(blockchain.chain.map(b => b.hash));

  let lock = Promise.resolve();
  function withLock(fn) {
    const run = lock.then(async () => {
      try {
        return await fn();
      } catch (e) {
        logEvent('NODE_ERROR', 'tag-sync', `Consensus handler error: ${e.message}`);
        throw e;
      }
    }, fn);
    lock = run.catch(() => {});
    return run;
  }

  function applyBlockEffects(block) {
    blockchain.pendingTransactions = blockchain.pendingTransactions.filter(
      t => !(block.transactions || []).some(b => b.txHash === t.txHash)
    );
    applyBlockToPool(ammPool, block);
    for (const tx of block.transactions || []) {
      if (tx.type === 'AIRDROP_CLAIM' && tx.toAddress) {
        blockchain.claimedAddresses.add(tx.toAddress.toLowerCase());
      }
    }
  }

  async function minePending(minerAddress) {
    return withLock(async () => {
      if (!blockchain.pendingTransactions.length) return null;
      const block = await blockchain.minePendingTransactions(minerAddress);
      await storage.appendRawBlock(block);
      applyBlockEffects(block);
      seenBlocks.add(block.hash);
      p2p.broadcastBlock(block);
      logEvent('BLOCK_MINED', 'tag-block', `Block #${block.index} mined with ${block.transactions.length} transactions`, { block: block.index, txs: block.transactions.length });
      return block;
    });
  }

  const p2p = new P2PNetwork({
    p2pPort: P2P_PORT,
    advertisedUrl: advertisedP2P,
    seedNodes: Array.from(seedSet),
    getChain: () => blockchain.chain,
    log: (tag, msg) => console.log(`[${tag}] ${msg}`),
    onTx: (tx) => {
      withLock(async () => {
        try {
          tx = Transaction.fromJSON(tx);
          const inChain = blockchain.chain.some(b => (b.transactions || []).some(t => t.txHash === tx.txHash));
          if (inChain) return;
          await blockchain.addTransaction(tx);
          logEvent('TX_RECEIVED', 'tag-sync', `Transaction ${tx.txHash.slice(0, 10)}... received from peer (${tx.type})`);
        } catch (e) {}
      });
    },
    onBlock: (block) => {
      withLock(async () => {
        block = Block.fromJSON(block);
        if (seenBlocks.has(block.hash)) return;
        if (blockchain.chain.some(b => b.hash === block.hash)) { seenBlocks.add(block.hash); return; }

        const err = await validateBlock(block, blockchain.getLatestBlock());
        if (err) {
          logEvent('BLOCK_REJECTED', 'tag-block', `Block #${block.index} rejected (${err}); requesting chain sync`);
          p2p.broadcast({ type: 'getchain' });
          return;
        }

        await storage.appendRawBlock(block);
        seenBlocks.add(block.hash);
        blockchain.chain.push(block);
        applyBlockEffects(block);
        p2p.broadcastBlock(block);
        logEvent('BLOCK_RECEIVED', 'tag-block', `Block #${block.index} received from peer and appended (${block.transactions.length} txs)`);
      });
    },
    onChainReceived: (blocks) => {
      withLock(async () => {
        const candidate = blocks.map(b => Block.fromJSON(b));
        if (!candidate.length) return;
        const candidateTip = candidate[candidate.length - 1].hash;
        const myHeight = blockchain.chain.length;
        const myTip = myHeight ? blockchain.chain[blockchain.chain.length - 1].hash : '';
        if (candidate.length < myHeight) return;
        if (candidate.length === myHeight && candidateTip >= myTip) return;
        if (sameChain(blockchain.chain, candidate)) return;

        const check = await chainIsValid(candidate);
        if (!check.valid) {
          logEvent('CHAIN_REJECTED', 'tag-block', `Incoming chain invalid: ${check.error}`);
          return;
        }

        blockchain.chain = candidate;
        const p = rebuildPoolState(candidate);
        ammPool.lvairReserve = p.lvairReserve;
        ammPool.usdtReserve = p.usdtReserve;
        ammPool.priceHistory = p.priceHistory;
        ammPool.trades = p.trades;
        blockchain.claimedAddresses = rebuildClaimedAddresses(candidate);
        candidate.forEach(b => seenBlocks.add(b.hash));
        await storage.writeRawBlocks(candidate);

        logEvent('CHAIN_ADOPTED', 'tag-sync', `Adopted ${candidate.length === myHeight ? 'tie-break' : 'longer'} chain from peer (#${candidate.length} blocks)`);
      });
    }
  });

  await p2p.start();
  setInterval(() => {
    const all = [...seedNodes, ...p2p.getPeerUrls()];
    savePeersFile(Array.from(new Set(all)));
  }, 30000);

  const minerTimer = setInterval(() => { minePending(null); }, MINER_INTERVAL);

  if (ENABLE_BOT) {
    botEngine = new TradingBotEngine({
      blockchain, ammPool,
      submitSwap: async (wallet, amount, token) => submitSwap(wallet, amount, token)
    });
    botEngine.start(4000, ({ action, price }) => {
      logEvent('BOT_TRADE_SUBMITTED', 'tag-swap', `Market Maker ${action.type} ${action.inputAmount} ${action.inputToken} @ $${price.toFixed(4)} (${action.reason})`);
    });
    logEvent('BOT_STARTED', 'tag-sync', 'Autonomous Market Maker started');
  }

  async function submitTxAndBroadcast(tx) {
    tx.txHash = await tx.calculateHash();
    await blockchain.addTransaction(tx);
    p2p.broadcastTx(tx);
    return tx;
  }

  async function submitSwap(userAddress, inputAmount, inputToken) {
    const quote = ammPool.getQuote(inputAmount, inputToken);
    if (quote.outputAmount <= 0) throw new Error('Invalid swap output — pool reserves may be depleted');

    const inTx = new Transaction(userAddress, blockchain.poolAddress, Number(inputAmount), inputToken, 'SWAP_IN', { quoteRate: quote.executionPrice });
    const outTx = new Transaction(blockchain.poolAddress, userAddress, Number(quote.outputAmount.toFixed(4)), quote.outputToken, 'SWAP_OUT', {
      received: Number(quote.outputAmount.toFixed(4)),
      priceImpact: `${quote.priceImpact}%`
    });

    await submitTxAndBroadcast(inTx);
    await submitTxAndBroadcast(outTx);

    const isBuy = inputToken === 'USDT';
    const trade = {
      id: inTx.txHash,
      timestamp: Date.now(),
      user: userAddress,
      traderAddress: userAddress,
      type: isBuy ? 'BUY_LVAIR' : 'SELL_LVAIR',
      inputAmount: Number(inputAmount),
      inputToken,
      outputAmount: Number(quote.outputAmount.toFixed(4)),
      outputToken: quote.outputToken,
      price: ammPool.getCurrentPrice(),
      effectivePrice: Number(quote.executionPrice.toFixed(4)),
      blockIndex: null
    };

    return { trade, newPrice: ammPool.getCurrentPrice(), pending: true };
  }

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(express.static(DIST_DIR));

  app.get('/api/config', (req, res) => {
    res.json({
      success: true,
      network: 'LVAIR Mainnet L1',
      airdropClaimAmount: blockchain.airdropClaimAmount,
      miningReward: blockchain.miningReward,
      difficulty: blockchain.difficulty,
      genesisReserves: { lvair: 100000, usdt: 25000 },
      claimedCount: blockchain.claimedAddresses.size,
      poolReserves: {
        lvair: ammPool.lvairReserve,
        usdt: ammPool.usdtReserve,
        price: ammPool.getCurrentPrice()
      }
    });
  });

  app.get('/api/amm/state', (req, res) => {
    res.json({
      success: true,
      lvairReserve: ammPool.lvairReserve,
      usdtReserve: ammPool.usdtReserve,
      price: ammPool.getCurrentPrice(),
      priceHistory: ammPool.priceHistory,
      trades: ammPool.trades,
      botRunning: botEngine ? botEngine.isRunning : false,
      mempoolSize: blockchain.pendingTransactions.length
    });
  });

  app.get('/api/telemetry/logs', (req, res) => {
    res.json(broadcastLogs);
  });

  app.post('/api/telemetry/event', (req, res) => {
    try {
      const { type, tag, message, data } = req.body;
      if (!type || !message) return res.status(400).json({ error: 'Missing type or message' });
      logEvent(type, tag || 'tag-block', message, data || {});
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/airdrop/claim', async (req, res) => {
    try {
      const { userAddress } = req.body;
      if (!userAddress) throw new Error('userAddress is required');

      const norm = userAddress.toLowerCase();
      if (blockchain.claimedAddresses.has(norm)) {
        throw new Error('This address has already claimed the $LVAIR Genesis Airdrop.');
      }
      const pendingClaim = blockchain.pendingTransactions.find(
        t => t.type === 'AIRDROP_CLAIM' && (t.toAddress || '').toLowerCase() === norm
      );
      if (pendingClaim) {
        throw new Error('A claim for this address is already pending in the mempool.');
      }

      const tx = new Transaction(
        blockchain.systemAddress,
        userAddress,
        blockchain.airdropClaimAmount,
        'LVAIR',
        'AIRDROP_CLAIM',
        { campaign: 'Season 1 Genesis Community Airdrop' }
      );
      await submitTxAndBroadcast(tx);

      logEvent('AIRDROP_CLAIM_SUBMITTED', 'tag-claim', `Wallet ${userAddress.substring(0, 8)}... submitted airdrop claim (pending)`, { tx: tx.txHash });
      res.json({
        success: true,
        pending: true,
        txHash: tx.txHash,
        mempool: blockchain.pendingTransactions.length
      });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  app.post('/api/tx/send', async (req, res) => {
    try {
      const { from, to, amount, token, type, metadata } = req.body;
      const tx = new Transaction(from, to, amount, token || 'LVAIR', type || 'TRANSFER', metadata || {});
      await submitTxAndBroadcast(tx);

      logEvent('TRANSFER_SUBMITTED', 'tag-block', `Transfer ${amount} ${token} from ${from.substring(0, 6)}... to ${to.substring(0, 6)}... (pending)`, { tx: tx.txHash });
      res.json({
        success: true,
        pending: true,
        txHash: tx.txHash,
        mempool: blockchain.pendingTransactions.length
      });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  app.post('/api/swap', async (req, res) => {
    try {
      const { userAddress, inputAmount, inputToken } = req.body;
      const result = await submitSwap(userAddress, inputAmount, inputToken);

      logEvent('SWAP_SUBMITTED', 'tag-swap', `Swap broadcast: ${inputAmount} ${inputToken} by ${userAddress.substring(0, 6)}... (pending)`, { tx: result.trade.id });
      res.json({ success: true, pending: true, result });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  app.post('/api/mine', async (req, res) => {
    try {
      const { minerRewardAddress } = req.body || {};
      const block = await minePending(minerRewardAddress || null);
      res.json({
        success: true,
        blockIndex: block ? block.index : null,
        txCount: block ? block.transactions.length : 0
      });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  app.get('/api/node/status', (req, res) => {
    const tip = blockchain.getLatestBlock();
    res.json({
      network: 'LVAIR Mainnet L1',
      version: '1.1.0',
      blockHeight: blockchain.chain.length,
      latestBlockHash: tip.hash,
      merkleRoot: tip.merkleRoot,
      difficulty: blockchain.difficulty,
      p2pPeers: p2p.getStatus().connected,
      spotPrice: ammPool.getCurrentPrice(),
      airdropClaimAmount: blockchain.airdropClaimAmount,
      botRunning: botEngine ? botEngine.isRunning : false,
      mempoolSize: blockchain.pendingTransactions.length,
      reserves: {
        lvair: ammPool.lvairReserve,
        usdt: ammPool.usdtReserve
      },
      claimedWallets: blockchain.claimedAddresses.size
    });
  });

  app.get('/api/node/peers', (req, res) => {
    res.json({ success: true, ...p2p.getStatus() });
  });

  app.get('/api/blocks', (req, res) => {
    res.json(blockchain.chain);
  });

  app.get('/api/balance/:address', (req, res) => {
    const address = req.params.address;
    const isClaimed = Array.from(blockchain.claimedAddresses).some(
      addr => (addr || '').toLowerCase() === (address || '').toLowerCase()
    );
    res.json({
      address,
      lvair: blockchain.getBalanceOfAddress(address, 'LVAIR'),
      usdt: blockchain.getBalanceOfAddress(address, 'USDT'),
      hasClaimedAirdrop: isClaimed,
      currentAirdropQuota: blockchain.airdropClaimAmount
    });
  });

  app.post('/api/bot/toggle', async (req, res) => {
    try {
      if (botEngine && botEngine.isRunning) {
        botEngine.stop();
        logEvent('BOT_PAUSED', 'tag-sync', 'Autonomous Market Maker paused');
      } else {
        if (!botEngine) botEngine = new TradingBotEngine({
          blockchain, ammPool,
          submitSwap: async (wallet, amount, token) => submitSwap(wallet, amount, token)
        });
        botEngine.start(4000, ({ action, price }) => {
          logEvent('BOT_TRADE_SUBMITTED', 'tag-swap', `Market Maker ${action.type} ${action.inputAmount} ${action.inputToken} @ $${price.toFixed(4)} (${action.reason})`);
        });
        logEvent('BOT_STARTED', 'tag-sync', 'Autonomous Market Maker started');
      }
      res.json({ success: true, running: botEngine ? botEngine.isRunning : false });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  app.listen(HTTP_PORT, () => {
    console.log(`[RPC] HTTP RPC Server listening on http://0.0.0.0:${HTTP_PORT}`);
    logEvent('NODE_BOOT', 'tag-sync', `LVAIR Core Node booted on port ${HTTP_PORT} (P2P ${P2P_PORT})`);
  });
}

startFullNode().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});