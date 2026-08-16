import fs from 'node:fs';
import path from 'node:path';
import { ClassicLevel } from 'classic-level';

/**
 * Native Node Database Storage Engine (Bitcoin / Ethereum Geth Style)
 * 1. blocks/blk00000.dat -> Raw Binary/JSON Append-Only Block Ledger
 * 2. chainstate/ -> Google LevelDB Key-Value State Database (Addresses, Nonces, Balances)
 * 3. keystore/ -> Encrypted Wallets
 */
export class NodeStorageEngine {
  constructor(baseDir = '/Volumes/LVNPC/Blockchain/data') {
    this.baseDir = baseDir;
    this.blocksDir = path.join(baseDir, 'blocks');
    this.chainstateDir = path.join(baseDir, 'chainstate');
    this.keystoreDir = path.join(baseDir, 'keystore');
    this.datFilePath = path.join(this.blocksDir, 'blk00000.dat');

    this.initDirectories();
    // Initialize Google LevelDB Database
    this.db = new ClassicLevel(this.chainstateDir, { valueEncoding: 'json' });
  }

  initDirectories() {
    if (!fs.existsSync(this.baseDir)) fs.mkdirSync(this.baseDir, { recursive: true });
    if (!fs.existsSync(this.blocksDir)) fs.mkdirSync(this.blocksDir, { recursive: true });
    if (!fs.existsSync(this.keystoreDir)) fs.mkdirSync(this.keystoreDir, { recursive: true });
    if (!fs.existsSync(this.datFilePath)) fs.writeFileSync(this.datFilePath, '', 'utf8');
  }

  async open() {
    try {
      await this.db.open();
    } catch (err) {
      if (err.code === 'LEVEL_LOCKED') {
        throw new Error('Database locked: another LVAIR node instance is already running. Stop it first (pm2 stop lvair-node or kill the old process) before starting a new one.');
      }
      throw err;
    }
  }

  /**
   * Append raw block to blk00000.dat file
   */
  async appendRawBlock(block) {
    const rawLine = JSON.stringify(block) + '\n';
    fs.appendFileSync(this.datFilePath, rawLine, 'utf8');

    // Index block by Height and Hash in LevelDB
    await this.db.put(`block:height:${block.index}`, block.hash);
    await this.db.put(`block:hash:${block.hash}`, block);
    await this.db.put('chain:latest_height', block.index);
    await this.db.put('chain:latest_hash', block.hash);

    // Update account balances in LevelDB Chainstate
    for (const tx of block.transactions) {
      await this.db.put(`tx:${tx.txHash}`, { ...tx, blockHeight: block.index, blockHash: block.hash });
    }
  }

  /**
   * Read all blocks from the raw blk00000.dat file
   */
  async readAllRawBlocks() {
    if (!fs.existsSync(this.datFilePath)) return [];
    const content = fs.readFileSync(this.datFilePath, 'utf8').trim();
    if (!content) return [];
    const lines = content.split('\n');
    return lines.map(line => JSON.parse(line));
  }

  /**
   * Overwrite the entire blk00000.dat ledger (used on chain reorg / full sync)
   */
  async writeRawBlocks(blocks) {
    const content = blocks.map(b => JSON.stringify(b)).join('\n') + '\n';
    fs.writeFileSync(this.datFilePath, content, 'utf8');

    for (const b of blocks) {
      await this.db.put(`block:height:${b.index}`, b.hash);
      await this.db.put(`block:hash:${b.hash}`, b);
    }
    if (blocks.length) {
      const tip = blocks[blocks.length - 1];
      await this.db.put('chain:latest_height', tip.index);
      await this.db.put('chain:latest_hash', tip.hash);
    }
  }

  /**
   * Rebuild blocks from the LevelDB chainstate as a recovery fallback when
   * blk00000.dat is missing or empty. Follows previousHash links starting from
   * the highest indexed block so orphaned blocks (e.g. a freshly regenerated
   * genesis) never mix into the recovered chain.
   */
  async readBlocksFromChainstate() {
    const byHeight = [];
    const byHash = new Map();
    let height = 0;
    while (true) {
      let hash;
      try {
        hash = await this.db.get(`block:height:${height}`);
      } catch (e) {
        if (e.code === 'LEVEL_NOT_FOUND') break;
        throw e;
      }
      if (!hash) break;
      try {
        const block = await this.db.get(`block:hash:${hash}`);
        if (block) {
          byHeight.push(block);
          byHash.set(hash, block);
        }
      } catch (e) {
        if (e.code !== 'LEVEL_NOT_FOUND') throw e;
      }
      height++;
    }
    if (byHeight.length === 0) return [];

    const chain = [];
    let cur = byHeight[byHeight.length - 1];
    let guard = 0;
    while (cur && guard < 1000000) {
      chain.unshift(cur);
      guard++;
      const prev = byHash.get(cur.previousHash);
      if (!prev) break;
      cur = prev;
    }
    return chain;
  }

  /**
   * Put key-value state to LevelDB
   */
  async putState(key, value) {
    await this.db.put(`state:${key}`, value);
  }

  /**
   * Get key-value state from LevelDB
   */
  async getState(key) {
    try {
      return await this.db.get(`state:${key}`);
    } catch (e) {
      if (e.code === 'LEVEL_NOT_FOUND') return null;
      throw e;
    }
  }

  /**
   * Close database gracefully
   */
  async close() {
    await this.db.close();
  }
}
