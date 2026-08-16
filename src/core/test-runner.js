import assert from 'node:assert/strict';
import { CryptoEngine } from './crypto.js';
import { Transaction, Block, BlockHeader } from './block.js';
import { Blockchain } from './blockchain.js';
import { buildSignableMessage } from './signing.js';
import { buildSignableMessage as buildServerMessage, verifyEvmSignature, verifySolanaSignature, verifySignature } from './verify.js';
import {
  GENESIS_RESERVES, GENESIS_SUPPLY, MAX_SUPPLY, MINING_REWARD_INITIAL,
  computeTotalSupply, getMiningReward, createEmptyPool, applyBlockToPool,
  rebuildPoolState, rebuildClaimedAddresses, validateBlock, chainIsValid, sameChain
} from '../node/consensus.js';

let passed = 0;
let failed = 0;

function ok(cond, msg) { assert.ok(cond, msg); }
function eq(a, b, msg) { assert.equal(a, b, msg); }

function makeCoinbaseTx(amount, type = 'COINBASE_REWARD') {
  const tx = new Transaction(null, '0xREWARD', amount, 'LVAIR', type);
  tx.txHash = `coinbase_${Math.random().toString(36).slice(2, 8)}`;
  return tx;
}

function makeTx(from, to, amount, token = 'LVAIR', type = 'TRANSFER') {
  const tx = new Transaction(from, to, amount, token, type);
  tx.txHash = `hash_${Math.random().toString(36).slice(2, 8)}`;
  return tx;
}

const tests = [];

function test(label, fn) {
  tests.push([label, fn]);
}

// ─── crypto.js ────────────────────────────────────────────────

test('sha256 deterministic', async () => {
  const a = await CryptoEngine.sha256('hello');
  const b = await CryptoEngine.sha256('hello');
  eq(a, b);
  eq(a.length, 64);
});

test('sha256 different inputs', async () => {
  const a = await CryptoEngine.sha256('hello');
  const b = await CryptoEngine.sha256('world');
  ok(a !== b);
});

test('sha256 empty string', async () => {
  const h = await CryptoEngine.sha256('');
  eq(h.length, 64);
});

test('generateKeyPair produces valid keys', async () => {
  const kp = await CryptoEngine.generateKeyPair();
  ok(kp.address);
  ok(kp.publicKey);
  ok(kp.privateKey);
  ok(kp.address.startsWith('0x'));
  eq(kp.address.length, 42);
});

test('generateKeyPair two calls differ', async () => {
  const a = await CryptoEngine.generateKeyPair();
  const b = await CryptoEngine.generateKeyPair();
  ok(a.address !== b.address);
});

test('merkleRoot empty array', async () => {
  const root = await CryptoEngine.calculateMerkleRoot([]);
  eq(root.length, 64);
});

test('merkleRoot single hash returns itself', async () => {
  const input = await CryptoEngine.sha256('test');
  const root = await CryptoEngine.calculateMerkleRoot([input]);
  eq(root, input);
});

test('merkleRoot two hashes', async () => {
  const root = await CryptoEngine.calculateMerkleRoot(['aaa', 'bbb']);
  const expected = await CryptoEngine.sha256('aaabbb');
  eq(root, expected);
});

test('merkleRoot deterministic', async () => {
  const r1 = await CryptoEngine.calculateMerkleRoot(['x', 'y', 'z']);
  const r2 = await CryptoEngine.calculateMerkleRoot(['x', 'y', 'z']);
  eq(r1, r2);
});

// ─── block.js ─────────────────────────────────────────────────

test('Transaction defaults', () => {
  const tx = new Transaction('0xA', '0xB', 100);
  eq(tx.amount, 100);
  eq(tx.token, 'LVAIR');
  eq(tx.type, 'TRANSFER');
  eq(tx.signature, '');
  eq(tx.nonce, 0);
});

test('Transaction.calculateHash deterministic', async () => {
  const tx = new Transaction('0xA', '0xB', 100, 'LVAIR', 'TRANSFER');
  tx.timestamp = 12345;
  const h1 = await tx.calculateHash();
  const h2 = await tx.calculateHash();
  eq(h1, h2);
  eq(h1.length, 64);
});

