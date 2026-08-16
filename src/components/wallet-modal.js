import { AppState, CONNECTED_WALLET_KEY, CONNECTED_PROVIDER_KEY, updateUI } from '../state.js';
import { showToast } from '../components/toast.js';

export function detectWalletProviders() {
  const tagMetamask = document.getElementById('tag-metamask');
  const tagPhantom = document.getElementById('tag-phantom');
  const tagBinance = document.getElementById('tag-binance');

  if (tagMetamask) {
    tagMetamask.innerText = window.ethereum ? 'Detected' : 'Not Installed';
    tagMetamask.className = window.ethereum ? 'badge badge-success' : 'badge badge-neutral';
  }

  if (tagPhantom) {
    const isPhantom = window.phantom?.solana?.isPhantom || window.solana?.isPhantom || window.solana;
    tagPhantom.innerText = isPhantom ? 'Detected' : 'Not Installed';
    tagPhantom.className = isPhantom ? 'badge badge-success' : 'badge badge-neutral';
  }

  if (tagBinance) {
    tagBinance.innerText = window.BinanceChain ? 'Detected' : 'Not Installed';
    tagBinance.className = window.BinanceChain ? 'badge badge-success' : 'badge badge-neutral';
  }
}

export function restoreSavedWallet() {
  const savedAddr = localStorage.getItem(CONNECTED_WALLET_KEY);
  const savedProv = localStorage.getItem(CONNECTED_PROVIDER_KEY);
  if (savedAddr) {
    AppState.currentConnectedAddress = savedAddr;
    AppState.currentConnectedProvider = savedProv || 'Web3 Wallet';
    updateUI();
  }
}

export function setConnectedWallet(address, provider) {
  AppState.currentConnectedAddress = address;
  AppState.currentConnectedProvider = provider;
  localStorage.setItem(CONNECTED_WALLET_KEY, address);
  localStorage.setItem(CONNECTED_PROVIDER_KEY, provider);
  showToast(`Connected to ${provider} (${address.substring(0, 6)}...${address.substring(address.length - 4)})`);
  updateUI();
}

export function disconnectWallet() {
  AppState.currentConnectedAddress = null;
  AppState.currentConnectedProvider = null;
  localStorage.removeItem(CONNECTED_WALLET_KEY);
  localStorage.removeItem(CONNECTED_PROVIDER_KEY);
  showToast('Wallet disconnected');
  updateUI();
}

function sanitizeText(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(String(str)));
  return div.innerHTML;
}

function openAccountDetailsModal() {
  let accModal = document.getElementById('account-details-modal');
  if (!accModal) {
    accModal = document.createElement('div');
    accModal.id = 'account-details-modal';
    accModal.className = 'modal-overlay';
    document.body.appendChild(accModal);
  }

  const addr = AppState.currentConnectedAddress || '';
  const prov = AppState.currentConnectedProvider || 'Web3 Wallet';
  const userAir = AppState.blockchain && addr ? AppState.blockchain.getBalanceOfAddress(addr, 'LVAIR') : 0;
  const userUsdt = AppState.blockchain && addr ? AppState.blockchain.getBalanceOfAddress(addr, 'USDT') : 0;
  const shortAddr = addr ? `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}` : '';

  const safeAddr = sanitizeText(addr);
  const safeProv = sanitizeText(prov);

  accModal.innerHTML = `
    <div class="modal-card">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <h3 style="font-size: 1.1rem; font-weight: 800;">Connected Account</h3>
        <button id="btn-close-account-modal" style="background: none; border: none; color: #71717a; font-size: 1.3rem; cursor: pointer;">✕</button>
      </div>

      <div style="background-color: #121212; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 16px; margin-bottom: 14px;">
        <div style="font-size: 0.72rem; color: #60a5fa; text-transform: uppercase; font-weight: 700; margin-bottom: 4px;">Provider: ${safeProv}</div>
        <div style="font-family: var(--font-mono); font-size: 0.84rem; color: #ffffff; word-break: break-all; margin-bottom: 12px;">${safeAddr}</div>
        <button id="btn-copy-address" class="btn-secondary" style="width: 100%; padding: 7px; font-size: 0.8rem;">
          Copy Address
        </button>
      </div>

      <div style="background-color: #0a0a0a; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 14px; margin-bottom: 14px;">
        <div style="font-size: 0.72rem; color: #71717a; text-transform: uppercase; font-weight: 700; margin-bottom: 10px;">Token Balances</div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <span style="font-weight: 600; font-size: 0.88rem;">$LVAIR Balance</span>
          <span style="font-family: var(--font-mono); font-weight: 700; color: #ffffff; font-size: 0.95rem;">${userAir.toLocaleString()} LVAIR</span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-weight: 600; font-size: 0.88rem;">USDT Balance</span>
          <span style="font-family: var(--font-mono); font-weight: 700; color: #10b981; font-size: 0.95rem;">$${userUsdt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </div>
      </div>

      <div style="background-color: #0a0a0a; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 12px 14px; margin-bottom: 18px; font-size: 0.78rem; color: var(--text-tertiary);">
        <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
          <span>Network</span>
          <span style="color: #10b981; font-weight: 600;">LVAIR Mainnet</span>
        </div>
        <div style="display: flex; justify-content: space-between;">
          <span>Status</span>
          <span style="color: #10b981; font-weight: 600;">● Active</span>
        </div>
      </div>

      <div style="display: flex; gap: 10px;">
        <button id="btn-disconnect-action" class="btn-secondary" style="flex: 1; padding: 10px; border-color: rgba(239, 68, 68, 0.4); color: #fca5a5;">
          Disconnect Wallet
        </button>
      </div>
    </div>
  `;

  accModal.style.display = 'flex';

  document.getElementById('btn-close-account-modal').onclick = () => {
    accModal.style.display = 'none';
  };

  document.getElementById('btn-copy-address').onclick = () => {
    navigator.clipboard.writeText(addr);
    showToast('Address copied to clipboard!');
  };

  document.getElementById('btn-disconnect-action').onclick = () => {
    accModal.style.display = 'none';
    disconnectWallet();
  };
}

