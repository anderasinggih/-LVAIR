# LVAIR — Solana Listing Runbook

Goal: make LVAIR appear as a tradable pair in Solana wallets (Phantom, Backpack, Jupiter).

> ⚠️ The live LVAIR on your L1 node is **not** a Solana token. Wallets only show
> Solana-native SPL tokens. This runbook deploys the SPL representation + liquidity.

## 0. Security (sudah dikerjakan)
- `solana-deployer-key.json` sudah **dihapus dari git** dan masuk `.gitignore`.
- Key lama (`8s45wb7...`) **dianggap bocor** — JANGAN pernah di-topup.
- Wallet baru: `pjYBR55ECJEURwxDFf8iN7P9UARrgtNMLyMLWZQFtCu`

## 1. Fund wallet (mainnet)
Kirim ~0.2–0.5 SOL ke `pjYBR55ECJEURwxDFf8iN7P9UARrgtNMLyMLWZQFtCu`.
Cek: https://explorer.solana.com/address/pjYBR55ECJEURwxDFf8iN7P9UARrgtNMLyMLWZQFtCu

## 2. Host logo
Letakkan file logo PNG di root repo dengan nama `lvair-logo.png`
→ otomatis bisa diakses `https://lvair.195.88.211.46.nip.io/lvair-logo.png`
(URL ini sudah direferensikan di `solana-token-metadata.json`).

## 3. Deploy mint + metadata
```bash
npm install   # pastikan @solana/web3.js & @solana/spl-token terpasang
node scripts/deploy-spl-token.js                # mainnet-beta
```
Opsional:
```bash
SOLANA_NETWORK=devnet node scripts/deploy-spl-token.js   # uji coba gratis dulu
REVOKE_MINT_AUTHORITY=1 node scripts/deploy-spl-token.js # kunci supply maksimum
```
Output disimpan ke `solana-token-deployment.json` (mint address dll).

## 4. Buat liquidity pool (→ muncul di Jupiter)
1. Buka **https://raydium.io** atau **https://www.orca.so** dengan wallet deployer.
2. Import token LVAIR pakai mint address dari step 3.
3. Tambah liquidity **LVAIR/USDC** (USDC dari wallet deployer; butuh SOL kecil utk fee).
   Disarankan mulai dari ~$500–$1000 total liquidity.
4. Begitu pool jadi, token + harga otomatis terdeteksi **Jupiter** →
   langsung muncul sebagai pair swap di Phantom/Backpack/wallet Jupiter.

## 5. Listing tambahan (opsional, untuk visibilitas)
- **Jupiter strict list** — https://developers.jupiter.com/docs/general-apis/process-of-adding-tokens
- **CoinGecko** — https://www.coingecko.com/en/coins/list
- Cek metadata jadi: `https://solscan.io/token/<MINT>`

## Uji cepat di devnet
```bash
SOLANA_NETWORK=devnet node scripts/deploy-spl-token.js
```
(script otomatis airdrop SOL devnet). Pakai devnet buat tes alur penuh sebelum mainnet.
