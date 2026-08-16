import { AMMPool } from './amm.js';

export class TradingBotEngine {
  constructor({ blockchain, ammPool, submitSwap = null }) {
    this.blockchain = blockchain;
    this.ammPool = ammPool;
    this.submitSwap = submitSwap || (async (wallet, amount, token) => this.ammPool.executeSwap(wallet, amount, token));
    this.botWallet = '0xbot_market_maker_alpha';
    this.isRunning = false;
    this.timer = null;
    this.rsiHistory = [];
    this.mode = 'volatile';
    this.tradeCount = 0;
    this.lastPrice = 0;
    this.trendDirection = 0;
    this.impulseCooldown = 0;
  }

  static MODES = ['volatile', 'volume', 'momentum', 'random', 'balanced', 'accumulate', 'distribute'];

  setMode(mode) {
    if (TradingBotEngine.MODES.includes(mode)) this.mode = mode;
  }

  getMode() {
    return this.mode;
  }

  calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50.0;
    const deltas = [];
    for (let i = 1; i < prices.length; i++) deltas.push(prices[i] - prices[i - 1]);
    let gains = deltas.slice(0, period).map(d => (d > 0 ? d : 0));
    let losses = deltas.slice(0, period).map(d => (d < 0 ? -d : 0));
    let avgGain = gains.reduce((a, b) => a + b, 0) / period;
    let avgLoss = losses.reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < deltas.length; i++) {
      const d = deltas[i];
      avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
      avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period;
    }
    if (avgLoss === 0) return 100.0;
    return 100.0 - (100.0 / (1.0 + avgGain / avgLoss));
  }

  getMomentum() {
    const prices = this.ammPool.priceHistory.map(h => h.price);
    if (prices.length < 5) return 0;
    const recent = prices.slice(-5);
    const old = prices.slice(-10, -5);
    if (!old.length) return 0;
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const oldAvg = old.reduce((a, b) => a + b, 0) / old.length;
    return (recentAvg - oldAvg) / oldAvg;
  }

  getVolatility() {
    const prices = this.ammPool.priceHistory.map(h => h.price);
    if (prices.length < 10) return 0;
    const recent = prices.slice(-20);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance = recent.reduce((a, b) => a + (b - mean) ** 2, 0) / recent.length;
    return Math.sqrt(variance) / mean;
  }

  rand(min, max) {
    return Math.random() * (max - min) + min;
  }

  randInt(min, max) {
    return Math.floor(this.rand(min, max + 1));
  }

  pickDirection(bias = 0.5) {
    return Math.random() < bias ? 'buy' : 'sell';
  }

  async executeTrade(direction, amount, token, reason) {
    try {
      const result = await this.submitSwap(this.botWallet, amount, token);
      this.tradeCount++;
      this.lastPrice = this.ammPool.getCurrentPrice();
      return { action: { type: direction === 'buy' ? 'BUY_LVAIR' : 'SELL_LVAIR', inputAmount: amount, inputToken: token, reason }, result };
    } catch {
      return null;
    }
  }

  getInterval() {
    const base = {
      volatile: 800,
      volume: 400,
      momentum: 2000,
      random: 1500,
      balanced: 3000,
      accumulate: 3000,
      distribute: 3000,
    }[this.mode] || 2000;
    return Math.max(300, base + this.rand(-base * 0.4, base * 0.4));
  }

  async step() {
    if (!this.isRunning) return;
    const prices = this.ammPool.priceHistory.map(h => h.price);
    const rsi = this.calculateRSI(prices, 5);
    const momentum = this.getMomentum();
    const volatility = this.getVolatility();
    const currentPrice = this.ammPool.getCurrentPrice();

    if (this.impulseCooldown > 0) this.impulseCooldown--;

    let trade = null;

    switch (this.mode) {
      case 'volatile': trade = await this.strategyVolatile(rsi, momentum, volatility, currentPrice); break;
      case 'volume': trade = await this.strategyVolume(rsi, momentum, currentPrice); break;
      case 'momentum': trade = await this.strategyMomentum(rsi, momentum, volatility, currentPrice); break;
      case 'random': trade = await this.strategyRandom(rsi, currentPrice); break;
      case 'balanced': trade = await this.strategyBalanced(rsi, momentum); break;
      case 'accumulate': trade = await this.strategyAccumulate(rsi, momentum); break;
      case 'distribute': trade = await this.strategyDistribute(rsi, momentum); break;
    }

    if (trade && this.onBotAction) {
      this.onBotAction({ action: trade.action, rsi, price: currentPrice, trade: trade.result?.trade, block: trade.result?.block });
    }
  }

  async strategyVolatile(rsi, momentum, volatility, price) {
    const isImpulse = Math.random() < 0.12 && this.impulseCooldown <= 0;
    if (isImpulse) {
      this.impulseCooldown = this.randInt(3, 8);
      const impulseSize = this.rand(150, 500);
      const direction = Math.random() < 0.5 ? 'buy' : 'sell';
      const token = direction === 'buy' ? 'USDT' : 'LVAIR';
      return this.executeTrade(direction, impulseSize, token, `IMPULSE ${direction.toUpperCase()} $${impulseSize.toFixed(0)}`);
    }

    let bias = 0.5;
    if (rsi < 25) bias = 0.8;
    else if (rsi > 75) bias = 0.2;
    else if (momentum > 0.01) bias = 0.65;
    else if (momentum < -0.01) bias = 0.35;

    const direction = this.pickDirection(bias);
    const amount = this.rand(20, 150);
    const token = direction === 'buy' ? 'USDT' : 'LVAIR';
    return this.executeTrade(direction, amount, token, `VOLATILE RSI:${rsi.toFixed(0)} MOM:${momentum.toFixed(3)}`);
  }

  async strategyVolume(rsi, momentum, price) {
    const burstSize = this.randInt(3, 8);
    const trades = [];
    for (let i = 0; i < burstSize; i++) {
      let bias = 0.5;
      if (rsi < 30) bias = 0.7;
      else if (rsi > 70) bias = 0.3;
      else bias = 0.5 + momentum * 2;

      const direction = this.pickDirection(bias);
      const amount = this.rand(2, 15);
      const token = direction === 'buy' ? 'USDT' : 'LVAIR';
      const trade = await this.executeTrade(direction, amount, token, `VOLUME BURST ${i + 1}/${burstSize}`);
      if (trade) trades.push(trade);
    }
    return trades.length ? trades[trades.length - 1] : null;
  }

  async strategyMomentum(rsi, momentum, volatility, price) {
    let direction;
    if (Math.abs(momentum) > 0.005) {
      direction = momentum > 0 ? 'buy' : 'sell';
    } else {
      direction = this.pickDirection(0.5);
    }

    const isImpulse = Math.random() < 0.08 && this.impulseCooldown <= 0;
    if (isImpulse) {
      this.impulseCooldown = this.randInt(5, 12);
      const impulseSize = this.rand(100, 300);
      const token = direction === 'buy' ? 'USDT' : 'LVAIR';
      return this.executeTrade(direction, impulseSize, token, `MOMENTUM IMPULSE ${direction.toUpperCase()}`);
    }

    const amount = this.rand(10, 80);
    const token = direction === 'buy' ? 'USDT' : 'LVAIR';
    return this.executeTrade(direction, amount, token, `MOMENTUM RSI:${rsi.toFixed(0)} MOM:${momentum.toFixed(3)}`);
  }

  async strategyRandom(rsi, price) {
    const isSpike = Math.random() < 0.06 && this.impulseCooldown <= 0;
    if (isSpike) {
      this.impulseCooldown = this.randInt(4, 10);
      const spikeSize = this.rand(200, 600);
      const direction = this.pickDirection(0.5);
      const token = direction === 'buy' ? 'USDT' : 'LVAIR';
      return this.executeTrade(direction, spikeSize, token, `SPIKE ${direction.toUpperCase()} $${spikeSize.toFixed(0)}`);
    }

    const direction = this.pickDirection(0.5);
    const amount = this.rand(5, 100);
    const token = direction === 'buy' ? 'USDT' : 'LVAIR';
    return this.executeTrade(direction, amount, token, `RANDOM RSI:${rsi.toFixed(0)}`);
  }

  async strategyBalanced(rsi, momentum) {
    let bias = 0.5;
    if (rsi < 35) bias = 0.75;
    else if (rsi > 65) bias = 0.25;
    else bias = 0.5 + momentum;

    const direction = this.pickDirection(bias);
    const amount = direction === 'buy' ? this.rand(5, 20) : this.rand(10, 40);
    const token = direction === 'buy' ? 'USDT' : 'LVAIR';
    return this.executeTrade(direction, amount, token, `BALANCED RSI:${rsi.toFixed(0)}`);
  }

  async strategyAccumulate(rsi, momentum) {
    const bias = 0.8;
    const direction = this.pickDirection(bias);
    const amount = direction === 'buy' ? this.rand(5, 25) : this.rand(10, 30);
    const token = direction === 'buy' ? 'USDT' : 'LVAIR';
    return this.executeTrade(direction, amount, token, `ACCUMULATE RSI:${rsi.toFixed(0)}`);
  }

  async strategyDistribute(rsi, momentum) {
    const bias = 0.2;
    const direction = this.pickDirection(bias);
    const amount = direction === 'buy' ? this.rand(5, 20) : this.rand(15, 50);
    const token = direction === 'buy' ? 'USDT' : 'LVAIR';
    return this.executeTrade(direction, amount, token, `DISTRIBUTE RSI:${rsi.toFixed(0)}`);
  }

  start(intervalMs = 2000, onBotAction = null) {
    if (this.isRunning) return;
    this.isRunning = true;
    this.onBotAction = onBotAction;

    const loop = async () => {
      if (!this.isRunning) return;
      await this.step();
      this.timer = setTimeout(loop, this.getInterval());
    };
    loop();
  }

  stop() {
    this.isRunning = false;
    if (this.timer) clearTimeout(this.timer);
  }
}