test('Transaction different amounts different hashes', async () => {
  const tx1 = new Transaction('0xA', '0xB', 100, 'LVAIR', 'TRANSFER');
  tx1.timestamp = 12345;
  const tx2 = new Transaction('0xA', '0xB', 200, 'LVAIR', 'TRANSFER');
  tx2.timestamp = 12345;
  ok((await tx1.calculateHash()) !== (await tx2.calculateHash()));
});

test('Transaction.fromJSON round-trips', () => {
  const json = { fromAddress: '0xA', toAddress: '0xB', amount: 50, token: 'USDT', type: 'SWAP_IN', timestamp: 999, nonce: 5, metadata: { memo: 'hi' }, signature: 'sig1', signerPublicKey: 'pub1', chainType: 'evm', txHash: 'h1' };
  const tx = Transaction.fromJSON(json);
  eq(tx.amount, 50);
  eq(tx.nonce, 5);
  eq(tx.signature, 'sig1');
  eq(tx.chainType, 'evm');
});

test('BlockHeader.calculateHash deterministic', async () => {
  const h = new BlockHeader(1, '0x00', '0xMR', 123, 2, 0);
  eq(await h.calculateHash(), await h.calculateHash());
});

test('Block.fromJSON round-trips', () => {
  const b = Block.fromJSON({ index: 5, timestamp: 1000, transactions: [], previousHash: '0xprev', hash: '0xhash', nonce: 7, difficulty: 3, merkleRoot: '0xMR' });
  eq(b.index, 5);
  eq(b.hash, '0xhash');
  eq(b.nonce, 7);
});

test('Block.calculateHash 64-char hex', async () => {
  const b = new Block(0, Date.now(), [], '0x00');
  const h = await b.calculateHash();
  eq(h.length, 64);
});

test('Block.mineBlock finds difficulty prefix', async () => {
  const b = new Block(0, Date.now(), [], '0x00');
  await b.mineBlock(2);
  ok(b.hash.startsWith('00'));
  const recalc = await b.calculateHash();
  eq(b.hash, recalc);
});

test('Block.calculateMerkleRoot sets merkleRoot', async () => {
  const tx = makeTx('0xA', '0xB', 10);
  const b = new Block(0, Date.now(), [tx], '0x00');
  const mr = await b.calculateMerkleRoot();
  eq(b.merkleRoot, mr);
  ok(typeof mr === 'string' && mr.length > 0);
});

// ─── blockchain.js ────────────────────────────────────────────

test('Blockchain.createGenesisBlock', async () => {
  const bc = new Blockchain(1);
  await bc.init();
  eq(bc.chain.length, 1);
  eq(bc.chain[0].index, 0);
  ok(bc.chain[0].hash.startsWith('0'));
});

test('Blockchain.addTransaction', async () => {
  const bc = new Blockchain(1);
  await bc.init();
  const tx = makeTx(null, '0xABC', 500, 'LVAIR', 'AIRDROP_CLAIM');
  tx.fromAddress = bc.systemAddress;
  await bc.addTransaction(tx);
  eq(bc.pendingTransactions.length, 1);
});

test('Blockchain.addTransaction throws if no toAddress', async () => {
  const bc = new Blockchain(1);
  await bc.init();
  const tx = makeTx('0xA', null, 10);
  await assert.rejects(() => bc.addTransaction(tx), /destination address/);
});

test('Blockchain.addTransaction rejects duplicate', async () => {
  const bc = new Blockchain(1);
  await bc.init();
  const tx1 = makeTx(null, '0xABC', 100);
  tx1.fromAddress = bc.systemAddress;
  await bc.addTransaction(tx1);
  await assert.rejects(() => bc.addTransaction(tx1), /Duplicate/);
});

test('Blockchain.minePendingTransactions', async () => {
  const bc = new Blockchain(1);
  await bc.init();
  const tx = makeTx(null, '0xABC', 100);
  tx.fromAddress = bc.systemAddress;
  await bc.addTransaction(tx);
  const block = await bc.minePendingTransactions('0xMINER');
  eq(bc.chain.length, 2);
  eq(block.index, 1);
  ok(block.hash.startsWith('0'));
  eq(bc.pendingTransactions.length, 0);
});

