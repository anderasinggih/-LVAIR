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
import { rpcPost } from '../api.js';
import { refreshNodeState } from '../node-sync.js';

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

  if (swapOutputAmount) swapOutputAmount.value = quote.outputAmount.toFixed(4);

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

  const minReceived = quote.outputAmount * (1 - currentSlippage / 100);
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

  if (swapPoolLiquidity) {
    swapPoolLiquidity.innerText = `$${ammPool.usdtReserve.toLocaleString()}`;
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
      const { blockchain, currentConnectedAddress, currentInputToken } = AppState;
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

      const quote = AppState.ammPool.getQuote(amountIn, currentInputToken);
      if (quote.priceImpact > 50) {
        return showToast('Price impact too high (>50%). Reduce swap amount.', 'error');
      }

      lastSwapTimestamp = now;
      btnExecuteSwap.disabled = true;
      btnExecuteSwap.innerText = 'Executing On-Chain Swap...';

      try {
        const data = await rpcPost('/api/swap', {
          userAddress: currentConnectedAddress,
          inputAmount: amountIn,
          inputToken: currentInputToken
        });

        const trade = data.result.trade;
        const isBuyingAir = currentInputToken === 'USDT';

        await refreshNodeState();

        addToHistory({
          type: 'swap',
          subtype: isBuyingAir ? 'BUY_LVAIR' : 'SELL_LVAIR',
          amountIn,
          amountOut: trade.outputAmount,
          tokenIn: isBuyingAir ? 'USDT' : 'LVAIR',
          tokenOut: isBuyingAir ? 'LVAIR' : 'USDT',
          price: trade.effectivePrice,
          blockIndex: trade.blockIndex || AppState.blockchain.chain.length,
          timestamp: Date.now()
        });

        showToast(`Swap submitted — pending network confirmation: ${trade.outputAmount.toFixed(2)} ${isBuyingAir ? 'LVAIR' : 'USDT'} @ $${trade.effectivePrice}`);
        updateUI();
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
  const { currentConnectedAddress, blockchain, ammPool } = AppState;
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

  const userAddrNorm = currentConnectedAddress.toLowerCase();
  const onChainTxList = [];

  if (blockchain && blockchain.chain) {
    blockchain.chain.forEach(block => {
      if (block.transactions) {
        block.transactions.forEach(tx => {
          const fromNorm = (tx.fromAddress || '').toLowerCase();
          const toNorm = (tx.toAddress || '').toLowerCase();

          if (tx.type === 'SWAP_IN' || tx.type === 'SWAP_OUT' || tx.type === 'COINBASE_REWARD' || tx.type === 'COINBASE_GENESIS') {
            return;
          }

          if (fromNorm === userAddrNorm || toNorm === userAddrNorm) {
            if (tx.type === 'AIRDROP_CLAIM') {
              onChainTxList.push({
                type: 'airdrop',
                subtype: 'CLAIM',
                amountIn: 0,
                amountOut: tx.amount,
                tokenIn: '—',
                tokenOut: 'LVAIR',
                price: null,
                blockIndex: block.index,
                timestamp: block.timestamp || Date.now()
              });
            } else if (tx.type === 'P2P_TRANSFER' || tx.type === 'TRANSFER') {
              onChainTxList.push({
                type: 'transfer',
                subtype: 'TRANSFER',
                amountIn: tx.amount,
                amountOut: tx.amount,
                tokenIn: tx.token,
                tokenOut: tx.token,
                price: null,
                blockIndex: block.index,
                timestamp: block.timestamp || Date.now()
              });
            }
          }
        });
      }
    });
  }

  if (ammPool && Array.isArray(ammPool.trades)) {
    ammPool.trades.forEach(t => {
      const trader = (t.traderAddress || t.user || '').toLowerCase();
      if (trader !== userAddrNorm) return;
      onChainTxList.push({
        type: 'swap',
        subtype: t.type,
        amountIn: Number(t.inputAmount),
        amountOut: Number(t.outputAmount),
        tokenIn: t.inputToken,
        tokenOut: t.outputToken,
        price: Number(t.effectivePrice || t.price || 0),
        blockIndex: t.blockIndex,
        timestamp: t.timestamp || Date.now()
      });
    });
  }

  const allTxs = [...walletHistory, ...onChainTxList];
  const uniqueTxs = [];
  const seenKeys = new Set();
  allTxs.forEach(t => {
    const key = `${t.type}_${t.blockIndex}_${t.amountOut}_${t.tokenOut}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      uniqueTxs.push(t);
    }
  });

  uniqueTxs.sort((a, b) => (b.blockIndex - a.blockIndex) || (b.timestamp - a.timestamp));

  const filterEl = document.getElementById('history-filter');
  const filter = filterEl ? filterEl.value : 'all';
  const filtered = filter === 'all' ? uniqueTxs : uniqueTxs.filter(h => h.type === filter);

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
  const recent = [...(ammPool.trades || [])].slice(0, 8);
  tradesTableBody.innerHTML = recent.map(t => {
    const isBuy = t.type === 'BUY_LVAIR';
    const trader = t.traderAddress || t.user || '';
    return `
      <tr>
        <td><span class="badge ${isBuy ? 'badge-success' : 'badge-danger'}">${isBuy ? 'BUY' : 'SELL'}</span></td>
        <td>${Number(t.inputAmount).toFixed(2)} ${isBuy ? 'USDT' : 'LVAIR'}</td>
        <td>${Number(t.outputAmount).toFixed(2)} ${isBuy ? 'LVAIR' : 'USDT'}</td>
        <td style="color: #60a5fa; font-weight:700;">$${Number(t.effectivePrice || t.price || 0).toFixed(4)}</td>
        <td title="${sanitizeText(trader)}">${sanitizeText(trader.substring(0, 6))}...${sanitizeText(trader.substring(trader.length - 4))}</td>
        <td>#${t.blockIndex || 1}</td>
      </tr>
    `;
  }).join('');
}

let chartPoints = [];
let lastHoverIndex = -1;
let chartEventsBound = false;

function formatChartTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function updateChartHeader() {
  const { ammPool } = AppState;
  if (!ammPool) return;
  const priceEl = document.getElementById('chart-price-index');
  const changeEl = document.getElementById('chart-price-change');
  const depthEl = document.getElementById('chart-pool-depth');
  const price = ammPool.getCurrentPrice();

  if (priceEl) priceEl.innerText = `$${price.toFixed(4)}`;

  const history = ammPool.priceHistory;
  if (changeEl && history && history.length >= 2) {
    const first = history[0].price;
    const last = history[history.length - 1].price;
    const pct = first > 0 ? ((last - first) / first) * 100 : 0;
    changeEl.innerText = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
    changeEl.style.color = pct >= 0 ? '#10b981' : '#f87171';
  }

  if (depthEl && typeof ammPool.lvairReserve === 'number') {
    depthEl.innerText = `Depth ${Number(ammPool.lvairReserve).toLocaleString()} LVAIR / ${Number(ammPool.usdtReserve).toLocaleString()} USDT`;
  }
}

export function renderChart() {
  const { ammPool } = AppState;
  if (!canvas || !ctx || !ammPool) return;
  const history = ammPool.priceHistory;
  updateChartHeader();
  if (history.length < 2) return;

  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const W = rect.width;
  const H = rect.height;
  ctx.clearRect(0, 0, W, H);

  const prices = history.map(h => h.price);
  const minP = Math.min(...prices) * 0.99;
  const maxP = Math.max(...prices) * 1.01;
  const range = (maxP - minP) || 1;

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.lineWidth = 1;
  ctx.font = '10px JetBrains Mono, monospace';
  for (let i = 0; i < 5; i++) {
    const y = (H / 4) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();

    const priceAtY = maxP - (range * i) / 4;
    ctx.fillStyle = 'rgba(148, 163, 184, 0.55)';
    ctx.fillText(`$${priceAtY.toFixed(4)}`, 6, y - 4);
  }

  const stepX = W / (prices.length - 1);
  chartPoints = prices.map((p, idx) => {
    const x = idx * stepX;
    const y = H - ((p - minP) / range) * H;
    return { x, y, price: p, ts: history[idx].timestamp, lvair: history[idx].lvairReserve, usdt: history[idx].usdtReserve };
  });

  ctx.beginPath();
  chartPoints.forEach((pt, idx) => {
    if (idx === 0) ctx.moveTo(pt.x, pt.y);
    else ctx.lineTo(pt.x, pt.y);
  });
  ctx.strokeStyle = '#2563eb';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.lineTo(W, H);
  ctx.lineTo(0, H);
  const gradient = ctx.createLinearGradient(0, 0, 0, H);
  gradient.addColorStop(0, 'rgba(37, 99, 235, 0.15)');
  gradient.addColorStop(1, 'rgba(37, 99, 235, 0.0)');
  ctx.fillStyle = gradient;
  ctx.fill();

  if (lastHoverIndex >= 0) {
    if (lastHoverIndex >= chartPoints.length) lastHoverIndex = chartPoints.length - 1;
    drawChartCrosshair(chartPoints[lastHoverIndex], W, H);
  }

  updateChartHeader();

  if (!chartEventsBound && canvas) {
    chartEventsBound = true;
    canvas.addEventListener('mousemove', (e) => {
      if (!chartPoints.length) return;
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < chartPoints.length; i++) {
        const d = Math.abs(chartPoints[i].x - x);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      lastHoverIndex = best;
      renderChart();
    });
    canvas.addEventListener('mouseleave', () => {
      lastHoverIndex = -1;
      renderChart();
    });
  }
}

function drawChartCrosshair(pt, W, H) {
  ctx.save();

  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pt.x, 0);
  ctx.lineTo(pt.x, H);
  ctx.moveTo(0, pt.y);
  ctx.lineTo(W, pt.y);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.beginPath();
  ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#2563eb';
  ctx.stroke();

  const tooltipW = 176;
  const tooltipH = 70;
  let tx = pt.x + 14;
  let ty = pt.y - tooltipH - 14;
  if (tx + tooltipW > W) tx = pt.x - tooltipW - 14;
  if (tx < 6) tx = 6;
  if (ty < 6) ty = pt.y + 14;
  if (ty + tooltipH > H) ty = H - tooltipH - 6;

  ctx.beginPath();
  ctx.moveTo(tx + 8, ty);
  ctx.lineTo(tx + tooltipW - 8, ty);
  ctx.quadraticCurveTo(tx + tooltipW, ty, tx + tooltipW, ty + 8);
  ctx.lineTo(tx + tooltipW, ty + tooltipH - 8);
  ctx.quadraticCurveTo(tx + tooltipW, ty + tooltipH, tx + tooltipW - 8, ty + tooltipH);
  ctx.lineTo(tx + 8, ty + tooltipH);
  ctx.quadraticCurveTo(tx, ty + tooltipH, tx, ty + tooltipH - 8);
  ctx.lineTo(tx, ty + 8);
  ctx.quadraticCurveTo(tx, ty, tx + 8, ty);
  ctx.closePath();
  ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(37, 99, 235, 0.45)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.font = '700 13px JetBrains Mono, monospace';
  ctx.fillText(`$${pt.price.toFixed(4)}`, tx + 12, ty + 18);

  ctx.fillStyle = 'rgba(148, 163, 184, 0.9)';
  ctx.font = '10px JetBrains Mono, monospace';
  ctx.fillText(formatChartTime(pt.ts), tx + 12, ty + 34);

  ctx.fillText(`L ${Number(pt.lvair || 0).toLocaleString()} / U ${Number(pt.usdt || 0).toLocaleString()}`, tx + 12, ty + 50);

  ctx.fillStyle = 'rgba(37, 99, 235, 0.9)';
  ctx.fillText(`Index ${((pt.price / (chartPoints[0].price || 1) - 1) * 100).toFixed(2)}%`, tx + 12, ty + 64);

  ctx.restore();
}
