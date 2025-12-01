/**
 * Hedge Trading Bot với Gemini AI
 * 
 * Chiến lược:
 * 1. Khi xu hướng không rõ ràng: Luôn có 2 lệnh long/short chạy song song
 *    - Nếu lệnh nào lãi 5% (với leverage 10x) thì đóng và mở lại 2 lệnh mới
 * 2. Khi xu hướng rõ ràng: Đóng lệnh ngược xu hướng, giữ lệnh cùng xu hướng
 * 3. Gemini AI chỉ phân tích và nhận định thị trường (không quyết định vào lệnh)
 * 4. Sử dụng dữ liệu đa khung thời gian từ Binance như PriceActionBot
 */

require('dotenv').config();
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const {
  EMA,
  SMA,
  MACD,
  ADX,
  RSI,
  Stochastic,
  ROC,
  BollingerBands,
  ATR,
  OBV,
} = require('technicalindicators');
const {
  sleep,
  formatNumber,
  roundToTick,
  roundToStep,
  getDecimalsFromStep,
} = require('./utils');

// Google Gemini API Configuration
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || 'AIzaSyBjtsO8MYNq8PMZH8dW_QkeAxL98Jexic0';

if (!GOOGLE_API_KEY || GOOGLE_API_KEY === '') {
  throw new Error('GOOGLE_API_KEY không được tìm thấy. Vui lòng thêm vào file .env hoặc export biến môi trường.');
}

// Binance API
const BINANCE_API_URL = 'https://api.binance.com/api/v3/klines';

// Ngưỡng lợi nhuận để đóng lệnh hedge (5% với leverage 10x)
const PROFIT_THRESHOLD_PERCENT = 5.0;

