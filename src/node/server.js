import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import { Blockchain } from '../core/blockchain.js';
import { AMMPool } from '../core/amm.js';
import { TradingBotEngine } from '../core/market-maker.js';

const VALID_BOT_MODES = TradingBotEngine.MODES;
import { NodeStorageEngine } from './storage.js';
import { Transaction, Block } from '../core/block.js';
import { P2PNetwork } from './p2p.js';
import {
  rebuildPoolState, rebuildClaimedAddresses, applyBlockToPool,
  validateBlock, chainIsValid, sameChain,
  computeTotalSupply, getMiningReward, MAX_SUPPLY
} from './consensus.js';
import { buildSignableMessage, verifySignature } from '../core/verify.js';
import { oracle } from './oracle.js';

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
const MIN_POOL_RESERVES = {
  lvair: Number(process.env.MIN_POOL_RESERVES_LVAIR) || 5000,
  usdt: Number(process.env.MIN_POOL_RESERVES_USDT) || 1250
};

const rawHost = process.env.NODE_HOST || '';
const advertisedP2P = rawHost
  ? (rawHost.includes('://') ? rawHost : `ws://${rawHost}:${P2P_PORT}`)
  : '';
const seedNodes = (process.env.SEED_NODES || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || crypto.randomBytes(32).toString('hex');
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const ENABLE_SIGNING = process.env.DISABLE_SIGNING !== '1';

let botEngine = null;
let botStrategyMode = 'volatile';

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
  } catch (e) { console.warn('[LOG] Failed to write log:', e.message); }
  console.log(`[${type}] ${message}`);
  return item;
}

function loadPeersFile() {
  try {
    if (fs.existsSync(PEERS_FILE)) return JSON.parse(fs.readFileSync(PEERS_FILE, 'utf8'));
  } catch (e) { console.warn('[P2P] Failed to load peers file:', e.message); }
  return [];
}

function savePeersFile(urls) {
  try {
    fs.writeFileSync(PEERS_FILE, JSON.stringify(urls, null, 2), 'utf8');
  } catch (e) { console.warn('[P2P] Failed to save peers file:', e.message); }
}

