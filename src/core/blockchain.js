import { Block, Transaction } from './block.js';
import { CryptoEngine } from './crypto.js';

export class Blockchain {
  constructor(difficulty = 2) {
    this.chain = [];
    this.difficulty = difficulty;
    this.pendingTransactions = [];
    this.miningReward = 10;
    this.airdropClaimAmount = 250;
    this.claimedAddresses = new Set();
    this.systemAddress = '0x0000000000000000000000000000000000000000';
    this.poolAddress = '0x1111111111111111111111111111111111111111';
  }

  async init() {
    if (this.chain.length === 0) {
      await this.createGenesisBlock();
    }
  }

  async createGenesisBlock() {
    const genesisTx = new Transaction(
      null,
      this.systemAddress,
      10000000,
      'LVAIR',
      'COINBASE_GENESIS',
      { memo: 'LVAIR Protocol Genesis Block — Sovereign Decentralized Liquidity Network' }
    );
    genesisTx.timestamp = 1700000000000;
    genesisTx.txHash = await genesisTx.calculateHash();

    const genesisBlock = new Block(0, 1700000000000, [genesisTx], '0x0000000000000000000000000000000000000000000000000000000000000000');
    await genesisBlock.mineBlock(this.difficulty);
    this.chain.push(genesisBlock);
  }

  getLatestBlock() {
    return this.chain[this.chain.length - 1];
  }

  async addTransaction(transaction) {
    if (!transaction.toAddress) {
      throw new Error('Transaction must include a destination address');
    }

    if (
      transaction.fromAddress &&
      transaction.fromAddress !== this.systemAddress &&
      transaction.fromAddress !== this.poolAddress &&
      !transaction.fromAddress.startsWith('0xbot_')
    ) {
      const balance = this.getBalanceOfAddress(transaction.fromAddress, transaction.token);
      if (balance < transaction.amount) {
        throw new Error(`Insufficient ${transaction.token} balance. Have: ${balance}, Need: ${transaction.amount}`);
      }
    }

    transaction.txHash = await transaction.calculateHash();
    if (this.pendingTransactions.some(t => t.txHash === transaction.txHash)) {
      throw new Error('Duplicate transaction — already in mempool');
    }
    this.pendingTransactions.push(transaction);
    return transaction;
  }

  async claimAirdrop(userAddress) {
    const userNormalized = (userAddress || '').toLowerCase();
    for (const claimed of this.claimedAddresses) {
      if (claimed.toLowerCase() === userNormalized) {
        throw new Error('This address has already claimed the $LVAIR Genesis Airdrop.');
      }
    }

    const airdropTx = new Transaction(
      this.systemAddress,
      userAddress,
      this.airdropClaimAmount,
      'LVAIR',
      'AIRDROP_CLAIM',
      { campaign: 'Season 1 Genesis Community Airdrop' }
    );
    airdropTx.txHash = await airdropTx.calculateHash();

    this.pendingTransactions.push(airdropTx);
    this.claimedAddresses.add(userAddress);

    const minedBlock = await this.minePendingTransactions(null);
    return { tx: airdropTx, block: minedBlock };
  }

  async minePendingTransactions(minerRewardAddress) {
    if (minerRewardAddress) {
      const rewardTx = new Transaction(
        null,
        minerRewardAddress,
        this.miningReward,
        'LVAIR',
        'COINBASE_REWARD'
      );
      rewardTx.txHash = await rewardTx.calculateHash();
      this.pendingTransactions.unshift(rewardTx);
    }

    const block = new Block(
      this.chain.length,
      Date.now(),
      [...this.pendingTransactions],
      this.getLatestBlock().hash
    );

    await block.mineBlock(this.difficulty);
    this.chain.push(block);
    this.pendingTransactions = [];

    return block;
  }

  getBalanceOfAddress(address, token = 'LVAIR') {
    if (!address) return 0;
    const target = address.toLowerCase();
    let balance = 0;

    for (const block of this.chain) {
      for (const trans of block.transactions) {
        if (trans.token !== token) continue;
        const from = (trans.fromAddress || '').toLowerCase();
        const to = (trans.toAddress || '').toLowerCase();
        if (from === target) balance -= Number(trans.amount);
        if (to === target) balance += Number(trans.amount);
      }
    }

    for (const trans of this.pendingTransactions) {
      if (trans.token === token) {
        const from = (trans.fromAddress || '').toLowerCase();
        if (from === target) balance -= Number(trans.amount);
      }
    }

    return Math.max(0, balance);
  }

  async isChainValid() {
    for (let i = 1; i < this.chain.length; i++) {
      const currentBlock = this.chain[i];
      const previousBlock = this.chain[i - 1];

      const txHashes = currentBlock.transactions.map(t => t.txHash || '');
      const recalculatedMerkle = await CryptoEngine.calculateMerkleRoot(txHashes);
      if (currentBlock.merkleRoot !== recalculatedMerkle) {
        return { valid: false, error: `Block #${i} Merkle Root mismatch — transaction data may be tampered` };
      }

      const recalculatedHash = await currentBlock.calculateHash();
      if (currentBlock.hash !== recalculatedHash) {
        return { valid: false, error: `Block #${i} hash integrity failure` };
      }

      if (currentBlock.previousHash !== previousBlock.hash) {
        return { valid: false, error: `Block #${i} parent hash linkage broken` };
      }
    }
    return { valid: true };
  }
}

