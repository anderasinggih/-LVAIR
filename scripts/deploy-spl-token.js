import {
  Connection,
  Keypair,
  PublicKey,
  clusterApiUrl,
  LAMPORTS_PER_SOL
} from '@solana/web3.js';
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo
} from '@solana/spl-token';
import fs from 'fs';

export const TOKEN_CONFIG = {
  name: "LVAIR Protocol",
  symbol: "LVAIR",
  decimals: 9,
  initialSupply: 10_000_000,
  network: process.env.SOLANA_NETWORK || 'devnet'
};

export async function deploySplToken(keypairPath = './solana-deployer-key.json') {
  const endpoint = TOKEN_CONFIG.network === 'mainnet-beta'
    ? 'https://api.mainnet-beta.solana.com'
    : 'https://api.devnet.solana.com';

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
    let airdropSuccess = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const sig = await connection.requestAirdrop(payer.publicKey, 2 * LAMPORTS_PER_SOL);
        const latestBlockhash = await connection.getLatestBlockhash();
        await connection.confirmTransaction({
          signature: sig,
          ...latestBlockhash
        });
        airdropSuccess = true;
        break;
      } catch (e) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    balance = await connection.getBalance(payer.publicKey);
    if (balance === 0) {
      throw new Error(`Deployer wallet ${payer.publicKey.toBase58()} needs Devnet/Mainnet SOL to pay for mint creation rent`);
    }
  }

  const mint = await createMint(
    connection,
    payer,
    payer.publicKey,
    payer.publicKey,
    TOKEN_CONFIG.decimals
  );

  const tokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    mint,
    payer.publicKey
  );

  const amountToMint = BigInt(TOKEN_CONFIG.initialSupply) * BigInt(10 ** TOKEN_CONFIG.decimals);
  await mintTo(
    connection,
    payer,
    mint,
    tokenAccount.address,
    payer.publicKey,
    amountToMint
  );

  const deploymentResult = {
    tokenName: TOKEN_CONFIG.name,
    tokenSymbol: TOKEN_CONFIG.symbol,
    decimals: TOKEN_CONFIG.decimals,
    totalSupply: TOKEN_CONFIG.initialSupply,
    mintAddress: mint.toBase58(),
    ownerTokenAccount: tokenAccount.address.toBase58(),
    deployerAddress: payer.publicKey.toBase58(),
    network: TOKEN_CONFIG.network,
    explorerUrl: `https://explorer.solana.com/address/${mint.toBase58()}?cluster=${TOKEN_CONFIG.network}`,
    deployedAt: new Date().toISOString()
  };

  fs.writeFileSync('./solana-token-deployment.json', JSON.stringify(deploymentResult, null, 2));
  return deploymentResult;
}

if (process.argv[1].endsWith('deploy-spl-token.js')) {
  deploySplToken()
    .then(res => {
      console.log('SPL Token Deployed Successfully:', JSON.stringify(res, null, 2));
      process.exit(0);
    })
    .catch(err => {
      console.error('Deployment Failed:', err.message || err);
      process.exit(1);
    });
}
