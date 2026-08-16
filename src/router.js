import { pageLanding, pageApp } from './dom.js';
import { renderLandingStats } from './pages/landing.js';
import { renderChart } from './pages/swap.js';
import { renderAdminDashboard } from './pages/admin.js';
import { updateUI } from './state.js';
import { showToast } from './components/toast.js';

// Clean Web3 Path Routing (Exact Uniswap / Raydium standard)
export const ROUTES = {
  HOME: '/',
  SWAP: '/swap',
  TRANSFER: '/transfer',
  AIRDROP: '/airdrop',
  ADMIN: '/vault-0x9f4a7c'
};

// Protected routes requiring connected Web3 wallet
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
  // Fallback support for hash migration (if user opens #/swap)
  if (window.location.hash) {
    const cleanFromHash = window.location.hash.replace('#', '');
    if (cleanFromHash) {
      path = cleanFromHash;
      window.history.replaceState({}, '', path);
    }
  }

  const savedWallet = localStorage.getItem('LVAIR_CONNECTED_WALLET_ADDR');
  const pageAdmin = document.getElementById('page-admin');

  // Strict Security Guard / Authentication Barrier for Transfer & Airdrop
  if (PROTECTED_ROUTES.has(path) && !savedWallet) {
    showToast('Unauthorized: Please connect your Web3 wallet to access this feature', 'error');
    const walletModal = document.getElementById('wallet-modal');
    if (walletModal) walletModal.style.display = 'flex';
    
    // Redirect cleanly to /swap
    window.history.pushState({}, '', ROUTES.SWAP);
    path = ROUTES.SWAP;
  }

  // Admin Route Handler (Obfuscated Secret Route)
  if (path === ROUTES.ADMIN || path === '/admin') {
    if (pageLanding) pageLanding.style.display = 'none';
    if (pageApp) pageApp.style.display = 'none';
    if (pageAdmin) pageAdmin.style.display = 'block';
    renderAdminDashboard();
    return;
  } else {
    if (pageAdmin) pageAdmin.style.display = 'none';
  }

  if (path.startsWith('/swap') || path.startsWith('/transfer') || path.startsWith('/airdrop') || path === '/app') {
    if (pageLanding) pageLanding.style.display = 'none';
    if (pageApp) pageApp.style.display = 'block';

    let targetTab = 'trading';
    if (path === ROUTES.TRANSFER) targetTab = 'transfer';
    else if (path === ROUTES.AIRDROP) targetTab = 'airdrop';

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
  window.addEventListener('popstate', handlePathRouting);
  
  // Secret Owner Hotkey: Ctrl + Shift + A / Cmd + Shift + A to open Admin Console
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
      e.preventDefault();
      navigateTo(ROUTES.ADMIN);
    }
  });

  handlePathRouting();
}
