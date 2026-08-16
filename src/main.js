import { Blockchain } from './core/blockchain.js';
import { AMMPool } from './core/trading.js';
import { TradingBotEngine } from './core/bot.js';
import { Transaction } from './core/block.js';
import contentData from './content.json';

const CONNECTED_WALLET_KEY = 'LVAIR_CONNECTED_WALLET_ADDR';
const CONNECTED_PROVIDER_KEY = 'LVAIR_CONNECTED_WALLET_PROV';

// State
let blockchain;
let ammPool;
let botEngine;
let currentConnectedAddress = null;
let currentConnectedProvider = null;
let currentInputToken = 'LVAIR';

// DOM Selectors
const pageLanding = document.getElementById('page-landing');
const pageApp = document.getElementById('page-app');

const btnLandingEnterApp = document.getElementById('btn-landing-enter-app');
const btnHeroTradeNow = document.getElementById('btn-hero-trade-now');
const btnHeroConnect = document.getElementById('btn-hero-connect');
const btnTerminalEnterApp = document.getElementById('btn-terminal-enter-app');
const appBrandHomeLink = document.getElementById('app-brand-home-link');

const heroBadge = document.getElementById('hero-badge');
const heroHeadline = document.getElementById('hero-headline');
const heroSubheadline = document.getElementById('hero-subheadline');
const landingTotalSupply = document.getElementById('landing-total-supply');
const landingPriceVal = document.getElementById('landing-price-val');
const landingReservesVal = document.getElementById('landing-reserves-val');
const landingHeightVal = document.getElementById('landing-height-val');

const dynamicValueProps = document.getElementById('dynamic-value-props');
const dynamicTokenomics = document.getElementById('dynamic-tokenomics');
const dynamicRoadmap = document.getElementById('dynamic-roadmap');
const dynamicFaqs = document.getElementById('dynamic-faqs');

const walletModal = document.getElementById('wallet-modal');
const btnCloseWalletModal = document.getElementById('btn-close-wallet-modal');
const btnConnectWallet = document.getElementById('btn-connect-wallet');

const walletOptMetamask = document.getElementById('wallet-opt-metamask');
const walletOptPhantom = document.getElementById('wallet-opt-phantom');
const walletOptBinance = document.getElementById('wallet-opt-binance');
const walletOptCoinbase = document.getElementById('wallet-opt-coinbase');

const tagMetamask = document.getElementById('tag-metamask');
const tagPhantom = document.getElementById('tag-phantom');
const tagBinance = document.getElementById('tag-binance');

const statPrice = document.getElementById('stat-price');
const statPoolReserves = document.getElementById('stat-pool-reserves');
const statAirBal = document.getElementById('stat-air-bal');
const statUsdtBal = document.getElementById('stat-usdt-bal');
const statBlockHeight = document.getElementById('stat-block-height');

const swapInputAmount = document.getElementById('swap-input-amount');
const swapOutputAmount = document.getElementById('swap-output-amount');
const swapInputToken = document.getElementById('swap-input-token');
const swapOutputToken = document.getElementById('swap-output-token');
const swapPriceImpact = document.getElementById('swap-price-impact');
const swapMaxBadge = document.getElementById('swap-max-badge');
const swapPoolLiquidity = document.getElementById('swap-pool-liquidity');
const btnExecuteSwap = document.getElementById('btn-execute-swap');
const btnTogglePair = document.getElementById('btn-toggle-pair');

const transferRecipientInput = document.getElementById('transfer-recipient-input');
const transferTokenSelect = document.getElementById('transfer-token-select');
const transferAmountInput = document.getElementById('transfer-amount-input');
const btnSendTransfer = document.getElementById('btn-send-transfer');

const btnClaimAirdrop = document.getElementById('btn-claim-airdrop');
const airdropStatusText = document.getElementById('airdrop-status-text');

const tradesTableBody = document.getElementById('trades-table-body');
const explorerBlocksBody = document.getElementById('explorer-blocks-body');
const btnValidateChain = document.getElementById('btn-validate-chain');
const btnExportChain = document.getElementById('btn-export-chain');

const canvas = document.getElementById('price-chart');
const ctx = canvas ? canvas.getContext('2d') : null;

