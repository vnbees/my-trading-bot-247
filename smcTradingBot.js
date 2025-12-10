/**
 * Smart Money Concepts (SMC) Trading Bot
 * 
 * Bot sử dụng Gemini AI để phân tích Price Action và phát hiện Liquidity Sweep/Fakeout
 * - Lấy 50 candles từ Binance
 * - Gửi cho Gemini AI phân tích
 * - Validate logic trước khi vào lệnh
 * - Thực hiện giao dịch (mock/real)
 */

require('dotenv').config();
const axios = require('axios');
const { GeminiAnalyzer } = require('./geminiAnalyzer');
const { sleep, roundToTick, roundToStep, getDecimalsFromStep } = require('./utils');

// Binance API
const BINANCE_API_URL = 'https://api.binance.com/api/v3/klines';

class SMCTradingBot {
  constructor({ apiClient, geminiApiKey, config }) {
    this.api = apiClient; // Có thể null nếu chỉ mock
    this.analyzer = new GeminiAnalyzer({ apiKey: geminiApiKey });
    
    this.config = {
      symbol: 'BTCUSDT',
      interval: '15m', // 15m hoặc 5m
      capital: 100, // USDT
      leverage: 10,
      riskPercent: 1, // 1% equity risk per trade
      mockBalance: 1000, // Mock balance nếu không có API
      priceTickSize: 0,
      sizeStep: 0,
      ...config,
    };

    this.isRunning = false;
    this.priceTick = this.config.priceTickSize > 0 ? this.config.priceTickSize : null;
    this.sizeStep = this.config.sizeStep > 0 ? this.config.sizeStep : null;
    this.priceDecimals = this.priceTick ? getDecimalsFromStep(this.priceTick) : 4;
    this.lastProcessedCandle = null;
  }

  /**
   * Convert symbol từ Bitget format sang Binance format
   * Ví dụ: BTCUSDT_UMCBL -> BTCUSDT
   */
  convertSymbolForBinance(symbol) {
    // Loại bỏ suffix _UMCBL, _CMCBL, _DMCBL
    return symbol.replace(/_[A-Z]+$/, '').toUpperCase();
  }

  /**
   * Lấy dữ liệu candles từ Binance
   */
  async getBinanceKlines(symbol = 'BTCUSDT', interval = '15m', limit = 50) {
    try {
      // Convert symbol sang format Binance nếu cần
      const binanceSymbol = this.convertSymbolForBinance(symbol);
      console.log(`[BOT] 📊 Lấy dữ liệu từ Binance: ${binanceSymbol} (từ ${symbol}), ${interval}, ${limit} candles`);
      
      const response = await axios.get(BINANCE_API_URL, {
        params: {
          symbol: binanceSymbol,
          interval: interval,
          limit: limit,
        },
      });

      const candles = response.data.map((k) => ({
        time: new Date(k[0]).toISOString(),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
        closeTime: new Date(k[6]).toISOString(),
      }));

      console.log(`[BOT] ✅ Đã lấy ${candles.length} candles`);
      console.log(`[BOT] Candle đầu: ${candles[0].time} (O: ${candles[0].open}, H: ${candles[0].high}, L: ${candles[0].low}, C: ${candles[0].close})`);
      console.log(`[BOT] Candle cuối: ${candles[candles.length - 1].time} (O: ${candles[candles.length - 1].open}, H: ${candles[candles.length - 1].high}, L: ${candles[candles.length - 1].low}, C: ${candles[candles.length - 1].close})`);

      return candles;
    } catch (error) {
      console.error('[BOT] ❌ Lỗi khi lấy dữ liệu từ Binance:', error.message);
      throw error;
    }
  }

  /**
   * Validate logic của signal trước khi vào lệnh
   */
  validateSignal(signal) {
    if (!signal || !signal.action) {
      return { valid: false, reason: 'Signal không hợp lệ' };
    }

    if (signal.action === 'WAIT') {
      return { valid: false, reason: 'AI khuyến nghị chờ đợi' };
    }

    const { action, entry, stopLoss, takeProfit } = signal;

    // Validate LONG signal
    if (action === 'LONG') {
      if (stopLoss >= entry) {
        return {
          valid: false,
          reason: `LONG: StopLoss (${stopLoss}) phải < Entry (${entry})`,
        };
      }
      if (takeProfit <= entry) {
        return {
          valid: false,
          reason: `LONG: TakeProfit (${takeProfit}) phải > Entry (${entry})`,
        };
      }
      return { valid: true };
    }

    // Validate SHORT signal
    if (action === 'SHORT') {
      if (stopLoss <= entry) {
        return {
          valid: false,
          reason: `SHORT: StopLoss (${stopLoss}) phải > Entry (${entry})`,
        };
      }
      if (takeProfit >= entry) {
        return {
          valid: false,
          reason: `SHORT: TakeProfit (${takeProfit}) phải < Entry (${entry})`,
        };
      }
      return { valid: true };
    }

    return { valid: false, reason: `Action không hợp lệ: ${action}` };
  }

