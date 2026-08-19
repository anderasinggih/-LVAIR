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
      settings: { defaultTpPct: 0, defaultSlPct: 0 },
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
    const leverage = position.leverage;
    const margin = position.margin;

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

  calculateTpSlPrices(position, tpPct, slPct) {
    const entry = position.entryPrice;
    const leverage = position.leverage;
    const isLong = position.side === 'long';

    let tpPrice = 0, slPrice = 0;
    if (tpPct > 0) {
      tpPrice = isLong
        ? entry * (1 + (tpPct / 100) / leverage)
        : entry * (1 - (tpPct / 100) / leverage);
    }
    if (slPct > 0) {
      slPrice = isLong
        ? entry * (1 - (slPct / 100) / leverage)
        : entry * (1 + (slPct / 100) / leverage);
    }
    return { tpPrice, slPrice };
  }

  async openPosition(address, side, marginAmount, leverage, tpPct = 0, slPct = 0) {
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
      tpPct: Math.max(0, Number(tpPct) || 0),
      slPct: Math.max(0, Number(slPct) || 0),
      tpPrice: 0,
      slPrice: 0,
      liquidationPrice: 0,
      pnl: 0,
      openedAt: Date.now(),
      status: 'open'
    };
    position.liquidationPrice = this.calculateLiquidationPrice(position);

    if (position.tpPct > 0 || position.slPct > 0) {
      const { tpPrice, slPrice } = this.calculateTpSlPrices(position, position.tpPct, position.slPct);
      position.tpPrice = tpPrice;
      position.slPrice = slPrice;
    }

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

  async closeAllPositions(address) {
    await this._loading;
    const addr = address.toLowerCase();
    const acc = this.accounts.get(addr);
    if (!acc) throw new Error('Demo account not found');

    const price = this.getCurrentPrice();
    if (!price || price <= 0) throw new Error('Price not available');

    const openPositions = acc.positions.filter(p => p.status === 'open');
    if (!openPositions.length) return { positions: [], balance: acc.balance };

    const closed = [];
    for (const pos of openPositions) {
      const pnl = this.calculatePnL(pos, price);
      const closeFee = pos.margin * FEE_RATE;
      const totalPnl = pnl - closeFee;

      pos.status = 'closed';
      pos.closePrice = price;
      pos.closedAt = Date.now();
      pos.pnl = totalPnl;

      acc.balance += pos.margin + totalPnl;

      acc.history.unshift({
        id: pos.id, side: pos.side, entryPrice: pos.entryPrice,
        closePrice: price, leverage: pos.leverage, margin: pos.margin,
        pnl: totalPnl, fee: pos.fee + closeFee,
        openedAt: pos.openedAt, closedAt: pos.closedAt
      });
      closed.push({ id: pos.id, pnl: totalPnl });
    }
    if (acc.history.length > 200) acc.history = acc.history.slice(0, 200);
    acc.positions = acc.positions.filter(p => p.status !== 'closed');
    await this._saveAll();
    return { positions: closed, balance: acc.balance };
  }

  async updatePositionTpSl(address, positionId, tpPct, slPct, tpPrice, slPrice) {
    await this._loading;
    const addr = address.toLowerCase();
    const acc = this.accounts.get(addr);
    if (!acc) throw new Error('Demo account not found');

    const pos = acc.positions.find(p => p.id === positionId && p.status === 'open');
    if (!pos) throw new Error('Position not found');

    const entry = pos.entryPrice;
    const leverage = pos.leverage;
    const isLong = pos.side === 'long';

    if (tpPrice !== undefined && tpPrice !== null && Number(tpPrice) > 0) {
      const tp = Number(tpPrice);
      pos.tpPct = Math.abs((isLong ? (tp - entry) : (entry - tp)) / (entry / leverage)) * 100;
    } else {
      pos.tpPct = Math.max(0, Number(tpPct) || 0);
    }
    if (slPrice !== undefined && slPrice !== null && Number(slPrice) > 0) {
      const sl = Number(slPrice);
      pos.slPct = Math.abs((isLong ? (entry - sl) : (sl - entry)) / (entry / leverage)) * 100;
    } else {
      pos.slPct = Math.max(0, Number(slPct) || 0);
    }

    const { tpPrice: calculatedTp, slPrice: calculatedSl } = this.calculateTpSlPrices(pos, pos.tpPct, pos.slPct);
    pos.tpPrice = calculatedTp;
    pos.slPrice = calculatedSl;

    await this._saveAll();
    return pos;
  }

  async updateSettings(address, settings) {
    await this._loading;
    const addr = address.toLowerCase();
    const acc = this.accounts.get(addr);
    if (!acc) throw new Error('Demo account not found');
    if (!acc.settings) acc.settings = { defaultTpPct: 0, defaultSlPct: 0 };
    if (settings.defaultTpPct !== undefined) acc.settings.defaultTpPct = Math.max(0, Number(settings.defaultTpPct) || 0);
    if (settings.defaultSlPct !== undefined) acc.settings.defaultSlPct = Math.max(0, Number(settings.defaultSlPct) || 0);
    await this._saveAll();
    return acc.settings;
  }

  async checkLiquidations() {
    const price = this.getCurrentPrice();
    if (!price) return [];
    const events = [];

    for (const [addr, acc] of this.accounts) {
      const openPositions = acc.positions.filter(p => p.status === 'open');
      for (const pos of openPositions) {
        let closed = false;
        let closeType = '';
        let closePnl = 0;

        if (pos.tpPrice > 0) {
          if (pos.side === 'long' && price >= pos.tpPrice) { closed = true; closeType = 'take_profit'; }
          if (pos.side === 'short' && price <= pos.tpPrice) { closed = true; closeType = 'take_profit'; }
        }
        if (!closed && pos.slPrice > 0) {
          if (pos.side === 'long' && price <= pos.slPrice) { closed = true; closeType = 'stop_loss'; }
          if (pos.side === 'short' && price >= pos.slPrice) { closed = true; closeType = 'stop_loss'; }
        }

        if (!closed) {
          const liq = this.calculateLiquidationPrice(pos);
          if (pos.side === 'long' && price <= liq) { closed = true; closeType = 'liquidation'; }
          if (pos.side === 'short' && price >= liq) { closed = true; closeType = 'liquidation'; }
        }

        if (closed) {
          const pnl = this.calculatePnL(pos, price);
          const closeFee = pos.margin * FEE_RATE;
          const totalPnl = closeType === 'liquidation' ? -(pos.margin) : (pnl - closeFee);

          pos.status = closeType === 'liquidation' ? 'liquidated' : 'closed';
          pos.closePrice = price;
          pos.closedAt = Date.now();
          pos.pnl = totalPnl;
          pos.closeType = closeType;

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
            closedAt: pos.closedAt,
            type: closeType
          });

          acc.positions = acc.positions.filter(p => p.id !== pos.id);
          events.push({ address: addr, positionId: pos.id, type: closeType, pnl: totalPnl });
        }
      }
    }
    if (events.length) await this._saveAll();
    return events;
  }

  async resetAccount(address) {
    await this._loading;
    const addr = address.toLowerCase();
    const acc = {
      address: addr,
      balance: DEMO_INITIAL_BALANCE,
      positions: [],
      history: [],
      settings: { defaultTpPct: 0, defaultSlPct: 0 },
      createdAt: Date.now()
    };
    this.accounts.set(addr, acc);
    await this._saveAll();
    return acc;
  }
}
