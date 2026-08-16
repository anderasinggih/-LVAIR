import { AMMPool } from './amm.js';

export class TradingBotEngine {
  constructor(blockchain, ammPool) {
    this.blockchain = blockchain;
    this.ammPool = ammPool;
    this.botWallet = '0xbot_market_maker_alpha';
    this.isRunning = false;
    this.timer = null;
    this.rsiHistory = [];
  }

  calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50.0;

    const deltas = [];
    for (let i = 1; i < prices.length; i++) {
      deltas.push(prices[i] - prices[i - 1]);
    }

    let gains = deltas.slice(0, period).map(d => (d > 0 ? d : 0));
    let losses = deltas.slice(0, period).map(d => (d < 0 ? -d : 0));

    let avgGain = gains.reduce((a, b) => a + b, 0) / period;
    let avgLoss = losses.reduce((a, b) => a + b, 0) / period;

    for (let i = period; i < deltas.length; i++) {
      const d = deltas[i];
      const gain = d > 0 ? d : 0;
      const loss = d < 0 ? -d : 0;
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }

    if (avgLoss === 0) return 100.0;
    const rs = avgGain / avgLoss;
    return 100.0 - (100.0 / (1.0 + rs));
  }

  start(intervalMs = 3500, onBotAction = null) {
    if (this.isRunning) return;
    this.isRunning = true;

    this.timer = setInterval(async () => {
      if (!this.isRunning) return;
      try {
        const prices = this.ammPool.priceHistory.map(h => h.price);
        const rsi = this.calculateRSI(prices, 5);
        this.rsiHistory.push({ timestamp: Date.now(), rsi });

        let action = null;

        if (rsi < 35) {
          const usdtAmount = Number((Math.random() * 15 + 5).toFixed(2));
          action = { type: 'BUY_LVAIR', inputAmount: usdtAmount, inputToken: 'USDT', reason: `RSI Oversold (${rsi.toFixed(1)})` };
          await this.ammPool.executeSwap(this.botWallet, usdtAmount, 'USDT');
        } else if (rsi > 65) {
          const lvairAmount = Number((Math.random() * 60 + 20).toFixed(2));
          action = { type: 'SELL_LVAIR', inputAmount: lvairAmount, inputToken: 'LVAIR', reason: `RSI Overbought (${rsi.toFixed(1)})` };
          await this.ammPool.executeSwap(this.botWallet, lvairAmount, 'LVAIR');
        } else {
          const isBuy = Math.random() > 0.5;
          if (isBuy) {
            const usdtAmount = Number((Math.random() * 8 + 2).toFixed(2));
            action = { type: 'BUY_LVAIR', inputAmount: usdtAmount, inputToken: 'USDT', reason: 'Market Making Flow' };
            await this.ammPool.executeSwap(this.botWallet, usdtAmount, 'USDT');
          } else {
            const lvairAmount = Number((Math.random() * 30 + 10).toFixed(2));
            action = { type: 'SELL_LVAIR', inputAmount: lvairAmount, inputToken: 'LVAIR', reason: 'Market Making Flow' };
            await this.ammPool.executeSwap(this.botWallet, lvairAmount, 'LVAIR');
          }
        }

        if (onBotAction) {
          onBotAction({ action, rsi, price: this.ammPool.getCurrentPrice() });
        }
      } catch {
        // Bot step skipped — pool may be rebalancing
      }
    }, intervalMs);
  }

  stop() {
    this.isRunning = false;
    if (this.timer) clearInterval(this.timer);
  }
}