// Toast Notification
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast-msg ${type === 'success' ? 'toast-success' : 'toast-error'}`;
  toast.innerHTML = `<span>${type === 'success' ? '✓' : '⚠'}</span> <span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 4500);
}

async function initApp() {
  blockchain = new Blockchain(2);
  await blockchain.init();
  ammPool = new AMMPool(blockchain, 100000, 25000);

  // Background Autonomous Liquidity Engine
  botEngine = new TradingBotEngine(blockchain, ammPool);
  botEngine.start(4000, () => {
    updateUI();
    updateLandingLiveStats();
  });

  renderDynamicContent();
  detectWalletProviders();
  setupNavigationRouting();
  setupWalletModalListeners();
  setupTabs();
  setupSwapListeners();
  setupTransferListeners();

  restoreSavedWallet();
  updateUI();
  updateLandingLiveStats();

  if (window.ethereum) {
    window.ethereum.on('accountsChanged', (accounts) => {
      if (accounts && accounts.length > 0) {
        setConnectedWallet(accounts[0], 'MetaMask');
      } else {
        disconnectWallet();
      }
    });
  }
}

function renderDynamicContent() {
  if (!contentData) return;

  if (heroBadge) heroBadge.innerText = contentData.project.badge;
  if (heroHeadline) heroHeadline.innerText = contentData.project.headline;
  if (heroSubheadline) heroSubheadline.innerHTML = `<strong>$${contentData.project.symbol}</strong> ${contentData.project.subheadline}`;
  if (landingTotalSupply) landingTotalSupply.innerText = contentData.project.stats.totalSupply;

  if (dynamicValueProps && contentData.valueProps) {
    dynamicValueProps.innerHTML = contentData.valueProps.map(v => `
      <div class="panel">
        <h3 style="font-size: 1rem; font-weight: 600; margin-bottom: 8px;">${v.title}</h3>
        <p style="color: var(--text-secondary); font-size: 0.82rem; line-height: 1.6;">${v.description}</p>
      </div>
    `).join('');
  }

  if (dynamicTokenomics && contentData.tokenomics) {
    dynamicTokenomics.innerHTML = contentData.tokenomics.map(t => `
      <div class="panel">
        <div class="stat-label">${t.label}</div>
        <div style="font-size: 1.15rem; font-weight: 700; color: ${t.isHighlight ? 'var(--accent-success)' : 'var(--text-primary)'}; margin-top: 4px;">${t.value}</div>
        <p style="color: var(--text-secondary); font-size: 0.8rem; margin-top: 6px; line-height: 1.5;">${t.description}</p>
      </div>
    `).join('');
  }

  if (dynamicRoadmap && contentData.roadmap) {
    dynamicRoadmap.innerHTML = contentData.roadmap.map(r => {
      const color = r.status === 'completed' ? 'var(--accent-success)' : r.status === 'current' ? 'var(--accent-primary)' : 'var(--text-tertiary)';
      return `
        <div class="panel">
          <div style="font-weight: 700; font-size: 0.85rem; color: ${color}; margin-bottom: 4px;">${r.phase}</div>
          <h4 style="font-size: 0.95rem; font-weight: 600; margin-bottom: 8px;">${r.title}</h4>
          <ul style="color: var(--text-secondary); font-size: 0.78rem; line-height: 1.8; list-style: none;">
            ${r.items.map(item => `<li>• ${item}</li>`).join('')}
          </ul>
        </div>
      `;
    }).join('');
  }

  if (dynamicFaqs && contentData.faqs) {
    dynamicFaqs.innerHTML = contentData.faqs.map(f => `
      <div class="panel">
        <h4 style="font-size: 0.9rem; font-weight: 600; margin-bottom: 6px;">${f.question}</h4>
        <p style="color: var(--text-secondary); font-size: 0.8rem; line-height: 1.5;">${f.answer}</p>
      </div>
    `).join('');
  }
}

