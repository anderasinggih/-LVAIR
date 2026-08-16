#!/usr/bin/env node
/**
 * LVAIR Protocol — Solana SPL Token Deployer
 *
 * Creates a mainnet (or devnet) SPL token with Metaplex metadata so it
 * displays with name/symbol/logo in Solana wallets, then prints the next
 * steps to make it appear as a tradable pair (Raydium pool -> Jupiter).
 *
 * Usage:
 *   node scripts/deploy-spl-token.js                     # mainnet-beta
 *   SOLANA_NETWORK=devnet node scripts/deploy-spl-token.js   # devnet test
 *
 * Env:
 *   SOLANA_NETWORK   mainnet-beta (default) | devnet
 *   SOLANA_RPC       custom RPC endpoint override
 */

import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from '@solana/spl-token';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

export const TOKEN_CONFIG = {
  name: process.env.TOKEN_NAME || 'LVAIR Protocol',
  symbol: process.env.TOKEN_SYMBOL || 'LVAIR',
  decimals: Number(process.env.TOKEN_DECIMALS) || 9,
  initialSupply: Number(process.env.TOKEN_SUPPLY) || 10_000_000,
  network: process.env.SOLANA_NETWORK || 'mainnet-beta',
  // Off-chain metadata JSON (name/symbol/image) — must be publicly hosted & permanent.
  // Default points to this repo's solana-token-metadata.json served by the app site.
  metadataUri: process.env.TOKEN_METADATA_URI || 'https://lvair.195.88.211.46.nip.io/solana-token-metadata.json',
  sellerFeeBasisPoints: Number(process.env.TOKEN_ROYALTY_BPS) || 0,
  revokeMintAuthority: process.env.REVOKE_MINT_AUTHORITY === '1',
};

// Metaplex Token Metadata program (stable mainnet ID)
const METAPLEX_METADATA_PROGRAM = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

const ENDPOINTS = {
  'mainnet-beta': 'https://api.mainnet-beta.solana.com',
  devnet: 'https://api.devnet.solana.com',
};

function encodeString(value) {
  const bytes = Buffer.from(value, 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(bytes.length, 0);
  return Buffer.concat([len, bytes]);
}

function encodeU16(value) {
  return Buffer.from([value & 0xff, (value >> 8) & 0xff]);
}

async function metadataPda(mint) {
  return PublicKey.findProgramAddress(
    [Buffer.from('metadata'), METAPLEX_METADATA_PROGRAM.toBuffer(), mint.toBuffer()],
    METAPLEX_METADATA_PROGRAM
  );
}

function buildCreateMetadataInstruction(payer, mint, mintAuthority, dataV2) {
  const { name, symbol, uri, sellerFeeBasisPoints } = dataV2;

  // createMetadataAccountV3 layout:
  // discriminator(8) | name | symbol | uri | feeBps(u16) | creators None(0) | collection None(0) | uses None(0) | isMutable(1) | collectionDetails None(0)
  const data = Buffer.concat([
    Buffer.from([0x25, 0x02, 0x06, 0xdf, 0xf2, 0xe7, 0x9b, 0xd2]),
    encodeString(name),
    encodeString(symbol),
    encodeString(uri),
    encodeU16(sellerFeeBasisPoints),
    Buffer.from([0]), // creators: None
    Buffer.from([0]), // collection: None
    Buffer.from([0]), // uses: None
    Buffer.from([1]), // isMutable: true
    Buffer.from([0]), // collectionDetails: None
  ]);

  const keys = [
    { pubkey: null, isSigner: false, isWritable: true },   // metadata PDA (filled below)
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: mintAuthority, isSigner: true, isWritable: false },
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: mintAuthority, isSigner: false, isWritable: false }, // updateAuthority
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
  ];

  return { keys, programId: METAPLEX_METADATA_PROGRAM, data };
}

