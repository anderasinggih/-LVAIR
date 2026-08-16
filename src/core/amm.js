import { Transaction } from './block.js';

export class AMMPool {
  constructor(blockchain, initialLvairReserve = 100000, initialUsdtReserve = 25000) {
    this.blockchain = blockchain;
    this.poolAddress = blockchain.poolAddress;
    this.lvairReserve = initialLvairReserve;
    this.usdtReserve = initialUsdtReserve;
    this.feeRate = 0.003; // 0.3% LP fee
    this.priceHistory = [];
    this.trades = [];

    this.recordPricePoint();
  }

  // Backwards-compat getters so main.js can still reference .airReserve
  get airReserve() { return this.lvairReserve; }
  set airReserve(v) { this.lvairReserve = v; }

  getCurrentPrice() {
    return this.usdtReserve / this.lvairReserve;
  }

  recordPricePoint() {
    this.priceHistory.push({
      timestamp: Date.now(),
      price: this.getCurrentPrice(),
      lvairReserve: this.lvairReserve,
      usdtReserve: this.usdtReserve,
    });
    if (this.priceHistory.length > 100) this.priceHistory.shift();
  }

  getQuote(inputAmount, inputToken) {
    const amount = Number(inputAmount);
    if (amount <= 0) return { outputAmount: 0, priceImpact: 0, executionPrice: 0 };

    const isLvairToUsdt = inputToken === 'LVAIR';
    const reserveIn  = isLvairToUsdt ? this.lvairReserve : this.usdtReserve;
    const reserveOut = isLvairToUsdt ? this.usdtReserve  : this.lvairReserve;

    const amountInWithFee = amount * (1 - this.feeRate);
    const numerator = amountInWithFee * reserveOut;
    const denominator = reserveIn + amountInWithFee;
    const outputAmount = numerator / denominator;

    const currentPrice = this.getCurrentPrice();
    const effectivePrice = isLvairToUsdt
      ? outputAmount / amount
      : amount / outputAmount;
    const priceImpact = Math.abs((effectivePrice - currentPrice) / currentPrice) * 100;

    return {
      outputAmount,
      outputToken: isLvairToUsdt ? 'USDT' : 'LVAIR',
      priceImpact: Number(priceImpact.toFixed(2)),
      executionPrice: Number(effectivePrice.toFixed(4)),
    };
  }

  async executeSwap(userAddress, inputAmount, inputToken) {
    const quote = this.getQuote(inputAmount, inputToken);
    if (quote.outputAmount <= 0) {
      throw new Error('Invalid swap output — pool reserves may be depleted');
    }

    const isLvairToUsdt = inputToken === 'LVAIR';

    const inTx = new Transaction(
      userAddress,
      this.poolAddress,
      inputAmount,
      inputToken,
      'SWAP_IN',
      { quoteRate: quote.executionPrice }
    );
    inTx.txHash = await inTx.calculateHash();
    await this.blockchain.addTransaction(inTx);

    const outTx = new Transaction(
      this.poolAddress,
      userAddress,
      quote.outputAmount,
      quote.outputToken,
      'SWAP_OUT',
      { received: quote.outputAmount, priceImpact: `${quote.priceImpact}%` }
    );
    outTx.txHash = await outTx.calculateHash();
    await this.blockchain.addTransaction(outTx);

    if (isLvairToUsdt) {
      this.lvairReserve += Number(inputAmount);
      this.usdtReserve  -= quote.outputAmount;
    } else {
      this.usdtReserve  += Number(inputAmount);
      this.lvairReserve -= quote.outputAmount;
    }

    const block = await this.blockchain.minePendingTransactions(userAddress);

    this.recordPricePoint();
    const tradeEntry = {
      id: inTx.txHash || `0x${Date.now()}`,
      timestamp: Date.now(),
      user: userAddress,
      traderAddress: userAddress,
      type: isLvairToUsdt ? 'SELL_LVAIR' : 'BUY_LVAIR',
      inputAmount: Number(inputAmount),
      inputToken,
      outputAmount: Number(quote.outputAmount.toFixed(4)),
      outputToken: quote.outputToken,
      price: this.getCurrentPrice(),
      effectivePrice: Number(quote.executionPrice.toFixed(4)),
      blockIndex: block.index,
    };
    this.trades.unshift(tradeEntry);

    return { trade: tradeEntry, newPrice: this.getCurrentPrice(), block };
  }
}