function setupNavigationRouting() {
  const showLanding = () => {
    pageLanding.style.display = 'block';
    pageApp.style.display = 'none';
    window.scrollTo({ top: 0, behavior: 'smooth' });
    updateLandingLiveStats();
  };

  const showApp = () => {
    pageLanding.style.display = 'none';
    pageApp.style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'smooth' });
    renderChart();
    updateUI();
  };

  btnLandingEnterApp.addEventListener('click', showApp);
  btnHeroTradeNow.addEventListener('click', showApp);
  if (btnTerminalEnterApp) btnTerminalEnterApp.addEventListener('click', showApp);
  btnHeroConnect.addEventListener('click', () => {
    walletModal.style.display = 'flex';
  });

  if (appBrandHomeLink) {
    appBrandHomeLink.addEventListener('click', showLanding);
  }
}

function updateLandingLiveStats() {
  if (!ammPool || !blockchain) return;
  landingPriceVal.innerText = `$${ammPool.getCurrentPrice().toFixed(4)}`;
  landingReservesVal.innerText = `${Math.round(ammPool.lvairReserve / 1000)}k / $${Math.round(ammPool.usdtReserve / 1000)}k`;
  landingHeightVal.innerText = `$${(ammPool.trades.length * 1420 + 25000).toLocaleString()}+`;
}

function detectWalletProviders() {
  if (window.ethereum) {
    tagMetamask.innerText = 'Detected';
    tagMetamask.className = 'badge badge-success';
  } else {
    tagMetamask.innerText = 'Not Installed';
    tagMetamask.className = 'badge badge-neutral';
  }

  if (window.phantom || window.solana) {
    tagPhantom.innerText = 'Detected';
    tagPhantom.className = 'badge badge-success';
  } else {
    tagPhantom.innerText = 'Not Installed';
    tagPhantom.className = 'badge badge-neutral';
  }

  if (window.BinanceChain) {
    tagBinance.innerText = 'Detected';
    tagBinance.className = 'badge badge-success';
  } else {
    tagBinance.innerText = 'Not Installed';
    tagBinance.className = 'badge badge-neutral';
  }
}

function restoreSavedWallet() {
  const savedAddr = localStorage.getItem(CONNECTED_WALLET_KEY);
  const savedProv = localStorage.getItem(CONNECTED_PROVIDER_KEY);
  if (savedAddr) {
    currentConnectedAddress = savedAddr;
    currentConnectedProvider = savedProv || 'Web3 Wallet';
  }
}

function disconnectWallet() {
  currentConnectedAddress = null;
  currentConnectedProvider = null;
  localStorage.removeItem(CONNECTED_WALLET_KEY);
  localStorage.removeItem(CONNECTED_PROVIDER_KEY);
  showToast('Wallet disconnected');
  updateUI();
}

function setupWalletModalListeners() {
  const openModal = () => {
    detectWalletProviders();
    walletModal.style.display = 'flex';
  };
  const closeModal = () => {
    walletModal.style.display = 'none';
  };

  btnConnectWallet.addEventListener('click', () => {
    if (currentConnectedAddress) {
      disconnectWallet();
    } else {
      openModal();
    }
  });

  btnCloseWalletModal.addEventListener('click', closeModal);

  walletOptMetamask.addEventListener('click', async () => {
    closeModal();
    if (!window.ethereum) {
      showToast('MetaMask not detected. Opening download page...', 'error');
      window.open('https://metamask.io/download/', '_blank');
      return;
    }

    try {
      showToast('Requesting connection from MetaMask...');
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      if (accounts && accounts.length > 0) {
        setConnectedWallet(accounts[0], 'MetaMask');
      } else {
        showToast('No accounts returned by MetaMask', 'error');
      }
    } catch (err) {
      if (err.code === 4001) {
        showToast('Connection request rejected by user', 'error');
      } else {
        showToast(`MetaMask Error: ${err.message || err}`, 'error');
      }
    }
  });

  walletOptPhantom.addEventListener('click', async () => {
    closeModal();
    const provider = window.phantom?.solana || window.solana;
    if (!provider || !provider.isPhantom) {
      showToast('Phantom Wallet not detected. Opening download page...', 'error');
      window.open('https://phantom.app/download', '_blank');
      return;
    }

    try {
      showToast('Requesting connection from Phantom...');
      const resp = await provider.connect();
      const pubKey = resp.publicKey.toString();
      setConnectedWallet(pubKey, 'Phantom');
    } catch (err) {
      if (err.code === 4001) {
        showToast('Connection rejected by user', 'error');
      } else {
        showToast(`Phantom Error: ${err.message || err}`, 'error');
      }
    }
  });

  walletOptBinance.addEventListener('click', async () => {
    closeModal();
    if (!window.BinanceChain) {
      showToast('Binance Web3 Wallet not detected. Opening download page...', 'error');
      window.open('https://www.binance.com/en/web3wallet', '_blank');
      return;
    }

    try {
      showToast('Requesting Binance Web3 Wallet...');
      const accounts = await window.BinanceChain.request({ method: 'eth_requestAccounts' });
      if (accounts && accounts.length > 0) {
        setConnectedWallet(accounts[0], 'Binance Wallet');
      }
    } catch (err) {
      showToast(`Binance Wallet Error: ${err.message || err}`, 'error');
    }
  });

  walletOptCoinbase.addEventListener('click', async () => {
    closeModal();
    if (window.ethereum?.isCoinbaseWallet || window.coinbaseWalletExtension) {
      try {
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        if (accounts && accounts[0]) {
          setConnectedWallet(accounts[0], 'Coinbase Wallet');
          return;
        }
      } catch (err) {
        showToast(`Coinbase Error: ${err.message}`, 'error');
        return;
      }
    }

    showToast('Coinbase Wallet extension not found. Opening download page...', 'error');
    window.open('https://www.coinbase.com/wallet', '_blank');
  });
}

