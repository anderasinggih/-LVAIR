import { pageLanding, pageApp } from './dom.js';
import { renderLandingStats } from './pages/landing.js';
import { renderChart } from './pages/swap.js';
import { updateUI } from './state.js';
import { showToast } from './components/toast.js';

// Route Definitions & Security Authorization Map
export const ROUTES = {
  HOME: '#/',
  SWAP: '#/swap',
  TRANSFER: '#/transfer',
  AIRDROP: '#/airdrop',
  EXPLORER: '#/explorer'
};

// Protected routes that strictly require connected wallet
const PROTECTED_ROUTES = new Set([
  ROUTES.TRANSFER,
  ROUTES.AIRDROP
]);

export function navigateTo(hash) {
  if (window.location.hash !== hash) {
    window.location.hash = hash;
  } else {
    handleHashRouting();
  }
}

export function handleHashRouting() {
  const hash = window.location.hash || ROUTES.HOME;
  const savedWallet = localStorage.getItem('LVAIR_CONNECTED_WALLET_ADDR');

  // Strict Security Guard / Authentication Barrier
  if (PROTECTED_ROUTES.has(hash) && !savedWallet) {
    showToast('Unauthorized: Please connect your Web3 wallet to access this feature', 'error');
    const walletModal = document.getElementById('wallet-modal');
    if (walletModal) walletModal.style.display = 'flex';
    
    // Redirect to swap or home
    window.location.hash = ROUTES.SWAP;
    return;
  }

  if (hash.startsWith('#/swap') || hash.startsWith('#/transfer') || hash.startsWith('#/airdrop') || hash.startsWith('#/explorer') || hash === '#/app') {
    if (pageLanding) pageLanding.style.display = 'none';
    if (pageApp) pageApp.style.display = 'block';

    let targetTab = 'trading';
    if (hash === ROUTES.TRANSFER) targetTab = 'transfer';
    else if (hash === ROUTES.AIRDROP) targetTab = 'airdrop';
    else if (hash === ROUTES.EXPLORER) targetTab = 'explorer';

    // Update active tab buttons
    const tabs = document.querySelectorAll('#page-app .tab-btn');
    tabs.forEach(tab => {
      if (tab.getAttribute('data-tab') === targetTab) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });

    // Update active tab contents
    document.querySelectorAll('#page-app .tab-content').forEach(content => {
      content.style.display = content.id === `tab-${targetTab}` ? 'block' : 'none';
    });

    if (targetTab === 'trading') renderChart();
    updateUI();
  } else {
    if (pageLanding) pageLanding.style.display = 'block';
    if (pageApp) pageApp.style.display = 'none';
    renderLandingStats();
  }
}

export function setupRouter() {
  window.addEventListener('hashchange', handleHashRouting);
  handleHashRouting();
}
