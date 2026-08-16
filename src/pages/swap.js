import {
  swapInputAmount,
  swapOutputAmount,
  swapInputToken,
  swapOutputToken,
  swapPriceImpact,
  swapMaxBadge,
  swapPoolLiquidity,
  btnExecuteSwap,
  btnTogglePair,
  tradesTableBody,
  canvas,
  ctx,
  walletModal
} from '../dom.js';
import { AppState, updateUI } from '../state.js';
import { showToast } from '../components/toast.js';
import { renderLandingStats } from './landing.js';

let currentSlippage = 0.5;
let lastSwapTimestamp = 0;
const SWAP_RATE_LIMIT_MS = 2000;

function sanitizeText(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(String(str)));
  return div.innerHTML;
}

function setupSlippageButtons() {
  document.querySelectorAll('.slip-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.slip-btn').forEach(b => {
        b.style.background = 'rgba(255,255,255,0.05)';
        b.style.border = '1px solid var(--border-subtle)';
        b.style.color = 'var(--text-secondary)';
      });
      btn.style.background = 'rgba(37,99,235,0.2)';
      btn.style.border = '1px solid #2563eb';
      btn.style.color = '#60a5fa';
      currentSlippage = parseFloat(btn.getAttribute('data-slip'));
      const customInput = document.getElementById('slip-custom');
      if (customInput) customInput.value = '';
      recalculateQuote();
    });
  });

  const customInput = document.getElementById('slip-custom');
  if (customInput) {
    customInput.addEventListener('input', () => {
      const val = parseFloat(customInput.value);
      if (!isNaN(val) && val > 0 && val <= 50) {
        document.querySelectorAll('.slip-btn').forEach(b => {
          b.style.background = 'rgba(255,255,255,0.05)';
          b.style.border = '1px solid var(--border-subtle)';
          b.style.color = 'var(--text-secondary)';
        });
        currentSlippage = val;
        recalculateQuote();
      }
    });
  }
}

function recalculateQuote() {
  const { ammPool, currentInputToken } = AppState;
  if (!ammPool) return;
  const val = parseFloat(swapInputAmount.value) || 0;
  const quote = ammPool.getQuote(val, currentInputToken);

  if (swapOutputAmount) swapOutputAmount.value = quote.amountOut.toFixed(4);

  const impact = quote.priceImpact;
  if (swapPriceImpact) {
    swapPriceImpact.innerText = `${impact.toFixed(2)}%`;
    swapPriceImpact.style.color = impact > 15
      ? '#ef4444'
      : impact > 5
        ? '#f59e0b'
        : 'var(--accent-success)';
  }

  const impactWarning = document.getElementById('price-impact-warning');
  if (impactWarning) {
    impactWarning.style.display = impact > 5 ? 'block' : 'none';
    if (impact > 15) {
      impactWarning.innerHTML = `<div style="display:flex; align-items:center; gap:8px;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg><div><strong style="color:#f87171;">Extreme Price Impact (${impact.toFixed(1)}%)</strong> — This swap will severely move pool price. Consider smaller order size.</div></div>`;
    } else {
      impactWarning.innerHTML = `<div style="display:flex; align-items:center; gap:8px;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg><div><strong style="color:#fbbf24;">High Price Impact (${impact.toFixed(1)}%)</strong> — This trade moves the market significantly.</div></div>`;
    }
  }

  const minReceived = quote.amountOut * (1 - currentSlippage / 100);
  const minReceivedEl = document.getElementById('swap-min-received');
  if (minReceivedEl && val > 0) {
    const outToken = currentInputToken === 'LVAIR' ? 'USDT' : 'LVAIR';
    minReceivedEl.innerText = `${minReceived.toFixed(4)} ${outToken}`;
  } else if (minReceivedEl) {
    minReceivedEl.innerText = '—';
  }

  const gasFeeEl = document.getElementById('swap-gas-fee');
  if (gasFeeEl) {
    if (val > 0) {
      const gasEst = (0.0001 * val * quote.priceImpact * 0.01).toFixed(4);
      gasFeeEl.innerText = gasEst === '0.0000' ? '~$0.00 (Subsidized)' : `~$${gasEst}`;
    } else {
      gasFeeEl.innerText = '~$0.00 (Subsidized)';
    }
  }
}

