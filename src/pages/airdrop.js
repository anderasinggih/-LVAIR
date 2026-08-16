import {
  btnClaimAirdrop,
  walletModal
} from '../dom.js';
import { AppState, updateUI } from '../state.js';
import { showToast } from '../components/toast.js';
import { renderLandingStats } from './landing.js';
import { addToHistory } from './swap.js';
import { rpcPost } from '../api.js';
import { refreshNodeState } from '../node-sync.js';

export function setupAirdropPage() {
  if (!btnClaimAirdrop) return;

  btnClaimAirdrop.addEventListener('click', async () => {
    const { currentConnectedAddress } = AppState;
    if (!currentConnectedAddress) {
      showToast('Please connect your wallet to claim the airdrop', 'warning');
      if (walletModal) walletModal.style.display = 'flex';
      return;
    }

    btnClaimAirdrop.disabled = true;
    btnClaimAirdrop.innerText = 'Claiming Allocation...';

    try {
      const quota = AppState.blockchain.airdropClaimAmount || 250;

      const data = await rpcPost('/api/airdrop/claim', { userAddress: currentConnectedAddress });

      await refreshNodeState();

      addToHistory({
        type: 'airdrop',
        subtype: 'CLAIM',
        amountIn: 0,
        amountOut: quota,
        tokenIn: '—',
        tokenOut: 'LVAIR',
        price: null,
        blockIndex: data.blockIndex || AppState.blockchain.chain.length,
        timestamp: Date.now()
      });

      showToast(`Airdrop claim submitted — pending network confirmation (${quota} $LVAIR).`);
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
