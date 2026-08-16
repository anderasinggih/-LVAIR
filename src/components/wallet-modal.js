import {
  walletModal,
  btnCloseWalletModal,
  btnConnectWallet,
  walletOptMetamask,
  walletOptPhantom,
  walletOptBinance,
  walletOptCoinbase,
  tagMetamask,
  tagPhantom,
  tagBinance
} from '../dom.js';
import { AppState, CONNECTED_WALLET_KEY, CONNECTED_PROVIDER_KEY, updateUI } from '../state.js';
import { showToast } from '../components/toast.js';

export function detectWalletProviders() {
  if (tagMetamask) {
    tagMetamask.innerText = window.ethereum ? 'Detected' : 'Not Installed';
    tagMetamask.className = window.ethereum ? 'badge badge-success' : 'badge badge-neutral';
  }

  if (tagPhantom) {
    const isPhantom = window.phantom || window.solana;
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
  const openModal = () => {
    detectWalletProviders();
    if (walletModal) walletModal.style.display = 'flex';
  };
  const closeModal = () => {
    if (walletModal) walletModal.style.display = 'none';
  };

  if (btnConnectWallet) {
    btnConnectWallet.addEventListener('click', () => {
      if (AppState.currentConnectedAddress) {
        disconnectWallet();
      } else {
        openModal();
      }
    });
  }

  if (btnCloseWalletModal) btnCloseWalletModal.addEventListener('click', closeModal);

  if (walletOptMetamask) {
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
        }
      } catch (err) {
        if (err.code === 4001) showToast('Connection rejected by user');
        else showToast(`MetaMask Error: ${err.message}`, 'error');
      }
    });
  }

  if (walletOptPhantom) {
    walletOptPhantom.addEventListener('click', async () => {
      closeModal();
      const provider = window.phantom?.solana || window.solana;
      if (!provider || !provider.isPhantom) {
        showToast('Phantom wallet not detected. Opening download page...', 'error');
        window.open('https://phantom.app/', '_blank');
        return;
      }
      try {
        showToast('Requesting connection from Phantom...');
        const resp = await provider.connect();
        setConnectedWallet(resp.publicKey.toString(), 'Phantom');
      } catch (err) {
        if (err.code === 4001) showToast('Connection rejected by user');
        else showToast(`Phantom Error: ${err.message || err}`, 'error');
      }
    });
  }

  if (walletOptBinance) {
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
  }

  if (walletOptCoinbase) {
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
      showToast('Coinbase Wallet not found. Opening download page...', 'error');
      window.open('https://www.coinbase.com/wallet', '_blank');
    });
  }
}