function setConnectedWallet(address, provider) {
  currentConnectedAddress = address;
  currentConnectedProvider = provider;
  localStorage.setItem(CONNECTED_WALLET_KEY, address);
  localStorage.setItem(CONNECTED_PROVIDER_KEY, provider);
  showToast(`Connected to ${provider} (${address.substring(0, 6)}...${address.substring(address.length - 4)})`);
  updateUI();
}

function setupTabs() {
  const tabs = document.querySelectorAll('#page-app .tab-btn');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const target = tab.getAttribute('data-tab');
      document.querySelectorAll('#page-app .tab-content').forEach(content => {
        content.style.display = content.id === `tab-${target}` ? 'block' : 'none';
      });

      if (target === 'trading') renderChart();
    });
  });
}

function setupTransferListeners() {
  btnSendTransfer.addEventListener('click', async () => {
    if (!currentConnectedAddress) {
      walletModal.style.display = 'flex';
      return;
    }

    const toAddress = transferRecipientInput.value.trim();
    const token = transferTokenSelect.value;
    const amount = parseFloat(transferAmountInput.value);

    if (!toAddress) return showToast('Please enter a valid destination address', 'error');
    if (!amount || amount <= 0) return showToast('Enter a valid transfer amount', 'error');

    const currentBal = blockchain.getBalanceOfAddress(currentConnectedAddress, token);
    if (currentBal < amount) {
      return showToast(`Insufficient ${token} balance. Available: ${currentBal} ${token}`, 'error');
    }

    btnSendTransfer.disabled = true;
    btnSendTransfer.innerText = 'Settling Transaction...';

    try {
      const tx = new Transaction(
        currentConnectedAddress,
        toAddress,
        amount,
        token,
        'P2P_TRANSFER',
        { memo: 'On-Chain Transfer' }
      );
      tx.txHash = await tx.calculateHash();
      await blockchain.addTransaction(tx);
      await blockchain.minePendingTransactions(currentConnectedAddress);

      showToast(`Transferred ${amount} ${token} on-chain!`);
      transferRecipientInput.value = '';
      updateUI();
      updateLandingLiveStats();
    } catch (err) {
      showToast(`Transfer Failed: ${err.message}`, 'error');
    } finally {
      btnSendTransfer.disabled = false;
      btnSendTransfer.innerText = 'Send On-Chain Transfer';
    }
  });
}

