import {
  explorerBlocksBody,
  btnValidateChain,
  btnExportChain
} from '../dom.js';
import { AppState } from '../state.js';
import { showToast } from '../components/toast.js';
import { formatBlockNumber } from '../format.js';

export function setupExplorerPage() {
  if (btnValidateChain) {
    btnValidateChain.addEventListener('click', async () => {
      const { blockchain } = AppState;
      if (!blockchain) return;
      const res = await blockchain.isChainValid();
      if (res.valid) {
        showToast('Ledger integrity verified: All blocks and proofs are valid!');
      } else {
        showToast(`Validation Error: ${res.error}`, 'error');
      }
    });
  }

  if (btnExportChain) {
    btnExportChain.addEventListener('click', () => {
      const { blockchain } = AppState;
      if (!blockchain) return;
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(blockchain.chain, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", `lvair_ledger_export_${blockchain.chain.length}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      showToast('Ledger JSON exported');
    });
  }
}

export function renderExplorerBlocks() {
  const { blockchain } = AppState;
  if (!explorerBlocksBody || !blockchain) return;
  const blocks = [...blockchain.chain].reverse().slice(0, 10);
  explorerBlocksBody.innerHTML = blocks.map(b => `
    <tr>
      <td><strong>#${formatBlockNumber(b.index)}</strong></td>
      <td title="${b.hash}">${b.hash.substring(0, 14)}...</td>
      <td title="${b.previousHash}">${b.previousHash.substring(0, 10)}...</td>
      <td title="${b.merkleRoot || ''}">${(b.merkleRoot || '').substring(0, 10)}...</td>
      <td>${b.nonce}</td>
      <td><span class="badge badge-neutral">${b.transactions.length} txs</span></td>
      <td>${new Date(b.timestamp).toLocaleTimeString()}</td>
    </tr>
  `).join('');
}
