import { CryptoEngine } from './crypto.js';

export class Transaction {
  constructor(fromAddress, toAddress, amount, token = 'LVAIR', type = 'TRANSFER', metadata = {}) {
    this.fromAddress = fromAddress;
    this.toAddress = toAddress;
    this.amount = Number(amount);
    this.token = token;
    this.type = type;
    this.timestamp = Date.now();
    this.metadata = metadata;
    this.signature = '';
    this.txHash = '';
  }

  async calculateHash() {
    return await CryptoEngine.sha256(
      `${this.fromAddress}${this.toAddress}${this.amount}${this.token}${this.type}${this.timestamp}${JSON.stringify(this.metadata)}`
    );
  }

  static fromJSON(obj) {
    const tx = new Transaction(obj.fromAddress, obj.toAddress, obj.amount, obj.token, obj.type, obj.metadata || {});
    tx.timestamp = obj.timestamp;
    tx.signature = obj.signature || '';
    tx.txHash = obj.txHash || '';
    return tx;
  }
}

export class BlockHeader {
  constructor(version, previousHash, merkleRoot, timestamp, difficulty, nonce) {
    this.version = version;
    this.previousHash = previousHash;
    this.merkleRoot = merkleRoot;
    this.timestamp = timestamp;
    this.difficulty = difficulty;
    this.nonce = nonce;
  }

  async calculateHash() {
    return await CryptoEngine.sha256(
      `${this.version}${this.previousHash}${this.merkleRoot}${this.timestamp}${this.difficulty}${this.nonce}`
    );
  }
}

export class Block {
  constructor(index, timestamp, transactions, previousHash = '') {
    this.index = index;
    this.timestamp = timestamp;
    this.transactions = transactions;
    this.previousHash = previousHash;
    this.merkleRoot = '';
    this.nonce = 0;
    this.difficulty = 2;
    this.hash = '';
  }

  static fromJSON(obj) {
    const block = new Block(obj.index, obj.timestamp, obj.transactions, obj.previousHash);
    block.merkleRoot = obj.merkleRoot || '';
    block.nonce = obj.nonce || 0;
    block.difficulty = obj.difficulty || 2;
    block.hash = obj.hash || '';
    return block;
  }

  async calculateMerkleRoot() {
    const txHashes = this.transactions.map(t => t.txHash || '');
    this.merkleRoot = await CryptoEngine.calculateMerkleRoot(txHashes);
    return this.merkleRoot;
  }

  async calculateHash() {
    if (!this.merkleRoot) {
      await this.calculateMerkleRoot();
    }
    const header = new BlockHeader(
      1,
      this.previousHash,
      this.merkleRoot,
      this.timestamp,
      this.difficulty,
      this.nonce
    );
    return await header.calculateHash();
  }

  async mineBlock(difficulty = 2) {
    this.difficulty = difficulty;
    await this.calculateMerkleRoot();
    const target = Array(difficulty + 1).join('0');

    while (true) {
      this.hash = await this.calculateHash();
      if (this.hash.substring(0, difficulty) === target) {
        break;
      }
      this.nonce++;
    }
    return this.hash;
  }
}
