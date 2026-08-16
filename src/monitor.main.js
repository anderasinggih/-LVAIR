import { getApiBaseUrl } from './api.js';

let lastBlockCount = 0;

function appendLog(tag, tagClass, text) {
  const container = document.getElementById('log-stream-container');
  if (!container) return;

  const now = new Date();
  const timeStr = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');

  const row = document.createElement('div');
  row.className = 'log-row';
  row.innerHTML = `
    <span class="log-time">[${timeStr}]</span>
    <span class="log-tag ${tagClass}">${tag}</span>
    <span>${text}</span>
  `;

  container.insertBefore(row, container.firstChild);

  // Keep max 150 logs in DOM
  if (container.children.length > 150) {
    container.removeChild(container.lastChild);
  }
}

async function fetchNodeTelemetry() {
  const apiUrl = getApiBaseUrl();

  try {
    const [resStatus, resConfig, resBlocks] = await Promise.all([
      fetch(`${apiUrl}/api/node/status`).catch(() => null),
      fetch(`${apiUrl}/api/config`).catch(() => null),
      fetch(`${apiUrl}/api/blocks`).catch(() => null)
    ]);

    if (resStatus && resStatus.ok) {
      const status = await resStatus.json();
      
      const elHeight = document.getElementById('mon-block-height');
      const elPeers = document.getElementById('mon-p2p-peers');
      const elPrice = document.getElementById('mon-spot-price');
      const elQuota = document.getElementById('mon-airdrop-quota');
      const elClaimed = document.getElementById('mon-claimed-count');
      const elBadge = document.getElementById('node-status-badge');

      if (elHeight) elHeight.innerText = `#${status.blockHeight || 0}`;
      if (elPeers) elPeers.innerText = `${status.p2pPeers || 0} Connected`;
      if (elPrice) elPrice.innerText = `$${(status.spotPrice || 0.25).toFixed(4)}`;
      if (elQuota) elQuota.innerText = `${status.airdropClaimAmount || 250} LVAIR`;
      if (elClaimed) elClaimed.innerText = `${status.claimedWallets || 0} Wallets`;
      if (elBadge) {
        elBadge.innerText = 'Node Online';
        elBadge.className = 'badge badge-success';
      }

      if (status.blockHeight > lastBlockCount && lastBlockCount > 0) {
        appendLog('NEW_BLOCK', 'tag-block', `Consensus finalized Block #${status.blockHeight} (Merkle: ${(status.merkleRoot || '').substring(0, 16)}...)`);
      }
      lastBlockCount = status.blockHeight;
    }

    if (resBlocks && resBlocks.ok) {
      const blocks = await resBlocks.json();
      renderBlocksTable(blocks);
    }
  } catch (err) {
    const elBadge = document.getElementById('node-status-badge');
    if (elBadge) {
      elBadge.innerText = 'Node Connecting...';
      elBadge.className = 'badge badge-neutral';
    }
  }
}

function renderBlocksTable(blocks) {
  const tbody = document.getElementById('mon-blocks-tbody');
  if (!tbody || !blocks) return;

  if (!blocks.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #6b7280; padding: 24px;">No blocks mined yet</td></tr>';
    return;
  }

  // Show last 30 blocks descending
  const recent = [...blocks].reverse().slice(0, 30);

  tbody.innerHTML = recent.map(b => {
    const txCount = b.transactions ? b.transactions.length : 0;
    const timeStr = b.timestamp ? new Date(b.timestamp).toLocaleTimeString() : '—';
    const shortHash = (b.hash || '').substring(0, 12) + '...' + (b.hash || '').substring((b.hash || '').length - 6);
    const shortMerkle = (b.merkleRoot || '').substring(0, 10) + '...';

    return `
      <tr>
        <td style="color: #60a5fa; font-weight: 700;">#${b.index}</td>
        <td title="${b.hash}">${shortHash}</td>
        <td><span class="badge ${txCount > 0 ? 'badge-success' : 'badge-neutral'}">${txCount} txs</span></td>
        <td style="color: #9ca3af;" title="${b.merkleRoot}">${shortMerkle}</td>
        <td style="color: #6b7280; font-size: 0.76rem;">${timeStr}</td>
      </tr>
    `;
  }).join('');
}

function connectP2PWebSocket() {
  const apiUrl = getApiBaseUrl();
  const wsUrl = apiUrl.replace(/^http/, 'ws').replace(':3001', ':6001');

  try {
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      appendLog('P2P_OPEN', 'tag-peer', `Connected to P2P Broadcast Network (${wsUrl})`);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'NEW_BLOCK') {
          appendLog('BLOCK_BROADCAST', 'tag-block', `Gossip received Block #${msg.block.index} (${msg.block.transactions?.length || 0} txs)`);
          fetchNodeTelemetry();
        } else if (msg.type === 'AIRDROP_CLAIMED') {
          appendLog('CLAIM_BROADCAST', 'tag-claim', `Wallet ${msg.userAddress.substring(0, 8)}... claimed airdrop on-chain`);
          fetchNodeTelemetry();
        } else if (msg.type === 'CONFIG_UPDATED') {
          appendLog('CONFIG_BROADCAST', 'tag-sync', `Airdrop quota updated to ${msg.config.airdropClaimAmount} LVAIR`);
          fetchNodeTelemetry();
        } else if (msg.type === 'WHITELIST_RESET') {
          appendLog('RESET_BROADCAST', 'tag-sync', `Airdrop whitelist was reset`);
          fetchNodeTelemetry();
        } else if (msg.type === 'SWAP_EXECUTED') {
          appendLog('SWAP_BROADCAST', 'tag-swap', `Swap settled! New Price: $${(msg.newPrice || 0.25).toFixed(4)}`);
          fetchNodeTelemetry();
        }
      } catch (e) {}
    };

    ws.onclose = () => {
      appendLog('P2P_RECONNECT', 'tag-sync', 'P2P Stream disconnected. Reconnecting in 3s...');
      setTimeout(connectP2PWebSocket, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  } catch (e) {
    setTimeout(connectP2PWebSocket, 3000);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  appendLog('MONITOR_INIT', 'tag-sync', 'Observer dashboard mounted. Starting telemetry polling...');
  fetchNodeTelemetry();
  connectP2PWebSocket();

  // 1-second interval telemetry refresh
  setInterval(fetchNodeTelemetry, 1000);
});