test('Blockchain.getBalanceOfAddress tracks sends/receives', async () => {
  const bc = new Blockchain(1);
  await bc.init();
  const tx1 = makeTx(null, '0xAlice', 500);
  tx1.fromAddress = bc.systemAddress;
  await bc.addTransaction(tx1);
  await bc.minePendingTransactions(null);
  const tx2 = makeTx('0xAlice', '0xBob', 200);
  await bc.addTransaction(tx2);
  await bc.minePendingTransactions('0xMiner');
  eq(bc.getBalanceOfAddress('0xAlice'), 300);
  eq(bc.getBalanceOfAddress('0xBob'), 200);
});

test('Blockchain.isChainValid fresh chain', async () => {
  const bc = new Blockchain(1);
  await bc.init();
  const result = await bc.isChainValid();
  ok(result.valid);
});

test('Blockchain.claimAirdrop', async () => {
  const bc = new Blockchain(1);
  await bc.init();
  bc.airdropClaimAmount = 250;
  const { tx, block } = await bc.claimAirdrop('0xUser');
  eq(tx.amount, 250);
  eq(tx.type, 'AIRDROP_CLAIM');
  ok(bc.chain.length >= 2);
  eq(bc.getBalanceOfAddress('0xUser', 'LVAIR'), 250);
});

test('Blockchain.claimAirdrop rejects second claim', async () => {
  const bc = new Blockchain(1);
  await bc.init();
  await bc.claimAirdrop('0xUser');
  await assert.rejects(() => bc.claimAirdrop('0xUser'), /already claimed/);
});

// ─── signing.js ───────────────────────────────────────────────

test('buildSignableMessage client format', () => {
  const msg = buildSignableMessage({ from: '0xA', to: '0xB', amount: 100, token: 'LVAIR', type: 'TRANSFER', nonce: 3, timestamp: 999 });
  ok(msg.includes('LVAIR Protocol — Transaction Authorization'));
  ok(msg.includes('Chain: lvair-mainnet'));
  ok(msg.includes('From: 0xA'));
  ok(msg.includes('To: 0xB'));
  ok(msg.includes('Amount: 100 LVAIR'));
  ok(msg.includes('Type: TRANSFER'));
  ok(msg.includes('Nonce: 3'));
  ok(msg.includes('Timestamp: 999'));
});

test('buildSignableMessage client == server', () => {
  const params = { from: '0xA', to: '0xB', amount: 42, token: 'USDT', type: 'SWAP_IN', nonce: 7, timestamp: 123 };
  eq(buildSignableMessage(params), buildServerMessage(params));
});

// ─── verify.js ────────────────────────────────────────────────

test('verifyEvmSignature valid', async () => {
  const { ethers } = await import('ethers');
  const wallet = ethers.Wallet.createRandom();
  const message = 'LVAIR Protocol — Transaction Authorization\n\nChain: lvair-mainnet\nFrom: 0xTEST\nTo: 0xTEST2\nAmount: 100 LVAIR\nType: TRANSFER\nNonce: 1\nTimestamp: 1000';
  const signature = await wallet.signMessage(message);
  ok(verifyEvmSignature(message, signature, wallet.address));
});

test('verifyEvmSignature rejects wrong address', async () => {
  const { ethers } = await import('ethers');
  const wallet = ethers.Wallet.createRandom();
  const other = ethers.Wallet.createRandom();
  const signature = await wallet.signMessage('test message to sign');
  ok(!verifyEvmSignature('test message to sign', signature, other.address));
});

test('verifyEvmSignature rejects tampered message', async () => {
  const { ethers } = await import('ethers');
  const wallet = ethers.Wallet.createRandom();
  const signature = await wallet.signMessage('original');
  ok(!verifyEvmSignature('tampered', signature, wallet.address));
});

test('verifySolanaSignature valid', async () => {
  const nacl = (await import('tweetnacl')).default;
  const { Keypair } = await import('@solana/web3.js');
  const kp = Keypair.generate();
  const msg = 'LVAIR Protocol — Transaction Authorization';
  const sig = nacl.sign.detached(new TextEncoder().encode(msg), kp.secretKey);
  ok(verifySolanaSignature(msg, Array.from(sig), kp.publicKey.toBase58()));
});

