import { AppState, updateUI } from './state.js';
import { renderLandingStats } from './pages/landing.js';
import { renderRecentTrades, renderChart, renderHistory, updateSwapMax } from './pages/swap.js';
import { Block } from './core/block.js';
import { getApiBaseUrl } from './api.js';

let lastBlockHash = '';
let lastTradesCount = 0;

function rebuildClaimedAddresses(blocks) {
  const claimed = new Set();
  blocks.forEach(b => {
    if (b.transactions) {
      b.transactions.forEach(t => {
        if (t.type === 'AIRDROP_CLAIM' && t.toAddress) {
          claimed.add(t.toAddress.toLowerCase());
        }
      });
    }
  });
  return claimed;
}

export async function refreshNodeState() {
  const apiUrl = getApiBaseUrl();
  let changed = false;

  try {
    const [blocksRes, cfgRes, ammRes] = await Promise.all([
      fetch(`${apiUrl}/api/blocks`).catch(() => null),
      fetch(`${apiUrl}/api/config`).catch(() => null),
      fetch(`${apiUrl}/api/amm/state`).catch(() => null)
    ]);

    if (blocksRes && blocksRes.ok) {
      const blocks = await blocksRes.json();
      if (Array.isArray(blocks) && blocks.length > 0) {
        AppState.blockchain.chain = blocks.map(b => Block.fromJSON(b));
        AppState.blockchain.claimedAddresses = rebuildClaimedAddresses(blocks);
        const latestHash = blocks[blocks.length - 1].hash;
        if (latestHash !== lastBlockHash) {
          lastBlockHash = latestHash;
          changed = true;
        }
      }
    }

    if (cfgRes && cfgRes.ok) {
      const cfg = await cfgRes.json();
      if (cfg.airdropClaimAmount) AppState.blockchain.airdropClaimAmount = cfg.airdropClaimAmount;
      if (cfg.miningReward) AppState.blockchain.miningReward = cfg.miningReward;
    }

    if (ammRes && ammRes.ok) {
      const amm = await ammRes.json();
      if (amm && typeof amm.lvairReserve === 'number') {
        AppState.ammPool.lvairReserve = amm.lvairReserve;
        AppState.ammPool.usdtReserve = amm.usdtReserve;
        if (Array.isArray(amm.priceHistory)) AppState.ammPool.priceHistory = amm.priceHistory;
        if (Array.isArray(amm.trades)) {
          AppState.ammPool.trades = amm.trades;
          if (amm.trades.length !== lastTradesCount) {
            lastTradesCount = amm.trades.length;
            changed = true;
          }
        }
      }
    }
  } catch (e) {}

  if (changed) {
    updateUI();
    renderLandingStats();
    renderRecentTrades();
    renderChart();
    renderHistory();
    updateSwapMax();
  }
}
