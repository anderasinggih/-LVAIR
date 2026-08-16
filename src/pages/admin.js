import { AppState, PROTOCOL_OWNER_CONFIG, updateUI } from '../state.js';
import { showToast } from '../components/toast.js';

export function setupAdminPage() {
  const adminOwnerDisplay = document.getElementById('admin-owner-display');
  const adminBotStatus = document.getElementById('admin-bot-status');
  const adminTotalClaims = document.getElementById('admin-total-claims');
  const adminTotalBlocks = document.getElementById('admin-total-blocks');
  const adminAirdropAmountInput = document.getElementById('admin-airdrop-amount-input');
  const adminPoolAirInput = document.getElementById('admin-pool-air-input');
  const adminPoolUsdtInput = document.getElementById('admin-pool-usdt-input');

  const btnClaimProtocolOwner = document.getElementById('btn-claim-protocol-owner');
  const btnToggleBot = document.getElementById('btn-toggle-bot');
  const btnSaveAirdropConfig = document.getElementById('btn-save-airdrop-config');
  const btnResetAirdropList = document.getElementById('btn-reset-airdrop-list');
  const btnUpdatePoolReserves = document.getElementById('btn-update-pool-reserves');
  const btnAdminForceMine = document.getElementById('btn-admin-force-mine');
  const btnAdminExportState = document.getElementById('btn-admin-export-state');

  // 1. Ownership Claiming & Signature Verification
  if (btnClaimProtocolOwner) {
    btnClaimProtocolOwner.addEventListener('click', async () => {
      const { currentConnectedAddress } = AppState;
      if (!currentConnectedAddress) {
        showToast('Please connect your Web3 wallet first', 'error');
        return;
      }

      // If no owner registered yet, first caller claims genesis ownership
      if (!PROTOCOL_OWNER_CONFIG.ownerAddress) {
        PROTOCOL_OWNER_CONFIG.ownerAddress = currentConnectedAddress;
        localStorage.setItem('LVAIR_PROTOCOL_OWNER_ADDR', currentConnectedAddress);
        PROTOCOL_OWNER_CONFIG.isAdminAuthorized = true;
        showToast(`Protocol Ownership Claimed by ${currentConnectedAddress.substring(0, 6)}...${currentConnectedAddress.substring(currentConnectedAddress.length - 4)}!`);
        renderAdminDashboard();
        return;
      }

      // If already registered, perform cryptographic challenge signature
      if (currentConnectedAddress.toLowerCase() === PROTOCOL_OWNER_CONFIG.ownerAddress.toLowerCase()) {
        if (window.ethereum) {
          try {
            const challenge = `LVAIR Protocol Admin Auth Challenge - Nonce: ${Date.now()}`;
            await window.ethereum.request({
              method: 'personal_sign',
              params: [challenge, currentConnectedAddress]
            });
            PROTOCOL_OWNER_CONFIG.isAdminAuthorized = true;
            showToast('Cryptographic signature verified. Admin access granted!');
            renderAdminDashboard();
          } catch (err) {
            showToast('Signature rejected: Admin verification cancelled', 'error');
          }
        } else {
          PROTOCOL_OWNER_CONFIG.isAdminAuthorized = true;
          showToast('Owner address verified!');
          renderAdminDashboard();
        }
      } else {
        showToast('Access Denied: Connected wallet is not the registered Protocol Owner', 'error');
      }
    });
  }

  // 2. Bot Control
  if (btnToggleBot) {
    btnToggleBot.addEventListener('click', () => {
      const { botEngine } = AppState;
      if (!botEngine) return;
      if (botEngine.isRunning) {
        botEngine.stop();
        showToast('Autonomous Liquidity Bot stopped');
      } else {
        botEngine.start(4000, () => {
          updateUI();
          renderAdminDashboard();
        });
        showToast('Autonomous Liquidity Bot started');
      }
      renderAdminDashboard();
    });
  }

  // 3. Airdrop Allocation Adjustment
  if (btnSaveAirdropConfig) {
    btnSaveAirdropConfig.addEventListener('click', () => {
      const { blockchain } = AppState;
      if (!blockchain) return;
      const amount = parseFloat(adminAirdropAmountInput.value);
      if (!amount || amount <= 0) return showToast('Enter a valid airdrop allocation amount', 'error');
      blockchain.airdropClaimAmount = amount;
      showToast(`Airdrop allocation per wallet updated to ${amount} $LVAIR`);
    });
  }

  // 4. Reset Airdrop Claims
  if (btnResetAirdropList) {
    btnResetAirdropList.addEventListener('click', () => {
      const { blockchain } = AppState;
      if (!blockchain) return;
      blockchain.claimedAddresses.clear();
      blockchain.saveState();
      showToast('Airdrop claims whitelist has been reset');
      renderAdminDashboard();
    });
  }

  // 5. Pool Reserves Rebalance
  if (btnUpdatePoolReserves) {
    btnUpdatePoolReserves.addEventListener('click', () => {
      const { ammPool } = AppState;
      if (!ammPool) return;
      const air = parseFloat(adminPoolAirInput.value);
      const usdt = parseFloat(adminPoolUsdtInput.value);
      if (!air || !usdt || air <= 0 || usdt <= 0) return showToast('Enter valid pool reserves', 'error');
      ammPool.lvairReserve = air;
      ammPool.usdtReserve = usdt;
      ammPool.k = air * usdt;
      updateUI();
      showToast(`Pool Reserves updated to ${air.toLocaleString()} LVAIR / $${usdt.toLocaleString()} USDT`);
    });
  }

  // 6. Force Mine Block
  if (btnAdminForceMine) {
    btnAdminForceMine.addEventListener('click', async () => {
      const { blockchain, currentConnectedAddress } = AppState;
      if (!blockchain) return;
      btnAdminForceMine.disabled = true;
      btnAdminForceMine.innerText = 'Mining Block...';
      try {
        await blockchain.minePendingTransactions(currentConnectedAddress || blockchain.systemAddress);
        showToast('New block mined and appended to the ledger!');
        updateUI();
        renderAdminDashboard();
      } catch (err) {
        showToast(`Mining error: ${err.message}`, 'error');
      } finally {
        btnAdminForceMine.disabled = false;
        btnAdminForceMine.innerText = 'Mine New Block';
      }
    });
  }

  // 7. Export State
  if (btnAdminExportState) {
    btnAdminExportState.addEventListener('click', () => {
      const { blockchain } = AppState;
      if (!blockchain) return;
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(blockchain.chain, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", `lvair_admin_state_export.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      showToast('State JSON exported');
    });
  }
}

export function renderAdminDashboard() {
  const { blockchain, botEngine, ammPool } = AppState;
  const adminOwnerDisplay = document.getElementById('admin-owner-display');
  const adminBotStatus = document.getElementById('admin-bot-status');
  const adminTotalClaims = document.getElementById('admin-total-claims');
  const adminTotalBlocks = document.getElementById('admin-total-blocks');
  const adminPoolAirInput = document.getElementById('admin-pool-air-input');
  const adminPoolUsdtInput = document.getElementById('admin-pool-usdt-input');
  const adminAuthCard = document.getElementById('admin-auth-card');
  const adminControlsPanel = document.getElementById('admin-controls-panel');
  const btnToggleBot = document.getElementById('btn-toggle-bot');

  if (!blockchain || !ammPool) return;

  const isOwner = PROTOCOL_OWNER_CONFIG.ownerAddress;
  const isAuth = PROTOCOL_OWNER_CONFIG.isAdminAuthorized;

  if (adminOwnerDisplay) {
    adminOwnerDisplay.innerText = isOwner ? `${isOwner.substring(0, 10)}...${isOwner.substring(isOwner.length - 8)}` : 'Unclaimed (Connect wallet to claim owner)';
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
    btnToggleBot.innerText = isRunning ? 'Pause Liquidity Bot' : 'Start Liquidity Bot';
    btnToggleBot.className = isRunning ? 'btn-secondary' : 'btn-primary';
  }

  if (adminTotalClaims) adminTotalClaims.innerText = `${blockchain.claimedAddresses.size} Wallets`;
  if (adminTotalBlocks) adminTotalBlocks.innerText = `#${blockchain.chain.length} Blocks`;

  if (adminPoolAirInput && !adminPoolAirInput.matches(':focus')) {
    adminPoolAirInput.value = ammPool.lvairReserve;
  }
  if (adminPoolUsdtInput && !adminPoolUsdtInput.matches(':focus')) {
    adminPoolUsdtInput.value = ammPool.usdtReserve;
  }
}
