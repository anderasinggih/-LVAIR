import { pageLanding, pageApp } from './dom.js';
import { renderLandingStats } from './pages/landing.js';
import { renderChart } from './pages/swap.js';
import { updateUI } from './state.js';
import { showToast } from './components/toast.js';

export const ROUTES = {
  HOME: '/',
  SWAP: '/swap',
  TRANSFER: '/transfer',
  AIRDROP: '/airdrop'
};

const PROTECTED_ROUTES = new Set([
  ROUTES.TRANSFER,
  ROUTES.AIRDROP
]);

export function navigateTo(path) {
  if (window.location.pathname !== path) {
    window.history.pushState({}, '', path);
  }
  handlePathRouting();
}

export function handlePathRouting() {
  let path = window.location.pathname || ROUTES.HOME;
  if (window.location.hash) {
    const cleanFromHash = window.location.hash.replace('#', '');
    if (cleanFromHash) {
      path = cleanFromHash;
      window.history.replaceState({}, '', path);
    }
  }

  const savedWallet = localStorage.getItem('LVAIR_CONNECTED_WALLET_ADDR');

  if (PROTECTED_ROUTES.has(path) && !savedWallet) {
    showToast('Please connect your wallet to continue', 'warning');
    const walletModal = document.getElementById('wallet-modal');
    if (walletModal) walletModal.style.display = 'flex';
    
    window.history.pushState({}, '', ROUTES.SWAP);
    path = ROUTES.SWAP;
  }

  if (path.startsWith('/swap') || path.startsWith('/transfer') || path.startsWith('/airdrop') || path === '/app') {
    if (pageLanding) pageLanding.style.display = 'none';
    if (pageApp) pageApp.style.display = 'block';

    let targetTab = 'trading';
    if (path === ROUTES.TRANSFER) targetTab = 'transfer';
    else if (path === ROUTES.AIRDROP) targetTab = 'airdrop';

    const tabs = document.querySelectorAll('#page-app .tab-btn');
    tabs.forEach(tab => {
      if (tab.getAttribute('data-tab') === targetTab) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });

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
  window.addEventListener('popstate', handlePathRouting);
  handlePathRouting();
}