test('verifySolanaSignature rejects wrong pubkey', async () => {
  const nacl = (await import('tweetnacl')).default;
  const { Keypair } = await import('@solana/web3.js');
  const kp1 = Keypair.generate();
  const kp2 = Keypair.generate();
  const sig = nacl.sign.detached(new TextEncoder().encode('test'), kp1.secretKey);
  ok(!verifySolanaSignature('test', Array.from(sig), kp2.publicKey.toBase58()));
});

test('verifySignature delegates to EVM', async () => {
  const { ethers } = await import('ethers');
  const wallet = ethers.Wallet.createRandom();
  const sig = await wallet.signMessage('verify test');
  ok(verifySignature('verify test', sig, wallet.address, 'evm'));
});

test('verifySignature delegates to Solana', async () => {
  const nacl = (await import('tweetnacl')).default;
  const { Keypair } = await import('@solana/web3.js');
  const kp = Keypair.generate();
  const sig = nacl.sign.detached(new TextEncoder().encode('verify solana'), kp.secretKey);
  ok(verifySignature('verify solana', Array.from(sig), kp.publicKey.toBase58(), 'solana'));
});

test('verifySignature unknown chain type returns false', () => {
  ok(!verifySignature('msg', 'sig', 'addr', 'bitcoin'));
});

// ─── consensus.js ─────────────────────────────────────────────

test('computeTotalSupply sums genesis + reward', () => {
  const blocks = [
    { transactions: [{ token: 'LVAIR', type: 'COINBASE_GENESIS', amount: 10000000 }] },
    { transactions: [{ token: 'LVAIR', type: 'COINBASE_REWARD', amount: 10 }] }
  ];
  eq(computeTotalSupply(blocks), 10000010);
});

test('computeTotalSupply ignores non-LVAIR', () => {
  const blocks = [
    { transactions: [
      { token: 'USDT', type: 'COINBASE_GENESIS', amount: 99999 },
      { token: 'LVAIR', type: 'TRANSFER', amount: 5000 },
      { token: 'LVAIR', type: 'COINBASE_REWARD', amount: 10 }
    ]}
  ];
  eq(computeTotalSupply(blocks), 10);
});

test('computeTotalSupply empty/null', () => {
  eq(computeTotalSupply([]), 0);
  eq(computeTotalSupply(null), 0);
});

test('getMiningReward 10 at genesis', () => {
  const chain = [{ transactions: [{ token: 'LVAIR', type: 'COINBASE_GENESIS', amount: 10000000 }] }];
  eq(getMiningReward(chain), 10);
});

test('getMiningReward 5 at 15M', () => {
  const chain = [
    { transactions: [{ token: 'LVAIR', type: 'COINBASE_GENESIS', amount: 10000000 }] },
    { transactions: [{ token: 'LVAIR', type: 'COINBASE_REWARD', amount: 5000000 }] }
  ];
  eq(getMiningReward(chain), 5);
});

test('getMiningReward 2.5 at 17.5M', () => {
  const chain = [
    { transactions: [{ token: 'LVAIR', type: 'COINBASE_GENESIS', amount: 10000000 }] },
    { transactions: [{ token: 'LVAIR', type: 'COINBASE_REWARD', amount: 7500000 }] }
  ];
  eq(getMiningReward(chain), 2.5);
});

test('getMiningReward 1.25 at 18.75M', () => {
  const chain = [
    { transactions: [{ token: 'LVAIR', type: 'COINBASE_GENESIS', amount: 10000000 }] },
    { transactions: [{ token: 'LVAIR', type: 'COINBASE_REWARD', amount: 8750000 }] }
  ];
  eq(getMiningReward(chain), 1.25);
});

test('getMiningReward 0 at 20M cap', () => {
  const chain = [
    { transactions: [{ token: 'LVAIR', type: 'COINBASE_GENESIS', amount: 10000000 }] },
    { transactions: [{ token: 'LVAIR', type: 'COINBASE_REWARD', amount: 10000000 }] }
  ];
  eq(getMiningReward(chain), 0);
});

