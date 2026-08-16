import { Blockchain } from './core/blockchain.js';
import { AMMPool } from './core/amm.js';
import { TradingBotEngine } from './core/market-maker.js';

import { AppState, updateUI } from './state.js';
import { appBrandHomeLink } from './dom.js';
import { setupRouter, navigateTo, ROUTES } from './router.js';
import { setupWalletModal, restoreSavedWallet, setConnectedWallet, disconnectWallet } from './components/wallet-modal.js';

import { setupLandingPage, renderLandingStats } from './pages/landing.js';
import { setupSwapPage, renderRecentTrades, renderChart, renderHistory } from './pages/swap.js';
import { setupTransferPage } from './pages/transfer.js';
import { setupAirdropPage } from './pages/airdrop.js';
import { getApiBaseUrl } from './api.js';

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
    await AppState.blockchain.init();

    try {
      const apiUrl = getApiBaseUrl();
      const [resCfg, resBlocks] = await Promise.all([
        fetch(`${apiUrl}/api/config`),
        fetch(`${apiUrl}/api/blocks`)
      ]);

      if (resCfg.ok) {
        const cfg = await resCfg.json();
        if (cfg.airdropClaimAmount) AppState.blockchain.airdropClaimAmount = cfg.airdropClaimAmount;
      }

      if (resBlocks.ok) {
        const blocks = await resBlocks.json();
        if (blocks && blocks.length > 0) {
          AppState.blockchain.chain = blocks;
          blocks.forEach(b => {
            if (b.transactions) {
              b.transactions.forEach(t => {
                if (t.type === 'AIRDROP_CLAIM' && t.toAddress) {
                  AppState.blockchain.claimedAddresses.add(t.toAddress.toLowerCase());
                }
              });
            }
          });
        }
      }
    } catch (e) {}

    AppState.ammPool = new AMMPool(AppState.blockchain, 100000, 25000);

    AppState.botEngine = new TradingBotEngine(AppState.blockchain, AppState.ammPool);
    AppState.botEngine.start(4000, () => {
      updateUI();
      renderLandingStats();
      renderRecentTrades();
    });

    setInterval(async () => {
      try {
        const apiUrl = getApiBaseUrl();
        const [resCfg, resBlocks] = await Promise.all([
          fetch(`${apiUrl}/api/config`),
          fetch(`${apiUrl}/api/blocks`)
        ]);

        if (resCfg.ok) {
          const cfg = await resCfg.json();
          if (cfg.airdropClaimAmount && AppState.blockchain) {
            AppState.blockchain.airdropClaimAmount = cfg.airdropClaimAmount;
          }
        }

        if (resBlocks.ok) {
          const blocks = await resBlocks.json();
          if (blocks && blocks.length > 0 && AppState.blockchain) {
            AppState.blockchain.chain = blocks;
            blocks.forEach(b => {
              if (b.transactions) {
                b.transactions.forEach(t => {
                  if (t.type === 'AIRDROP_CLAIM' && t.toAddress) {
                    AppState.blockchain.claimedAddresses.add(t.toAddress.toLowerCase());
                  }
                });
              }
            });
            updateUI();
          }
        }
      } catch (e) {}
    }, 3000);

    updateUI();
    renderLandingStats();
    renderRecentTrades();

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
