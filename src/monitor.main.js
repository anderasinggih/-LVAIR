import { getApiBaseUrl } from './api.js';

let seenLogIds = new Set();

function appendLog(timeStr, tag, tagClass, text) {
  const container = document.getElementById('log-stream-container');
  if (!container) return;

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
    const [resStatus, resConfig, resBlocks, resLogs] = await Promise.all([
      fetch(`${apiUrl}/api/node/status`).catch(() => null),
      fetch(`${apiUrl}/api/config`).catch(() => null),
      fetch(`${apiUrl}/api/blocks`).catch(() => null),
      fetch(`${apiUrl}/api/telemetry/logs`).catch(() => null)
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
    }

    if (resLogs && resLogs.ok) {
      const logs = await resLogs.json();
      if (Array.isArray(logs)) {
        // Render in chronological order to add missing
        const newLogs = logs.filter(l => !seenLogIds.has(l.id));
        newLogs.reverse().forEach(l => {
          seenLogIds.add(l.id);
          const time = new Date(l.timestamp).toTimeString().split(' ')[0];
          appendLog(time, l.type, l.tag, l.message);
        });
      }
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

window.addEventListener('DOMContentLoaded', () => {
  const nowTime = new Date().toTimeString().split(' ')[0];
  appendLog(nowTime, 'MONITOR_INIT', 'tag-sync', 'Telemetry stream connected directly to Node RPC Server.');
  
  fetchNodeTelemetry();
  setInterval(fetchNodeTelemetry, 1000);
});