async function startFullNode() {
  console.log('===================================================');
  console.log('  LVAIR PROTOCOL FULL-NODE (L1 ENGINE)');
  console.log('===================================================');

  const storage = new NodeStorageEngine(DATA_DIR);
  await storage.open();
  console.log(`Database storage initialized at: ${DATA_DIR}`);
  console.log(`Telemetry ledger: ${LOG_FILE}`);

  const persistedBotMode = await storage.getState('bot_strategy_mode');
  if (persistedBotMode && VALID_BOT_MODES.includes(persistedBotMode)) {
    botStrategyMode = persistedBotMode;
    console.log(`Restored market-maker strategy: ${botStrategyMode}`);
  }
  const persistedBotRunning = (await storage.getState('bot_running')) !== '0';

  const blockchain = new Blockchain(DIFFICULTY);
  blockchain.airdropClaimAmount = AIRDROP_AMOUNT;
  blockchain.miningReward = MINING_REWARD;

  let existingBlocks = await storage.readAllRawBlocks();
  if (existingBlocks.length === 0) {
    const recovered = await storage.readBlocksFromChainstate();
    if (recovered.length > 0) {
      const recoveredBlocks = recovered.map(b => Block.fromJSON(b));
      const check = await chainIsValid(recoveredBlocks);
      if (check.valid) {
        await storage.writeRawBlocks(recovered);
        console.log(`Recovered ${recovered.length} blocks from LevelDB chainstate -> blk00000.dat ledger restored`);
        existingBlocks = recovered;
      } else {
        console.log(`Chainstate recovery skipped (${check.error}); starting fresh genesis`);
      }
    }
  }
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

  const txIndex = new Map();
  for (const block of blockchain.chain) {
    for (const tx of (block.transactions || [])) {
      if (tx.txHash) txIndex.set(tx.txHash, { tx, blockIndex: block.index, blockHash: block.hash, blockTs: block.timestamp });
    }
  }
  console.log(`[EXPLORER] Indexed ${txIndex.size} transactions from ${blockchain.chain.length} blocks`);

  const savedMempool = await storage.loadMempool();
  if (savedMempool.length > 0) {
    const validPending = [];
    for (const txData of savedMempool) {
      try {
        const tx = Transaction.fromJSON(txData);
        const inChain = blockchain.chain.some(b => (b.transactions || []).some(t => t.txHash === tx.txHash));
        if (!inChain) {
          await blockchain.addTransaction(tx);
          validPending.push(txData);
        }
      } catch (e) { console.warn(`[MEMPOOL] Failed to restore tx: ${e.message}`); }
    }
    console.log(`Restored ${validPending.length} pending transactions from mempool`);
  }

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
    lock = run.catch(e => { console.warn('[LOCK] Consensus lock broken:', e.message); });
    return run;
  }

  async function applyBlockEffects(block) {
    blockchain.pendingTransactions = blockchain.pendingTransactions.filter(
      t => !(block.transactions || []).some(b => b.txHash === t.txHash)
    );
    await storage.saveMempool(blockchain.pendingTransactions);
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
      const dynamicReward = getMiningReward(blockchain.chain);
      if (dynamicReward !== blockchain.miningReward) {
        console.log(`[EMISSION] Mining reward adjusted: ${blockchain.miningReward} -> ${dynamicReward} (supply ${computeTotalSupply(blockchain.chain).toLocaleString()}/${MAX_SUPPLY.toLocaleString()})`);
        blockchain.miningReward = dynamicReward;
      }
      const block = await blockchain.minePendingTransactions(minerAddress);
      await storage.appendRawBlock(block);
      for (const tx of (block.transactions || [])) {
        if (tx.txHash) txIndex.set(tx.txHash, { tx, blockIndex: block.index, blockHash: block.hash, blockTs: block.timestamp });
      }
      await applyBlockEffects(block);
      seenBlocks.add(block.hash);
      p2p.broadcastBlock(block);
      logEvent('BLOCK_MINED', 'tag-block', `Block #${block.index} mined with ${block.transactions.length} transactions`, { block: block.index, txs: block.transactions.length, supply: computeTotalSupply(blockchain.chain) });
      return block;
    });
  }

  const p2p = new P2PNetwork({
    p2pPort: P2P_PORT,
    advertisedUrl: advertisedP2P,
    seedNodes: Array.from(seedSet),
    getChain: () => blockchain.chain,
    dataDir: DATA_DIR,
    log: (tag, msg) => console.log(`[${tag}] ${msg}`),
    onTx: (tx) => {
      withLock(async () => {
        try {
          tx = Transaction.fromJSON(tx);
          const inChain = blockchain.chain.some(b => (b.transactions || []).some(t => t.txHash === tx.txHash));
          if (inChain) return;
          await blockchain.addTransaction(tx);
          logEvent('TX_RECEIVED', 'tag-sync', `Transaction ${tx.txHash.slice(0, 10)}... received from peer (${tx.type})`);
        } catch (e) { logEvent('TX_ERROR', 'tag-sync', `Peer tx rejected: ${e.message}`); }
      });
    },
    onBlock: (block) => {
      withLock(async () => {
        block = Block.fromJSON(block);
        if (seenBlocks.has(block.hash)) return;
        if (blockchain.chain.some(b => b.hash === block.hash)) { seenBlocks.add(block.hash); return; }

        const err = await validateBlock(block, blockchain.getLatestBlock(), { chain: blockchain.chain });
        if (err) {
          logEvent('BLOCK_REJECTED', 'tag-block', `Block #${block.index} rejected (${err}); requesting chain sync`);
          p2p.broadcast({ type: 'getchain' });
          return;
        }

        await storage.appendRawBlock(block);
        seenBlocks.add(block.hash);
        blockchain.chain.push(block);
        for (const tx of (block.transactions || [])) {
          if (tx.txHash) txIndex.set(tx.txHash, { tx, blockIndex: block.index, blockHash: block.hash, blockTs: block.timestamp });
        }
        await applyBlockEffects(block);
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
        txIndex.clear();
        for (const b of candidate) {
          for (const tx of (b.transactions || [])) {
            if (tx.txHash) txIndex.set(tx.txHash, { tx, blockIndex: b.index, blockHash: b.hash, blockTs: b.timestamp });
          }
        }
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
    botEngine.setMode(botStrategyMode);
    if (persistedBotRunning) {
      botEngine.start(4000, ({ action, price }) => {
        logEvent('BOT_TRADE_SUBMITTED', 'tag-swap', `Market Maker ${action.type} ${action.inputAmount} ${action.inputToken} @ $${price.toFixed(4)} (${action.reason})`);
      });
      logEvent('BOT_STARTED', 'tag-sync', 'Autonomous Market Maker started');
    } else {
      logEvent('BOT_STARTED', 'tag-sync', 'Market Maker kept paused (previously stopped)');
    }
  }

  oracle.start(60000);

  async function submitTxAndBroadcast(tx) {
    tx.txHash = await tx.calculateHash();
    await blockchain.addTransaction(tx);
    await storage.saveMempool(blockchain.pendingTransactions);
    p2p.broadcastTx(tx);
    return tx;
  }

  async function submitSwap(userAddress, inputAmount, inputToken, signatureData = null) {
    const quote = ammPool.getQuote(inputAmount, inputToken);
    if (quote.outputAmount <= 0) throw new Error('Invalid swap output — pool reserves may be depleted');

    if (ENABLE_SIGNING && signatureData && userAddress !== blockchain.systemAddress) {
      const expectedNonce = await getNonce(userAddress);
      const sigNonce = signatureData.nonce || 0;
      if (sigNonce !== expectedNonce) {
        throw new Error(`Nonce mismatch: expected ${expectedNonce}, got ${sigNonce}`);
      }
      const txMsg = buildSignableMessage({
        from: userAddress,
        to: blockchain.poolAddress,
        amount: Number(inputAmount),
        token: inputToken,
        type: 'SWAP_IN',
        nonce: sigNonce,
        timestamp: signatureData.timestamp
      });
      const valid = verifySignature(txMsg, signatureData.signature, userAddress, signatureData.chainType);
      if (!valid) throw new Error('Transaction signature verification failed');
    }

    const newNonce = await incrementNonce(userAddress);

    const inTx = new Transaction(userAddress, blockchain.poolAddress, Number(inputAmount), inputToken, 'SWAP_IN', { quoteRate: quote.executionPrice });
    inTx.nonce = newNonce;
    if (signatureData) {
      inTx.signature = typeof signatureData.signature === 'string' ? signatureData.signature : JSON.stringify(signatureData.signature);
      inTx.signerPublicKey = signatureData.address || userAddress;
      inTx.chainType = signatureData.chainType || '';
    }
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
  app.use(cors({
    origin: ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS : '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(DIST_DIR));

  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api/') && !req.path.includes('.')) {
      return res.sendFile(path.join(DIST_DIR, 'index.html'));
    }
    next();
  });

  const rateLimitStore = new Map();
  function rateLimit(windowMs = 10000, max = 20) {
    return (req, res, next) => {
      const ip = req.ip || req.connection.remoteAddress;
      const now = Date.now();
      const entry = rateLimitStore.get(ip);
      if (!entry || now - entry.start > windowMs) {
        rateLimitStore.set(ip, { start: now, count: 1 });
        return next();
      }
      entry.count++;
      if (entry.count > max) {
        return res.status(429).json({ success: false, error: 'Rate limit exceeded. Slow down.' });
      }
      next();
    };
  }
  setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of rateLimitStore) {
      if (now - entry.start > 120000) rateLimitStore.delete(ip);
    }
  }, 60000);

  function requireAdmin(req, res, next) {
    const auth = req.headers.authorization || '';
    const token = auth.replace(/^Bearer\s+/i, '');
    if (token !== ADMIN_TOKEN) {
      return res.status(401).json({ success: false, error: 'Unauthorized — valid admin token required' });
    }
    next();
  }

  const nonceTracker = new Map();
  async function getNonce(address) {
    const key = (address || '').toLowerCase();
    if (nonceTracker.has(key)) return nonceTracker.get(key);
    let maxNonce = 0;
    for (const block of blockchain.chain) {
      for (const tx of block.transactions || []) {
        if ((tx.fromAddress || '').toLowerCase() === key && (tx.nonce || 0) > maxNonce) {
          maxNonce = tx.nonce;
        }
      }
    }
    nonceTracker.set(key, maxNonce);
    return maxNonce;
  }
  async function incrementNonce(address) {
    const key = (address || '').toLowerCase();
    const current = await getNonce(address);
    nonceTracker.set(key, current + 1);
    return current + 1;
  }

  app.get('/api/config', (req, res) => {
    const totalSupply = computeTotalSupply(blockchain.chain);
    res.json({
      success: true,
      network: 'LVAIR Mainnet L1',
      airdropClaimAmount: blockchain.airdropClaimAmount,
      miningReward: blockchain.miningReward,
      difficulty: blockchain.difficulty,
      genesisReserves: { lvair: 100000, usdt: 25000 },
      maxSupply: MAX_SUPPLY,
      totalSupply,
      supplyRemaining: Math.max(0, MAX_SUPPLY - totalSupply),
      claimedCount: blockchain.claimedAddresses.size,
      poolReserves: {
        lvair: ammPool.lvairReserve,
        usdt: ammPool.usdtReserve,
        price: ammPool.getCurrentPrice()
      }
    });
  });

  app.post('/api/config/airdrop', requireAdmin, async (req, res) => {
    try {
      const amount = Number(req.body && req.body.amount);
      if (!amount || amount <= 0 || amount > 1000000) {
        return res.status(400).json({ success: false, error: 'Invalid airdrop amount' });
      }
      blockchain.airdropClaimAmount = amount;
      logEvent('AIRDROP_QUOTA_UPDATED', 'tag-claim', `Airdrop quota updated to ${amount} $LVAIR per wallet (node runtime)`, { amount });
      res.json({ success: true, airdropClaimAmount: amount });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  function computeMarketMetrics() {
    const balances = {};
    const apply = (address, delta) => {
      if (!address) return;
      const key = address.toLowerCase();
      balances[key] = (balances[key] || 0) + delta;
    };
    for (const block of blockchain.chain) {
      for (const tx of block.transactions || []) {
        if (tx.token !== 'LVAIR') continue;
        apply(tx.fromAddress, -Number(tx.amount));
        apply(tx.toAddress, Number(tx.amount));
      }
    }
    for (const tx of blockchain.pendingTransactions || []) {
      if (tx.token !== 'LVAIR') continue;
      apply(tx.fromAddress, -Number(tx.amount));
    }
    let lvairSupply = 0;
    for (const v of Object.values(balances)) {
      if (v > 0) lvairSupply += v;
    }
    const price = ammPool.getCurrentPrice();
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    let volume24h = 0;
    for (const t of ammPool.trades || []) {
      if (now - (t.timestamp || 0) > day) continue;
      const usdtAmt = t.inputToken === 'USDT' ? Number(t.inputAmount || 0) : Number(t.outputAmount || 0);
      volume24h += usdtAmt;
    }
    return {
      marketCap: price * lvairSupply,
      volume24h,
      circulatingSupply: lvairSupply
    };
  }

  app.get('/api/amm/state', (req, res) => {
    const metrics = computeMarketMetrics();
    const oracleSnap = oracle.getSnapshot();
    res.json({
      success: true,
      lvairReserve: ammPool.lvairReserve,
      usdtReserve: ammPool.usdtReserve,
      price: ammPool.getCurrentPrice(),
      priceHistory: ammPool.priceHistory.slice(-1000),
      trades: ammPool.trades,
      botRunning: botEngine ? botEngine.isRunning : false,
      botMode: botEngine ? botEngine.getMode() : botStrategyMode,
      minPoolReserves: MIN_POOL_RESERVES,
      mempoolSize: blockchain.pendingTransactions.length,
      marketCap: metrics.marketCap,
      volume24h: metrics.volume24h,
      circulatingSupply: metrics.circulatingSupply,
      oracle: oracleSnap
    });
  });

  const TF_BUCKET_MS = {
    'S30': 30 * 1000,
    'M1': 60 * 1000,
    'M5': 5 * 60 * 1000,
    'M15': 15 * 60 * 1000,
    'M30': 30 * 60 * 1000,
    'H1': 60 * 60 * 1000,
    'H4': 4 * 60 * 60 * 1000,
    'D1': 24 * 60 * 60 * 1000,
    'W1': 7 * 24 * 60 * 60 * 1000,
    'MN': 30 * 24 * 60 * 60 * 1000,
  };
  const TF_RANGE_MS = {
    'S30': 2 * 60 * 60 * 1000,
    'M1': 24 * 60 * 60 * 1000,
    'M5': 7 * 24 * 60 * 60 * 1000,
    'M15': 30 * 24 * 60 * 60 * 1000,
    'M30': 60 * 24 * 60 * 60 * 1000,
    'H1': 180 * 24 * 60 * 60 * 1000,
    'H4': 365 * 24 * 60 * 60 * 1000,
    'D1': 730 * 24 * 60 * 60 * 1000,
    'W1': 1825 * 24 * 60 * 60 * 1000,
    'MN': Infinity,
  };

  function buildCandles(history, tf) {
    const bucket = TF_BUCKET_MS[tf];
    const range = TF_RANGE_MS[tf];
    const now = Date.now();
    const cutoff = range === Infinity ? 0 : now - range;
    const raw = [];
    let current = null;
    for (const p of history) {
      if (p.timestamp < cutoff) continue;
      const b = Math.floor(p.timestamp / bucket) * bucket;
      if (!current || current.time !== b) {
        if (current) raw.push(current);
        current = { time: b, open: p.price, high: p.price, low: p.price, close: p.price, volume: 0 };
      } else {
        current.high = Math.max(current.high, p.price);
        current.low = Math.min(current.low, p.price);
        current.close = p.price;
      }
      const prevLv = raw.length > 0 ? raw[raw.length - 1].lvair : (current.lvair || 0);
      current.volume += Math.abs((p.lvairReserve || 0) - prevLv);
      current.lvair = p.lvairReserve || 0;
    }
    if (current) raw.push(current);
    if (raw.length < 2) return raw;

    const candles = [];
    let t = raw[0].time;
    const lastT = raw[raw.length - 1].time;
    let ri = 0;
    let lastClose = raw[0].open;
    while (t <= lastT) {
      if (ri < raw.length && raw[ri].time === t) {
        candles.push({ time: raw[ri].time, open: raw[ri].open, high: raw[ri].high, low: raw[ri].low, close: raw[ri].close, volume: raw[ri].volume });
        lastClose = raw[ri].close;
        ri++;
      } else {
        candles.push({ time: t, open: lastClose, high: lastClose, low: lastClose, close: lastClose, volume: 0 });
      }
      t += bucket;
    }
    return candles;
  }

  app.get('/api/chart', (req, res) => {
    const tf = String(req.query.tf || 'LIVE');
    if (tf === 'LIVE') {
      const history = ammPool.priceHistory;
      const points = history.slice(-5000).map(p => ({ timestamp: p.timestamp, price: p.price }));
      return res.json({ success: true, tf, candles: null, points });
    }
    if (!TF_BUCKET_MS[tf]) {
      return res.status(400).json({ success: false, error: `Unsupported timeframe: ${tf}. Use S30,M1,M5,M15,M30,H1,H4,D1,W1,MN` });
    }
    res.json({ success: true, tf, candles: buildCandles(ammPool.priceHistory, tf), points: null });
  });

  app.post('/api/liquidity/provision', rateLimit(10000, 3), requireAdmin, async (req, res) => {
    try {
      const { lvairAmount, usdtAmount, operatorAddress } = req.body || {};
      const lv = Number(lvairAmount);
      const us = Number(usdtAmount);
      if (!operatorAddress) throw new Error('operatorAddress is required');
      if (!(lv > 0) && !(us > 0)) throw new Error('Provide at least one token amount');

      for (const [amt, tok] of [[lv, 'LVAIR'], [us, 'USDT']]) {
        if (amt > 0) {
          const bal = blockchain.getBalanceOfAddress(operatorAddress, tok);
          if (bal < amt) throw new Error(`Insufficient ${tok} balance. Available: ${bal} ${tok}`);
        }
      }

      const lvTx = lv > 0
        ? new Transaction(operatorAddress, blockchain.poolAddress, lv, 'LVAIR', 'LP_PROVISION', { operation: 'PROVISION' })
        : null;
      const usTx = us > 0
        ? new Transaction(operatorAddress, blockchain.poolAddress, us, 'USDT', 'LP_PROVISION', { operation: 'PROVISION' })
        : null;

      for (const tx of [lvTx, usTx]) if (tx) await submitTxAndBroadcast(tx);
      const block = await minePending(null);

      logEvent('LIQUIDITY_PROVISIONED', 'tag-pool', `Liquidity provisioned: ${lv > 0 ? lv + ' LVAIR' : ''}${lv > 0 && us > 0 ? ' + ' : ''}${us > 0 ? us + ' USDT' : ''}`, { lvairAmount: lv, usdtAmount: us, block: block ? block.index : null });
      res.json({ success: true, blockIndex: block ? block.index : null, lvairReserve: ammPool.lvairReserve, usdtReserve: ammPool.usdtReserve, price: ammPool.getCurrentPrice() });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  app.post('/api/liquidity/withdrawal', rateLimit(10000, 3), requireAdmin, async (req, res) => {
    try {
      const { lvairAmount, usdtAmount, operatorAddress } = req.body || {};
      const lv = Number(lvairAmount);
      const us = Number(usdtAmount);
      if (!operatorAddress) throw new Error('operatorAddress is required');
      if (!(lv > 0) && !(us > 0)) throw new Error('Specify an amount to withdraw');

      if (ammPool.lvairReserve - lv < MIN_POOL_RESERVES.lvair) {
        throw new Error(`Withdrawal would breach the minimum reserve requirement of ${MIN_POOL_RESERVES.lvair} LVAIR`);
      }
      if (ammPool.usdtReserve - us < MIN_POOL_RESERVES.usdt) {
        throw new Error(`Withdrawal would breach the minimum reserve requirement of ${MIN_POOL_RESERVES.usdt} USDT`);
      }

      const lvTx = lv > 0
        ? new Transaction(blockchain.poolAddress, operatorAddress, lv, 'LVAIR', 'LP_WITHDRAWAL', { operation: 'WITHDRAWAL' })
        : null;
      const usTx = us > 0
        ? new Transaction(blockchain.poolAddress, operatorAddress, us, 'USDT', 'LP_WITHDRAWAL', { operation: 'WITHDRAWAL' })
        : null;

      for (const tx of [lvTx, usTx]) if (tx) await submitTxAndBroadcast(tx);
      const block = await minePending(null);

      logEvent('LIQUIDITY_WITHDRAWN', 'tag-pool', `Liquidity withdrawn: ${lv > 0 ? lv + ' LVAIR' : ''}${lv > 0 && us > 0 ? ' + ' : ''}${us > 0 ? us + ' USDT' : ''}`, { lvairAmount: lv, usdtAmount: us, block: block ? block.index : null });
      res.json({ success: true, blockIndex: block ? block.index : null, lvairReserve: ammPool.lvairReserve, usdtReserve: ammPool.usdtReserve, price: ammPool.getCurrentPrice() });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
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

  app.post('/api/airdrop/claim', rateLimit(30000, 3), async (req, res) => {
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

  app.post('/api/tx/send', rateLimit(5000, 5), async (req, res) => {
    try {
      const { from, to, amount, token, type, metadata, signature, signatureData } = req.body;
      if (!from || !to || !amount) {
        return res.status(400).json({ success: false, error: 'Missing required fields' });
      }

      if (ENABLE_SIGNING && from !== blockchain.systemAddress && !from.startsWith('0xbot_')) {
        const sigData = signature || signatureData;
        if (!sigData) {
          return res.status(401).json({ success: false, error: 'Transaction signature required' });
        }
        const expectedNonce = await getNonce(from);
        const sigNonce = sigData.nonce || 0;
        if (sigNonce !== expectedNonce) {
          return res.status(401).json({ success: false, error: `Nonce mismatch: expected ${expectedNonce}, got ${sigNonce}` });
        }
        const txMsg = buildSignableMessage({
          from, to, amount: Number(amount),
          token: token || 'LVAIR',
          type: type || 'TRANSFER',
          nonce: sigNonce,
          timestamp: sigData.timestamp
        });
        const valid = verifySignature(txMsg, sigData.signature, from, sigData.chainType);
        if (!valid) {
          return res.status(401).json({ success: false, error: 'Transaction signature verification failed' });
        }
      }

      const newNonce = from !== blockchain.systemAddress && !from.startsWith('0xbot_')
        ? await incrementNonce(from) : 0;

      const tx = new Transaction(from, to, amount, token || 'LVAIR', type || 'TRANSFER', metadata || {});
      tx.nonce = newNonce;
      if (signature || signatureData) {
        const sd = signature || signatureData;
        tx.signature = typeof sd.signature === 'string' ? sd.signature : JSON.stringify(sd.signature);
        tx.signerPublicKey = sd.address || from;
        tx.chainType = sd.chainType || '';
      }
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

  app.post('/api/swap', rateLimit(5000, 5), async (req, res) => {
    try {
      const { userAddress, inputAmount, inputToken, signature, signatureData } = req.body;
      if (!userAddress || !inputAmount || !inputToken) {
        return res.status(400).json({ success: false, error: 'Missing required fields' });
      }
      const sigData = signature || signatureData || null;
      const result = await submitSwap(userAddress, inputAmount, inputToken, sigData);

      logEvent('SWAP_SUBMITTED', 'tag-swap', `Swap broadcast: ${inputAmount} ${inputToken} by ${userAddress.substring(0, 6)}... (pending)`, { tx: result.trade.id });
      res.json({ success: true, pending: true, result });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  app.post('/api/mine', requireAdmin, async (req, res) => {
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
    const totalSupply = computeTotalSupply(blockchain.chain);
    res.json({
      network: 'LVAIR Mainnet L1',
      version: '1.2.0',
      blockHeight: blockchain.chain.length,
      latestBlockHash: tip.hash,
      merkleRoot: tip.merkleRoot,
      difficulty: blockchain.difficulty,
      p2pPeers: p2p.getStatus().connected,
      spotPrice: ammPool.getCurrentPrice(),
      airdropClaimAmount: blockchain.airdropClaimAmount,
      botRunning: botEngine ? botEngine.isRunning : false,
      mempoolSize: blockchain.pendingTransactions.length,
      maxSupply: MAX_SUPPLY,
      totalSupply,
      supplyRemaining: Math.max(0, MAX_SUPPLY - totalSupply),
      miningReward: blockchain.miningReward,
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
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const chain = blockchain.chain;
    const total = chain.length;
    const totalPages = Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const blocks = chain.slice().reverse().slice(start, start + limit);
    res.json({ blocks, page, limit, total, totalPages });
  });

  app.get('/api/block/:height', (req, res) => {
    const height = parseInt(req.params.height);
    if (isNaN(height) || height < 0 || height >= blockchain.chain.length) {
      return res.status(404).json({ error: 'Block not found' });
    }
    const block = blockchain.chain[height];
    res.json({ block });
  });

  app.get('/api/tx/:hash', (req, res) => {
    const entry = txIndex.get(req.params.hash);
    if (!entry) return res.status(404).json({ error: 'Transaction not found' });
    res.json({ tx: entry.tx, blockIndex: entry.blockIndex, blockHash: entry.blockHash, blockTimestamp: entry.blockTs });
  });

  app.get('/api/txs', (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const all = Array.from(txIndex.values()).sort((a, b) => (b.blockIndex || 0) - (a.blockIndex || 0));
    const total = all.length;
    const totalPages = Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const txs = all.slice(start, start + limit).map(e => ({
      txHash: e.tx.txHash,
      type: e.tx.type,
      from: e.tx.fromAddress,
      to: e.tx.toAddress,
      amount: e.tx.amount,
      token: e.tx.token,
      blockIndex: e.blockIndex,
      timestamp: e.blockTs
    }));
    res.json({ txs, page, limit, total, totalPages });
  });

  app.get('/api/oracle/prices', (req, res) => {
    res.json({ success: true, ...oracle.getSnapshot() });
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
      currentAirdropQuota: blockchain.airdropClaimAmount,
      nonce: nonceTracker.get(address.toLowerCase()) || 0
    });
  });

  app.post('/api/bot/toggle', requireAdmin, async (req, res) => {
    try {
      if (botEngine && botEngine.isRunning) {
        botEngine.stop();
        logEvent('BOT_PAUSED', 'tag-sync', 'Autonomous Market Maker paused');
      } else {
        if (!botEngine) botEngine = new TradingBotEngine({
          blockchain, ammPool,
          submitSwap: async (wallet, amount, token) => submitSwap(wallet, amount, token)
        });
        botEngine.setMode(botStrategyMode);
        botEngine.start(4000, ({ action, price }) => {
          logEvent('BOT_TRADE_SUBMITTED', 'tag-swap', `Market Maker ${action.type} ${action.inputAmount} ${action.inputToken} @ $${price.toFixed(4)} (${action.reason})`);
        });
        logEvent('BOT_STARTED', 'tag-sync', 'Autonomous Market Maker started');
      }
      await storage.putState('bot_running', botEngine && botEngine.isRunning ? '1' : '0');
      res.json({ success: true, running: botEngine ? botEngine.isRunning : false });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  app.post('/api/bot/mode', requireAdmin, async (req, res) => {
    try {
      const { mode } = req.body || {};
      if (!VALID_BOT_MODES.includes(mode)) {
        return res.status(400).json({ success: false, error: 'Invalid strategy mode' });
      }
      botStrategyMode = mode;
      if (botEngine) botEngine.setMode(mode);
      await storage.putState('bot_strategy_mode', mode);
      logEvent('BOT_MODE_UPDATED', 'tag-sync', `Market Maker strategy set to ${mode}`);
      res.json({ success: true, mode });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  const httpServer = app.listen(HTTP_PORT, () => {
    console.log(`[RPC] HTTP RPC Server listening on http://0.0.0.0:${HTTP_PORT}`);
    if (ADMIN_TOKEN && !process.env.ADMIN_TOKEN) console.log(`[SECURITY] Admin token (auto): ${ADMIN_TOKEN}`);
    else if (ADMIN_TOKEN) console.log(`[SECURITY] Admin token: ${ADMIN_TOKEN.substring(0, 8)}...`);
    console.log(`[SECURITY] Transaction signing: ${ENABLE_SIGNING ? 'ENABLED' : 'DISABLED'}`);
    console.log(`[SECURITY] CORS origins: ${ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS.join(', ') : 'ALL (open)'}`);
    logEvent('NODE_BOOT', 'tag-sync', `LVAIR Core Node booted on port ${HTTP_PORT} (P2P ${P2P_PORT})`);
  });

  async function gracefulShutdown(signal) {
    console.log(`\n[${signal}] Shutting down gracefully...`);
    oracle.stop();
    if (botEngine && botEngine.isRunning) botEngine.stop();
    await storage.saveMempool(blockchain.pendingTransactions);
    console.log(`[SHUTDOWN] Mempool saved (${blockchain.pendingTransactions.length} pending txs)`);
    p2p.stop();
    httpServer.close();
    try { await storage.close(); } catch (e) { console.warn('[SHUTDOWN] Failed to close storage:', e.message); }
    console.log('[SHUTDOWN] Clean exit.');
    process.exit(0);
  }
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

startFullNode().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});