import { Blockchain } from './core/blockchain.js';
import { AMMPool } from './core/amm.js';
import { TradingBotEngine } from './core/market-maker.js';
import { AppState, updateUI, PROTOCOL_OWNER_CONFIG } from './state.js';
import { setupWalletModal, restoreSavedWallet, setConnectedWallet, disconnectWallet } from './components/wallet-modal.js';
import { showToast } from './components/toast.js';
import { getApiBaseUrl } from './api.js';

async function initAdminApp() {
  try {
    setupWalletModal();
    setupAdminHandlers();

    AppState.blockchain = new Blockchain(2);
    await AppState.blockchain.init();
    AppState.ammPool = new AMMPool(AppState.blockchain, 100000, 25000);

    AppState.botEngine = new TradingBotEngine(AppState.blockchain, AppState.ammPool);
    AppState.botEngine.start(4000, () => {
      renderAdminDashboard();
    });

    restoreSavedWallet();
    if (AppState.currentConnectedAddress && PROTOCOL_OWNER_CONFIG.ownerAddress) {
      if (AppState.currentConnectedAddress.toLowerCase() === PROTOCOL_OWNER_CONFIG.ownerAddress.toLowerCase()) {
        PROTOCOL_OWNER_CONFIG.isAdminAuthorized = true;
      }
    }
    renderAdminDashboard();

    if (window.ethereum) {
      window.ethereum.on('accountsChanged', (accounts) => {
        if (accounts && accounts.length > 0) {
          setConnectedWallet(accounts[0], 'MetaMask');
          if (PROTOCOL_OWNER_CONFIG.ownerAddress && accounts[0].toLowerCase() === PROTOCOL_OWNER_CONFIG.ownerAddress.toLowerCase()) {
            PROTOCOL_OWNER_CONFIG.isAdminAuthorized = true;
          } else {
            PROTOCOL_OWNER_CONFIG.isAdminAuthorized = false;
          }
        } else {
          disconnectWallet();
          PROTOCOL_OWNER_CONFIG.isAdminAuthorized = false;
        }
        renderAdminDashboard();
      });
    }
  } catch (err) {
    console.error('[Admin Ops Init Error]:', err);
  }
}