export async function deploySplToken(keypairPath = path.join(REPO_ROOT, 'solana-deployer-key.json')) {
  if (TOKEN_CONFIG.network !== 'mainnet-beta' && TOKEN_CONFIG.network !== 'devnet') {
    throw new Error(`Unsupported SOLANA_NETWORK: ${TOKEN_CONFIG.network}`);
  }

  const endpoint = process.env.SOLANA_RPC || ENDPOINTS[TOKEN_CONFIG.network];
  const connection = new Connection(endpoint, 'confirmed');

  let payer;
  if (fs.existsSync(keypairPath)) {
    const rawKey = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
    payer = Keypair.fromSecretKey(Uint8Array.from(rawKey));
  } else {
    payer = Keypair.generate();
    fs.writeFileSync(keypairPath, JSON.stringify(Array.from(payer.secretKey)));
  }

  let balance = await connection.getBalance(payer.publicKey);

  if (balance < 0.05 * LAMPORTS_PER_SOL) {
    if (TOKEN_CONFIG.network === 'devnet') {
      for (let attempt = 1; attempt <= 3 && balance === 0; attempt++) {
        try {
          const sig = await connection.requestAirdrop(payer.publicKey, 2 * LAMPORTS_PER_SOL);
          const latestBlockhash = await connection.getLatestBlockhash();
          await connection.confirmTransaction({ signature: sig, ...latestBlockhash });
        } catch (e) {
          await new Promise(r => setTimeout(r, 2000));
        }
        balance = await connection.getBalance(payer.publicKey);
      }
    }

    if (balance === 0) {
      throw new Error(
        `Deployer wallet ${payer.publicKey.toBase58()} has no SOL. ` +
        `Fund it with ~0.2-0.5 SOL on ${TOKEN_CONFIG.network} first, then re-run.`
      );
    }
  }

  console.log(`\n[1/4] Creating mint on ${TOKEN_CONFIG.network} (deployer: ${payer.publicKey.toBase58()})...`);
  const mint = await createMint(
    connection,
    payer,
    payer.publicKey,
    payer.publicKey,
    TOKEN_CONFIG.decimals
  );
  console.log(`      Mint: ${mint.toBase58()}`);

  console.log('[2/4] Minting initial supply...');
  const tokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    mint,
    payer.publicKey
  );
  const amountToMint = BigInt(TOKEN_CONFIG.initialSupply) * BigInt(10 ** TOKEN_CONFIG.decimals);
  await mintTo(connection, payer, mint, tokenAccount.address, payer.publicKey, amountToMint);
  console.log(`      ${TOKEN_CONFIG.initialSupply.toLocaleString()} ${TOKEN_CONFIG.symbol} -> ${tokenAccount.address.toBase58()}`);

  console.log('[3/4] Attaching Metaplex metadata (name/symbol/logo)...');
  const [metadataAddress] = await metadataPda(mint);
  const existingMetadata = await connection.getAccountInfo(metadataAddress);

  if (!existingMetadata) {
    const createMetaIx = buildCreateMetadataInstruction(
      payer.publicKey,
      mint,
      payer.publicKey,
      {
        name: TOKEN_CONFIG.name,
        symbol: TOKEN_CONFIG.symbol,
        uri: TOKEN_CONFIG.metadataUri,
        sellerFeeBasisPoints: TOKEN_CONFIG.sellerFeeBasisPoints,
      }
    );
    createMetaIx.keys[0].pubkey = metadataAddress;

    const tx = new Transaction().add({
      keys: createMetaIx.keys,
      programId: createMetaIx.programId,
      data: createMetaIx.data,
    });
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    tx.feePayer = payer.publicKey;
    await sendAndConfirmTransaction(connection, tx, [payer]);
    console.log(`      Metadata account: ${metadataAddress.toBase58()}`);
  } else {
    console.log('      Metadata already exists — skipped.');
  }

  if (TOKEN_CONFIG.revokeMintAuthority) {
    console.log('[4/4] Revoking mint authority (supply is now fixed)...');
    const { createSetAuthorityInstruction } = await import('@solana/spl-token');
    const ix = createSetAuthorityInstruction(
      mint,
      payer.publicKey,
      null,
      0, // AuthorityType.MintTokens
      payer.publicKey,
      [payer.publicKey]
    );
    const tx = new Transaction().add(ix);
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    tx.feePayer = payer.publicKey;
    await sendAndConfirmTransaction(connection, tx, [payer]);
    console.log('      Mint authority revoked. No more tokens can be minted.');
  } else {
    console.log('[4/4] Mint authority kept (deployer). Set REVOKE_MINT_AUTHORITY=1 to fix supply.');
  }

  const deploymentResult = {
    tokenName: TOKEN_CONFIG.name,
    tokenSymbol: TOKEN_CONFIG.symbol,
    decimals: TOKEN_CONFIG.decimals,
    totalSupply: TOKEN_CONFIG.initialSupply,
    mintAddress: mint.toBase58(),
    ownerTokenAccount: tokenAccount.address.toBase58(),
    metadataAddress: metadataAddress.toBase58(),
    metadataUri: TOKEN_CONFIG.metadataUri,
    deployerAddress: payer.publicKey.toBase58(),
    network: TOKEN_CONFIG.network,
    explorerUrl: `https://explorer.solana.com/address/${mint.toBase58()}?cluster=${TOKEN_CONFIG.network}`,
    deployedAt: new Date().toISOString(),
  };

  fs.writeFileSync(
    path.join(REPO_ROOT, 'solana-token-deployment.json'),
    JSON.stringify(deploymentResult, null, 2)
  );

  console.log('\n✅ SPL Token deployed:');
  console.log(JSON.stringify(deploymentResult, null, 2));
  console.log(`
━━━━ NEXT STEPS to appear as a pair in wallets ━━━━
1. Make sure your metadata JSON is live at:
     ${TOKEN_CONFIG.metadataUri}
   (file: solana-token-metadata.json in repo root + logo image URL inside it)

2. Create a liquidity pool LVAIR/USDC on a Solana DEX:
   - Raydium v4 (https://raydium.io) or Orca (https://www.orca.so)
   - Use the wallet above; pair ${TOKEN_CONFIG.symbol} against USDC with ~$500-$1k liquidity
   → Once the pool exists, the token + price automatically appear in Jupiter swaps
     (Phantom / Backpack / Jupiter wallet).

3. Optional listings for visibility:
   - Jupiter strict list: https://developers.jupiter.com/docs/general-apis/process-of-adding-tokens
   - CoinGecko listing: https://www.coingecko.com/en/coins/list
   - Verify metadata on https://bubblemaps.io or https://solscan.io/token/${mint.toBase58()}
`);
  return deploymentResult;
}

if (process.argv[1].endsWith('deploy-spl-token.js')) {
  deploySplToken()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('\n❌ Deployment Failed:', err.message || err);
      process.exit(1);
    });
}
