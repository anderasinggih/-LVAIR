import { AppState, updateUI, PROTOCOL_OWNER_CONFIG } from './state.js';
import { setupWalletModal, restoreSavedWallet, setConnectedWallet, disconnectWallet } from './components/wallet-modal.js';
import { showToast } from './components/toast.js';
import { getApiBaseUrl } from './api.js';

let lastBotRunning = null;

function seedMirrors() {
  AppState.blockchain = {
    chain: [],
    claimedAddresses: new Set(),
    airdropClaimAmount: 250,
    miningReward: 10,
    getBalanceOfAddress: () => 0,
    getLatestBlock: () => ({ hash: '' })
  };
  AppState.ammPool = {
    lvairReserve: 100000,
    usdtReserve: 25000,
    getCurrentPrice: () => AppState.ammPool.usdtReserve / AppState.ammPool.lvairReserve
  };
}

async function refreshOpsState() {
  const apiUrl = getApiBaseUrl();
  try {
    const [statusRes, cfgRes, ammRes] = await Promise.all([
      fetch(`${apiUrl}/api/node/status`).catch(() => null),
      fetch(`${apiUrl}/api/config`).catch(() => null),
      fetch(`${apiUrl}/api/amm/state`).catch(() => null)
    ]);

    if (statusRes && statusRes.ok) {
      const status = await statusRes.json();
      AppState.blockchain.chain = Array.from({ length: status.blockHeight || 1 });
      AppState.blockchain.claimedAddresses = new Set(Array.from({ length: status.claimedWallets || 0 }));
      AppState.blockchain.airdropClaimAmount = status.airdropClaimAmount || 250;
      AppState.blockchain.miningReward = 10;
      lastBotRunning = !!status.botRunning;
    }

    if (cfgRes && cfgRes.ok) {
      const cfg = await cfgRes.json();
      AppState.blockchain.airdropClaimAmount = cfg.airdropClaimAmount || 250;
      AppState.blockchain.miningReward = cfg.miningReward || 10;
    }

    if (ammRes && ammRes.ok) {
      const amm = await ammRes.json();
      AppState.ammPool.lvairReserve = amm.lvairReserve;
      AppState.ammPool.usdtReserve = amm.usdtReserve;
      if (amm.botRunning !== undefined) lastBotRunning = !!amm.botRunning;
    }
  } catch (e) {}
  renderAdminDashboard();
}

function postJson(url, body) {
  const apiUrl = getApiBaseUrl();
  return fetch(`${apiUrl}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
}

async function initAdminApp() {
  try {
    setupWalletModal();
    setupAdminHandlers();
    seedMirrors();

    restoreSavedWallet();
    if (AppState.currentConnectedAddress && PROTOCOL_OWNER_CONFIG.ownerAddress) {
      if (AppState.currentConnectedAddress.toLowerCase() === PROTOCOL_OWNER_CONFIG.ownerAddress.toLowerCase()) {
        PROTOCOL_OWNER_CONFIG.isAdminAuthorized = true;
      }
    }
    await refreshOpsState();
    setInterval(refreshOpsState, 3000);

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
    btnToggleBot.addEventListener('click', async () => {
      try {
        const res = await postJson('/api/bot/toggle');
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody.error || 'RPC error');
        }
        const data = await res.json();
        showToast(data.running ? 'Autonomous Market Maker started on node' : 'Autonomous Market Maker paused on node');
      } catch (err) {
        showToast(`Bot control error: ${err.message}`, 'error');
      }
      await refreshOpsState();
    });
  }

  if (btnSaveAirdropConfig) {
    btnSaveAirdropConfig.addEventListener('click', async () => {
      const amount = parseFloat(adminAirdropAmountInput.value);
      if (!amount || amount <= 0) return showToast('Enter a valid airdrop allocation amount', 'error');
      try {
        const res = await postJson('/api/config/airdrop', { amount });
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody.error || 'RPC error');
        }
        await res.json();
        showToast(`Airdrop quota per wallet updated to ${amount} $LVAIR`);
      } catch (err) {
        showToast(`Config error: ${err.message}`, 'error');
      }
      await refreshOpsState();
    });
  }

  if (btnResetAirdropList) {
    btnResetAirdropList.addEventListener('click', async () => {
      try {
        const res = await postJson('/api/config/reset-whitelist');
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody.error || 'RPC error');
        }
        await res.json();
        showToast('Airdrop claims whitelist has been reset');
      } catch (err) {
        showToast(`Reset error: ${err.message}`, 'error');
      }
      await refreshOpsState();
    });
  }

  if (btnUpdatePoolReserves) {
    btnUpdatePoolReserves.addEventListener('click', async () => {
      const air = parseFloat(adminPoolAirInput.value);
      const usdt = parseFloat(adminPoolUsdtInput.value);
      if (!air || !usdt || air <= 0 || usdt <= 0) return showToast('Enter valid pool reserves', 'error');
      try {
        const res = await postJson('/api/config/reserves', { lvair: air, usdt });
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody.error || 'RPC error');
        }
        await res.json();
        showToast(`Pool Reserves updated to ${air.toLocaleString()} LVAIR / $${usdt.toLocaleString()} USDT`);
      } catch (err) {
        showToast(`Reserve error: ${err.message}`, 'error');
      }
      await refreshOpsState();
    });
  }

  if (btnAdminForceMine) {
    btnAdminForceMine.addEventListener('click', async () => {
      const { currentConnectedAddress } = AppState;
      btnAdminForceMine.disabled = true;
      btnAdminForceMine.innerText = 'Mining Block...';
      try {
        const res = await postJson('/api/mine', { minerRewardAddress: currentConnectedAddress || null });
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody.error || 'RPC error');
        }
        await res.json();
        showToast('New block mined and appended to the ledger!');
      } catch (err) {
        showToast(`Mining error: ${err.message}`, 'error');
      } finally {
        btnAdminForceMine.disabled = false;
        btnAdminForceMine.innerText = 'Mine New Block';
      }
      await refreshOpsState();
    });
  }

  if (btnAdminExportState) {
    btnAdminExportState.addEventListener('click', async () => {
      try {
        const apiUrl = getApiBaseUrl();
        const res = await fetch(`${apiUrl}/api/blocks`);
        if (!res.ok) throw new Error('Unable to fetch ledger');
        const chain = await res.json();
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(chain, null, 2));
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute("href", dataStr);
        downloadAnchor.setAttribute("download", `lvair_protocol_ledger_export.json`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
        showToast('Ledger JSON exported');
      } catch (err) {
        showToast(`Export error: ${err.message}`, 'error');
      }
    });
  }
}

function renderAdminDashboard() {
  const { blockchain, ammPool, currentConnectedAddress } = AppState;
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
    const isRunning = !!lastBotRunning;
    adminBotStatus.innerText = isRunning ? 'Running (Active Liquidity)' : 'Paused';
    adminBotStatus.className = isRunning ? 'badge badge-success' : 'badge badge-danger';
  }

  if (btnToggleBot) {
    const isRunning = !!lastBotRunning;
    btnToggleBot.innerText = isRunning ? 'Pause Market Maker' : 'Start Market Maker';
    btnToggleBot.className = isRunning ? 'btn-secondary' : 'btn-primary';
  }

  if (adminTotalClaims) adminTotalClaims.innerText = blockchain && blockchain.claimedAddresses ? `${blockchain.claimedAddresses.size} Wallets` : '0 Wallets';
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

  updateUI();
}

window.addEventListener('DOMContentLoaded', initAdminApp);
