import {
  transferRecipientInput,
  transferTokenSelect,
  transferAmountInput,
  btnSendTransfer,
  walletModal
} from '../dom.js';
import { AppState, updateUI } from '../state.js';
import { Transaction } from '../core/block.js';
import { showToast } from '../components/toast.js';
import { renderLandingStats } from './landing.js';
import { addToHistory } from './swap.js';
import { getApiBaseUrl } from '../api.js';

export function setupTransferPage() {
  if (!btnSendTransfer) return;

  btnSendTransfer.addEventListener('click', async () => {
    const { blockchain, currentConnectedAddress } = AppState;
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

    const currentBal = blockchain.getBalanceOfAddress(currentConnectedAddress, token);
    if (currentBal < amount) {
      return showToast(`Insufficient ${token} balance. Available: ${currentBal} ${token}`, 'error');
    }

    btnSendTransfer.disabled = true;
    btnSendTransfer.innerText = 'Settling Transaction...';

    try {
      const tx = new Transaction(
        currentConnectedAddress,
        toAddress,
        amount,
        token,
        'P2P_TRANSFER',
        { memo: 'On-Chain Transfer' }
      );
      tx.txHash = await tx.calculateHash();
      await blockchain.addTransaction(tx);
      await blockchain.minePendingTransactions(currentConnectedAddress);

      // Notify server so monitor picks it up
      try {
        const apiUrl = getApiBaseUrl();
        await fetch(`${apiUrl}/api/tx/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: currentConnectedAddress, to: toAddress, amount, token, type: 'P2P_TRANSFER', metadata: { memo: 'On-Chain Transfer' } })
        });
      } catch (e) {}

      showToast(`Transferred ${amount} ${token} on-chain!`);
      addToHistory({
        type: 'transfer',
        subtype: 'P2P_TRANSFER',
        amountIn: amount,
        amountOut: amount,
        tokenIn: token,
        tokenOut: token,
        price: null,
        blockIndex: blockchain.chain.length,
        timestamp: Date.now()
      });
      transferRecipientInput.value = '';
      updateUI();
      renderLandingStats();
    } catch (err) {
      showToast(`Transfer Failed: ${err.message}`, 'error');
    } finally {
      btnSendTransfer.disabled = false;
      btnSendTransfer.innerText = 'Send On-Chain Transfer';
    }
  });
}
