# 📘 Tutor Lengkap: Deploy LVAIR ke Solana & Muncul di Wallet

Panduan langkah-demi-langkah buat menerbitkan token **LVAIR** di jaringan Solana
(mainnet), sehingga bisa **muncul sebagai pair/token di wallet** (Phantom, Backpack,
Jupiter) dan bisa di-swap.

> ⚠️ **Penting dipahami:** LVAIR yang sekarang jalan di node L1 kamu adalah token di
> **blockchain custom sendiri**, bukan token Solana. Wallet Solana tidak akan pernah
> menampilkannya. Supaya muncul di wallet, kita deploy **versi SPL LVAIR** di Solana,
> lalu bikin liquidity pool-nya.

---

## 📦 Persiapan

| Kebutuhan | Keterangan |
|---|---|
| Node.js v18+ | Untuk menjalankan script deploy |
| Wallet deployer | `pjYBR55ECJEURwxDFf8iN7P9UARrgtNMLyMLWZQFtCu` (sudah dibuat, aman) |
| SOL (mainnet) | ±0.3–0.5 SOL untuk biaya rent & fee |
| Logo PNG | `lvair-logo.png` di root repo |
| Wallet Phantom | Untuk operasi pool & verifikasi |

---

## 🔐 Langkah 0 — Keamanan Wallet

- `solana-deployer-key.json` **sudah dihapus dari git** dan masuk `.gitignore` (aman).
- Wallet lama `8s45wb7...` **dianggap bocor** — **JANGAN** pernah di-topup.
- Wallet baru yang dipakai: `pjYBR55ECJEURwxDFf8iN7P9UARrgtNMLyMLWZQFtCu`.

---

## 💰 Langkah 1 — Topup SOL ke Wallet Deployer (Wajib)

Semua biaya deploy (rent mint, metadata, pool) dibayar pakai SOL dari wallet ini.

1. Buka exchange kamu (Binance / OKX / Kraken / dsb.)
2. Pilih **Withdraw → SOL**, network **Solana**
3. Alamat tujuan:
   ```
   pjYBR55ECJEURwxDFf8iN7P9UARrgtNMLyMLWZQFtCu
   ```
4. Kirim **±0.3–0.5 SOL** (jangan terlalu kecil — nanti butuh buat pool juga)
5. Verifikasi saldo: https://explorer.solana.com/address/pjYBR55ECJEURwxDFf8iN7P9UARrgtNMLyMLWZQFtCu

> ⏳ Biasanya masuk dalam < 1 menit. Lanjut setelah saldo terlihat.

---

## 🖼️ Langkah 2 — Siapkan Logo & Metadata

1. Buat file logo **`lvair-logo.png`** (ukuran bebas, ideal 512×512, background polos)
2. Taruh di **root folder repo** (sejajar dengan `ops.html`)
3. Setelah di-push, logo otomatis bisa diakses di:
   ```
   https://lvair.195.88.211.46.nip.io/lvair-logo.png
   ```
   (URL ini sudah direferensikan di `solana-token-metadata.json` — nama, simbol, deskripsi, logo)

> Kalau mau ganti nama/simbol/deskripsi, edit `solana-token-metadata.json` dulu.

---

## 🚀 Langkah 3 — Deploy SPL Token (Mint + Metadata)

Buka terminal di folder repo:

```bash
npm install
node scripts/deploy-spl-token.js
```

Apa yang terjadi di dalam script:

| Tahap | Aksi |
|---|---|
| 1/4 | Buat **Mint** LVAIR (decimals 9) |
| 2/4 | **Mint 10.000.000 LVAIR** ke wallet deployer |
| 3/4 | Pasang **metadata Metaplex** (nama, simbol, logo) |
| 4/4 | Tampilkan hasil deploy |

Output-nya akan seperti ini:

```
[1/4] Creating mint on mainnet-beta (deployer: pjYBR55...)
      Mint: 4k3YxQ2...abc
[2/4] Minting initial supply...
      10,000,000 LVAIR -> Gf7m...xyz
[3/4] Attaching Metaplex metadata...
      Metadata account: 9Aq1...
✅ SPL Token deployed:
{
  "mintAddress": "4k3YxQ2...abc",
  "network": "mainnet-beta",
  ...
}
```