export function setupSwapPage() {
  setupSlippageButtons();

  if (swapInputAmount) swapInputAmount.addEventListener('input', recalculateQuote);

  if (btnTogglePair) {
    btnTogglePair.addEventListener('click', () => {
      AppState.currentInputToken = AppState.currentInputToken === 'LVAIR' ? 'USDT' : 'LVAIR';
      if (swapInputToken) swapInputToken.innerText = AppState.currentInputToken;
      if (swapOutputToken) swapOutputToken.innerText = AppState.currentInputToken === 'LVAIR' ? 'USDT' : 'LVAIR';
      updateSwapMax();
      recalculateQuote();
    });
  }

  if (swapMaxBadge) {
    swapMaxBadge.addEventListener('click', () => {
      const { blockchain, currentConnectedAddress, currentInputToken } = AppState;
      if (!currentConnectedAddress || !blockchain) return;
      const bal = blockchain.getBalanceOfAddress(currentConnectedAddress, currentInputToken);
      if (swapInputAmount) {
        swapInputAmount.value = bal;
        recalculateQuote();
      }
    });
  }

  if (btnExecuteSwap) {
    btnExecuteSwap.addEventListener('click', async () => {
      const { blockchain, ammPool, currentConnectedAddress, currentInputToken } = AppState;
      if (!currentConnectedAddress) {
        if (walletModal) walletModal.style.display = 'flex';
        return;
      }

      const now = Date.now();
      if (now - lastSwapTimestamp < SWAP_RATE_LIMIT_MS) {
        showToast(`Please wait ${Math.ceil((SWAP_RATE_LIMIT_MS - (now - lastSwapTimestamp)) / 1000)}s before swapping again`, 'error');
        return;
      }

      const amountIn = parseFloat(swapInputAmount.value);
      if (!amountIn || amountIn <= 0) return showToast('Please enter a valid swap amount', 'error');

      const userBal = blockchain.getBalanceOfAddress(currentConnectedAddress, currentInputToken);
      if (userBal < amountIn) {
        return showToast(`Insufficient ${sanitizeText(currentInputToken)} balance. You have ${userBal.toLocaleString()} ${sanitizeText(currentInputToken)}`, 'error');
      }

      const quote = ammPool.getQuote(amountIn, currentInputToken);
      if (quote.priceImpact > 50) {
        return showToast('Price impact too high (>50%). Reduce swap amount.', 'error');
      }

      lastSwapTimestamp = now;
      btnExecuteSwap.disabled = true;
      btnExecuteSwap.innerText = 'Executing On-Chain Swap...';

      try {
        const isBuyingAir = currentInputToken === 'USDT';
        const trade = await ammPool.executeTrade(
          currentConnectedAddress,
          isBuyingAir ? 'BUY_LVAIR' : 'SELL_LVAIR',
          amountIn,
          currentSlippage / 100
        );

        addToHistory({
          type: 'swap',
          subtype: isBuyingAir ? 'BUY_LVAIR' : 'SELL_LVAIR',
          amountIn,
          amountOut: trade.amountOut,
          tokenIn: isBuyingAir ? 'USDT' : 'LVAIR',
          tokenOut: isBuyingAir ? 'LVAIR' : 'USDT',
          price: trade.effectivePrice,
          blockIndex: trade.blockIndex || AppState.blockchain.chain.length,
          timestamp: Date.now()
        });

        showToast(`Swap Settled! Received ${trade.amountOut.toFixed(2)} ${isBuyingAir ? 'LVAIR' : 'USDT'}`);
        updateUI();
        renderRecentTrades();
        renderLandingStats();
      } catch (err) {
        showToast(`Swap Failed: ${err.message}`, 'error');
      } finally {
        btnExecuteSwap.disabled = false;
        btnExecuteSwap.innerText = 'Execute Swap';
      }
    });
  }

  recalculateQuote();
  setupHistoryTab();
}

