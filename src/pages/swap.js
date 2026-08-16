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

export function setupSwapPage() {
  const recalculateQuote = () => {
    const { ammPool, currentInputToken } = AppState;
    if (!ammPool) return;
    const val = parseFloat(swapInputAmount.value) || 0;
    const quote = ammPool.getQuote(val, currentInputToken);
    
    if (swapOutputAmount) swapOutputAmount.value = quote.amountOut.toFixed(4);
    if (swapPriceImpact) {
      swapPriceImpact.innerText = `${quote.priceImpact.toFixed(2)}%`;
      swapPriceImpact.style.color = quote.priceImpact > 5 ? 'var(--accent-danger)' : 'var(--accent-success)';
    }
  };

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

      const amountIn = parseFloat(swapInputAmount.value);
      if (!amountIn || amountIn <= 0) return showToast('Please enter a valid swap amount', 'error');

      const userBal = blockchain.getBalanceOfAddress(currentConnectedAddress, currentInputToken);
      if (userBal < amountIn) {
        return showToast(`Insufficient ${currentInputToken} balance. You have ${userBal} ${currentInputToken}`, 'error');
      }

      btnExecuteSwap.disabled = true;
      btnExecuteSwap.innerText = 'Executing On-Chain Swap...';

      try {
        const isBuyingAir = currentInputToken === 'USDT';
        const trade = await ammPool.executeTrade(
          currentConnectedAddress,
          isBuyingAir ? 'BUY_LVAIR' : 'SELL_LVAIR',
          amountIn,
          0.05
        );

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
        <td title="${t.traderAddress}">${t.traderAddress.substring(0, 6)}...${t.traderAddress.substring(t.traderAddress.length - 4)}</td>
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
