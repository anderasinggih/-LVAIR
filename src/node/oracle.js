const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

const DEFAULT_FEEDS = [
  { id: 'tether', symbol: 'USDT', name: 'Tether' },
];

class PriceOracle {
  constructor() {
    this.prices = {};
    this.lastUpdated = null;
    this.interval = null;
    this.fetching = false;
  }

  start(intervalMs = 60000) {
    if (this.interval) return;
    this.fetchPrices();
    this.interval = setInterval(() => this.fetchPrices(), intervalMs);
    console.log(`[oracle] started, polling every ${intervalMs / 1000}s`);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async fetchPrices() {
    if (this.fetching) return;
    this.fetching = true;
    try {
      const ids = DEFAULT_FEEDS.map(f => f.id).join(',');
      const url = `${COINGECKO_BASE}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      for (const feed of DEFAULT_FEEDS) {
        const d = data[feed.id];
        if (!d) continue;
        this.prices[feed.symbol] = {
          symbol: feed.symbol,
          name: feed.name,
          usd: d.usd,
          change24h: d.usd_24h_change ?? null,
          source: 'coingecko',
        };
      }

      this.lastUpdated = Date.now();
      console.log(`[oracle] prices updated:`, Object.keys(this.prices).map(s => `${s}=$${this.prices[s].usd}`).join(', '));
    } catch (err) {
      console.error(`[oracle] fetch failed:`, err.message);
    } finally {
      this.fetching = false;
    }
  }

  getPrice(symbol) {
    return this.prices[symbol] || null;
  }

  getAllPrices() {
    return { ...this.prices };
  }

  getSnapshot() {
    return {
      prices: this.getAllPrices(),
      lastUpdated: this.lastUpdated,
      feeds: DEFAULT_FEEDS.map(f => ({ id: f.id, symbol: f.symbol })),
    };
  }
}

export const oracle = new PriceOracle();