const walletHistory = [];

export function addToHistory(entry) {
  walletHistory.unshift(entry);
  renderHistory();
}

function setupHistoryTab() {
  const filterEl = document.getElementById('history-filter');
  if (filterEl) filterEl.addEventListener('change', renderHistory);

  const exportBtn = document.getElementById('btn-export-history');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const { currentConnectedAddress } = AppState;
      if (!currentConnectedAddress) return showToast('Connect wallet first', 'error');
      if (!walletHistory.length) return showToast('No history to export', 'error');

      const rows = ['Type,Amount In,Token In,Amount Out,Token Out,Price,Block,Time'];
      walletHistory.forEach(h => {
        rows.push(`${h.type},${h.amountIn},${h.tokenIn},${h.amountOut},${h.tokenOut},${h.price || ''},${h.blockIndex},${new Date(h.timestamp).toISOString()}`);
      });
      const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lvair_history_${currentConnectedAddress.substring(0, 8)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('History exported as CSV!');
    });
  }
}

export function renderHistory() {
  const { currentConnectedAddress } = AppState;
  const walletNotice = document.getElementById('history-wallet-notice');
  const emptyNotice = document.getElementById('history-empty-notice');
  const tableWrapper = document.getElementById('history-table-wrapper');
  const summaryEl = document.getElementById('history-summary');
  const tbody = document.getElementById('history-table-body');

  if (!walletNotice || !tbody) return;

  if (!currentConnectedAddress) {
    walletNotice.style.display = 'block';
    if (emptyNotice) emptyNotice.style.display = 'none';
    if (tableWrapper) tableWrapper.style.display = 'none';
    if (summaryEl) summaryEl.style.display = 'none';
    return;
  }

  walletNotice.style.display = 'none';

  const filterEl = document.getElementById('history-filter');
  const filter = filterEl ? filterEl.value : 'all';
  const filtered = filter === 'all' ? walletHistory : walletHistory.filter(h => h.type === filter);

  if (!filtered.length) {
    if (emptyNotice) emptyNotice.style.display = 'block';
    if (tableWrapper) tableWrapper.style.display = 'none';
    if (summaryEl) summaryEl.style.display = 'none';
    return;
  }

  if (emptyNotice) emptyNotice.style.display = 'none';
  if (tableWrapper) tableWrapper.style.display = 'block';
  if (summaryEl) summaryEl.style.display = 'flex';

  let totalVolume = 0;
  let netPnl = 0;

  tbody.innerHTML = filtered.map(h => {
    const isBuy = h.subtype === 'BUY_LVAIR' || h.type === 'airdrop';
    const typeLabel = h.type === 'airdrop' ? 'AIRDROP' : h.type === 'transfer' ? 'TRANSFER' : (isBuy ? 'BUY' : 'SELL');
    const badgeClass = h.type === 'airdrop' ? 'badge-neutral' : h.type === 'transfer' ? 'badge-neutral' : (isBuy ? 'badge-success' : 'badge-danger');
    const timeStr = new Date(h.timestamp).toLocaleTimeString();
    const dateStr = new Date(h.timestamp).toLocaleDateString();
    const priceStr = h.price ? `$${h.price.toFixed(4)}` : '—';
    const usdValue = h.tokenIn === 'USDT' ? h.amountIn : (h.amountIn * (AppState.ammPool ? AppState.ammPool.getCurrentPrice() : 0));
    totalVolume += usdValue;
    if (!isBuy && h.price) netPnl += (h.price * h.amountOut - h.amountIn);
    return `<tr>
      <td><span class="badge ${badgeClass}">${sanitizeText(typeLabel)}</span></td>
      <td style="font-family:var(--font-mono);">${h.amountIn.toFixed(4)} ${sanitizeText(h.tokenIn)}</td>
      <td style="font-family:var(--font-mono); color:#10b981;">${h.amountOut.toFixed(4)} ${sanitizeText(h.tokenOut)}</td>
      <td style="font-family:var(--font-mono); color:#60a5fa;">${priceStr}</td>
      <td style="font-family:var(--font-mono);">#${h.blockIndex}</td>
      <td style="color:var(--text-tertiary); font-size:0.78rem;">${dateStr} ${timeStr}</td>
      <td><span class="badge badge-success">Settled</span></td>
    </tr>`;
  }).join('');

  const totalTradesEl = document.getElementById('history-total-trades');
  const totalVolEl = document.getElementById('history-total-volume');
  const netPnlEl = document.getElementById('history-net-pnl');
  if (totalTradesEl) totalTradesEl.innerText = filtered.length;
  if (totalVolEl) totalVolEl.innerText = `$${totalVolume.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (netPnlEl) {
    netPnlEl.innerText = `${netPnl >= 0 ? '+' : ''}$${netPnl.toFixed(2)}`;
    netPnlEl.style.color = netPnl >= 0 ? '#10b981' : '#ef4444';
  }
}

export function updateSwapMax() {
  const { blockchain, currentConnectedAddress, currentInputToken } = AppState;
  if (!swapMaxBadge) return;
  if (!currentConnectedAddress || !blockchain) {
    swapMaxBadge.innerText = 'Bal: 0';
    return;
  }
  const bal = blockchain.getBalanceOfAddress(currentConnectedAddress, currentInputToken);
  swapMaxBadge.innerText = `Bal: ${bal.toLocaleString()} ${currentInputToken}`;
}

export function renderRecentTrades() {
  const { ammPool } = AppState;
  if (!tradesTableBody || !ammPool) return;
  const recent = [...ammPool.trades].reverse().slice(0, 8);
  tradesTableBody.innerHTML = recent.map(t => {
    const isBuy = t.type === 'BUY_LVAIR';
    return `
      <tr>
        <td><span class="badge ${isBuy ? 'badge-success' : 'badge-danger'}">${isBuy ? 'BUY' : 'SELL'}</span></td>
        <td>${t.amountIn.toFixed(2)} ${isBuy ? 'USDT' : 'LVAIR'}</td>
        <td>${t.amountOut.toFixed(2)} ${isBuy ? 'LVAIR' : 'USDT'}</td>
        <td style="color: #60a5fa; font-weight:700;">$${t.effectivePrice.toFixed(4)}</td>
        <td title="${sanitizeText(t.traderAddress)}">${sanitizeText(t.traderAddress.substring(0, 6))}...${sanitizeText(t.traderAddress.substring(t.traderAddress.length - 4))}</td>
        <td>#${t.blockIndex || 1}</td>
      </tr>
    `;
  }).join('');
}

export function renderChart() {
  const { ammPool } = AppState;
  if (!canvas || !ctx || !ammPool) return;
  const history = ammPool.priceHistory;
  if (history.length < 2) return;

  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const prices = history.map(h => h.price);
  const minP = Math.min(...prices) * 0.99;
  const maxP = Math.max(...prices) * 1.01;

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    const y = (canvas.height / 5) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  ctx.beginPath();
  const stepX = canvas.width / (prices.length - 1);
  prices.forEach((p, idx) => {
    const x = idx * stepX;
    const y = canvas.height - ((p - minP) / (maxP - minP)) * canvas.height;
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.strokeStyle = '#2563eb';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.lineTo(canvas.width, canvas.height);
  ctx.lineTo(0, canvas.height);
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, 'rgba(37, 99, 235, 0.15)');
  gradient.addColorStop(1, 'rgba(37, 99, 235, 0.0)');
  ctx.fillStyle = gradient;
  ctx.fill();
}