  /**
   * Tính toán lot size dựa trên risk percentage
   */
  calculateLotSize(entry, stopLoss, action, balance) {
    const riskAmount = balance * (this.config.riskPercent / 100);
    let riskDistance;

    if (action === 'LONG') {
      riskDistance = Math.abs(entry - stopLoss);
    } else {
      riskDistance = Math.abs(stopLoss - entry);
    }

    if (riskDistance <= 0) {
      throw new Error('Risk distance phải > 0');
    }

    // Size = Risk Amount / Risk Distance
    const size = riskAmount / riskDistance;

    // Round theo sizeStep nếu có
    if (this.sizeStep) {
      return roundToStep(size, this.sizeStep);
    }

    return Number(size.toFixed(8));
  }

  /**
   * Mock execution - chỉ log trade details
   */
  async mockPlaceOrder(signal) {
    const { action, entry, stopLoss, takeProfit, reason } = signal;

    // Tính risk/reward ratio
    let riskDistance, rewardDistance;
    if (action === 'LONG') {
      riskDistance = entry - stopLoss;
      rewardDistance = takeProfit - entry;
    } else {
      riskDistance = stopLoss - entry;
      rewardDistance = entry - takeProfit;
    }
    const riskRewardRatio = rewardDistance / riskDistance;

    // Tính lot size
    const balance = this.config.mockBalance;
    const lotSize = this.calculateLotSize(entry, stopLoss, action, balance);
    const notional = lotSize * entry;
    const margin = notional / this.config.leverage;

    console.log('\n═══════════════════════════════════════════════════════');
    console.log('📈 MOCK ORDER EXECUTION');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`Symbol: ${this.config.symbol}`);
    console.log(`Action: ${action}`);
    console.log(`Entry: ${entry.toFixed(this.priceDecimals)}`);
    console.log(`StopLoss: ${stopLoss.toFixed(this.priceDecimals)}`);
    console.log(`TakeProfit: ${takeProfit.toFixed(this.priceDecimals)}`);
    console.log(`Reason: ${reason}`);
    console.log(`\nRisk Management:`);
    console.log(`  - Balance: ${balance} USDT`);
    console.log(`  - Risk: ${this.config.riskPercent}% (${(balance * this.config.riskPercent / 100).toFixed(2)} USDT)`);
    console.log(`  - Lot Size: ${lotSize.toFixed(8)}`);
    console.log(`  - Notional: ${notional.toFixed(2)} USDT`);
    console.log(`  - Margin: ${margin.toFixed(2)} USDT (Leverage: ${this.config.leverage}x)`);
    console.log(`  - Risk Distance: ${riskDistance.toFixed(this.priceDecimals)}`);
    console.log(`  - Reward Distance: ${rewardDistance.toFixed(this.priceDecimals)}`);
    console.log(`  - Risk:Reward Ratio: 1:${riskRewardRatio.toFixed(2)}`);
    console.log('═══════════════════════════════════════════════════════\n');
  }

  /**
   * Real execution - đặt lệnh thật qua Bitget API
   */
  async realPlaceOrder(signal) {
    if (!this.api) {
      throw new Error('API client không được cung cấp');
    }

    const { action, entry, stopLoss, takeProfit } = signal;

    // Convert action sang side cho Bitget
    const side = action === 'LONG' ? 'open_long' : 'open_short';

    // Tính lot size
    // TODO: Lấy balance thật từ API
    const balance = this.config.capital || 100;
    const lotSize = this.calculateLotSize(entry, stopLoss, action, balance);

    // Round prices
    const roundedEntry = this.priceTick ? roundToTick(entry, this.priceTick) : entry;
    const roundedSL = this.priceTick ? roundToTick(stopLoss, this.priceTick) : stopLoss;
    const roundedTP = this.priceTick ? roundToTick(takeProfit, this.priceTick) : takeProfit;

    console.log(`[BOT] 📤 Đặt lệnh ${action}...`);
    console.log(`  - Entry: ${roundedEntry}`);
    console.log(`  - Size: ${lotSize}`);
    console.log(`  - SL: ${roundedSL}`);
    console.log(`  - TP: ${roundedTP}`);

    try {
      const result = await this.api.placeOrder({
        symbol: this.config.symbol,
        marginCoin: this.config.marginCoin || 'USDT',
        size: lotSize.toString(),
        side: side,
        orderType: 'market',
        presetStopLossPrice: roundedSL.toString(),
        presetTakeProfitPrice: roundedTP.toString(),
      });

      console.log('[BOT] ✅ Đặt lệnh thành công:', result);
      return result;
    } catch (err) {
      console.error('[BOT] ❌ Lỗi khi đặt lệnh:', err.message);
      throw err;
    }
  }

  /**
   * Chờ đến khi candle mới đóng (chạy cycle)
   */
  async waitForNextCandle() {
    const intervalMs = this.getIntervalMs(this.config.interval);
    const now = new Date();
    const currentMs = now.getTime();
    
    // Tính thời điểm đóng candle tiếp theo
    const nextCandleClose = Math.ceil(currentMs / intervalMs) * intervalMs;
    const waitTime = nextCandleClose - currentMs;

    if (waitTime > 0) {
      const nextCandleTime = new Date(nextCandleClose);
      console.log(`[BOT] ⏳ Chờ đến khi candle đóng: ${nextCandleTime.toLocaleString('vi-VN')} (còn ${(waitTime / 1000 / 60).toFixed(1)} phút)`);
      await sleep(waitTime);
    }
  }

  /**
   * Convert interval string sang milliseconds
   */
  getIntervalMs(interval) {
    const map = {
      '1m': 60 * 1000,
      '3m': 3 * 60 * 1000,
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '30m': 30 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '2h': 2 * 60 * 60 * 1000,
      '4h': 4 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
    };
    return map[interval] || 15 * 60 * 1000; // Default 15m
  }

  /**
   * Thực hiện một cycle phân tích và giao dịch
   */
  async executeCycle() {
    try {
      console.log('\n═══════════════════════════════════════════════════════');
      console.log(`[BOT] 🔄 Bắt đầu cycle mới - ${new Date().toLocaleString('vi-VN')}`);
      console.log('═══════════════════════════════════════════════════════\n');

      // 1. Lấy dữ liệu candles
      const candles = await this.getBinanceKlines(
        this.config.symbol,
        this.config.interval,
        50
      );

      // Kiểm tra xem candle cuối đã được xử lý chưa
      const lastCandle = candles[candles.length - 1];
      if (this.lastProcessedCandle && this.lastProcessedCandle === lastCandle.time) {
        console.log('[BOT] ⏭️  Candle này đã được xử lý, bỏ qua...');
        return;
      }

      // 2. Gửi cho Gemini AI phân tích
      const signal = await this.analyzer.analyze(candles);

      // 3. Validate signal
      const validation = this.validateSignal(signal);
      if (!validation.valid) {
        console.log(`[BOT] ⚠️  Signal không hợp lệ: ${validation.reason}`);
        console.log('[BOT] ⏭️  Bỏ qua cycle này...');
        this.lastProcessedCandle = lastCandle.time;
        return;
      }

      // 4. Execute order
      if (this.api) {
        await this.realPlaceOrder(signal);
      } else {
        await this.mockPlaceOrder(signal);
      }

      this.lastProcessedCandle = lastCandle.time;
      console.log('[BOT] ✅ Cycle hoàn thành\n');
    } catch (err) {
      console.error(`[BOT] ❌ Lỗi trong cycle: ${err.message}`);
      if (err.stack) {
        console.error(err.stack);
      }
      throw err;
    }
  }

  /**
   * Chạy bot
   */
  async run() {
    this.isRunning = true;
    console.log('[BOT] 🚀 Khởi động SMC Trading Bot');
    console.log(`  - Symbol: ${this.config.symbol}`);
    console.log(`  - Interval: ${this.config.interval}`);
    console.log(`  - Capital: ${this.config.capital} USDT`);
    console.log(`  - Leverage: ${this.config.leverage}x`);
    console.log(`  - Risk: ${this.config.riskPercent}% per trade`);
    console.log(`  - Mode: ${this.api ? 'REAL (Bitget API)' : 'MOCK (Console only)'}`);

    // Chờ đến khi candle đóng
    await this.waitForNextCandle();

    while (this.isRunning) {
      try {
        await this.executeCycle();
        // Chờ đến candle tiếp theo
        await this.waitForNextCandle();
      } catch (err) {
        console.error(`[BOT] ❌ Lỗi trong bot loop: ${err.message}`);
        if (err.stack) {
          console.error(err.stack);
        }
        console.log('[BOT] ⏳ Đợi 1 phút trước khi retry...');
        await sleep(60 * 1000);
      }
    }
  }

  /**
   * Dừng bot
   */
  stop() {
    this.isRunning = false;
    console.log('[BOT] 🛑 Đã dừng bot');
  }
}

module.exports = { SMCTradingBot };