test('getMiningReward never exceeds remaining', () => {
  const chain = [
    { transactions: [{ token: 'LVAIR', type: 'COINBASE_GENESIS', amount: 10000000 }] },
    { transactions: [{ token: 'LVAIR', type: 'COINBASE_REWARD', amount: 9999999 }] }
  ];
  ok(getMiningReward(chain) <= 1);
});

test('createEmptyPool has genesis reserves', () => {
  const pool = createEmptyPool();
  eq(pool.lvairReserve, GENESIS_RESERVES.lvair);
  eq(pool.usdtReserve, GENESIS_RESERVES.usdt);
  eq(pool.priceHistory.length, 0);
  eq(pool.trades.length, 0);
});

test('applyBlockToPool LP provision', () => {
  const pool = createEmptyPool();
  applyBlockToPool(pool, { index: 1, transactions: [
    { type: 'LP_PROVISION', token: 'LVAIR', amount: 1000, timestamp: 100 },
    { type: 'LP_PROVISION', token: 'USDT', amount: 500, timestamp: 100 }
  ]});
  eq(pool.lvairReserve, GENESIS_RESERVES.lvair + 1000);
  eq(pool.usdtReserve, GENESIS_RESERVES.usdt + 500);
  eq(pool.priceHistory.length, 1);
});

test('applyBlockToPool LP withdrawal', () => {
  const pool = createEmptyPool();
  applyBlockToPool(pool, { index: 1, transactions: [
    { type: 'LP_WITHDRAWAL', token: 'LVAIR', amount: 500, timestamp: 100 },
    { type: 'LP_WITHDRAWAL', token: 'USDT', amount: 250, timestamp: 100 }
  ]});
  eq(pool.lvairReserve, GENESIS_RESERVES.lvair - 500);
  eq(pool.usdtReserve, GENESIS_RESERVES.usdt - 250);
});

test('applyBlockToPool swap', () => {
  const pool = createEmptyPool();
  applyBlockToPool(pool, { index: 2, transactions: [
    { type: 'SWAP_IN', token: 'USDT', amount: 100, fromAddress: '0xT', txHash: 'tx1', timestamp: 200, metadata: { quoteRate: 0.5 } },
    { type: 'SWAP_OUT', token: 'LVAIR', amount: 200, txHash: 'tx2', timestamp: 200 }
  ]});
  eq(pool.usdtReserve, GENESIS_RESERVES.usdt + 100);
  eq(pool.lvairReserve, GENESIS_RESERVES.lvair - 200);
  eq(pool.trades.length, 1);
  eq(pool.trades[0].type, 'BUY_LVAIR');
});

test('applyBlockToPool non-swap non-LP is no-op', () => {
  const pool = createEmptyPool();
  applyBlockToPool(pool, { index: 1, transactions: [{ type: 'TRANSFER', token: 'LVAIR', amount: 10 }] });
  eq(pool.lvairReserve, GENESIS_RESERVES.lvair);
  eq(pool.trades.length, 0);
});

test('rebuildPoolState from blocks', () => {
  const pool = rebuildPoolState([{ index: 1, transactions: [
    { type: 'LP_PROVISION', token: 'LVAIR', amount: 500, timestamp: 100 },
    { type: 'LP_PROVISION', token: 'USDT', amount: 250, timestamp: 100 }
  ]}]);
  eq(pool.lvairReserve, GENESIS_RESERVES.lvair + 500);
  eq(pool.usdtReserve, GENESIS_RESERVES.usdt + 250);
});

test('rebuildClaimedAddresses collects claims', () => {
  const blocks = [
    { transactions: [{ type: 'AIRDROP_CLAIM', toAddress: '0xA' }] },
    { transactions: [{ type: 'AIRDROP_CLAIM', toAddress: '0xB' }] },
    { transactions: [{ type: 'TRANSFER', toAddress: '0xC' }] }
  ];
  const claimed = rebuildClaimedAddresses(blocks);
  ok(claimed.has('0xa'));
  ok(claimed.has('0xb'));
  ok(!claimed.has('0xc'));
});

test('validateBlock rejects wrong hash', async () => {
  const b = new Block(0, Date.now(), [], '0x00');
  b.hash = 'bad';
  const err = await validateBlock(b, null);
  ok(err.includes('difficulty') || err.includes('hash'));
});

