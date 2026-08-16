import {
  btnClaimAirdrop,
  walletModal
} from '../dom.js';
import { AppState, updateUI } from '../state.js';
import { showToast } from '../components/toast.js';
import { renderLandingStats } from './landing.js';
import { addToHistory } from './swap.js';
import { getApiBaseUrl } from '../api.js';

export function setupAirdropPage() {
  if (!btnClaimAirdrop) return;

  btnClaimAirdrop.addEventListener('click', async () => {
    const { blockchain, currentConnectedAddress } = AppState;
    if (!currentConnectedAddress) {
      showToast('Authentication required: Connect your Web3 wallet to claim airdrop', 'error');
      if (walletModal) walletModal.style.display = 'flex';
      return;
    }

    btnClaimAirdrop.disabled = true;
    btnClaimAirdrop.innerText = 'Claiming Allocation...';

    try {
      const quota = blockchain.airdropClaimAmount || 250;
      const apiUrl = getApiBaseUrl();

      // Submit to Global Node Server RPC
      let serverClaimSuccess = false;
      try {
        const res = await fetch(`${apiUrl}/api/airdrop/claim`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userAddress: currentConnectedAddress })
        });
        if (res.ok) {
          serverClaimSuccess = true;
        }
      } catch (e) {
        console.warn('Direct server claim offline, executing local consensus fallback');
      }

      // Execute on client state
      await blockchain.claimAirdrop(currentConnectedAddress);

      if (!serverClaimSuccess) {
        try {
          await fetch(`${apiUrl}/api/telemetry/event`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'AIRDROP_CLAIMED',
              tag: 'tag-claim',
              message: `Wallet ${currentConnectedAddress.substring(0, 8)}... claimed ${quota} $LVAIR airdrop`,
              data: { userAddress: currentConnectedAddress, quota }
            })
          });
        } catch (e) {}
      }

      addToHistory({
        type: 'airdrop',
        subtype: 'CLAIM',
        amountIn: 0,
        amountOut: quota,
        tokenIn: '—',
        tokenOut: 'LVAIR',
        price: null,
        blockIndex: blockchain.chain.length,
        timestamp: Date.now()
      });

      showToast(`${quota} $LVAIR successfully claimed!`);
      updateUI();
      renderLandingStats();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btnClaimAirdrop.disabled = false;
      const quota = blockchain.airdropClaimAmount || 250;
      btnClaimAirdrop.innerText = `Claim ${quota} $LVAIR Airdrop`;
    }
  });
}