function setupAdminHandlers() {
  const adminAirdropAmountInput = document.getElementById('admin-airdrop-amount-input');
  const adminPoolAirInput = document.getElementById('admin-pool-air-input');
  const adminPoolUsdtInput = document.getElementById('admin-pool-usdt-input');

  const btnClaimProtocolOwner = document.getElementById('btn-claim-protocol-owner');
  const btnResetOwnerKey = document.getElementById('btn-reset-owner-key');
  const btnToggleBot = document.getElementById('btn-toggle-bot');
  const btnSaveAirdropConfig = document.getElementById('btn-save-airdrop-config');
  const btnResetAirdropList = document.getElementById('btn-reset-airdrop-list');
  const btnUpdatePoolReserves = document.getElementById('btn-update-pool-reserves');
  const btnAdminForceMine = document.getElementById('btn-admin-force-mine');
  const btnAdminExportState = document.getElementById('btn-admin-export-state');

  if (btnResetOwnerKey) {
    btnResetOwnerKey.addEventListener('click', () => {
      PROTOCOL_OWNER_CONFIG.ownerAddress = null;
      PROTOCOL_OWNER_CONFIG.isAdminAuthorized = false;
      localStorage.removeItem('LVAIR_PROTOCOL_OWNER_ADDR');
      localStorage.removeItem('LVAIR_ADMIN_AUTH_TOKEN_V1');
      showToast('Protocol Owner key reset! You can now claim ownership with any wallet.');
      renderAdminDashboard();
    });
  }

  if (btnClaimProtocolOwner) {
    btnClaimProtocolOwner.addEventListener('click', async () => {
      const { currentConnectedAddress } = AppState;
      if (!currentConnectedAddress) {
        showToast('Please connect your Web3 wallet first', 'error');
        const walletModal = document.getElementById('wallet-modal');
        if (walletModal) walletModal.style.display = 'flex';
        return;
      }

      if (!PROTOCOL_OWNER_CONFIG.ownerAddress) {
        PROTOCOL_OWNER_CONFIG.ownerAddress = currentConnectedAddress;
        localStorage.setItem('LVAIR_PROTOCOL_OWNER_ADDR', currentConnectedAddress);
        PROTOCOL_OWNER_CONFIG.isAdminAuthorized = true;
        showToast(`Protocol Ownership Claimed by ${currentConnectedAddress.substring(0, 6)}...${currentConnectedAddress.substring(currentConnectedAddress.length - 4)}!`);
        renderAdminDashboard();
        return;
      }

      if (currentConnectedAddress.toLowerCase() === PROTOCOL_OWNER_CONFIG.ownerAddress.toLowerCase()) {
        PROTOCOL_OWNER_CONFIG.isAdminAuthorized = true;
        showToast('Protocol Owner Authorized! Full Ops Control Active.');
        renderAdminDashboard();
      } else {
        showToast('Access Denied: Connected wallet is not the registered Protocol Owner', 'error');
      }
    });
  }

  if (btnToggleBot) {
    btnToggleBot.addEventListener('click', () => {
      const { botEngine } = AppState;
      if (!botEngine) return;
      if (botEngine.isRunning) {
        botEngine.stop();
        showToast('Autonomous Market Maker paused');
      } else {
        botEngine.start(4000, () => {
          renderAdminDashboard();
        });
        showToast('Autonomous Market Maker started');
      }
      renderAdminDashboard();
    });
  }

  if (btnSaveAirdropConfig) {
    btnSaveAirdropConfig.addEventListener('click', async () => {
      const { blockchain } = AppState;
      if (!blockchain) return;
      const amount = parseFloat(adminAirdropAmountInput.value);
      if (!amount || amount <= 0) return showToast('Enter a valid airdrop allocation amount', 'error');
      blockchain.airdropClaimAmount = amount;
      await blockchain.saveState();

      try {
        const apiUrl = getApiBaseUrl();
        await fetch(`${apiUrl}/api/config/airdrop`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount })
        });
      } catch (e) {}

      showToast(`Airdrop quota per wallet updated to ${amount} $LVAIR`);
      renderAdminDashboard();
    });
  }

  if (btnResetAirdropList) {
    btnResetAirdropList.addEventListener('click', async () => {
      const { blockchain } = AppState;
      if (!blockchain) return;
      blockchain.claimedAddresses.clear();
      await blockchain.saveState();

      try {
        const apiUrl = getApiBaseUrl();
        await fetch(`${apiUrl}/api/config/reset-whitelist`, { method: 'POST' });
      } catch (e) {}

      showToast('Airdrop claims whitelist has been reset');
      renderAdminDashboard();
    });
  }

  if (btnUpdatePoolReserves) {
    btnUpdatePoolReserves.addEventListener('click', async () => {
      const { ammPool } = AppState;
      if (!ammPool) return;
      const air = parseFloat(adminPoolAirInput.value);
      const usdt = parseFloat(adminPoolUsdtInput.value);
      if (!air || !usdt || air <= 0 || usdt <= 0) return showToast('Enter valid pool reserves', 'error');
      ammPool.lvairReserve = air;
      ammPool.usdtReserve = usdt;
      ammPool.k = air * usdt;

      try {
        const apiUrl = getApiBaseUrl();
        await fetch(`${apiUrl}/api/config/reserves`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lvair: air, usdt })
        });
      } catch (e) {}

      showToast(`Pool Reserves updated to ${air.toLocaleString()} LVAIR / $${usdt.toLocaleString()} USDT`);
      renderAdminDashboard();
    });
  }

  if (btnAdminForceMine) {
    btnAdminForceMine.addEventListener('click', async () => {
      const { blockchain, currentConnectedAddress } = AppState;
      if (!blockchain) return;
      btnAdminForceMine.disabled = true;
      btnAdminForceMine.innerText = 'Mining Block...';
      try {
        await blockchain.minePendingTransactions(currentConnectedAddress || blockchain.systemAddress);
        showToast('New block mined and appended to the ledger!');
        renderAdminDashboard();
      } catch (err) {
        showToast(`Mining error: ${err.message}`, 'error');
      } finally {
        btnAdminForceMine.disabled = false;
        btnAdminForceMine.innerText = 'Mine New Block';
      }
    });
  }

  if (btnAdminExportState) {
    btnAdminExportState.addEventListener('click', () => {
      const { blockchain } = AppState;
      if (!blockchain) return;
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(blockchain.chain, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", `lvair_protocol_ledger_export.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      showToast('Ledger JSON exported');
    });
  }
}

