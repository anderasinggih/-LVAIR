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
        disconnectWallet();
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
        showToast('MetaMask extension not found. Opening download page...', 'error');
        window.open('https://metamask.io/download/', '_blank');
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
        showToast('Phantom extension not detected in browser. Opening download page...', 'error');
        window.open('https://phantom.app/', '_blank');
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
