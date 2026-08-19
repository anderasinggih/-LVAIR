import crypto from 'node:crypto';

const DEMO_INITIAL_BALANCE = 10000;
const MAX_LEVERAGE = 2000;
const FEE_RATE = 0.001;

export class DemoTradingEngine {
  constructor(storage, ammPool) {
    this.storage = storage;
    this.ammPool = ammPool;
    this.accounts = new Map();
    this._loading = this._loadAll();
  }

  async _loadAll() {
    try {
      const raw = await this.storage.getState('demo:accounts');
      if (raw && typeof raw === 'object') {
        for (const [addr, acc] of Object.entries(raw)) {
          this.accounts.set(addr, acc);
        }
      }
    } catch (e) { /* fresh */ }
  }

  async _saveAll() {
    const obj = {};
    for (const [k, v] of this.accounts) obj[k] = v;
    await this.storage.putState('demo:accounts', obj);
  }

  async getOrCreate(address) {
    await this._loading;
    const addr = address.toLowerCase();
    if (this.accounts.has(addr)) return this.accounts.get(addr);
    const acc = {
      address: addr,
      balance: DEMO_INITIAL_BALANCE,
      positions: [],
      history: [],
      createdAt: Date.now()
    };
    this.accounts.set(addr, acc);
    await this._saveAll();
    return acc;
  }

  async getAccount(address) {
    await this._loading;
    const addr = address.toLowerCase();
    return this.accounts.get(addr) || null;
  }

  getCurrentPrice() {
    return this.ammPool ? this.ammPool.getCurrentPrice() : 0;
  }

  calculatePnL(position, currentPrice) {
    if (!position || !currentPrice) return 0;
    const entry = position.entryPrice;
    const size = position.size;
    const leverage = position.leverage;
    const margin = Math.abs(size) * entry / leverage;

    if (position.side === 'long') {
      return (currentPrice - entry) / entry * margin * leverage;
    } else {
      return (entry - currentPrice) / entry * margin * leverage;
    }
  }

  calculateLiquidationPrice(position) {
    if (!position) return 0;
    const entry = position.entryPrice;
    const leverage = position.leverage;
    const maintMargin = 0.005;

    if (position.side === 'long') {
      return entry * (1 - (1 / leverage) + maintMargin);
    } else {
      return entry * (1 + (1 / leverage) - maintMargin);
    }
  }

  async openPosition(address, side, marginAmount, leverage) {
    await this._loading;
    const addr = address.toLowerCase();
    const acc = this.accounts.get(addr);
    if (!acc) throw new Error('Demo account not found');
    if (leverage < 1 || leverage > MAX_LEVERAGE) throw new Error(`Leverage must be 1-${MAX_LEVERAGE}x`);
    if (marginAmount <= 0) throw new Error('Invalid margin amount');
    if (marginAmount > acc.balance) throw new Error('Insufficient balance');
    if (!['long', 'short'].includes(side)) throw new Error('Side must be long or short');

    const price = this.getCurrentPrice();
    if (!price || price <= 0) throw new Error('Price not available');

    const fee = marginAmount * FEE_RATE;
    const positionSize = marginAmount * leverage;
    const qty = positionSize / price;

    const position = {
      id: crypto.randomUUID(),
      side,
      entryPrice: price,
      leverage,
      margin: marginAmount,
      size: positionSize,
      qty,
      fee,
      liquidationPrice: 0,
      pnl: 0,
      openedAt: Date.now(),
      status: 'open'
    };
    position.liquidationPrice = this.calculateLiquidationPrice(position);

    acc.balance -= (marginAmount + fee);
    acc.positions.push(position);

    await this._saveAll();
    return { position, balance: acc.balance, fee };
  }

  async closePosition(address, positionId) {
    await this._loading;
    const addr = address.toLowerCase();
    const acc = this.accounts.get(addr);
    if (!acc) throw new Error('Demo account not found');

    const pos = acc.positions.find(p => p.id === positionId && p.status === 'open');
    if (!pos) throw new Error('Position not found or already closed');

    const price = this.getCurrentPrice();
    if (!price || price <= 0) throw new Error('Price not available');

    const pnl = this.calculatePnL(pos, price);
    const closeFee = pos.margin * FEE_RATE;
    const totalPnl = pnl - closeFee;

    pos.status = 'closed';
    pos.closePrice = price;
    pos.closedAt = Date.now();
    pos.pnl = totalPnl;

    acc.balance += pos.margin + totalPnl;

    acc.history.unshift({
      id: pos.id,
      side: pos.side,
      entryPrice: pos.entryPrice,
      closePrice: price,
      leverage: pos.leverage,
      margin: pos.margin,
      pnl: totalPnl,
      fee: pos.fee + closeFee,
      openedAt: pos.openedAt,
      closedAt: pos.closedAt
    });
    if (acc.history.length > 200) acc.history = acc.history.slice(0, 200);

    acc.positions = acc.positions.filter(p => p.id !== positionId);
    await this._saveAll();
    return { pnl: totalPnl, balance: acc.balance, closePrice: price };
  }

  async checkLiquidations() {
    const price = this.getCurrentPrice();
    if (!price) return [];
    const liquidated = [];

    for (const [addr, acc] of this.accounts) {
      const openPositions = acc.positions.filter(p => p.status === 'open');
      for (const pos of openPositions) {
        const liq = this.calculateLiquidationPrice(pos);
        let shouldLiquidate = false;
        if (pos.side === 'long' && price <= liq) shouldLiquidate = true;
        if (pos.side === 'short' && price >= liq) shouldLiquidate = true;

        if (shouldLiquidate) {
          const pnl = this.calculatePnL(pos, price);
          const closeFee = pos.margin * FEE_RATE;
          pos.status = 'liquidated';
          pos.closePrice = price;
          pos.closedAt = Date.now();
          pos.pnl = -(pos.margin);

          acc.history.unshift({
            id: pos.id,
            side: pos.side,
            entryPrice: pos.entryPrice,
            closePrice: price,
            leverage: pos.leverage,
            margin: pos.margin,
            pnl: -(pos.margin),
            fee: pos.fee + closeFee,
            openedAt: pos.openedAt,
            closedAt: pos.closedAt,
            type: 'liquidation'
          });

          acc.positions = acc.positions.filter(p => p.id !== pos.id);
          liquidated.push({ address: addr, positionId: pos.id, loss: pos.margin });
        }
      }
    }
    if (liquidated.length) await this._saveAll();
    return liquidated;
  }

  async resetAccount(address) {
    await this._loading;
    const addr = address.toLowerCase();
    const acc = {
      address: addr,
      balance: DEMO_INITIAL_BALANCE,
      positions: [],
      history: [],
      createdAt: Date.now()
    };
    this.accounts.set(addr, acc);
    await this._saveAll();
    return acc;
  }
}