class HedgeBot {
  constructor({ apiClient, config }) {
    this.api = apiClient;
    this.config = {
      symbol: 'BTCUSDT_UMCBL',
      marginCoin: 'USDT',
      capital: null, // Số tiền muốn vào lệnh (USDT), null = dùng toàn bộ equity
      leverage: 10,
      
      // Technical
      priceTickSize: 0,
      sizeStep: 0,
      
      // Run interval (default 5 phút để check positions thường xuyên)
      runIntervalMs: 5 * 60 * 1000,
      
      ...config,
    };
    this.isRunning = false;
    this.priceTick = this.config.priceTickSize > 0 ? this.config.priceTickSize : null;
    this.sizeStep = this.config.sizeStep > 0 ? this.config.sizeStep : null;
    this.marketInfoLoaded = false;
    this.priceDecimals = this.priceTick ? getDecimalsFromStep(this.priceTick) : 4;
    this.minLotSize = null;
    
    // Position tracking
    this.longPosition = null;
    this.shortPosition = null;
    this.marketTrend = 'unclear'; // 'uptrend', 'downtrend', 'unclear'
    
    // Gemini AI
    this.genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);
    this.geminiModel = null;
  }

  async run() {
    this.isRunning = true;
    console.log('[HEDGE-BOT] 🚀 Khởi động Hedge Trading Bot với Gemini AI');
    const capitalStr = this.config.capital && this.config.capital > 0 
      ? `${this.config.capital} ${this.config.marginCoin}` 
      : 'Auto (toàn bộ equity)';
    console.table({
      'Cặp giao dịch': this.config.symbol,
      'Capital': capitalStr,
      'Leverage': `${this.config.leverage}x`,
      'Chiến lược': 'Hedge Trading (Long + Short)',
      'Lợi nhuận mục tiêu': `${PROFIT_THRESHOLD_PERCENT}%`,
      'AI': 'Gemini (Phân tích xu hướng)',
    });

    await this.prepareMarketMeta();
    await this.initializeGeminiModel();

    // Kiểm tra positions hiện tại
    console.log('[HEDGE-BOT] 🔍 Kiểm tra positions hiện tại...');
    await this.loadCurrentPositions();

    // Main loop
    console.log(`[HEDGE-BOT] ⏰ Bot sẽ check positions mỗi ${this.config.runIntervalMs / 60000} phút\n`);
    
    while (this.isRunning) {
      try {
        await this.executeCycle();
        
        const waitMs = this.config.runIntervalMs;
        const nextRun = new Date(Date.now() + waitMs);
        
        console.log(`\n[HEDGE-BOT] ⏳ Đợi ${waitMs / 60000} phút`);
        console.log(`  Lần chạy tiếp theo: ${nextRun.toLocaleString('vi-VN')}\n`);
        await sleep(waitMs);
      } catch (err) {
        console.error(`[HEDGE-BOT] ❌ Lỗi trong cycle: ${err.message}`);
        if (err.stack) {
          console.error(err.stack);
        }
        console.log('[HEDGE-BOT] ⏳ Đợi 5 phút trước khi retry...');
        await sleep(5 * 60 * 1000);
      }
    }
  }

  /**
   * Khởi tạo Gemini model
   */
  async initializeGeminiModel() {
    try {
      console.log('[HEDGE-BOT] 🤖 Đang khởi tạo Gemini AI...');
      
      const modelsToTry = ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-pro'];
      
      for (const modelName of modelsToTry) {
        try {
          this.geminiModel = this.genAI.getGenerativeModel({ model: modelName });
          const testResult = await this.geminiModel.generateContent('Test');
          console.log(`[HEDGE-BOT] ✅ Đã khởi tạo model: ${modelName}`);
          return;
        } catch (err) {
          console.log(`[HEDGE-BOT] ⚠️ Model ${modelName} không khả dụng, thử model khác...`);
          continue;
        }
      }
      
      throw new Error('Không tìm thấy model Gemini nào khả dụng');
    } catch (err) {
      console.error(`[HEDGE-BOT] ❌ Lỗi khi khởi tạo Gemini: ${err.message}`);
      throw err;
    }
  }

  /**
   * Load positions hiện tại từ API
   */
  async loadCurrentPositions() {
    try {
      const positions = await this.api.getAllPositions('umcbl', this.config.marginCoin);
      
      // Debug: Log positions response
      console.log(`[HEDGE-BOT] 🔍 Positions response:`, JSON.stringify(positions, null, 2));
      
      if (!Array.isArray(positions)) {
        console.log('[HEDGE-BOT] ℹ️ Không có position nào đang mở (không phải array)');
        return;
      }

      // Normalize symbol để so sánh (remove suffix, lowercase)
      const symbolNormalized = this.config.symbol
        .replace('_UMCBL', '')
        .replace('_CMCBL', '')
        .replace('_DMCBL', '')
        .toLowerCase();
      
      console.log(`[HEDGE-BOT] 🔍 Tìm kiếm symbol: ${symbolNormalized} (từ ${this.config.symbol})`);
      
      // Reset positions
      this.longPosition = null;
      this.shortPosition = null;
      
      for (const pos of positions) {
        const posSymbol = (pos.symbol || '').toLowerCase();
        console.log(`[HEDGE-BOT] 🔍 Checking position: ${posSymbol} (holdSide: ${pos.holdSide}, size: ${pos.total || pos.holdSize || pos.size})`);
        
        // So sánh symbol đã normalize
        if (posSymbol !== symbolNormalized) continue;
        
        const size = Number(pos.total || pos.holdSize || pos.size || 0);
        if (size <= 0) continue;
        
        const holdSide = pos.holdSide || pos.side;
        const entryPrice = Number(pos.averageOpenPrice || pos.openPriceAvg || pos.entryPrice || 0);
        
        if (!entryPrice || entryPrice <= 0) continue;
        
        const posData = {
          holdSide,
          entryPrice,
          size,
          leverage: Number(pos.leverage || this.config.leverage),
        };
        
        if (holdSide === 'long') {
          this.longPosition = posData;
          console.log(`[HEDGE-BOT] ✅ Phát hiện LONG position: Entry=${formatNumber(entryPrice)}, Size=${formatNumber(size)}`);
        } else if (holdSide === 'short') {
          this.shortPosition = posData;
          console.log(`[HEDGE-BOT] ✅ Phát hiện SHORT position: Entry=${formatNumber(entryPrice)}, Size=${formatNumber(size)}`);
        }
      }
      
      if (!this.longPosition && !this.shortPosition) {
        console.log('[HEDGE-BOT] ℹ️ Không có position nào đang mở');
      }
    } catch (err) {
      console.warn(`[HEDGE-BOT] ⚠️ Lỗi khi load positions: ${err.message}`);
    }
  }

  /**
   * Chu kỳ chạy chính
   */
  async executeCycle() {
    console.log('\n' + '='.repeat(60));
    console.log(`[HEDGE-BOT] 🔄 Bắt đầu chu kỳ mới - ${new Date().toLocaleString('vi-VN')}`);
    console.log('='.repeat(60));

    // 1. Load positions hiện tại
    await this.loadCurrentPositions();

    // 2. Lấy giá hiện tại
    const currentPrice = await this.getCurrentPrice();
    console.log(`[HEDGE-BOT] 💵 Giá hiện tại: ${formatNumber(currentPrice)}`);

    // 3. ✅ Phân tích xu hướng TRƯỚC (để check profit thông minh)
    await this.analyzeTrendWithGemini();

    // 4. ✅ Kiểm tra lợi nhuận THÔNG MINH (dựa trên xu hướng)
    await this.checkProfitAndCloseIntelligent(currentPrice);

    // 5. Quản lý positions dựa trên xu hướng
    await this.managePositionsBasedOnTrend(currentPrice);

    // 6. Đảm bảo luôn có 2 lệnh hedge nếu xu hướng không rõ
    if (this.marketTrend === 'unclear') {
      await this.ensureHedgePositions(currentPrice);
    }
  }

  /**
   * Lấy giá hiện tại từ Binance (giống PriceActionBot)
   */
  async getCurrentPrice() {
    try {
      const binanceSymbol = this.config.symbol.replace('_UMCBL', '').replace('_CMCBL', '').replace('_DMCBL', '');
      const klines = await this.getBinanceKlines(binanceSymbol, '1m', 1);
      
      if (!klines || klines.length === 0) {
        throw new Error('Không lấy được dữ liệu giá từ Binance');
      }
      
      const price = klines[0].close;
      
      if (!price || price <= 0) {
        throw new Error('Giá từ Binance không hợp lệ');
      }
      
      return price;
    } catch (err) {
      console.error(`[HEDGE-BOT] ❌ Lỗi khi lấy giá: ${err.message}`);
      throw err;
    }
  }

  /**
   * Kiểm tra lợi nhuận THÔNG MINH dựa trên xu hướng
   */
  async checkProfitAndCloseIntelligent(currentPrice) {
    const leverage = this.config.leverage || 10;
    
    console.log('[HEDGE-BOT] 📊 Kiểm tra lợi nhuận (intelligent mode)...');
    console.log(`[HEDGE-BOT] 🎯 Xu hướng hiện tại: ${this.marketTrend.toUpperCase()}`);

    if (this.marketTrend === 'unclear') {
      // Xu hướng không rõ → Áp dụng hedge rule: Đóng lệnh lãi 5% ROI
      console.log('[HEDGE-BOT] ⚖️ Xu hướng unclear → Áp dụng hedge rule (đóng lệnh lãi 5% ROI)');
      await this.checkProfitAndClose(currentPrice);
    } else if (this.marketTrend === 'uptrend') {
      // Xu hướng tăng → Giữ LONG, ĐÓNG SHORT NGAY
      console.log('[HEDGE-BOT] 📈 Xu hướng tăng → Giữ LONG để tối đa hóa lợi nhuận');
      
      if (this.longPosition) {
        const priceChangePercent = ((currentPrice - this.longPosition.entryPrice) / this.longPosition.entryPrice) * 100;
        const roiPercent = priceChangePercent * leverage;
        console.log(`  - LONG: Entry=${formatNumber(this.longPosition.entryPrice)} | Price Δ=${priceChangePercent.toFixed(2)}% | ROI=${roiPercent.toFixed(2)}% → ✅ GIỮ (follow trend)`);
      }
      
      if (this.shortPosition) {
        const priceChangePercent = ((this.shortPosition.entryPrice - currentPrice) / this.shortPosition.entryPrice) * 100;
        const roiPercent = priceChangePercent * leverage;
        console.log(`  - SHORT: Entry=${formatNumber(this.shortPosition.entryPrice)} | Price Δ=${priceChangePercent.toFixed(2)}% | ROI=${roiPercent.toFixed(2)}%`);
        
        // Đóng SHORT ngay khi xu hướng uptrend (không cần đợi lỗ 5%)
        console.log(`[HEDGE-BOT] ❌ SHORT ngược xu hướng tăng → Đóng NGAY để tránh lỗ lớn`);
        await this.closePosition('short');
        this.shortPosition = null;
      }
    } else if (this.marketTrend === 'downtrend') {
      // Xu hướng giảm → Giữ SHORT, ĐÓNG LONG NGAY
      console.log('[HEDGE-BOT] 📉 Xu hướng giảm → Giữ SHORT để tối đa hóa lợi nhuận');
      
      if (this.shortPosition) {
        const priceChangePercent = ((this.shortPosition.entryPrice - currentPrice) / this.shortPosition.entryPrice) * 100;
        const roiPercent = priceChangePercent * leverage;
        console.log(`  - SHORT: Entry=${formatNumber(this.shortPosition.entryPrice)} | Price Δ=${priceChangePercent.toFixed(2)}% | ROI=${roiPercent.toFixed(2)}% → ✅ GIỮ (follow trend)`);
      }
      
      if (this.longPosition) {
        const priceChangePercent = ((currentPrice - this.longPosition.entryPrice) / this.longPosition.entryPrice) * 100;
        const roiPercent = priceChangePercent * leverage;
        console.log(`  - LONG: Entry=${formatNumber(this.longPosition.entryPrice)} | Price Δ=${priceChangePercent.toFixed(2)}% | ROI=${roiPercent.toFixed(2)}%`);
        
        // Đóng LONG ngay khi xu hướng downtrend (không cần đợi lỗ 5%)
        console.log(`[HEDGE-BOT] ❌ LONG ngược xu hướng giảm → Đóng NGAY để tránh lỗ lớn`);
        await this.closePosition('long');
        this.longPosition = null;
      }
    }
  }

  /**
   * Kiểm tra lợi nhuận và đóng lệnh nếu đạt threshold (hedge mode)
   */
  async checkProfitAndClose(currentPrice) {
    const leverage = this.config.leverage || 10;
    
    // Kiểm tra LONG position
    if (this.longPosition) {
      const priceChangePercent = ((currentPrice - this.longPosition.entryPrice) / this.longPosition.entryPrice) * 100;
      const roiPercent = priceChangePercent * leverage; // Tính ROI với leverage
      
      console.log(`  - LONG: Entry=${formatNumber(this.longPosition.entryPrice)} | Price Δ=${priceChangePercent.toFixed(2)}% | ROI=${roiPercent.toFixed(2)}%`);
      
      if (roiPercent >= PROFIT_THRESHOLD_PERCENT) {
        console.log(`[HEDGE-BOT] 🎯 LONG đã lãi ${roiPercent.toFixed(2)}% ROI (Price Δ ${priceChangePercent.toFixed(2)}%) >= ${PROFIT_THRESHOLD_PERCENT}%, đóng lệnh...`);
        await this.closePosition('long');
        this.longPosition = null;
      }
    }

    // Kiểm tra SHORT position
    if (this.shortPosition) {
      const priceChangePercent = ((this.shortPosition.entryPrice - currentPrice) / this.shortPosition.entryPrice) * 100;
      const roiPercent = priceChangePercent * leverage; // Tính ROI với leverage
      
      console.log(`  - SHORT: Entry=${formatNumber(this.shortPosition.entryPrice)} | Price Δ=${priceChangePercent.toFixed(2)}% | ROI=${roiPercent.toFixed(2)}%`);
      
      if (roiPercent >= PROFIT_THRESHOLD_PERCENT) {
        console.log(`[HEDGE-BOT] 🎯 SHORT đã lãi ${roiPercent.toFixed(2)}% ROI (Price Δ ${priceChangePercent.toFixed(2)}%) >= ${PROFIT_THRESHOLD_PERCENT}%, đóng lệnh...`);
        await this.closePosition('short');
        this.shortPosition = null;
      }
    }
  }

  /**
   * Phân tích xu hướng thị trường bằng Gemini AI
   */
  async analyzeTrendWithGemini() {
    try {
      console.log('[HEDGE-BOT] 🤖 Đang phân tích xu hướng bằng Gemini AI...');
      
      // 1. Lấy dữ liệu đa khung thời gian từ Binance
      const binanceSymbol = this.config.symbol.replace('_UMCBL', '');
      
      const [klines5m, klines15m, klines1h, klines4h, klines1d] = await Promise.all([
        this.getBinanceKlines(binanceSymbol, '5m', 288),
        this.getBinanceKlines(binanceSymbol, '15m', 288),
        this.getBinanceKlines(binanceSymbol, '1h', 168),
        this.getBinanceKlines(binanceSymbol, '4h', 90),
        this.getBinanceKlines(binanceSymbol, '1d', 60),
      ]);

      // 2. Tính toán chỉ báo kỹ thuật
      const indicators = await this.calculateAllIndicators({
        '5m': klines5m,
        '15m': klines15m,
        '1h': klines1h,
        '4h': klines4h,
        '1d': klines1d,
      });

      // 3. Phân tích Price Action
      const priceActionAnalysis = this.analyzePriceAction({
        '5m': klines5m,
        '15m': klines15m,
        '1h': klines1h,
        '4h': klines4h,
        '1d': klines1d,
      });

      // 4. Format dữ liệu cho Gemini
      const priceData = this.formatPriceDataForGemini(
        klines5m,
        binanceSymbol,
        indicators,
        priceActionAnalysis
      );

      // 5. Phân tích bằng Gemini
      const analysis = await this.analyzeWithGemini(priceData, binanceSymbol);
      
      if (analysis && analysis.trend) {
        this.marketTrend = analysis.trend;
        console.log(`[HEDGE-BOT] ✅ Xu hướng thị trường: ${this.marketTrend.toUpperCase()}`);
        if (analysis.reason) {
          console.log(`   Lý do: ${analysis.reason}`);
        }
      }
    } catch (err) {
      console.error(`[HEDGE-BOT] ❌ Lỗi khi phân tích xu hướng: ${err.message}`);
      // Giữ nguyên xu hướng cũ nếu có lỗi
    }
  }

  /**
   * Quản lý positions dựa trên xu hướng
   * (Việc đóng lệnh đã được xử lý trong checkProfitAndCloseIntelligent)
   */
  async managePositionsBasedOnTrend(currentPrice) {
    console.log(`[HEDGE-BOT] 📈 Quản lý positions theo xu hướng: ${this.marketTrend.toUpperCase()}`);

    if (this.marketTrend === 'uptrend') {
      // Chỉ mở LONG nếu chưa có (SHORT đã được đóng trong checkProfitAndCloseIntelligent)
      if (!this.longPosition) {
        console.log('[HEDGE-BOT] 📈 Mở LONG position theo xu hướng tăng...');
        await this.openPosition('long', currentPrice);
      } else {
        console.log('[HEDGE-BOT] ✅ Đã có LONG position, tiếp tục hold');
      }
    } else if (this.marketTrend === 'downtrend') {
      // Chỉ mở SHORT nếu chưa có (LONG đã được đóng trong checkProfitAndCloseIntelligent)
      if (!this.shortPosition) {
        console.log('[HEDGE-BOT] 📉 Mở SHORT position theo xu hướng giảm...');
        await this.openPosition('short', currentPrice);
      } else {
        console.log('[HEDGE-BOT] ✅ Đã có SHORT position, tiếp tục hold');
      }
    }
    // Nếu unclear, không làm gì ở đây, sẽ xử lý ở ensureHedgePositions
  }

  /**
   * Đảm bảo luôn có 2 lệnh hedge khi xu hướng không rõ
   */
  async ensureHedgePositions(currentPrice) {
    console.log('[HEDGE-BOT] ⚖️ Xu hướng không rõ, đảm bảo có 2 lệnh hedge...');

    if (!this.longPosition) {
      console.log('[HEDGE-BOT] ➕ Mở LONG position...');
      await this.openPosition('long', currentPrice);
    }

    if (!this.shortPosition) {
      console.log('[HEDGE-BOT] ➕ Mở SHORT position...');
      await this.openPosition('short', currentPrice);
    }

    if (this.longPosition && this.shortPosition) {
      console.log('[HEDGE-BOT] ✅ Đã có đủ 2 lệnh hedge (LONG + SHORT)');
    }
  }

  /**
   * Mở position mới
   */
  async openPosition(side, currentPrice) {
    try {
      await this.configureLeverage();

      const equity = await this.getEquity();
      
      // Nếu có capital setting, chia đôi cho mỗi lệnh hedge
      let capitalPerSide = equity;
      if (this.config.capital && this.config.capital > 0) {
        capitalPerSide = Math.min(this.config.capital / 2, equity);
      } else {
        capitalPerSide = equity / 2; // Chia đôi equity cho 2 lệnh
      }

      const lotSizeResult = this.calculateLotSize(currentPrice, capitalPerSide);

      console.log(`[HEDGE-BOT] 📝 Mở lệnh ${side.toUpperCase()}:`);
      console.log(`  - Entry: ${formatNumber(currentPrice)}`);
      console.log(`  - Size: ${formatNumber(lotSizeResult.size)}`);
      console.log(`  - Capital: ${formatNumber(lotSizeResult.actualCapital || lotSizeResult.capital)} ${this.config.marginCoin}`);

      if (lotSizeResult.capitalTooLow && lotSizeResult.minCapitalRequired) {
        throw new Error(`Capital quá thấp! Cần ít nhất ${formatNumber(lotSizeResult.minCapitalRequired)} ${this.config.marginCoin}`);
      }

      const apiSide = side === 'long' ? 'open_long' : 'open_short';
      await this.api.placeOrder({
        symbol: this.config.symbol,
        marginCoin: this.config.marginCoin,
        size: lotSizeResult.size.toString(),
        side: apiSide,
        orderType: 'market',
      });

      console.log(`[HEDGE-BOT] ✅ Đã mở ${side.toUpperCase()} thành công`);

      // Update position tracking
      const posData = {
        holdSide: side,
        entryPrice: currentPrice,
        size: lotSizeResult.size,
        leverage: this.config.leverage,
      };

      if (side === 'long') {
        this.longPosition = posData;
      } else {
        this.shortPosition = posData;
      }

      await sleep(2000);
    } catch (err) {
      console.error(`[HEDGE-BOT] ❌ Lỗi khi mở ${side}: ${err.message}`);
      throw err;
    }
  }

  /**
   * Đóng position
   */
  async closePosition(side) {
    try {
      const position = side === 'long' ? this.longPosition : this.shortPosition;
      
      if (!position) {
        console.log(`[HEDGE-BOT] ⚠️ Không có ${side} position để đóng`);
        return;
      }

      console.log(`[HEDGE-BOT] 🔴 Đóng ${side.toUpperCase()} position...`);

      await this.api.closePosition({
        symbol: this.config.symbol,
        marginCoin: this.config.marginCoin,
        holdSide: side,
        size: position.size.toString(),
      });

      console.log(`[HEDGE-BOT] ✅ Đã đóng ${side.toUpperCase()} thành công`);
    } catch (err) {
      console.error(`[HEDGE-BOT] ❌ Lỗi khi đóng ${side}: ${err.message}`);
      throw err;
    }
  }

  /**
   * Phân tích Price Action (tương tự PriceActionBot)
   */
  analyzePriceAction(multiTimeframeData) {
    const result = {};
    
    for (const [timeframe, klines] of Object.entries(multiTimeframeData)) {
      if (!klines || klines.length < 10) {
        continue;
      }

      const recent = klines.slice(-50);
      
      const candlestickPatterns = this.detectCandlestickPatterns(recent);
      const swings = this.identifySwingPoints(recent);
      const levels = this.identifySupportResistance(recent);
      const trendStructure = this.analyzeTrendStructure(swings);
      
      result[timeframe] = {
        candlestickPatterns,
        swings,
        levels,
        trendStructure,
      };
    }
    
    return result;
  }

  detectCandlestickPatterns(klines) {
    const patterns = [];
    const recentCandles = klines.slice(-5);
    
    if (recentCandles.length < 2) return patterns;
    
    for (let i = 1; i < recentCandles.length; i++) {
      const prev = recentCandles[i - 1];
      const curr = recentCandles[i];
      
      const prevBody = Math.abs(prev.close - prev.open);
      const currBody = Math.abs(curr.close - curr.open);
      const currRange = curr.high - curr.low;
      
      const prevIsBullish = prev.close > prev.open;
      const currIsBullish = curr.close > curr.open;
      
      const upperWick = curr.high - Math.max(curr.open, curr.close);
      const lowerWick = Math.min(curr.open, curr.close) - curr.low;
      
      if (currBody > 0) {
        if (lowerWick > currBody * 2 && upperWick < currBody * 0.3) {
          patterns.push({ type: 'Hammer', signal: 'Bullish Reversal', strength: 'Medium' });
        }
        if (upperWick > currBody * 2 && lowerWick < currBody * 0.3) {
          patterns.push({ type: 'Shooting Star', signal: 'Bearish Reversal', strength: 'Medium' });
        }
      }
      
      if (currBody < currRange * 0.1) {
        patterns.push({ type: 'Doji', signal: 'Indecision', strength: 'Low' });
      }
      
      if (i >= 1) {
        if (!prevIsBullish && currIsBullish && curr.close > prev.open && curr.open < prev.close) {
          patterns.push({ type: 'Bullish Engulfing', signal: 'Bullish Reversal', strength: 'Strong' });
        }
        if (prevIsBullish && !currIsBullish && curr.close < prev.open && curr.open > prev.close) {
          patterns.push({ type: 'Bearish Engulfing', signal: 'Bearish Reversal', strength: 'Strong' });
        }
      }
    }
    
    return patterns;
  }

  identifySwingPoints(klines) {
    const swingHighs = [];
    const swingLows = [];
    
    if (klines.length < 5) {
      return { highs: swingHighs, lows: swingLows };
    }
    
    for (let i = 2; i < klines.length - 2; i++) {
      const curr = klines[i];
      const left1 = klines[i - 1];
      const left2 = klines[i - 2];
      const right1 = klines[i + 1];
      const right2 = klines[i + 2];
      
      if (curr.high > left1.high && curr.high > left2.high &&
          curr.high > right1.high && curr.high > right2.high) {
        swingHighs.push({ index: i, price: curr.high, time: curr.time });
      }
      
      if (curr.low < left1.low && curr.low < left2.low &&
          curr.low < right1.low && curr.low < right2.low) {
        swingLows.push({ index: i, price: curr.low, time: curr.time });
      }
    }
    
    return { 
      highs: swingHighs.slice(-5),
      lows: swingLows.slice(-5),
    };
  }

  identifySupportResistance(klines) {
    if (klines.length < 10) return { support: [], resistance: [] };
    
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const tolerance = 0.005;
    const levels = [];
    const allPrices = [...highs, ...lows];
    
    for (const price of allPrices) {
      let found = false;
      for (const level of levels) {
        if (Math.abs(price - level.price) / level.price < tolerance) {
          level.touches++;
          found = true;
          break;
        }
      }
      if (!found) {
        levels.push({ price, touches: 1 });
      }
    }
    
    const significantLevels = levels
      .filter(l => l.touches >= 3)
      .sort((a, b) => b.touches - a.touches)
      .slice(0, 10);
    
    const currentPrice = klines[klines.length - 1].close;
    
    const support = significantLevels
      .filter(l => l.price < currentPrice)
      .sort((a, b) => b.price - a.price)
      .slice(0, 3);
    
    const resistance = significantLevels
      .filter(l => l.price > currentPrice)
      .sort((a, b) => a.price - b.price)
      .slice(0, 3);
    
    return { support, resistance };
  }

  analyzeTrendStructure(swings) {
    const { highs, lows } = swings;
    
    if (highs.length < 2 || lows.length < 2) {
      return { trend: 'Unknown', structure: 'Insufficient data' };
    }
    
    const recentHigh1 = highs[highs.length - 1];
    const recentHigh2 = highs[highs.length - 2];
    const recentLow1 = lows[lows.length - 1];
    const recentLow2 = lows[lows.length - 2];
    
    const higherHigh = recentHigh1.price > recentHigh2.price;
    const lowerHigh = recentHigh1.price < recentHigh2.price;
    const higherLow = recentLow1.price > recentLow2.price;
    const lowerLow = recentLow1.price < recentLow2.price;
    
    if (higherHigh && higherLow) {
      return { trend: 'Uptrend', structure: 'Higher Highs & Higher Lows', strength: 'Strong' };
    } else if (lowerHigh && lowerLow) {
      return { trend: 'Downtrend', structure: 'Lower Highs & Lower Lows', strength: 'Strong' };
    } else if (lowerHigh && higherLow) {
      return { trend: 'Consolidation', structure: 'Narrowing Range', strength: 'Medium' };
    } else {
      return { trend: 'Mixed', structure: 'Unclear', strength: 'Weak' };
    }
  }

  async getBinanceKlines(symbol = 'BTCUSDT', interval = '5m', limit = 288) {
    try {
      const response = await axios.get(BINANCE_API_URL, {
        params: { symbol, interval, limit },
      });

      return response.data.map((k) => ({
        time: new Date(k[0]).toISOString(),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
        closeTime: new Date(k[6]).toISOString(),
      }));
    } catch (error) {
      console.error('[HEDGE-BOT] ❌ Lỗi khi lấy dữ liệu từ Binance:', error.message);
      throw error;
    }
  }

  async calculateAllIndicators(multiTimeframeData) {
    const result = {};
    
    for (const [timeframe, klines] of Object.entries(multiTimeframeData)) {
      if (!klines || klines.length < 50) continue;

      const closes = klines.map(k => k.close);
      const highs = klines.map(k => k.high);
      const lows = klines.map(k => k.low);
      const volumes = klines.map(k => k.volume);
      const currentPrice = closes[closes.length - 1];
      
      const ema20 = EMA.calculate({ values: closes, period: 20 });
      const ema50 = EMA.calculate({ values: closes, period: 50 });
      const ema200 = EMA.calculate({ values: closes, period: Math.min(200, closes.length - 1) });
      const rsi = RSI.calculate({ values: closes, period: 14 });
      const atr = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
      const bb = BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 });
      
      result[timeframe] = {
        ema20: ema20?.length > 0 ? ema20[ema20.length - 1].toFixed(this.priceDecimals) : null,
        ema50: ema50?.length > 0 ? ema50[ema50.length - 1].toFixed(this.priceDecimals) : null,
        ema200: ema200?.length > 0 ? ema200[ema200.length - 1].toFixed(this.priceDecimals) : null,
        rsi: rsi?.length > 0 ? rsi[rsi.length - 1].toFixed(2) : null,
        atr: atr?.length > 0 ? atr[atr.length - 1].toFixed(this.priceDecimals) : null,
        atrPercent: atr?.length > 0 ? ((atr[atr.length - 1] / currentPrice) * 100).toFixed(2) : null,
        bb: bb?.length > 0 ? {
          upper: bb[bb.length - 1].upper.toFixed(this.priceDecimals),
          middle: bb[bb.length - 1].middle.toFixed(this.priceDecimals),
          lower: bb[bb.length - 1].lower.toFixed(this.priceDecimals),
        } : null,
      };
    }
    
    return result;
  }

  formatPriceDataForGemini(klines, symbol, indicators = {}, priceActionAnalysis = {}) {
    if (!klines || klines.length === 0) {
      return 'Không có dữ liệu giá.';
    }

    const latest = klines[klines.length - 1];
    const currentPrice = latest.close;
    
    let dataText = `=== PHÂN TÍCH THỊ TRƯỜNG - ${symbol} ===\n\n`;
    dataText += `Giá hiện tại: ${currentPrice.toFixed(this.priceDecimals)} USDT\n`;
    dataText += `Thời gian: ${latest.time}\n\n`;

    const timeframes = ['5m', '15m', '1h', '4h', '1d'];
    for (const tf of timeframes) {
      if (priceActionAnalysis[tf]) {
        const pa = priceActionAnalysis[tf];
        dataText += `\n${'='.repeat(60)}\n`;
        dataText += `KHUNG ${tf.toUpperCase()}\n`;
        dataText += `${'='.repeat(60)}\n`;
        
        dataText += `\n🕯️ MÔ HÌNH NẾN:\n`;
        if (pa.candlestickPatterns?.length > 0) {
          pa.candlestickPatterns.forEach(p => {
            dataText += `  - ${p.type}: ${p.signal} (${p.strength})\n`;
          });
        } else {
          dataText += `  - Không có mô hình đặc biệt\n`;
        }
        
        dataText += `\n📊 CẤU TRÚC THỊ TRƯỜNG:\n`;
        if (pa.trendStructure) {
          dataText += `  - Trend: ${pa.trendStructure.trend}\n`;
          dataText += `  - Structure: ${pa.trendStructure.structure}\n`;
        }
        
        if (indicators[tf]) {
          const ind = indicators[tf];
          dataText += `\n📈 CHỈ BÁO:\n`;
          if (ind.ema20) dataText += `  - EMA(20): ${ind.ema20}\n`;
          if (ind.ema50) dataText += `  - EMA(50): ${ind.ema50}\n`;
          if (ind.rsi) dataText += `  - RSI: ${ind.rsi}\n`;
        }
      }
    }

    dataText += `\n${'='.repeat(60)}\n`;
    dataText += `10 CANDLES GẦN NHẤT (5m)\n`;
    dataText += `${'='.repeat(60)}\n`;
    klines.slice(-10).forEach((c, i) => {
      const type = c.close > c.open ? 'BULL' : c.close < c.open ? 'BEAR' : 'DOJI';
      dataText += `${i + 1}. [${type}] O:${c.open.toFixed(2)} H:${c.high.toFixed(2)} L:${c.low.toFixed(2)} C:${c.close.toFixed(2)}\n`;
    });

    return dataText;
  }

  async analyzeWithGemini(priceData, symbol) {
    const prompt = `
Bạn là chuyên gia phân tích thị trường cryptocurrency.

**DỮ LIỆU THỊ TRƯỜNG:**

${priceData}

**NHIỆM VỤ:**

Phân tích dữ liệu trên và xác định xu hướng thị trường hiện tại.

**XU HƯỚNG CÓ 3 LOẠI:**

1. **"uptrend"** - Xu hướng tăng RÕ RÀNG:
   - Higher Highs và Higher Lows rõ nét
   - Giá trên EMA 50/200
   - Momentum tăng mạnh
   - Breakout các resistance quan trọng

2. **"downtrend"** - Xu hướng giảm RÕ RÀNG:
   - Lower Highs và Lower Lows rõ nét
   - Giá dưới EMA 50/200
   - Momentum giảm mạnh
   - Breakdown các support quan trọng

3. **"unclear"** - Xu hướng KHÔNG RÕ RÀNG (Mặc định):
   - Sideways/consolidation
   - Mixed signals
   - Cấu trúc không rõ ràng
   - Không có breakout/breakdown mạnh

**NGUYÊN TẮC QUAN TRỌNG:**

- Chỉ chọn uptrend/downtrend khi xu hướng THỰC SỰ RÕ RÀNG và MẠNH
- Khi có nghi ngờ → chọn "unclear"
- Cần nhiều xác nhận từ đa khung thời gian
- Ưu tiên an toàn hơn là aggressive

**OUTPUT (JSON only, no markdown):**

{
  "trend": "uptrend" hoặc "downtrend" hoặc "unclear",
  "reason": "Giải thích chi tiết về xu hướng (cấu trúc thị trường, price action, indicators)",
  "confidence": "high" hoặc "medium" hoặc "low"
}

Chỉ trả về JSON, KHÔNG có text hay markdown khác!
`;

    try {
      const result = await this.geminiModel.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      
      let jsonText = text.trim();
      jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      jsonText = jsonText.trim();
      
      try {
        const analysis = JSON.parse(jsonText);
        console.log('[HEDGE-BOT] ✅ Phân tích từ AI:', JSON.stringify(analysis, null, 2));
        return analysis;
      } catch (parseErr) {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const analysis = JSON.parse(jsonMatch[0]);
          return analysis;
        }
        return { trend: 'unclear', reason: 'Parse error', confidence: 'low' };
      }
    } catch (error) {
      console.error('[HEDGE-BOT] ❌ Lỗi khi gọi Gemini:', error.message);
      return { trend: 'unclear', reason: 'API error', confidence: 'low' };
    }
  }

  // ========== Helper methods ==========

  async prepareMarketMeta() {
    if (this.marketInfoLoaded) return;

    try {
      console.log('[HEDGE-BOT] ⚙️ Đang lấy thông tin market...');
      const productType = this.config.symbol.includes('_UMCBL') ? 'umcbl' : undefined;
      const contract = await this.api.getContract(this.config.symbol, productType);

      if (!contract) {
        throw new Error(`Không tìm thấy contract "${this.config.symbol}"`);
      }

      const derivedPriceTick = Number(contract.priceTick || contract.priceStep || contract.minPriceChange || 0);
      const derivedSizeStep = Number(contract.quantityTick || contract.sizeTick || contract.minTradeNum || 0);

      if (!this.priceTick && derivedPriceTick > 0) {
        this.priceTick = derivedPriceTick;
        this.priceDecimals = getDecimalsFromStep(this.priceTick);
      }

      if (!this.sizeStep && derivedSizeStep > 0) {
        this.sizeStep = derivedSizeStep;
      }

      this.minLotSize = Number(contract.minTradeNum || contract.minSize || this.sizeStep || 0.001);

      console.log(`[HEDGE-BOT] ℹ️ Contract: tick=${this.priceTick}, step=${this.sizeStep}, minLot=${formatNumber(this.minLotSize)}`);
    } catch (err) {
      console.warn(`[HEDGE-BOT] ⚠️ Không lấy được contract spec: ${err.message}`);
      this.priceTick = this.priceTick || 0.01;
      this.priceDecimals = getDecimalsFromStep(this.priceTick);
      this.sizeStep = this.sizeStep || 0.0001;
    } finally {
      this.marketInfoLoaded = true;
    }
  }

  async configureLeverage() {
    try {
      // 1. Set Margin Mode thành CROSSED
      console.log('[HEDGE-BOT] 🔧 Đang set Margin Mode = CROSSED...');
      try {
        await this.api.setMarginMode({
          symbol: this.config.symbol,
          marginCoin: this.config.marginCoin,
          marginMode: 'crossed',
        });
        console.log('[HEDGE-BOT] ✅ Đã set Margin Mode = CROSSED');
      } catch (err) {
        // Nếu margin mode đã được set rồi, API có thể trả lỗi, không cần lo
        console.warn(`[HEDGE-BOT] ⚠️ Set margin mode: ${err.message} (có thể đã set rồi)`);
      }

      // 2. Set Leverage cho cả long và short
      await Promise.all(
        ['long', 'short'].map((side) =>
          this.api.setLeverage({
            symbol: this.config.symbol,
            marginCoin: this.config.marginCoin,
            leverage: this.config.leverage,
            holdSide: side,
          }).catch(err => {
            console.warn(`[HEDGE-BOT] ⚠️ Set leverage ${side}: ${err.message}`);
          }),
        ),
      );
      console.log(`[HEDGE-BOT] ✅ Đã set leverage ${this.config.leverage}x`);
    } catch (err) {
      console.error(`[HEDGE-BOT] ❌ Lỗi khi config: ${err.message}`);
      throw err;
    }
  }

  async getEquity() {
    try {
      const productType = this.config.symbol.includes('_UMCBL') ? 'umcbl' : 'umcbl';
      const account = await this.api.getAccount(productType, this.config.marginCoin, this.config.symbol);
      
      const equity = Number(
        account?.equity || 
        account?.availableEquity || 
        account?.availableBalance || 
        account?.available ||
        0
      );

      if (equity <= 0) {
        throw new Error('Equity không hợp lệ hoặc không đủ vốn');
      }

      return equity;
    } catch (err) {
      console.error(`[HEDGE-BOT] ❌ Lỗi khi lấy equity: ${err.message}`);
      throw err;
    }
  }

  calculateLotSize(entryPrice, capital) {
    if (!entryPrice || entryPrice <= 0) {
      throw new Error('Entry price không hợp lệ');
    }

    if (!capital || capital <= 0) {
      throw new Error('Capital không hợp lệ');
    }

    const notional = capital * this.config.leverage;
    let size = notional / entryPrice;

    if (this.sizeStep && this.sizeStep > 0) {
      size = roundToStep(size, this.sizeStep);
    }

    const minLotSize = this.minLotSize || 0.001;

    if (size < minLotSize) {
      const minNotional = minLotSize * entryPrice;
      const minCapitalRequired = minNotional / this.config.leverage;
      
      return {
        size: Number(minLotSize.toFixed(8)),
        capital: capital,
        minCapitalRequired: minCapitalRequired,
        warning: `⚠️ Capital quá thấp. Cần ít nhất ${formatNumber(minCapitalRequired)} ${this.config.marginCoin}`,
        capitalTooLow: true,
      };
    }

    const actualNotional = size * entryPrice;
    const actualCapital = actualNotional / this.config.leverage;

    return {
      size: Number(size.toFixed(8)),
      capital: capital,
      actualCapital: actualCapital,
      notional: actualNotional,
      warning: null,
      capitalTooLow: false,
    };
  }
}

module.exports = { HedgeBot };