function setupSwapListeners() {
  const recalculateQuote = () => {
    const val = parseFloat(swapInputAmount.value) || 0;
    const quote = ammPool.getQuote(val, currentInputToken);
    swapOutputAmount.value = quote.outputAmount.toFixed(4);
    swapPriceImpact.innerText = `${quote.priceImpact}%`;
    swapPriceImpact.style.color = quote.priceImpact > 3 ? 'var(--accent-danger)' : 'var(--accent-success)';
  };

  swapInputAmount.addEventListener('input', recalculateQuote);

  swapMaxBadge.addEventListener('click', () => {
    if (!currentConnectedAddress) return;
    const bal = blockchain.getBalanceOfAddress(currentConnectedAddress, currentInputToken);
    swapInputAmount.value = bal;
    recalculateQuote();
  });

  btnTogglePair.addEventListener('click', () => {
    currentInputToken = currentInputToken === 'LVAIR' ? 'USDT' : 'LVAIR';
    swapInputToken.innerText = currentInputToken;
    swapOutputToken.innerText = currentInputToken === 'LVAIR' ? 'USDT' : 'LVAIR';
    recalculateQuote();
    updateSwapMax();
  });

  btnExecuteSwap.addEventListener('click', async () => {
    if (!currentConnectedAddress) {
      walletModal.style.display = 'flex';
      return;
    }

    const amount = parseFloat(swapInputAmount.value);
    if (!amount || amount <= 0) return showToast('Enter a valid amount', 'error');

    btnExecuteSwap.disabled = true;
    btnExecuteSwap.innerText = 'Settling Swap...';

    try {
      const result = await ammPool.executeSwap(currentConnectedAddress, amount, currentInputToken);
      showToast(`Swapped ${amount} ${currentInputToken} in Block #${result.block.index}!`);
      updateUI();
      updateLandingLiveStats();
      recalculateQuote();
    } catch (err) {
      showToast(`Swap Error: ${err.message}`, 'error');
    } finally {
      btnExecuteSwap.disabled = false;
      btnExecuteSwap.innerText = 'Execute Swap';
    }
  });

  btnClaimAirdrop.addEventListener('click', async () => {
    if (!currentConnectedAddress) {
      walletModal.style.display = 'flex';
      return;
    }

    btnClaimAirdrop.disabled = true;
    btnClaimAirdrop.innerText = 'Claiming Allocation...';

    try {
      await blockchain.claimAirdrop(currentConnectedAddress);
      showToast(`250 $LVAIR successfully claimed!`);
      updateUI();
      updateLandingLiveStats();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btnClaimAirdrop.disabled = false;
      btnClaimAirdrop.innerText = 'Claim 250 $LVAIR Airdrop';
    }
  });

  btnValidateChain.addEventListener('click', async () => {
    const res = await blockchain.isChainValid();
    if (res.valid) {
      showToast('Ledger integrity verified: All blocks and proofs are valid!');
    } else {
      showToast(`Validation Error: ${res.error}`, 'error');
    }
  });

  if (btnExportChain) {
    btnExportChain.addEventListener('click', () => {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(blockchain.chain, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", `lvair_ledger_export_${blockchain.chain.length}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      showToast('Ledger JSON exported');
    });
  }

  recalculateQuote();
}

function updateSwapMax() {
  if (!currentConnectedAddress) {
    swapMaxBadge.innerText = 'Bal: 0';
    return;
  }
  const bal = blockchain.getBalanceOfAddress(currentConnectedAddress, currentInputToken);
  swapMaxBadge.innerText = `Bal: ${bal.toLocaleString()} ${currentInputToken}`;
}

function updateUI() {
  if (!ammPool || !blockchain) return;

  if (currentConnectedAddress) {
    btnConnectWallet.innerText = `${currentConnectedAddress.substring(0, 6)}...${currentConnectedAddress.substring(currentConnectedAddress.length - 4)}`;
    btnConnectWallet.title = `Connected via ${currentConnectedProvider} (Click to disconnect)`;
    btnConnectWallet.className = 'btn-secondary';
    btnExecuteSwap.innerText = 'Execute Swap';
  } else {
    btnConnectWallet.innerText = 'Connect Wallet';
    btnConnectWallet.title = 'Click to connect your Web3 wallet';
    btnConnectWallet.className = 'btn-primary';
    btnExecuteSwap.innerText = 'Connect Wallet to Swap';
  }

  const airPrice = ammPool.getCurrentPrice();
  statPrice.innerText = `$${airPrice.toFixed(4)}`;
  statPoolReserves.innerText = `${Math.round(ammPool.lvairReserve).toLocaleString()} / $${Math.round(ammPool.usdtReserve).toLocaleString()}`;
  swapPoolLiquidity.innerText = `$${Math.round(ammPool.usdtReserve * 2).toLocaleString()}`;

  if (currentConnectedAddress) {
    const userAir = blockchain.getBalanceOfAddress(currentConnectedAddress, 'LVAIR');
    const userUsdt = blockchain.getBalanceOfAddress(currentConnectedAddress, 'USDT');
    statAirBal.innerText = `${userAir.toLocaleString()} LVAIR`;
    statUsdtBal.innerText = `$${userUsdt.toFixed(2)}`;

    const hasClaimed = blockchain.claimedAddresses.has(currentConnectedAddress);
    if (hasClaimed) {
      airdropStatusText.innerText = `250 $LVAIR Claimed for this Wallet`;
      airdropStatusText.style.color = 'var(--text-secondary)';
      btnClaimAirdrop.disabled = true;
      btnClaimAirdrop.innerText = 'Already Claimed';
    } else {
      airdropStatusText.innerText = `Eligible to Claim 250 $LVAIR`;
      airdropStatusText.style.color = 'var(--accent-success)';
      btnClaimAirdrop.disabled = false;
      btnClaimAirdrop.innerText = `Claim 250 $LVAIR Airdrop`;
    }
  } else {
    statAirBal.innerText = '0 LVAIR';
    statUsdtBal.innerText = '$0.00';
    airdropStatusText.innerText = 'Connect Wallet to Check';
    airdropStatusText.style.color = 'var(--text-tertiary)';
    btnClaimAirdrop.disabled = false;
    btnClaimAirdrop.innerText = 'Connect Wallet to Claim';
  }

  statBlockHeight.innerText = `#${blockchain.chain.length}`;
  updateSwapMax();

  tradesTableBody.innerHTML = ammPool.trades.slice(0, 10).map(t => `
    <tr>
      <td><span class="badge ${t.type === 'BUY_LVAIR' ? 'badge-success' : 'badge-danger'}">${t.type}</span></td>
      <td>${t.inputAmount} ${t.inputToken}</td>
      <td>${t.outputAmount} ${t.outputToken}</td>
      <td>$${t.price.toFixed(4)}</td>
      <td title="${t.user}">${t.user.substring(0, 6)}...${t.user.substring(t.user.length - 4)}</td>
      <td>#${t.blockIndex}</td>
    </tr>
  `).join('');

  explorerBlocksBody.innerHTML = [...blockchain.chain].reverse().map(b => `
    <tr>
      <td><strong style="color: var(--text-primary);">#${b.index}</strong></td>
      <td title="${b.hash}">${b.hash.substring(0, 10)}...</td>
      <td title="${b.previousHash}">${b.previousHash.substring(0, 10)}...</td>
      <td title="${b.merkleRoot || ''}">${(b.merkleRoot || '').substring(0, 10)}...</td>
      <td>${b.nonce}</td>
      <td><span class="badge badge-neutral">${b.transactions.length} txs</span></td>
      <td>${new Date(b.timestamp).toLocaleTimeString()}</td>
    </tr>
  `).join('');

  renderChart();
}

function renderChart() {
  if (!canvas || !ctx) return;
  const history = ammPool.priceHistory;
  if (history.length < 2) return;

  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const prices = history.map(h => h.price);
  const minP = Math.min(...prices) * 0.99;
  const maxP = Math.max(...prices) * 1.01;

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    const y = (canvas.height / 5) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  ctx.beginPath();
  const stepX = canvas.width / (prices.length - 1);
  prices.forEach((p, idx) => {
    const x = idx * stepX;
    const y = canvas.height - ((p - minP) / (maxP - minP)) * canvas.height;
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.strokeStyle = '#2563eb';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.lineTo(canvas.width, canvas.height);
  ctx.lineTo(0, canvas.height);
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, 'rgba(37, 99, 235, 0.15)');
  gradient.addColorStop(1, 'rgba(37, 99, 235, 0.0)');
  ctx.fillStyle = gradient;
  ctx.fill();
}

window.addEventListener('DOMContentLoaded', initApp);
window.addEventListener('resize', renderChart);