export function setupWalletModal() {
  const modal = document.getElementById('wallet-modal');
  const btnClose = document.getElementById('btn-close-wallet-modal') || document.getElementById('btn-close-modal');
  const connectButtons = document.querySelectorAll('#btn-connect-wallet, #btn-hero-connect');
  const optMetaMask = document.getElementById('wallet-opt-metamask');
  const optPhantom = document.getElementById('wallet-opt-phantom');
  const optBinance = document.getElementById('wallet-opt-binance');
  const optCoinbase = document.getElementById('wallet-opt-coinbase');

  const openModal = () => {
    detectWalletProviders();
    if (modal) modal.style.display = 'flex';
  };
  const closeModal = () => {
    if (modal) modal.style.display = 'none';
  };

  connectButtons.forEach(btn => {
    btn.onclick = () => {
      if (AppState.currentConnectedAddress) {
        openAccountDetailsModal();
      } else {
        openModal();
      }
    };
  });

  if (btnClose) btnClose.onclick = closeModal;

  if (optMetaMask) {
    optMetaMask.onclick = async () => {
      closeModal();
      if (typeof window.ethereum !== 'undefined') {
        try {
          showToast('Connecting MetaMask...');
          const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
          if (accounts && accounts.length > 0) {
            setConnectedWallet(accounts[0], 'MetaMask');
          }
        } catch (err) {
          if (err.code === 4001) showToast('Connection rejected by user');
          else showToast(`MetaMask Error: ${err.message}`, 'error');
        }
      } else {
        const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        if (isMobile) {
          showToast('Redirecting into MetaMask In-App Browser...');
          const cleanHost = window.location.host + window.location.pathname + window.location.search;
          const metamaskDeeplink = `https://metamask.app.link/dapp/${cleanHost}`;
          window.location.href = metamaskDeeplink;
        } else {
          showToast('MetaMask extension not found in browser. Opening download page...', 'error');
          window.open('https://metamask.io/download/', '_blank');
        }
      }
    };
  }

  if (optPhantom) {
    optPhantom.onclick = async () => {
      closeModal();
      
      let solanaProvider = null;
      if (window.phantom?.solana?.isPhantom) {
        solanaProvider = window.phantom.solana;
      } else if (window.solana?.isPhantom) {
        solanaProvider = window.solana;
      } else if (window.solana) {
        solanaProvider = window.solana;
      }

      if (solanaProvider) {
        try {
          showToast('Requesting connection from Phantom...');
          const resp = await solanaProvider.connect({ onlyIfTrusted: false });
          let pubkey = '';
          if (resp && resp.publicKey) {
            pubkey = resp.publicKey.toString();
          } else if (solanaProvider.publicKey) {
            pubkey = solanaProvider.publicKey.toString();
          }
          
          if (pubkey) {
            setConnectedWallet(pubkey, 'Phantom');
          } else {
            showToast('Unable to extract public key from Phantom', 'error');
          }
        } catch (err) {
          if (err.code === 4001) {
            showToast('Connection rejected by user');
          } else {
            showToast(`Phantom Error: ${err.message || 'Connection failed'}`, 'error');
          }
        }
      } else {
        const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        if (isMobile) {
          showToast('Redirecting into Phantom In-App DApp Browser...');
          const currentUrl = encodeURIComponent(window.location.href);
          const phantomDeeplink = `https://phantom.app/ul/browse/${currentUrl}?ref=${encodeURIComponent(window.location.origin)}`;
          window.location.href = phantomDeeplink;
        } else {
          showToast('Phantom extension not detected. Opening download page...', 'error');
          window.open('https://phantom.app/', '_blank');
        }
      }
    };
  }

  if (optBinance) {
    optBinance.onclick = async () => {
      closeModal();
      if (window.BinanceChain) {
        try {
          showToast('Connecting Binance Wallet...');
          const accounts = await window.BinanceChain.request({ method: 'eth_requestAccounts' });
          if (accounts && accounts.length > 0) {
            setConnectedWallet(accounts[0], 'Binance');
          }
        } catch (err) {
          showToast(`Binance Error: ${err.message}`, 'error');
        }
      } else if (typeof window.ethereum !== 'undefined') {
        try {
          const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
          if (accounts && accounts.length > 0) {
            setConnectedWallet(accounts[0], 'Web3 Wallet');
          }
        } catch (err) {
          showToast(`Wallet Error: ${err.message}`, 'error');
        }
      } else {
        showToast('Binance Web3 Wallet not detected. Opening download page...', 'error');
        window.open('https://www.binance.com/en/web3wallet', '_blank');
      }
    };
  }

  if (optCoinbase) {
    optCoinbase.onclick = async () => {
      closeModal();
      if (typeof window.ethereum !== 'undefined') {
        try {
          const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
          if (accounts && accounts.length > 0) {
            setConnectedWallet(accounts[0], 'Coinbase');
          }
        } catch (err) {
          showToast(`Wallet Error: ${err.message}`, 'error');
        }
      } else {
        showToast('Web3 Wallet not detected', 'error');
      }
    };
  }
}
