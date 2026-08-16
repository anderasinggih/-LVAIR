import { CryptoEngine } from '../core/crypto.js';

export const GENESIS_RESERVES = { lvair: 100000, usdt: 25000 };

export function createEmptyPool() {
  return {
    lvairReserve: GENESIS_RESERVES.lvair,
    usdtReserve: GENESIS_RESERVES.usdt,
    priceHistory: [],
    trades: []
  };
}

export function applyBlockToPool(pool, block) {
  const txs = block.transactions || [];

  const lpOps = txs.filter(t => t.type === 'LP_PROVISION' || t.type === 'LP_WITHDRAWAL');
  if (lpOps.length) {
    for (const tx of lpOps) {
      const s = tx.type === 'LP_PROVISION' ? 1 : -1;
      if (tx.token === 'LVAIR') pool.lvairReserve = Math.max(0, pool.lvairReserve + s * Number(tx.amount));
      if (tx.token === 'USDT') pool.usdtReserve = Math.max(0, pool.usdtReserve + s * Number(tx.amount));
    }
    const price = pool.usdtReserve / pool.lvairReserve;
    pool.priceHistory.push({
      timestamp: txs[0].timestamp || Date.now(),
      price,
      lvairReserve: pool.lvairReserve,
      usdtReserve: pool.usdtReserve
    });
    if (pool.priceHistory.length > 200000) pool.priceHistory.shift();
    return;
  }

  const inTx = txs.find(t => t.type === 'SWAP_IN');
  const outTx = txs.find(t => t.type === 'SWAP_OUT');
  if (!inTx || !outTx) return;

  if (inTx.token === 'USDT') {
    pool.usdtReserve += Number(inTx.amount);
    pool.lvairReserve -= Number(outTx.amount);
  } else {
    pool.lvairReserve += Number(inTx.amount);
    pool.usdtReserve -= Number(outTx.amount);
  }

  const price = pool.usdtReserve / pool.lvairReserve;
  pool.priceHistory.push({
    timestamp: inTx.timestamp,
    price,
    lvairReserve: pool.lvairReserve,
    usdtReserve: pool.usdtReserve
  });
  if (pool.priceHistory.length > 200000) pool.priceHistory.shift();

  pool.trades.unshift({
    id: inTx.txHash,
    timestamp: inTx.timestamp,
    user: inTx.fromAddress,
    traderAddress: inTx.fromAddress,
    type: inTx.token === 'USDT' ? 'BUY_LVAIR' : 'SELL_LVAIR',
    inputAmount: Number(inTx.amount),
    inputToken: inTx.token,
    outputAmount: Number(outTx.amount),
    outputToken: outTx.token,
    price,
    effectivePrice: Number(inTx.metadata && inTx.metadata.quoteRate) || price,
    blockIndex: block.index
  });
}

export function rebuildPoolState(blocks) {
  const pool = createEmptyPool();
  for (const block of blocks) applyBlockToPool(pool, block);
  return pool;
}

export function rebuildClaimedAddresses(blocks) {
  const claimed = new Set();
  for (const block of blocks) {
    for (const tx of block.transactions || []) {
      if (tx.type === 'AIRDROP_CLAIM' && tx.toAddress) {
        claimed.add(tx.toAddress.toLowerCase());
      }
    }
  }
  return claimed;
}

export async function validateBlock(block, prevBlock) {
  const target = Array((block.difficulty || 2) + 1).join('0');
  if (!block.hash || !block.hash.startsWith(target)) return 'Proof-of-work below network difficulty';
  if (block.merkleRoot) {
    const txHashes = (block.transactions || []).map(t => t.txHash || '');
    const merkle = await CryptoEngine.calculateMerkleRoot(txHashes);
    if (block.merkleRoot !== merkle) return 'Merkle root mismatch';
  }
  const recalc = await block.calculateHash();
  if (block.hash !== recalc) return 'Block hash integrity failure';
  if (prevBlock) {
    if (block.previousHash !== prevBlock.hash) return 'Parent hash linkage broken';
    if (block.index !== prevBlock.index + 1) return 'Non-sequential block index';
  }
  return null;
}

export async function chainIsValid(blocks) {
  if (!blocks || !blocks.length) return { valid: false, error: 'Empty chain' };
  for (let i = 0; i < blocks.length; i++) {
    const prev = i > 0 ? blocks[i - 1] : null;
    const err = await validateBlock(blocks[i], prev);
    if (err) return { valid: false, error: `Block #${blocks[i].index}: ${err}` };
  }
  return { valid: true };
}

export function sameChain(mine, theirs) {
  if (mine.length !== theirs.length) return false;
  if (!mine.length) return true;
  return mine[mine.length - 1].hash === theirs[theirs.length - 1].hash;
}
