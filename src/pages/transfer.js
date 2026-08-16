import {
  transferRecipientInput,
  transferTokenSelect,
  transferAmountInput,
  btnSendTransfer,
  walletModal
} from '../dom.js';
import { AppState } from '../state.js';
import { showToast } from '../components/toast.js';
import { addToHistory } from './swap.js';
import { rpcPost } from '../api.js';
import { refreshNodeState } from '../node-sync.js';

export function setupTransferPage() {
  if (!btnSendTransfer) return;

  btnSendTransfer.addEventListener('click', async () => {
    const { currentConnectedAddress } = AppState;
    if (!currentConnectedAddress) {
      showToast('Authentication required: Connect your Web3 wallet to transfer tokens', 'error');
      if (walletModal) walletModal.style.display = 'flex';
      return;
    }

    const toAddress = transferRecipientInput.value.trim();
    const token = transferTokenSelect.value;
    const amount = parseFloat(transferAmountInput.value);

    if (!toAddress) return showToast('Please enter a valid destination address', 'error');
    if (!amount || amount <= 0) return showToast('Enter a valid transfer amount', 'error');

    const currentBal = AppState.blockchain.getBalanceOfAddress(currentConnectedAddress, token);
    if (currentBal < amount) {
      return showToast(`Insufficient ${token} balance. Available: ${currentBal} ${token}`, 'error');
    }

    btnSendTransfer.disabled = true;
    btnSendTransfer.innerText = 'Settling Transaction...';

    try {
      const data = await rpcPost('/api/tx/send', {
        from: currentConnectedAddress,
        to: toAddress,
        amount,
        token,
        type: 'P2P_TRANSFER',
        metadata: { memo: 'On-Chain Transfer' }
      });
      await refreshNodeState();

      showToast(`Transfer ${amount} ${token} broadcast to network — menunggu blok berikutnya.`);
      addToHistory({
        type: 'transfer',
        subtype: 'P2P_TRANSFER',
        amountIn: amount,
        amountOut: amount,
        tokenIn: token,
        tokenOut: token,
        price: null,
        blockIndex: data.blockIndex || AppState.blockchain.chain.length,
        timestamp: Date.now()
      });
      transferRecipientInput.value = '';
    } catch (err) {
      showToast(`Transfer Failed: ${err.message}`, 'error');
    } finally {
      btnSendTransfer.disabled = false;
      btnSendTransfer.innerText = 'Send On-Chain Transfer';
    }
  });
}
