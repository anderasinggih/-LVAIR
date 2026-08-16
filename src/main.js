import { Blockchain } from './core/blockchain.js';
import { AMMPool } from './core/amm.js';
import { TradingBotEngine } from './core/market-maker.js';

import { AppState, updateUI } from './state.js';
import { appBrandHomeLink } from './dom.js';
import { setupRouter, navigateTo, ROUTES } from './router.js';
import { setupWalletModal, restoreSavedWallet, setConnectedWallet, disconnectWallet } from './components/wallet-modal.js';

import { setupLandingPage, renderLandingStats } from './pages/landing.js';
import { setupSwapPage, renderRecentTrades, renderChart } from './pages/swap.js';
import { setupTransferPage } from './pages/transfer.js';
import { setupAirdropPage } from './pages/airdrop.js';
import { setupAdminPage, renderAdminDashboard } from './pages/admin.js';

/**
 * Main Application Orchestrator
 * Fully modular architecture adhering to Web3 production standards
 */
async function initApp() {
  try {
    // 1. Setup & Resolve Router First (Instant zero-flicker rendering)
    restoreSavedWallet();
    setupRouter();

    // 2. Initialize UI Handlers & Pages Synchronously
    setupLandingPage();
    setupSwapPage();
    setupTransferPage();
    setupAirdropPage();
    setupAdminPage();
    setupWalletModal();
    setupTabsNavigation();

    // 3. Initialize Blockchain, AMM Pool & State
    AppState.blockchain = new Blockchain(2);
    await AppState.blockchain.init();
    AppState.ammPool = new AMMPool(AppState.blockchain, 100000, 25000);

    // 4. Autonomous Liquidity Engine
    AppState.botEngine = new TradingBotEngine(AppState.blockchain, AppState.ammPool);
    AppState.botEngine.start(4000, () => {
      updateUI();
      renderLandingStats();
      renderRecentTrades();
    });

    updateUI();
    renderLandingStats();
    renderRecentTrades();

    // 5. Native Wallet Listeners
    if (window.ethereum) {
      window.ethereum.on('accountsChanged', (accounts) => {
        if (accounts && accounts.length > 0) {
          setConnectedWallet(accounts[0], 'MetaMask');
        } else {
          disconnectWallet();
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