📌 **SALIN `mintAddress`** — ini alamat token LVAIR di Solana, dipakai di langkah berikutnya.
Hasil lengkap juga tersimpan di file **`solana-token-deployment.json`**.

---

## ✅ Langkah 4 — Verifikasi Token

Buka di browser:

```
https://solscan.io/token/<mintAddress>
```

Pastikan:
- ✔️ Nama & simbol **LVAIR** muncul (bukan "Unknown")
- ✔️ Logo tampil
- ✔️ Total supply 10.000.000
- ✔️ Decimals 9

---

## 📱 Langkah 5 — Import di Wallet Phantom

1. Buka Phantom → **Settings → Tokens → Manage Token List → Add Custom Token**
2. Network: **Solana**
3. Tempel `mintAddress`
4. Klik Add → token LVAIR + saldo muncul di wallet

---

## 💧 Langkah 6 — Buat Liquidity Pool (Biar Jadi "Pair")

Ini langkah kunci: **tanpa pool, token tidak akan muncul sebagai pair di wallet swap.**

1. Buka **https://raydium.io** → **Connect Wallet** (import wallet deployer ke Phantom dulu: Phantom → Import Secret Key)
2. Klik **+ (Add Token)** di dropdown token → tempel `mintAddress`
3. Pilih pair **LVAIR / USDC**
4. Klik **Add Liquidity**:
   - **LVAIR**: dari saldo deployer
   - **USDC**: dari saldo deployer (atau beli USDC dulu)
   - Total liquidity disarankan mulai **$500–$1.000**
5. Konfirmasi transaksi (bayar fee SOL ±0.01–0.02 SOL)

> 💡 Alternatif DEX lain: **Orca** (https://www.orca.so) atau **Meteora**.

---

## 🎉 Langkah 7 — Verifikasi "Muncul di Pair" di Wallet

Setelah pool jadi (±1–2 menit):

1. Buka **Phantom → Swap** atau **https://jupiter.ag**
2. Cari token **LVAIR** — sudah muncul dengan harga & chart
3. Coba **swap USDC → LVAIR** (atau sebaliknya) — harus berhasil

> Jupiter adalah mesin aggregator yang dipakai Phantom/Backpack — begitu pool
> terdeteksi Jupiter, token otomatis muncul di semua wallet tersebut.

---

## 🔧 Opsional

### Kunci Supply Maksimum
Biar tidak ada yang bisa mint token baru lagi:
```bash
REVOKE_MINT_AUTHORITY=1 node scripts/deploy-spl-token.js
```

### Uji Coba di Devnet (Gratis, Buat Tes Dulu)
```bash
SOLANA_NETWORK=devnet node scripts/deploy-spl-token.js
```
- Script otomatis minta SOL devnet.
- Kalau dapat pesan *"faucet has run dry"*, topup manual di web
  **https://faucet.solana.com** (isi alamat wallet + captcha), lalu ulangi.

### Listing Resmi (untuk Visibilitas Lebih Luas)
- **Jupiter Strict List** — agar selalu tampil di swap:
  https://developers.jupiter.com/docs/general-apis/process-of-adding-tokens
- **CoinGecko** — agar ada harga & data di situs market:
  https://www.coingecko.com/en/coins/list

---

## 🧯 Troubleshooting

| Masalah | Solusi |
|---|---|
| `has no SOL` saat deploy | Wallet deployer belum di-topup. Lihat Langkah 1. |
| `429 / faucet has run dry` (devnet) | Topup manual di https://faucet.solana.com |
| Token tampil "Unknown" | Metadata belum terpasang → cek URL `metadataUri` bisa diakses & coba deploy ulang ke mint baru |
| Tidak muncul di Jupiter | Pool belum dibuat / liquidity belum cukup. Selesaikan Langkah 6. |
| Logo tidak tampil | Pastikan `lvair-logo.png` sudah di-push & URL `https://lvair.195.88.211.46.nip.io/lvair-logo.png` bisa dibuka |

---

## 📂 File Terkait

| File | Fungsi |
|---|---|
| `scripts/deploy-spl-token.js` | Script deploy mint + metadata |
| `solana-token-metadata.json` | Metadata off-chain (nama/simbol/logo) |
| `solana-deployer-key.json` | Private key wallet (⚠️ RAHASIA — jangan commit) |
| `solana-token-deployment.json` | Hasil deploy (mint address, dll) |
