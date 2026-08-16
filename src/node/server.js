import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { Blockchain } from '../core/blockchain.js';
import { AMMPool } from '../core/amm.js';
import { NodeStorageEngine } from './storage.js';
import { Transaction } from '../core/block.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../data');

const HTTP_PORT = process.env.HTTP_PORT || 3001;
const P2P_PORT = process.env.P2P_PORT || 6001;

let protocolConfig = {
  airdropClaimAmount: 250,
  miningReward: 10,
  ownerAddress: null
};

// In-memory ring buffer for live telemetry logs (HTTP fallback)
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
  return item;
}

async function startFullNode() {
  console.log('===================================================');
  console.log('  LVAIR PROTOCOL FULL-NODE (L1 ENGINE)');
  console.log('===================================================');

  const storage = new NodeStorageEngine(DATA_DIR);
  console.log(`Database storage initialized at: ${DATA_DIR}`);

  const blockchain = new Blockchain(2);
  
  const existingBlocks = await storage.readAllRawBlocks();
  if (existingBlocks.length > 0) {
    blockchain.chain = existingBlocks;
    existingBlocks.forEach(b => {
      if (b.transactions) {
        b.transactions.forEach(t => {
          if (t.type === 'AIRDROP_CLAIM' && t.toAddress) {
            blockchain.claimedAddresses.add(t.toAddress.toLowerCase());
          }
        });
      }
    });
    console.log(`Loaded ${existingBlocks.length} blocks from physical LevelDB & blk00000.dat ledger`);
  } else {
    await blockchain.init();
    await storage.appendRawBlock(blockchain.chain[0]);
    console.log('Genesis Block created and stored into LevelDB!');
  }

  const ammPool = new AMMPool(blockchain, 100000, 25000);

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/api/config', (req, res) => {
    res.json({
      success: true,
      airdropClaimAmount: protocolConfig.airdropClaimAmount || blockchain.airdropClaimAmount,
      miningReward: protocolConfig.miningReward || blockchain.miningReward,
      ownerAddress: protocolConfig.ownerAddress,
      claimedCount: blockchain.claimedAddresses.size,
      poolReserves: {
        lvair: ammPool.lvairReserve,
        usdt: ammPool.usdtReserve,
        price: ammPool.getCurrentPrice()
      }
    });
  });

  app.get('/api/telemetry/logs', (req, res) => {
    res.json(broadcastLogs);
  });

  // Lightweight event reporter — no chain execution, just logs for monitor
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

  app.post('/api/config/airdrop', (req, res) => {
    try {
      const { amount } = req.body;
      const parsed = parseFloat(amount);
      if (!parsed || parsed <= 0) throw new Error('Invalid airdrop amount');
      
      protocolConfig.airdropClaimAmount = parsed;
      blockchain.airdropClaimAmount = parsed;
      blockchain.saveState();

      logEvent('CONFIG_UPDATED', 'tag-sync', `Airdrop quota updated to ${parsed} LVAIR`);
      broadcast({ type: 'CONFIG_UPDATED', config: protocolConfig });

      res.json({ success: true, airdropClaimAmount: parsed });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  app.post('/api/config/reset-whitelist', (req, res) => {
    try {
      blockchain.claimedAddresses.clear();
      blockchain.saveState();

      logEvent('WHITELIST_RESET', 'tag-sync', 'Airdrop whitelist was reset');
      broadcast({ type: 'WHITELIST_RESET' });

      res.json({ success: true, message: 'Airdrop whitelist reset successfully' });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  app.post('/api/config/reserves', (req, res) => {
    try {
      const { lvair, usdt } = req.body;
      const airNum = parseFloat(lvair);
      const usdtNum = parseFloat(usdt);
      if (!airNum || !usdtNum || airNum <= 0 || usdtNum <= 0) throw new Error('Invalid reserves');
      
      ammPool.lvairReserve = airNum;
      ammPool.usdtReserve = usdtNum;

      logEvent('RESERVES_UPDATED', 'tag-swap', `Pool reserves rebalanced: ${airNum.toLocaleString()} LVAIR / $${usdtNum.toLocaleString()} USDT`);
      broadcast({ type: 'RESERVES_UPDATED', reserves: { lvair: airNum, usdt: usdtNum, price: ammPool.getCurrentPrice() } });

      res.json({ success: true, reserves: { lvair: airNum, usdt: usdtNum, price: ammPool.getCurrentPrice() } });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  app.get('/api/node/status', async (req, res) => {
    res.json({
      network: 'LVAIR Mainnet L1',
      version: '1.0.0',
      blockHeight: blockchain.chain.length,
      latestBlockHash: blockchain.getLatestBlock().hash,
      merkleRoot: blockchain.getLatestBlock().merkleRoot,
      difficulty: blockchain.difficulty,
      p2pPeers: sockets.length,
      spotPrice: ammPool.getCurrentPrice(),
      airdropClaimAmount: blockchain.airdropClaimAmount,
      reserves: {
        lvair: ammPool.lvairReserve,
        usdt: ammPool.usdtReserve,
      },
      claimedWallets: blockchain.claimedAddresses.size
    });
  });

  app.get('/api/blocks', async (req, res) => {
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

  app.post('/api/airdrop/claim', async (req, res) => {
    try {
      const { userAddress } = req.body;
      if (!userAddress) throw new Error('userAddress is required');

      const result = await blockchain.claimAirdrop(userAddress);
      await storage.appendRawBlock(result.block);

      logEvent('AIRDROP_CLAIMED', 'tag-claim', `Wallet ${userAddress.substring(0, 8)}... claimed airdrop on-chain`, { block: result.block.index });
      broadcast({ type: 'AIRDROP_CLAIMED', userAddress, block: result.block });

      res.json({
        success: true,
        txHash: result.tx.txHash,
        blockIndex: result.block.index,
        balance: blockchain.getBalanceOfAddress(userAddress, 'LVAIR')
      });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  app.post('/api/tx/send', async (req, res) => {
    try {
      const { from, to, amount, token, type, metadata } = req.body;
      const tx = new Transaction(from, to, amount, token || 'LVAIR', type || 'TRANSFER', metadata || {});
      tx.txHash = await tx.calculateHash();
      await blockchain.addTransaction(tx);
      
      const block = await blockchain.minePendingTransactions(from);
      await storage.appendRawBlock(block);

      logEvent('TRANSFER_EXECUTED', 'tag-block', `Transfer ${amount} ${token} from ${from.substring(0,6)}... to ${to.substring(0,6)}...`, { block: block.index });
      broadcast({ type: 'NEW_BLOCK', block });

      res.json({ success: true, txHash: tx.txHash, blockIndex: block.index });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  app.post('/api/swap', async (req, res) => {
    try {
      const { userAddress, inputAmount, inputToken } = req.body;
      const result = await ammPool.executeSwap(userAddress, inputAmount, inputToken);
      await storage.appendRawBlock(result.block);

      logEvent('SWAP_EXECUTED', 'tag-swap', `Swap settled: ${inputAmount} ${inputToken} by ${userAddress.substring(0,6)}... New Price: $${result.newPrice.toFixed(4)}`, { block: result.block.index });
      broadcast({ type: 'SWAP_EXECUTED', trade: result.trade, newPrice: result.newPrice });

      res.json({ success: true, result });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  app.listen(HTTP_PORT, () => {
    console.log(`[RPC] HTTP RPC Server listening on http://0.0.0.0:${HTTP_PORT}`);
    logEvent('NODE_BOOT', 'tag-sync', `LVAIR Core Node booted on port ${HTTP_PORT}`);
  });

  const sockets = [];
  const p2pServer = new WebSocketServer({ port: P2P_PORT });

  p2pServer.on('connection', (ws) => {
    sockets.push(ws);
    logEvent('PEER_CONNECTED', 'tag-peer', `New node peer connected. Total peers: ${sockets.length}`);
    console.log(`[P2P] Peer connected. Total active peers: ${sockets.length}`);

    ws.send(JSON.stringify({ type: 'CHAIN_SYNC', chain: blockchain.chain }));

    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message);
        if (data.type === 'NEW_BLOCK') {
          console.log(`[P2P] Received Block #${data.block.index} from peer`);
        }
      } catch (e) {
        console.error('[P2P] Invalid message format');
      }
    });

    ws.on('close', () => {
      const idx = sockets.indexOf(ws);
      if (idx !== -1) sockets.splice(idx, 1);
      logEvent('PEER_DISCONNECTED', 'tag-peer', `Peer disconnected. Remaining peers: ${sockets.length}`);
      console.log(`[P2P] Peer disconnected. Remaining peers: ${sockets.length}`);
    });
  });

  function broadcast(data) {
    const payload = JSON.stringify(data);
    sockets.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    });
  }

  console.log(`[P2P] WebSocket Gossip network listening on ws://0.0.0.0:${P2P_PORT}`);
}

startFullNode().catch(console.error);
