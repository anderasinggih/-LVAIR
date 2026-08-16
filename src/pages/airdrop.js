import {
  btnClaimAirdrop,
  walletModal
} from '../dom.js';
import { AppState, updateUI } from '../state.js';
import { showToast } from '../components/toast.js';
import { renderLandingStats } from './landing.js';
import { addToHistory } from './swap.js';
import { getApiBaseUrl } from '../api.js';
import { refreshNodeState } from '../node-sync.js';

export function setupAirdropPage() {
  if (!btnClaimAirdrop) return;

  btnClaimAirdrop.addEventListener('click', async () => {
    const { currentConnectedAddress } = AppState;
    if (!currentConnectedAddress) {
      showToast('Authentication required: Connect your Web3 wallet to claim airdrop', 'error');
      if (walletModal) walletModal.style.display = 'flex';
      return;
    }

    btnClaimAirdrop.disabled = true;
    btnClaimAirdrop.innerText = 'Claiming Allocation...';

    try {
      const quota = AppState.blockchain.airdropClaimAmount || 250;
      const apiUrl = getApiBaseUrl();

      const res = await fetch(`${apiUrl}/api/airdrop/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userAddress: currentConnectedAddress })
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || 'RPC rejected the claim');
      }

      await res.json();
      await refreshNodeState();

      addToHistory({
        type: 'airdrop',
        subtype: 'CLAIM',
        amountIn: 0,
        amountOut: quota,
        tokenIn: '—',
        tokenOut: 'LVAIR',
        price: null,
        blockIndex: AppState.blockchain.chain.length,
        timestamp: Date.now()
      });

      showToast(`${quota} $LVAIR successfully claimed!`);
      updateUI();
      renderLandingStats();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btnClaimAirdrop.disabled = false;
      const quota = AppState.blockchain.airdropClaimAmount || 250;
      btnClaimAirdrop.innerText = `Claim ${quota} $LVAIR Airdrop`;
    }
  });
}
