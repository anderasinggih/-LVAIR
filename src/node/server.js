import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { Blockchain } from '../core/blockchain.js';
import { AMMPool } from '../core/trading.js';
import { NodeStorageEngine } from './storage.js';
import { Transaction } from '../core/block.js';

const HTTP_PORT = 3001;
const P2P_PORT = 6001;

async function startFullNode() {
  console.log('🌐 ===================================================');
  console.log('⛓️  INITIALIZING AIR PROTOCOL FULL-NODE (L1 ENGINE)');
  console.log('🌐 ===================================================');

  // 1. Initialize LevelDB & raw .dat storage
  const storage = new NodeStorageEngine('/Volumes/LVNPC/Blockchain/data');
  console.log('💾 LevelDB Chainstate Database Initialized at data/chainstate/');
  console.log('📦 Raw Block Ledger Initialized at data/blocks/blk00000.dat');

  // 2. Initialize Blockchain Core
  const blockchain = new Blockchain(2);
  
  // Load existing blocks from blk00000.dat if present
  const existingBlocks = await storage.readAllRawBlocks();
  if (existingBlocks.length > 0) {
    blockchain.chain = existingBlocks;
    console.log(`✓ Loaded ${existingBlocks.length} blocks from physical LevelDB & blk00000.dat ledger`);
  } else {
    await blockchain.init();
    await storage.appendRawBlock(blockchain.chain[0]);
    console.log('✓ Genesis Block created and stored into LevelDB!');
  }

  const ammPool = new AMMPool(blockchain, 100000, 25000);

  // 3. HTTP RPC Server (JSON-RPC / REST)
  const app = express();
  app.use(cors());
  app.use(express.json());

  // RPC Endpoints
  app.get('/api/node/status', async (req, res) => {
    res.json({
      network: 'AIR Mainnet L1',
      version: '1.0.0',
      blockHeight: blockchain.chain.length,
      latestBlockHash: blockchain.getLatestBlock().hash,
      merkleRoot: blockchain.getLatestBlock().merkleRoot,
      difficulty: blockchain.difficulty,
      p2pPeers: sockets.length,
      storageEngine: 'Google LevelDB (LSM-Tree) + blk00000.dat',
      spotPrice: ammPool.getCurrentPrice(),
    });
  });

  app.get('/api/blocks', async (req, res) => {
    res.json(blockchain.chain);
  });

  app.get('/api/balance/:address', (req, res) => {
    const { address } = req.params;
    const air = blockchain.getBalanceOfAddress(address, 'AIR');
    const usdt = blockchain.getBalanceOfAddress(address, 'USDT');
    res.json({ address, air, usdt, hasClaimed: blockchain.claimedAddresses.has(address) });
  });

  app.post('/api/tx/airdrop', async (req, res) => {
    const { address } = req.body;
    try {
      const result = await blockchain.claimAirdrop(address);
      await storage.appendRawBlock(result.block);
      broadcastNewBlock(result.block);
      res.json({ success: true, block: result.block });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  app.post('/api/tx/swap', async (req, res) => {
    const { address, amount, inputToken } = req.body;
    try {
      const result = await ammPool.executeSwap(address, amount, inputToken);
      await storage.appendRawBlock(result.block);
      broadcastNewBlock(result.block);
      res.json({ success: true, result });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  app.post('/api/tx/transfer', async (req, res) => {
    const { from, to, amount, token } = req.body;
    try {
      const tx = new Transaction(from, to, amount, token, 'P2P_TRANSFER');
      tx.txHash = await tx.calculateHash();
      await blockchain.addTransaction(tx);
      const block = await blockchain.minePendingTransactions(from);
      await storage.appendRawBlock(block);
      broadcastNewBlock(block);
      res.json({ success: true, block });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  const httpServer = app.listen(HTTP_PORT, () => {
    console.log(`🚀 Node HTTP RPC API running at http://localhost:${HTTP_PORT}`);
  });

  // 4. P2P Gossip / WebSocket Network (Node Synchronization)
  const p2pServer = new WebSocketServer({ port: P2P_PORT });
  const sockets = [];

  p2pServer.on('connection', (ws) => {
    sockets.push(ws);
    console.log(`🔗 P2P: New Peer Node Connected (Total Peers: ${sockets.length})`);
    
    // Send full chain to newly connected peer
    ws.send(JSON.stringify({ type: 'SYNC_CHAIN', chain: blockchain.chain }));

    ws.on('close', () => {
      const idx = sockets.indexOf(ws);
      if (idx !== -1) sockets.splice(idx, 1);
    });
  });

  function broadcastNewBlock(block) {
    const msg = JSON.stringify({ type: 'NEW_BLOCK', block });
    sockets.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      }
    });
  }

  console.log(`📡 P2P Gossip Network running at ws://localhost:${P2P_PORT}`);
}

startFullNode().catch(console.error);