test('validateBlock rejects bad merkle', async () => {
  const tx = makeTx('0xA', '0xB', 10);
  const b = new Block(0, Date.now(), [tx], '0x00');
  b.merkleRoot = 'wrong';
  b.hash = '00';
  const err = await validateBlock(b, null);
  ok(err.includes('Merkle'));
});

test('validateBlock rejects broken parent', async () => {
  const tx = makeTx('0xA', '0xB', 10);
  const prev = new Block(0, Date.now(), [], '0x00');
  await prev.mineBlock(1);
  const b = new Block(1, Date.now(), [tx], '0xBAD');
  await b.mineBlock(1);
  const err = await validateBlock(b, prev);
  ok(err.includes('Parent'));
});

test('validateBlock rejects non-sequential index', async () => {
  const tx = makeTx('0xA', '0xB', 10);
  const prev = new Block(0, Date.now(), [], '0x00');
  await prev.mineBlock(1);
  const b = new Block(5, Date.now(), [tx], prev.hash);
  await b.mineBlock(1);
  const err = await validateBlock(b, prev);
  ok(err.includes('Non-sequential'));
});

test('validateBlock rejects supply cap exceeded', async () => {
  const tx = makeCoinbaseTx(10000001, 'COINBASE_REWARD');
  const prev = new Block(0, Date.now(), [makeCoinbaseTx(10000000, 'COINBASE_GENESIS')], '0x00');
  await prev.mineBlock(1);
  const b = new Block(1, Date.now(), [tx], prev.hash);
  await b.mineBlock(1);
  const err = await validateBlock(b, prev, { chain: [prev] });
  ok(err.includes('Supply cap'));
});

test('validateBlock accepts valid block', async () => {
  const tx = makeCoinbaseTx(10);
  const prev = new Block(0, Date.now(), [makeCoinbaseTx(10000000, 'COINBASE_GENESIS')], '0x00');
  await prev.mineBlock(1);
  const b = new Block(1, Date.now(), [tx], prev.hash);
  await b.mineBlock(1);
  const err = await validateBlock(b, prev, { chain: [prev] });
  eq(err, null);
});

test('chainIsValid valid chain passes', async () => {
  const genesis = new Block(0, 1700000000000, [makeCoinbaseTx(10000000, 'COINBASE_GENESIS')], '0x00');
  await genesis.mineBlock(1);
  const b1 = new Block(1, Date.now(), [makeCoinbaseTx(10)], genesis.hash);
  await b1.mineBlock(1);
  const result = await chainIsValid([genesis, b1]);
  ok(result.valid);
});

test('chainIsValid empty chain fails', async () => {
  ok(!(await chainIsValid([])).valid);
});

test('chainIsValid null chain fails', async () => {
  ok(!(await chainIsValid(null)).valid);
});

test('chainIsValid bad block fails', async () => {
  const genesis = new Block(0, 1700000000000, [makeCoinbaseTx(10000000, 'COINBASE_GENESIS')], '0x00');
  await genesis.mineBlock(1);
  const bad = new Block(1, Date.now(), [makeCoinbaseTx(10)], genesis.hash);
  bad.hash = '00bad';
  bad.nonce = 0;
  ok(!(await chainIsValid([genesis, bad])).valid);
});

test('sameChain same last hash', () => {
  ok(sameChain([{ hash: '0x1' }, { hash: '0x2' }], [{ hash: '0x1' }, { hash: '0x2' }]));
});

test('sameChain different length', () => {
  ok(!sameChain([{ hash: '0x1' }], [{ hash: '0x1' }, { hash: '0x2' }]));
});

test('sameChain different last hash', () => {
  ok(!sameChain([{ hash: '0x1' }], [{ hash: '0x9' }]));
});

test('sameChain empty', () => {
  ok(sameChain([], []));
});

// ─── run ──────────────────────────────────────────────────────

for (const [label, fn] of tests) {
  try {
    await fn();
    passed++;
  } catch (e) {
    failed++;
    console.error(`  FAIL  ${label}`);
    console.error(`        ${e.message}`);
  }
}

console.log('');
console.log(`  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('  All tests passed.');
