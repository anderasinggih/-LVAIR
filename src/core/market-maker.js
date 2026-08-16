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
    this.mode = 'human';
    this.tradeCount = 0;
    this.lastPrice = 0;
    this.trendDirection = 0;
    this.impulseCooldown = 0;

    this.human = {
      phase: 'accumulation',
      phaseTimer: 0,
      phaseDuration: this.randInt(20, 40),
      support: 0.2,
      resistance: 0.3,
      trendDir: 1,
      ma: 0.25,
      maLen: 0,
      targetPrice: 0.25,
      breakoutDir: 0,
      panicLevel: 0,
      fomoActive: false,
    };
  }

  static MODES = ['human', 'volatile', 'volume', 'momentum', 'random', 'balanced', 'accumulate', 'distribute'];

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
      human: 1500,
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
      case 'human': trade = await this.strategyHuman(rsi, momentum, volatility, currentPrice); break;
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

  async strategyHuman(rsi, momentum, volatility, price) {
    const h = this.human;
    h.phaseTimer++;
    h.maLen++;
    h.ma = h.ma + (price - h.ma) / h.maLen;

    if (h.phaseTimer >= h.phaseDuration) {
      this.humanAdvancePhase(price);
    }

    switch (h.phase) {
      case 'accumulation': return this.humanAccumulation(price, rsi);
      case 'markup': return this.humanMarkup(price, rsi, momentum);
      case 'distribution': return this.humanDistribution(price, rsi);
      case 'markdown': return this.humanMarkdown(price, rsi, momentum);
      case 'breakout': return this.humanBreakout(price, rsi);
      case 'panic': return this.humanPanic(price, rsi);
      case 'fomo': return this.humanFomo(price, rsi);
    }
  }

  humanAdvancePhase(price) {
    const h = this.human;
    h.phaseTimer = 0;

    const range = h.resistance - h.support;
    const mid = (h.support + h.resistance) / 2;

    switch (h.phase) {
      case 'accumulation':
        h.phase = 'markup';
        h.phaseDuration = this.randInt(25, 50);
        h.trendDir = 1;
        h.targetPrice = h.resistance + range * 0.3;
        break;
      case 'markup':
        if (Math.random() < 0.15 && price > h.resistance) {
          h.phase = 'fomo';
          h.phaseDuration = this.randInt(8, 15);
          h.fomoActive = true;
        } else {
          h.phase = 'distribution';
          h.phaseDuration = this.randInt(20, 40);
          h.trendDir = 0;
          h.support = price - range * 0.2;
          h.resistance = price + range * 0.15;
          h.targetPrice = price;
        }
        break;
      case 'distribution':
        h.phase = 'markdown';
        h.phaseDuration = this.randInt(25, 50);
        h.trendDir = -1;
        h.targetPrice = h.support - range * 0.3;
        h.resistance = price + range * 0.1;
        break;
      case 'markdown':
        if (Math.random() < 0.12 && price < h.support) {
          h.phase = 'panic';
          h.phaseDuration = this.randInt(6, 12);
          h.panicLevel = 3;
        } else {
          h.phase = 'accumulation';
          h.phaseDuration = this.randInt(20, 40);
          h.trendDir = 0;
          h.support = price - range * 0.15;
          h.resistance = price + range * 0.2;
          h.targetPrice = price;
        }
        break;
      case 'breakout':
        h.phase = h.breakoutDir > 0 ? 'markup' : 'markdown';
        h.phaseDuration = this.randInt(20, 40);
        h.trendDir = h.breakoutDir;
        h.targetPrice = price + h.breakoutDir * range * 0.5;
        break;
      case 'panic':
        h.phase = 'accumulation';
        h.phaseDuration = this.randInt(25, 45);
        h.trendDir = 0;
        h.support = price - range * 0.1;
        h.resistance = price + range * 0.25;
        h.targetPrice = price;
        h.panicLevel = 0;
        break;
      case 'fomo':
        h.phase = 'distribution';
        h.phaseDuration = this.randInt(15, 30);
        h.trendDir = 0;
        h.resistance = price + range * 0.1;
        h.support = price - range * 0.2;
        h.targetPrice = price;
        h.fomoActive = false;
        break;
    }
  }

  async humanAccumulation(price, rsi) {
    const h = this.human;
    const nearSupport = price <= h.support * 1.02;
    const bias = nearSupport ? 0.75 : 0.55;
    const direction = this.pickDirection(bias);
    const amount = direction === 'buy'
      ? this.rand(8, 30)
      : this.rand(3, 12);
    const token = direction === 'buy' ? 'USDT' : 'LVAIR';
    const reason = `ACCUM near support $${h.support.toFixed(4)}`;
    if (nearSupport && Math.random() < 0.08) {
      h.phase = 'breakout';
      h.phaseDuration = this.randInt(4, 8);
      h.breakoutDir = 1;
    }
    return this.executeTrade(direction, amount, token, reason);
  }

  async humanMarkup(price, rsi, momentum) {
    const h = this.human;
    const aboveMA = price > h.ma;
    const bias = aboveMA ? 0.65 : 0.55;
    const isPullback = price > h.resistance && Math.random() < 0.4;
    if (isPullback) {
      const amount = this.rand(15, 60);
      return this.executeTrade('sell', amount, 'LVAIR', `PROFIT TAKE @ resistance $${h.resistance.toFixed(4)}`);
    }
    const direction = this.pickDirection(bias);
    const amount = direction === 'buy'
      ? this.rand(10, 40)
      : this.rand(5, 20);
    const token = direction === 'buy' ? 'USDT' : 'LVAIR';
    return this.executeTrade(direction, amount, token, `TREND UP RSI:${rsi.toFixed(0)} MOM:${momentum.toFixed(3)}`);
  }

  async humanDistribution(price, rsi) {
    const h = this.human;
    const nearResistance = price >= h.resistance * 0.98;
    const bias = nearResistance ? 0.3 : 0.45;
    const direction = this.pickDirection(bias);
    const amount = direction === 'buy'
      ? this.rand(3, 12)
      : this.rand(10, 40);
    const token = direction === 'buy' ? 'USDT' : 'LVAIR';
    const reason = `DISTRIBUTE near resistance $${h.resistance.toFixed(4)}`;
    if (nearResistance && Math.random() < 0.08) {
      h.phase = 'breakout';
      h.phaseDuration = this.randInt(4, 8);
      h.breakoutDir = -1;
    }
    return this.executeTrade(direction, amount, token, reason);
  }

  async humanMarkdown(price, rsi, momentum) {
    const h = this.human;
    const belowMA = price < h.ma;
    const bias = belowMA ? 0.35 : 0.45;
    const isBounce = price < h.support && Math.random() < 0.35;
    if (isBounce) {
      const amount = this.rand(10, 40);
      return this.executeTrade('buy', amount, 'USDT', `DIP BUY @ support $${h.support.toFixed(4)}`);
    }
    const direction = this.pickDirection(bias);
    const amount = direction === 'buy'
      ? this.rand(5, 20)
      : this.rand(10, 40);
    const token = direction === 'buy' ? 'USDT' : 'LVAIR';
    return this.executeTrade(direction, amount, token, `TREND DOWN RSI:${rsi.toFixed(0)} MOM:${momentum.toFixed(3)}`);
  }

  async humanBreakout(price, rsi) {
    const h = this.human;
    const size = this.rand(40, 120);
    const token = h.breakoutDir > 0 ? 'USDT' : 'LVAIR';
    const direction = h.breakoutDir > 0 ? 'buy' : 'sell';
    return this.executeTrade(direction, size, token, `BREAKOUT ${h.breakoutDir > 0 ? 'UP' : 'DOWN'} RSI:${rsi.toFixed(0)}`);
  }

  async humanPanic(price, rsi) {
    const h = this.human;
    h.panicLevel = Math.max(0, h.panicLevel - 1);
    const size = this.rand(30, 100 + h.panicLevel * 30);
    return this.executeTrade('sell', size, 'LVAIR', `PANIC SELL level:${h.panicLevel} RSI:${rsi.toFixed(0)}`);
  }

  async humanFomo(price, rsi) {
    const size = this.rand(25, 80);
    return this.executeTrade('buy', size, 'USDT', `FOMO BUY RSI:${rsi.toFixed(0)} parabolic`);
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
