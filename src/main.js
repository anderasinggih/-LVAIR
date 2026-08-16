import { Blockchain } from './core/blockchain.js';
import { AMMPool } from './core/amm.js';

import { AppState } from './state.js';
import { appBrandHomeLink } from './dom.js';
import { setupRouter, navigateTo, ROUTES } from './router.js';
import { setupWalletModal, restoreSavedWallet, setConnectedWallet, disconnectWallet } from './components/wallet-modal.js';

import { setupLandingPage } from './pages/landing.js';
import { setupSwapPage, renderHistory, renderChart } from './pages/swap.js';
import { setupTransferPage } from './pages/transfer.js';
import { setupAirdropPage } from './pages/airdrop.js';
import { refreshNodeState } from './node-sync.js';

async function initApp() {
  try {
    restoreSavedWallet();
    setupRouter();

    setupLandingPage();
    setupSwapPage();
    setupTransferPage();
    setupAirdropPage();
    setupWalletModal();
    setupTabsNavigation();

    AppState.blockchain = new Blockchain(2);
    AppState.ammPool = new AMMPool(AppState.blockchain, 100000, 25000);

    await refreshNodeState();
    setInterval(refreshNodeState, 3000);

    if (window.ethereum) {
      window.ethereum.on('accountsChanged', (accounts) => {
        if (accounts && accounts.length > 0) {
          setConnectedWallet(accounts[0], 'MetaMask');
          renderHistory();
        } else {
          disconnectWallet();
          renderHistory();
        }
      });
    }
  } catch (err) {
    console.error('[LVAIR Init Error]:', err);
  }
}

function setupTabsNavigation() {
  const tabs = document.querySelectorAll('#page-app .tab-btn');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.getAttribute('data-tab');
      if (target === 'trading') navigateTo(ROUTES.SWAP);
      else if (target === 'transfer') navigateTo(ROUTES.TRANSFER);
      else if (target === 'airdrop') navigateTo(ROUTES.AIRDROP);
      else if (target === 'history') {
        document.querySelectorAll('.tab-content').forEach(t => t.style.display = 'none');
        const histTab = document.getElementById('tab-history');
        if (histTab) histTab.style.display = 'block';
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        tab.classList.add('active');
        renderHistory();
      }
    });
  });

  document.querySelectorAll('.spa-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const href = link.getAttribute('href');
      if (href) navigateTo(href);
    });
  });

  if (appBrandHomeLink) {
    appBrandHomeLink.addEventListener('click', () => navigateTo(ROUTES.HOME));
  }
}

window.addEventListener('DOMContentLoaded', initApp);
window.addEventListener('resize', renderChart);