function renderAdminDashboard() {
  const { blockchain, botEngine, ammPool, currentConnectedAddress, currentConnectedProvider } = AppState;
  const adminOwnerDisplay = document.getElementById('admin-owner-display');
  const adminBotStatus = document.getElementById('admin-bot-status');
  const adminTotalClaims = document.getElementById('admin-total-claims');
  const adminTotalBlocks = document.getElementById('admin-total-blocks');
  const adminPoolAirInput = document.getElementById('admin-pool-air-input');
  const adminPoolUsdtInput = document.getElementById('admin-pool-usdt-input');
  const adminAuthCard = document.getElementById('admin-auth-card');
  const adminControlsPanel = document.getElementById('admin-controls-panel');
  const btnToggleBot = document.getElementById('btn-toggle-bot');
  const btnConnectWallet = document.getElementById('btn-connect-wallet');

  const isOwner = PROTOCOL_OWNER_CONFIG.ownerAddress;
  const isAuth = (currentConnectedAddress && isOwner && currentConnectedAddress.toLowerCase() === isOwner.toLowerCase()) || PROTOCOL_OWNER_CONFIG.isAdminAuthorized;

  if (btnConnectWallet) {
    if (currentConnectedAddress) {
      btnConnectWallet.innerText = `${currentConnectedAddress.substring(0, 6)}...${currentConnectedAddress.substring(currentConnectedAddress.length - 4)}`;
      btnConnectWallet.className = 'btn-secondary';
    } else {
      btnConnectWallet.innerText = 'Connect Wallet';
      btnConnectWallet.className = 'btn-primary';
    }
  }

  if (adminOwnerDisplay) {
    adminOwnerDisplay.innerText = isOwner ? `${isOwner.substring(0, 8)}...${isOwner.substring(isOwner.length - 6)}` : 'Unclaimed (Genesis Setup)';
  }

  if (adminAuthCard && adminControlsPanel) {
    if (isAuth) {
      adminAuthCard.style.display = 'none';
      adminControlsPanel.style.display = 'block';
    } else {
      adminAuthCard.style.display = 'block';
      adminControlsPanel.style.display = 'none';
    }
  }

  if (adminBotStatus) {
    const isRunning = botEngine && botEngine.isRunning;
    adminBotStatus.innerText = isRunning ? 'Running (Active Liquidity)' : 'Paused';
    adminBotStatus.className = isRunning ? 'badge badge-success' : 'badge badge-danger';
  }

  if (btnToggleBot) {
    const isRunning = botEngine && botEngine.isRunning;
    btnToggleBot.innerText = isRunning ? 'Pause Market Maker' : 'Start Market Maker';
    btnToggleBot.className = isRunning ? 'btn-secondary' : 'btn-primary';
  }

  if (adminTotalClaims) adminTotalClaims.innerText = blockchain ? `${blockchain.claimedAddresses.size} Wallets` : '0 Wallets';
  if (adminTotalBlocks) adminTotalBlocks.innerText = blockchain ? `#${blockchain.chain.length} Blocks` : '#1 Blocks';

  if (blockchain) {
    const adminAirdropInput = document.getElementById('admin-airdrop-amount-input');
    if (adminAirdropInput && !adminAirdropInput.matches(':focus')) {
      adminAirdropInput.value = blockchain.airdropClaimAmount || 250;
    }
  }

  if (ammPool) {
    if (adminPoolAirInput && !adminPoolAirInput.matches(':focus')) {
      adminPoolAirInput.value = ammPool.lvairReserve;
    }
    if (adminPoolUsdtInput && !adminPoolUsdtInput.matches(':focus')) {
      adminPoolUsdtInput.value = ammPool.usdtReserve;
    }
  }
}

window.addEventListener('DOMContentLoaded', initAdminApp);
