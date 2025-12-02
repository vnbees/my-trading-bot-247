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
    
    // AI Analysis History (lưu trữ nhận định trước đó)
    this.previousAnalyses = []; // Array of { timestamp, trend, confidence, reason, risk_assessment, suggestions }
    this.maxHistorySize = 5; // Giữ tối đa 5 nhận định gần nhất
    
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
   * Bot chỉ theo 100% đề xuất của AI, không có logic tự động
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

    // 3. Phân tích xu hướng và nhận suggestions từ AI
    await this.analyzeTrendWithGemini();

    // 4. Bot chỉ execute AI suggestions, KHÔNG có logic tự động
    // Tất cả decisions đều từ AI
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

      // 4. Lấy thông tin tài chính và positions hiện tại
      const accountStatus = await this.getAccountStatus();

      // Log thông tin số dư gửi cho AI
      if (accountStatus) {
        console.log('[HEDGE-BOT] 📊 Thông tin tài khoản gửi cho AI:');
        console.log(`   💰 Equity: ${formatNumber(accountStatus.equity)} USDT`);
        console.log(`   💵 Available: ${formatNumber(accountStatus.available)} USDT`);
        console.log(`   📊 Margin used: ${formatNumber(accountStatus.totalMarginUsed)} USDT`);
        console.log(`   🆓 Free margin: ${formatNumber(accountStatus.freeMargin)} USDT`);
        console.log(`   📈 Margin level: ${accountStatus.marginLevel.toFixed(2)}%`);
        console.log(`   💹 Unrealized PnL: ${accountStatus.totalUnrealizedPnL >= 0 ? '+' : ''}${formatNumber(accountStatus.totalUnrealizedPnL)} USDT`);
        if (accountStatus.longPosition) {
          const pos = accountStatus.longPosition;
          console.log(`   🟢 LONG: Entry=${formatNumber(pos.entryPrice)} | Current=${formatNumber(pos.currentPrice)} | ROI=${pos.roiPercent >= 0 ? '+' : ''}${pos.roiPercent.toFixed(2)}% | Margin=${formatNumber(pos.marginUsed)} USDT`);
        }
        if (accountStatus.shortPosition) {
          const pos = accountStatus.shortPosition;
          console.log(`   🔴 SHORT: Entry=${formatNumber(pos.entryPrice)} | Current=${formatNumber(pos.currentPrice)} | ROI=${pos.roiPercent >= 0 ? '+' : ''}${pos.roiPercent.toFixed(2)}% | Margin=${formatNumber(pos.marginUsed)} USDT`);
        }
      }

      // 5. Format dữ liệu cho Gemini (bao gồm cả account info)
      const priceData = this.formatPriceDataForGemini(
        klines5m,
        binanceSymbol,
        indicators,
        priceActionAnalysis,
        accountStatus
      );

      // 6. Phân tích bằng Gemini
      const analysis = await this.analyzeWithGemini(priceData, binanceSymbol);
      
      if (analysis && analysis.trend) {
        this.marketTrend = analysis.trend;
        console.log(`[HEDGE-BOT] ✅ Xu hướng thị trường: ${this.marketTrend.toUpperCase()}`);
        if (analysis.reason) {
          console.log(`   Lý do: ${analysis.reason}`);
        }
        
        // Lưu analysis vào history
        this.saveAnalysisToHistory(analysis);
        
        // Xử lý AI suggestions nếu có
        if (analysis.suggestions && analysis.suggestions.length > 0) {
          const currentPrice = klines5m[klines5m.length - 1].close;
          await this.handleAISuggestions(analysis.suggestions, currentPrice);
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
   * Lấy thông tin tài chính và trạng thái positions hiện tại
   */
  async getAccountStatus() {
    try {
      const currentPrice = await this.getCurrentPrice();
      const equity = await this.getEquity();
      
      // Lấy available balance
      const productType = this.config.symbol.includes('_UMCBL') ? 'umcbl' : 'umcbl';
      const accountData = await this.api.getAccount(productType, this.config.marginCoin, this.config.symbol);
      
      const available = Number(
        accountData?.available || 
        accountData?.availableBalance || 
        accountData?.availableEquity ||
        equity
      );
      
      // Tính toán thông tin positions
      const leverage = this.config.leverage || 10;
      let longInfo = null;
      let shortInfo = null;
      let totalMarginUsed = 0;
      let totalUnrealizedPnL = 0;
      
      if (this.longPosition) {
        const priceChange = ((currentPrice - this.longPosition.entryPrice) / this.longPosition.entryPrice) * 100;
        const roiPercent = priceChange * leverage;
        const notional = this.longPosition.size * this.longPosition.entryPrice;
        const marginUsed = notional / leverage;
        const unrealizedPnL = (roiPercent / 100) * marginUsed;
        
        longInfo = {
          side: 'LONG',
          entryPrice: this.longPosition.entryPrice,
          currentPrice: currentPrice,
          size: this.longPosition.size,
          notional: notional,
          marginUsed: marginUsed,
          priceChangePercent: priceChange,
          roiPercent: roiPercent,
          unrealizedPnL: unrealizedPnL,
        };
        
        totalMarginUsed += marginUsed;
        totalUnrealizedPnL += unrealizedPnL;
      }
      
      if (this.shortPosition) {
        const priceChange = ((this.shortPosition.entryPrice - currentPrice) / this.shortPosition.entryPrice) * 100;
        const roiPercent = priceChange * leverage;
        const notional = this.shortPosition.size * this.shortPosition.entryPrice;
        const marginUsed = notional / leverage;
        const unrealizedPnL = (roiPercent / 100) * marginUsed;
        
        shortInfo = {
          side: 'SHORT',
          entryPrice: this.shortPosition.entryPrice,
          currentPrice: currentPrice,
          size: this.shortPosition.size,
          notional: notional,
          marginUsed: marginUsed,
          priceChangePercent: priceChange,
          roiPercent: roiPercent,
          unrealizedPnL: unrealizedPnL,
        };
        
        totalMarginUsed += marginUsed;
        totalUnrealizedPnL += unrealizedPnL;
      }
      
      const freeMargin = equity - totalMarginUsed;
      const marginLevel = totalMarginUsed > 0 ? (equity / totalMarginUsed) * 100 : 0;
      
      return {
        equity: equity,
        available: available,
        totalMarginUsed: totalMarginUsed,
        freeMargin: freeMargin,
        marginLevel: marginLevel,
        totalUnrealizedPnL: totalUnrealizedPnL,
        leverage: leverage,
        longPosition: longInfo,
        shortPosition: shortInfo,
        configCapital: this.config.capital || null,
      };
    } catch (err) {
      console.error(`[HEDGE-BOT] ❌ Lỗi khi lấy account status: ${err.message}`);
      return null;
    }
  }

  /**
   * Xử lý suggestions từ AI
   * @param {Array} suggestions - Array of suggestion objects từ AI
   * @param {number} currentPrice - Giá hiện tại
   */
  async handleAISuggestions(suggestions, currentPrice) {
    if (!suggestions || suggestions.length === 0) return;
    
    console.log('[HEDGE-BOT] 💡 AI Suggestions:');
    
    for (const suggestion of suggestions) {
      const { action, reason, priority, capital, percentage, target_size } = suggestion;
      
      console.log(`   - ${action}: ${reason}`);
      if (priority === 'critical') {
        console.log(`     ⚠️ PRIORITY: CRITICAL - Cân nhắc xử lý ngay!`);
      }
      
      try {
        // Execute suggestions dựa trên action
        switch (action) {
          case 'open_long':
            if (!this.longPosition) {
              console.log(`[HEDGE-BOT] 🤖 AI: Mở LONG position...`);
              await this.openPosition('long', currentPrice);
            } else {
              console.log(`[HEDGE-BOT] ⚠️ AI suggest open_long nhưng đã có LONG position, bỏ qua`);
            }
            break;
            
          case 'open_short':
            if (!this.shortPosition) {
              console.log(`[HEDGE-BOT] 🤖 AI: Mở SHORT position...`);
              await this.openPosition('short', currentPrice);
            } else {
              console.log(`[HEDGE-BOT] ⚠️ AI suggest open_short nhưng đã có SHORT position, bỏ qua`);
            }
            break;
            
          case 'close_long':
            if (this.longPosition) {
              console.log(`[HEDGE-BOT] 🤖 AI: Đóng LONG position...`);
              await this.closePosition('long');
              this.longPosition = null;
            } else {
              console.log(`[HEDGE-BOT] ⚠️ AI suggest close_long nhưng không có LONG position, bỏ qua`);
            }
            break;
            
          case 'close_short':
            if (this.shortPosition) {
              console.log(`[HEDGE-BOT] 🤖 AI: Đóng SHORT position...`);
              await this.closePosition('short');
              this.shortPosition = null;
            } else {
              console.log(`[HEDGE-BOT] ⚠️ AI suggest close_short nhưng không có SHORT position, bỏ qua`);
            }
            break;
            
          case 'add_to_long':
            if (capital && capital >= 1.0) {
              console.log(`[HEDGE-BOT] 🤖 AI: Thêm ${formatNumber(capital)} USDT vào LONG...`);
              await this.addToPosition('long', currentPrice, capital);
            } else {
              console.log(`[HEDGE-BOT] ⚠️ AI suggest add_to_long nhưng capital (${capital}) < 1 USDT, bỏ qua`);
            }
            break;
            
          case 'add_to_short':
            if (capital && capital >= 1.0) {
              console.log(`[HEDGE-BOT] 🤖 AI: Thêm ${formatNumber(capital)} USDT vào SHORT...`);
              await this.addToPosition('short', currentPrice, capital);
            } else {
              console.log(`[HEDGE-BOT] ⚠️ AI suggest add_to_short nhưng capital (${capital}) < 1 USDT, bỏ qua`);
            }
            break;
            
          case 'partial_close_long':
            if (percentage && percentage > 0 && percentage < 100) {
              console.log(`[HEDGE-BOT] 🤖 AI: Đóng ${percentage}% LONG...`);
              await this.partialClose('long', percentage);
            } else {
              console.log(`[HEDGE-BOT] ⚠️ AI suggest partial_close_long nhưng percentage (${percentage}) không hợp lệ, bỏ qua`);
            }
            break;
            
          case 'partial_close_short':
            if (percentage && percentage > 0 && percentage < 100) {
              console.log(`[HEDGE-BOT] 🤖 AI: Đóng ${percentage}% SHORT...`);
              await this.partialClose('short', percentage);
            } else {
              console.log(`[HEDGE-BOT] ⚠️ AI suggest partial_close_short nhưng percentage (${percentage}) không hợp lệ, bỏ qua`);
            }
            break;
            
          case 'rebalance_long':
            if (target_size && target_size >= 1.0) {
              console.log(`[HEDGE-BOT] 🤖 AI: Rebalance LONG về ${formatNumber(target_size)} USDT...`);
              await this.rebalancePosition('long', target_size, currentPrice);
            } else {
              console.log(`[HEDGE-BOT] ⚠️ AI suggest rebalance_long nhưng target_size (${target_size}) < 1 USDT, bỏ qua`);
            }
            break;
            
          case 'rebalance_short':
            if (target_size && target_size >= 1.0) {
              console.log(`[HEDGE-BOT] 🤖 AI: Rebalance SHORT về ${formatNumber(target_size)} USDT...`);
              await this.rebalancePosition('short', target_size, currentPrice);
            } else {
              console.log(`[HEDGE-BOT] ⚠️ AI suggest rebalance_short nhưng target_size (${target_size}) < 1 USDT, bỏ qua`);
            }
            break;
            
            
          case 'reduce_margin':
            // TODO: Implement reduce margin logic nếu cần
            console.log(`[HEDGE-BOT] 💡 AI suggest reduce_margin - Chưa implement, cần manual review`);
            break;
            
          case 'increase_caution':
          case 'hold':
            // Chỉ log, không cần action
            console.log(`[HEDGE-BOT] 💡 AI suggest ${action} - Chỉ log, không cần action`);
            break;
            
          default:
            console.log(`[HEDGE-BOT] ⚠️ Unknown action: ${action}`);
        }
      } catch (err) {
        console.error(`[HEDGE-BOT] ❌ Lỗi khi execute suggestion "${action}": ${err.message}`);
        // Tiếp tục với suggestions khác, không throw
      }
    }
  }

  /**
   * Lưu analysis vào history
   */
  saveAnalysisToHistory(analysis) {
    const historyEntry = {
      timestamp: new Date().toISOString(),
      trend: analysis.trend,
      confidence: analysis.confidence || 'medium',
      reason: analysis.reason || '',
      risk_assessment: analysis.risk_assessment || null,
      suggestions: analysis.suggestions || [],
    };
    
    // Thêm vào đầu array
    this.previousAnalyses.unshift(historyEntry);
    
    // Giữ chỉ tối đa maxHistorySize entries
    if (this.previousAnalyses.length > this.maxHistorySize) {
      this.previousAnalyses = this.previousAnalyses.slice(0, this.maxHistorySize);
    }
    
    console.log(`[HEDGE-BOT] 📝 Đã lưu analysis vào history (${this.previousAnalyses.length}/${this.maxHistorySize})`);
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
   * Thêm vào position hiện có (Pyramiding/Scaling In)
   * @param {string} side - 'long' hoặc 'short'
   * @param {number} currentPrice - Giá hiện tại
   * @param {number} additionalCapital - Số USDT thêm vào (tối thiểu 1 USDT)
   */
  async addToPosition(side, currentPrice, additionalCapital) {
    try {
      const position = side === 'long' ? this.longPosition : this.shortPosition;
      
      if (!position) {
        throw new Error(`Không có ${side} position để thêm vào. Sử dụng openPosition() thay vì.`);
      }

      // Kiểm tra minimum 1 USDT
      if (additionalCapital < 1.0) {
        throw new Error(`Capital thêm vào phải tối thiểu 1 USDT. Nhận được: ${additionalCapital} USDT`);
      }

      // Kiểm tra position hiện tại >= 1 USDT
      const currentNotional = position.size * position.entryPrice;
      const currentMargin = currentNotional / (this.config.leverage || 10);
      
      if (currentMargin < 1.0) {
        throw new Error(`Position hiện tại chỉ có ${formatNumber(currentMargin)} USDT, cần tối thiểu 1 USDT`);
      }

      // Kiểm tra free margin
      const equity = await this.getEquity();
      const accountStatus = await this.getAccountStatus();
      
      if (accountStatus && accountStatus.freeMargin < additionalCapital) {
        throw new Error(`Free margin không đủ! Cần ${formatNumber(additionalCapital)} USDT, chỉ có ${formatNumber(accountStatus.freeMargin)} USDT`);
      }

      console.log(`[HEDGE-BOT] ➕ Thêm vào ${side.toUpperCase()} position:`);
      console.log(`  - Position hiện tại: ${formatNumber(position.size)} @ ${formatNumber(position.entryPrice)}`);
      console.log(`  - Capital thêm: ${formatNumber(additionalCapital)} USDT`);
      console.log(`  - Giá hiện tại: ${formatNumber(currentPrice)}`);

      // Tính size mới cần mua
      const lotSizeResult = this.calculateLotSize(currentPrice, additionalCapital);
      
      if (lotSizeResult.capitalTooLow) {
        throw new Error(`Capital quá thấp để tính size!`);
      }

      const additionalSize = lotSizeResult.size;
      console.log(`  - Size thêm: ${formatNumber(additionalSize)}`);

      // Place order để thêm vào
      const apiSide = side === 'long' ? 'open_long' : 'open_short';
      await this.api.placeOrder({
        symbol: this.config.symbol,
        marginCoin: this.config.marginCoin,
        size: additionalSize.toString(),
        side: apiSide,
        orderType: 'market',
      });

      // Tính average entry price
      const oldNotional = position.size * position.entryPrice;
      const newNotional = additionalSize * currentPrice;
      const totalSize = position.size + additionalSize;
      const averageEntryPrice = (oldNotional + newNotional) / totalSize;

      // Update position tracking
      const updatedPosition = {
        holdSide: side,
        entryPrice: averageEntryPrice,
        size: totalSize,
        leverage: this.config.leverage,
      };

      if (side === 'long') {
        this.longPosition = updatedPosition;
      } else {
        this.shortPosition = updatedPosition;
      }

      console.log(`[HEDGE-BOT] ✅ Đã thêm vào ${side.toUpperCase()} thành công`);
      console.log(`  - Average Entry: ${formatNumber(averageEntryPrice)}`);
      console.log(`  - Total Size: ${formatNumber(totalSize)}`);
      console.log(`  - Total Margin: ${formatNumber((totalSize * averageEntryPrice) / (this.config.leverage || 10))} USDT`);

      await sleep(2000);
    } catch (err) {
      console.error(`[HEDGE-BOT] ❌ Lỗi khi thêm vào ${side}: ${err.message}`);
      throw err;
    }
  }

  /**
   * Đóng một phần position (Partial Close)
   * @param {string} side - 'long' hoặc 'short'
   * @param {number} percentage - Phần trăm đóng (0-100), ví dụ: 50 = đóng 50%
   */
  async partialClose(side, percentage) {
    try {
      const position = side === 'long' ? this.longPosition : this.shortPosition;
      
      if (!position) {
        throw new Error(`Không có ${side} position để đóng`);
      }

      // Validate percentage
      if (percentage <= 0 || percentage >= 100) {
        throw new Error(`Percentage phải trong khoảng 0-100. Nhận được: ${percentage}`);
      }

      const closeSize = position.size * (percentage / 100);
      const remainingSize = position.size - closeSize;

      // Kiểm tra position sau khi đóng vẫn >= 1 USDT
      const currentNotional = position.size * position.entryPrice;
      const currentMargin = currentNotional / (this.config.leverage || 10);
      const remainingMargin = currentMargin * (1 - percentage / 100);

      if (remainingMargin < 1.0) {
        throw new Error(`Sau khi đóng ${percentage}%, position còn ${formatNumber(remainingMargin)} USDT (< 1 USDT tối thiểu). Hãy đóng ít hơn hoặc đóng toàn bộ.`);
      }

      console.log(`[HEDGE-BOT] 🔴 Đóng ${percentage}% ${side.toUpperCase()} position:`);
      console.log(`  - Size hiện tại: ${formatNumber(position.size)}`);
      console.log(`  - Size đóng: ${formatNumber(closeSize)}`);
      console.log(`  - Size còn lại: ${formatNumber(remainingSize)}`);

      // Đóng một phần
      await this.api.closePosition({
        symbol: this.config.symbol,
        marginCoin: this.config.marginCoin,
        holdSide: side,
        size: closeSize.toString(),
      });

      // Update position tracking
      const updatedPosition = {
        holdSide: side,
        entryPrice: position.entryPrice, // Entry price không đổi
        size: remainingSize,
        leverage: this.config.leverage,
      };

      if (side === 'long') {
        this.longPosition = updatedPosition;
      } else {
        this.shortPosition = updatedPosition;
      }

      console.log(`[HEDGE-BOT] ✅ Đã đóng ${percentage}% ${side.toUpperCase()} thành công`);
      console.log(`  - Size còn lại: ${formatNumber(remainingSize)}`);
      console.log(`  - Margin còn lại: ${formatNumber(remainingMargin)} USDT`);

      await sleep(2000);
    } catch (err) {
      console.error(`[HEDGE-BOT] ❌ Lỗi khi đóng một phần ${side}: ${err.message}`);
      throw err;
    }
  }

  /**
   * Điều chỉnh size position về target (Rebalance)
   * @param {string} side - 'long' hoặc 'short'
   * @param {number} targetSize - Target size (USDT margin), tối thiểu 1 USDT
   * @param {number} currentPrice - Giá hiện tại
   */
  async rebalancePosition(side, targetSize, currentPrice) {
    try {
      const position = side === 'long' ? this.longPosition : this.shortPosition;
      
      if (!position) {
        // Nếu chưa có position và target >= 1 USDT, mở mới
        if (targetSize >= 1.0) {
          console.log(`[HEDGE-BOT] 📝 Chưa có ${side} position, mở mới với target ${formatNumber(targetSize)} USDT...`);
          await this.openPosition(side, currentPrice);
          return;
        } else {
          throw new Error(`Target size ${targetSize} USDT < 1 USDT tối thiểu`);
        }
      }

      // Kiểm tra target >= 1 USDT
      if (targetSize < 1.0) {
        throw new Error(`Target size phải tối thiểu 1 USDT. Nhận được: ${targetSize} USDT`);
      }

      // Tính margin hiện tại
      const currentNotional = position.size * position.entryPrice;
      const currentMargin = currentNotional / (this.config.leverage || 10);
      const targetNotional = targetSize * (this.config.leverage || 10);
      const targetSizeContracts = targetNotional / currentPrice;

      console.log(`[HEDGE-BOT] ⚖️ Rebalance ${side.toUpperCase()} position:`);
      console.log(`  - Margin hiện tại: ${formatNumber(currentMargin)} USDT`);
      console.log(`  - Target margin: ${formatNumber(targetSize)} USDT`);
      console.log(`  - Size hiện tại: ${formatNumber(position.size)}`);
      console.log(`  - Target size: ${formatNumber(targetSizeContracts)}`);

      if (Math.abs(currentMargin - targetSize) < 0.01) {
        console.log(`[HEDGE-BOT] ✅ Position đã đúng target, không cần điều chỉnh`);
        return;
      }

      if (targetSize > currentMargin) {
        // Cần thêm vào
        const additionalCapital = targetSize - currentMargin;
        console.log(`[HEDGE-BOT] ➕ Cần thêm ${formatNumber(additionalCapital)} USDT...`);
        await this.addToPosition(side, currentPrice, additionalCapital);
      } else {
        // Cần đóng một phần
        const percentageToClose = ((currentMargin - targetSize) / currentMargin) * 100;
        console.log(`[HEDGE-BOT] 🔴 Cần đóng ${percentageToClose.toFixed(1)}%...`);
        await this.partialClose(side, percentageToClose);
      }

      console.log(`[HEDGE-BOT] ✅ Đã rebalance ${side.toUpperCase()} về ${formatNumber(targetSize)} USDT`);
    } catch (err) {
      console.error(`[HEDGE-BOT] ❌ Lỗi khi rebalance ${side}: ${err.message}`);
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

  formatPriceDataForGemini(klines, symbol, indicators = {}, priceActionAnalysis = {}, accountStatus = null) {
    if (!klines || klines.length === 0) {
      return 'Không có dữ liệu giá.';
    }

    const latest = klines[klines.length - 1];
    const currentPrice = latest.close;
    
    let dataText = `=== PHÂN TÍCH THỊ TRƯỜNG - ${symbol} ===\n\n`;
    dataText += `Giá hiện tại: ${currentPrice.toFixed(this.priceDecimals)} USDT\n`;
    dataText += `Thời gian: ${latest.time}\n\n`;

    // Thêm thông tin tài chính và positions
    if (accountStatus) {
      dataText += `\n${'='.repeat(60)}\n`;
      dataText += `THÔNG TIN TÀI KHOẢN & POSITIONS\n`;
      dataText += `${'='.repeat(60)}\n`;
      dataText += `💰 Tổng vốn (Equity): ${formatNumber(accountStatus.equity)} USDT\n`;
      dataText += `💵 Khả dụng (Available): ${formatNumber(accountStatus.available)} USDT\n`;
      dataText += `📊 Margin đã dùng: ${formatNumber(accountStatus.totalMarginUsed)} USDT\n`;
      dataText += `🆓 Margin tự do: ${formatNumber(accountStatus.freeMargin)} USDT\n`;
      dataText += `📈 Margin Level: ${accountStatus.marginLevel.toFixed(2)}%\n`;
      dataText += `💹 Unrealized PnL: ${accountStatus.totalUnrealizedPnL >= 0 ? '+' : ''}${formatNumber(accountStatus.totalUnrealizedPnL)} USDT\n`;
      dataText += `🎚️ Leverage: ${accountStatus.leverage}x\n`;
      if (accountStatus.configCapital) {
        dataText += `⚙️ Config capital: ${formatNumber(accountStatus.configCapital)} USDT\n`;
      }
      
      dataText += `\n${'='.repeat(60)}\n`;
      dataText += `CHIẾN LƯỢC HEDGE TRADING CỦA BOT\n`;
      dataText += `${'='.repeat(60)}\n`;
      
      // Capital allocation
      const capitalPerSide = accountStatus.configCapital ? accountStatus.configCapital / 2 : accountStatus.equity / 2;
      
      // Trạng thái hiện tại
      dataText += `\n📌 TRẠNG THÁI HIỆN TẠI:\n`;
      dataText += `   - Xu hướng thị trường: ${this.marketTrend.toUpperCase()}\n`;
      dataText += `   - Bot đang ở mode: ${this.marketTrend === 'unclear' ? 'HEDGE (Long + Short)' : 'TREND FOLLOWING (Single position)'}\n`;
      
      dataText += `\n💰 PHÂN BỔ VỐN:\n`;
      dataText += `   - Capital người dùng set: ${formatNumber(accountStatus.configCapital || accountStatus.equity)} USDT\n`;
      dataText += `   - Capital mỗi lệnh (Long/Short): ${formatNumber(capitalPerSide)} USDT\n`;
      dataText += `   - Leverage: ${accountStatus.leverage}x\n`;
      dataText += `   - Profit threshold: ${PROFIT_THRESHOLD_PERCENT}% ROI (với leverage ${accountStatus.leverage}x)\n`;
      
      dataText += `\n⚠️ RÀNG BUỘC BẮT BUỘC (PHẢI TUÂN THỦ 100%):\n`;
      dataText += `   - Mỗi lệnh PHẢI có TỐI THIỂU 1 USDT margin\n`;
      dataText += `   - Khi mở lệnh mới: capital >= 1 USDT\n`;
      dataText += `   - Khi suggest "add_to_long/add_to_short": capital thêm vào >= 1 USDT\n`;
      dataText += `   - Khi suggest "partial_close": position sau khi đóng PHẢI >= 1 USDT\n`;
      dataText += `   - Khi suggest "rebalance": target_size >= 1 USDT\n`;
      dataText += `   - Khi đóng position: Phải đóng TẤT CẢ hoặc đảm bảo còn lại >= 1 USDT\n`;
      dataText += `   - Position hiện tại < 1 USDT → KHÔNG thể add hoặc partial close\n`;
      
      dataText += `\n📊 CHIẾN LƯỢC THEO XU HƯỚNG:\n`;
      dataText += `\n1️⃣ KHI XU HƯỚNG KHÔNG RÕ RÀNG (UNCLEAR/SIDEWAYS) - CHIẾN LƯỢC HEDGE:\n`;
      dataText += `\n   🎯 MỤC TIÊU:\n`;
      dataText += `      - Kiếm lợi nhuận từ biến động thị trường (sideways)\n`;
      dataText += `      - Take profit nhanh khi đạt +${PROFIT_THRESHOLD_PERCENT}% ROI\n`;
      dataText += `      - Bảo toàn vốn bằng cách hedge (Long + Short)\n`;
      dataText += `\n   📋 QUY TẮC:\n`;
      dataText += `      ✅ LUÔN duy trì 2 lệnh: LONG + SHORT (hedge)\n`;
      dataText += `      ✅ Mỗi lệnh: ${formatNumber(capitalPerSide)} USDT margin (tối thiểu 1 USDT)\n`;
      dataText += `      ✅ Khi lệnh nào đạt +${PROFIT_THRESHOLD_PERCENT}% ROI:\n`;
      dataText += `         → Đóng lệnh đó\n`;
      dataText += `         → Mở lại lệnh CÙNG CHIỀU với lệnh vừa đóng (với capital ${formatNumber(capitalPerSide)} USDT)\n`;
      dataText += `         → Lệnh kia GIỮ NGUYÊN (không đóng, không mở lại)\n`;
      dataText += `      ✅ Nếu thiếu 1 trong 2 lệnh (Long hoặc Short):\n`;
      dataText += `         → Mở ngay lệnh thiếu với capital ${formatNumber(capitalPerSide)} USDT\n`;
      dataText += `\n   🤖 AI PHẢI ĐỀ XUẤT:\n`;
      dataText += `      - "open_long": Nếu chưa có LONG position\n`;
      dataText += `      - "open_short": Nếu chưa có SHORT position\n`;
      dataText += `      - "close_long": Nếu LONG đạt +${PROFIT_THRESHOLD_PERCENT}% ROI\n`;
      dataText += `      - "close_short": Nếu SHORT đạt +${PROFIT_THRESHOLD_PERCENT}% ROI\n`;
      dataText += `      - Sau khi close, phải suggest "open_long" hoặc "open_short" để mở lại\n`;
      dataText += `      - KHÔNG suggest add/partial close trong unclear mode (chỉ mở/đóng đơn giản)\n`;
      
      dataText += `\n2️⃣ KHI XU HƯỚNG RÕ RÀNG (UPTREND/DOWNTREND) - CHIẾN LƯỢC TREND FOLLOWING:\n`;
      dataText += `\n   🎯 MỤC TIÊU:\n`;
      dataText += `      - Tối đa hóa lợi nhuận bằng cách follow trend\n`;
      dataText += `      - Giữ position cùng xu hướng đến khi trend đảo chiều\n`;
      dataText += `\n   📋 QUY TẮC:\n`;
      dataText += `      ✅ Đóng NGAY lệnh ngược xu hướng (bất kể P/L)\n`;
      dataText += `      ✅ Giữ lệnh cùng xu hướng (KHÔNG đóng dù lãi 5%, 10%, 15%...)\n`;
      dataText += `      ✅ Chỉ đóng khi xu hướng đảo chiều hoặc unclear\n`;
      dataText += `\n   🤖 AI PHẢI ĐỀ XUẤT:\n`;
      dataText += `      - "close_long": Nếu trend DOWNTREND và có LONG\n`;
      dataText += `      - "close_short": Nếu trend UPTREND và có SHORT\n`;
      dataText += `      - "open_long": Nếu trend UPTREND và chưa có LONG\n`;
      dataText += `      - "open_short": Nếu trend DOWNTREND và chưa có SHORT\n`;
      dataText += `      - "add_to_long/add_to_short": Khi trend mạnh và position cùng chiều đang lãi\n`;
      dataText += `      - "partial_close": Khi position lãi lớn và trend có dấu hiệu chậm lại\n`;
      
      dataText += `\n💡 LƯU Ý QUAN TRỌNG CHO AI:\n`;
      dataText += `   - Bot KHÔNG có logic tự động, chỉ execute 100% suggestions của AI\n`;
      dataText += `   - AI PHẢI đề xuất TẤT CẢ actions cần thiết (open, close, add, partial_close)\n`;
      dataText += `   - Trong UNCLEAR mode: AI phải đảm bảo luôn có 2 lệnh (Long + Short)\n`;
      dataText += `   - Trong TREND mode: AI phải đảm bảo chỉ có 1 lệnh cùng xu hướng\n`;
      dataText += `   - Mỗi action PHẢI tuân thủ ràng buộc 1 USDT minimum\n`;
      dataText += `   - Capital mỗi lệnh: ${formatNumber(capitalPerSide)} USDT (khi mở mới)\n`;
      
      dataText += `\n📍 VỊ THẾ ĐANG MỞ:\n`;
      
      if (accountStatus.longPosition) {
        const pos = accountStatus.longPosition;
        dataText += `\n  🟢 LONG Position:\n`;
        dataText += `     Entry: ${formatNumber(pos.entryPrice)} USDT\n`;
        dataText += `     Current: ${formatNumber(pos.currentPrice)} USDT\n`;
        dataText += `     Size: ${formatNumber(pos.size)} contracts\n`;
        dataText += `     Notional: ${formatNumber(pos.notional)} USDT\n`;
        dataText += `     Margin: ${formatNumber(pos.marginUsed)} USDT\n`;
        dataText += `     Price Δ: ${pos.priceChangePercent >= 0 ? '+' : ''}${pos.priceChangePercent.toFixed(2)}%\n`;
        dataText += `     ROI: ${pos.roiPercent >= 0 ? '+' : ''}${pos.roiPercent.toFixed(2)}%\n`;
        dataText += `     Unrealized PnL: ${pos.unrealizedPnL >= 0 ? '+' : ''}${formatNumber(pos.unrealizedPnL)} USDT\n`;
      } else {
        dataText += `\n  🟢 LONG Position: Không có\n`;
      }
      
      if (accountStatus.shortPosition) {
        const pos = accountStatus.shortPosition;
        dataText += `\n  🔴 SHORT Position:\n`;
        dataText += `     Entry: ${formatNumber(pos.entryPrice)} USDT\n`;
        dataText += `     Current: ${formatNumber(pos.currentPrice)} USDT\n`;
        dataText += `     Size: ${formatNumber(pos.size)} contracts\n`;
        dataText += `     Notional: ${formatNumber(pos.notional)} USDT\n`;
        dataText += `     Margin: ${formatNumber(pos.marginUsed)} USDT\n`;
        dataText += `     Price Δ: ${pos.priceChangePercent >= 0 ? '+' : ''}${pos.priceChangePercent.toFixed(2)}%\n`;
        dataText += `     ROI: ${pos.roiPercent >= 0 ? '+' : ''}${pos.roiPercent.toFixed(2)}%\n`;
        dataText += `     Unrealized PnL: ${pos.unrealizedPnL >= 0 ? '+' : ''}${formatNumber(pos.unrealizedPnL)} USDT\n`;
      } else {
        dataText += `\n  🔴 SHORT Position: Không có\n`;
      }
    }

    // Thêm lịch sử nhận định trước đó
    if (this.previousAnalyses && this.previousAnalyses.length > 0) {
      dataText += `\n${'='.repeat(60)}\n`;
      dataText += `LỊCH SỬ NHẬN ĐỊNH TRƯỚC ĐÓ (${this.previousAnalyses.length} nhận định gần nhất)\n`;
      dataText += `${'='.repeat(60)}\n`;
      
      this.previousAnalyses.forEach((analysis, index) => {
        const timeAgo = index === 0 ? 'Vừa rồi' : `${index * 5} phút trước`;
        dataText += `\n📅 ${timeAgo} (${new Date(analysis.timestamp).toLocaleString('vi-VN')}):\n`;
        dataText += `   Trend: ${analysis.trend.toUpperCase()}\n`;
        dataText += `   Confidence: ${analysis.confidence.toUpperCase()}\n`;
        if (analysis.reason) {
          dataText += `   Lý do: ${analysis.reason.substring(0, 150)}${analysis.reason.length > 150 ? '...' : ''}\n`;
        }
        if (analysis.risk_assessment) {
          dataText += `   Risk: ${analysis.risk_assessment.overall_risk || 'N/A'}\n`;
        }
        if (analysis.suggestions && analysis.suggestions.length > 0) {
          dataText += `   Suggestions: ${analysis.suggestions.map(s => s.action).join(', ')}\n`;
        }
      });
      
      dataText += `\n💡 LƯU Ý: So sánh với nhận định trước để phát hiện:\n`;
      dataText += `   - Thay đổi xu hướng (trend reversal)\n`;
      dataText += `   - Tăng/giảm confidence\n`;
      dataText += `   - Tiến triển của risk level\n`;
      dataText += `   - Suggestions đã được thực hiện hay chưa\n`;
    }

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
Bạn là chuyên gia phân tích thị trường cryptocurrency và quản lý rủi ro.

**DỮ LIỆU THỊ TRƯỜNG & TÀI KHOẢN:**

${priceData}

**NHIỆM VỤ:**

1. Phân tích xu hướng thị trường hiện tại
2. Đánh giá tình trạng tài chính và positions
3. Đưa ra suggestions về quản lý vốn và risk (nếu cần)

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

**SỬ DỤNG LỊCH SỬ NHẬN ĐỊNH TRƯỚC ĐÓ:**

Nếu có "LỊCH SỬ NHẬN ĐỊNH TRƯỚC ĐÓ" trong dữ liệu, hãy:
1. **So sánh trend hiện tại với trend trước:**
   - Nếu trend thay đổi (ví dụ: unclear → uptrend) → Đây là tín hiệu quan trọng!
   - Nếu trend giữ nguyên → Xác nhận xu hướng đang tiếp tục
   - Nếu trend dao động (uptrend → unclear → uptrend) → Market đang choppy

2. **Theo dõi confidence level:**
   - Confidence tăng (low → medium → high) → Xu hướng đang mạnh lên
   - Confidence giảm (high → medium → low) → Xu hướng đang yếu đi
   - Confidence dao động → Market không rõ ràng

3. **Phát hiện trend reversal:**
   - Nếu 2-3 nhận định trước là "uptrend" nhưng hiện tại có dấu hiệu "downtrend" → Có thể đảo chiều!
   - Nếu liên tục "unclear" → Market đang sideways, không nên force trend

4. **Đánh giá risk progression:**
   - Nếu risk từ "low" → "medium" → "high" → Cần action ngay!
   - Nếu suggestions trước chưa được thực hiện và risk tăng → Priority cao hơn

5. **Context-aware suggestions:**
   - Nếu suggestion trước là "close_short" nhưng SHORT vẫn còn → Cần repeat với priority cao hơn
   - Nếu trend đã thay đổi → Update suggestions cho phù hợp

**CHIẾN LƯỢC THEO XU HƯỚNG - AI PHẢI ĐỀ XUẤT THEO ĐÂY:**

**1️⃣ KHI XU HƯỚNG KHÔNG RÕ RÀNG (UNCLEAR/SIDEWAYS) - HEDGE STRATEGY:**

AI PHẢI đề xuất theo chiến lược hedge:
- ✅ LUÔN đảm bảo có 2 lệnh: LONG + SHORT
- ✅ Mỗi lệnh: capital = (capital config) / 2 (xem trong data)
- ✅ Khi lệnh nào đạt +5% ROI → Suggest "close_long" hoặc "close_short"
- ✅ Sau khi close, PHẢI suggest "open_long" hoặc "open_short" để mở lại lệnh cùng chiều
- ✅ Lệnh kia GIỮ NGUYÊN (không suggest close)
- ✅ Nếu thiếu 1 trong 2 lệnh → Suggest "open_long" hoặc "open_short" ngay
- ❌ KHÔNG suggest add/partial close trong unclear mode (chỉ mở/đóng đơn giản)

**Ví dụ suggestions trong unclear mode:**
- Chưa có LONG → Suggest "open_long"
- Chưa có SHORT → Suggest "open_short"
- LONG đạt +5% ROI → Suggest "close_long", sau đó "open_long" (mở lại)
- SHORT đạt +5% ROI → Suggest "close_short", sau đó "open_short" (mở lại)

**2️⃣ KHI XU HƯỚNG RÕ RÀNG (UPTREND/DOWNTREND) - TREND FOLLOWING:**

AI PHẢI đề xuất theo chiến lược trend following:
- ✅ Đóng NGAY lệnh ngược xu hướng → Suggest "close_long" (nếu downtrend) hoặc "close_short" (nếu uptrend)
- ✅ Mở/giữ lệnh cùng xu hướng → Suggest "open_long" (nếu uptrend) hoặc "open_short" (nếu downtrend)
- ✅ KHÔNG suggest close lệnh cùng xu hướng dù lãi 5%, 10%, 15%...
- ✅ Có thể suggest "add_to_long/add_to_short" khi trend mạnh
- ✅ Có thể suggest "partial_close" khi position lãi lớn và trend chậm lại

**PHÂN TÍCH RỦI RO & SUGGESTIONS:**

Dựa trên thông tin tài khoản và positions, đánh giá:
- Margin level có an toàn không? (>200% là tốt, <150% là rủi ro)
- Positions có cân đối không?
- Có position nào đang lỗ quá lớn cần cắt lỗ?
- Free margin có đủ để chịu đựng biến động?
- Trong unclear mode: Đã có đủ 2 lệnh (Long + Short) chưa?
- Trong trend mode: Lệnh có cùng xu hướng không?

**⚠️ RÀNG BUỘC BẮT BUỘC (Xem trong "RÀNG BUỘC QUAN TRỌNG" ở data):**
- Mỗi lệnh PHẢI có tối thiểu 1 USDT margin
- Khi suggest "add_to_long/add_to_short": capital >= 1 USDT
- Khi suggest "partial_close": đảm bảo position còn lại >= 1 USDT
- Khi suggest "rebalance": target_size >= 1 USDT
- Nếu position hiện tại < 1 USDT → KHÔNG thể add hoặc partial close
- Luôn kiểm tra constraint này TRƯỚC KHI suggest!

**SUGGESTIONS - BOT CHỈ THEO 100% ĐỀ XUẤT CỦA AI:**

**⚠️ QUAN TRỌNG: Bot KHÔNG có logic tự động, chỉ execute suggestions của AI. AI PHẢI đề xuất TẤT CẢ actions cần thiết!**

**Mở lệnh:**
- "open_long": Mở LONG position mới (capital = capital mỗi lệnh từ config, tối thiểu 1 USDT)
- "open_short": Mở SHORT position mới (capital = capital mỗi lệnh từ config, tối thiểu 1 USDT)

**Đóng lệnh:**
- "close_long": Đóng toàn bộ LONG position (nếu rủi ro cao, xu hướng đảo chiều, hoặc loss quá lớn)
- "close_short": Đóng toàn bộ SHORT position (nếu rủi ro cao, xu hướng đảo chiều, hoặc loss quá lớn)
- "partial_close_long": Đóng một phần LONG:
  + Khi LONG đang LÃI và trend có dấu hiệu đảo → Lock profit (50-70%)
  + Khi LONG đang LÃI lớn (+15%+) và trend chậm lại → Take partial profit (30-50%)
  + ❌ KHÔNG nên dùng khi LONG đang LỖ và trend vẫn cùng chiều
- "partial_close_short": Đóng một phần SHORT:
  + Khi SHORT đang LÃI và trend có dấu hiệu đảo → Lock profit (50-70%)
  + Khi SHORT đang LÃI lớn (+15%+) và trend chậm lại → Take partial profit (30-50%)
  + ❌ KHÔNG nên dùng khi SHORT đang LỖ và trend vẫn cùng chiều

**Thêm vào lệnh (Pyramiding/Scaling In/Averaging Down):**
- "add_to_long": Thêm vào LONG position khi:
  + Trend UPTREND và LONG đang LÃI → Pyramiding để maximize profit
  + Trend UPTREND và LONG đang LỖ → Averaging down (giảm entry price trung bình)
  + Free margin đủ và confidence cao
- "add_to_short": Thêm vào SHORT position khi:
  + Trend DOWNTREND và SHORT đang LÃI → Pyramiding để maximize profit
  + Trend DOWNTREND và SHORT đang LỖ → Averaging down (giảm entry price trung bình)
  + Free margin đủ và confidence cao

**⚠️ LOGIC QUAN TRỌNG - KHI NÀO ADD vs PARTIAL CLOSE:**

1. **Position đang LỖ nhưng trend VẪN CÙNG CHIỀU:**
   - ✅ Nên: HOLD hoặc ADD (averaging down)
   - ❌ KHÔNG nên: Partial close (sẽ lock loss)
   - Lý do: Trend vẫn đúng, chỉ là entry timing chưa tốt. Averaging down sẽ giúp break-even nhanh hơn khi trend tiếp tục.

2. **Position đang LỖ và trend ĐẢO CHIỀU:**
   - ✅ Nên: CLOSE toàn bộ hoặc partial close (cut loss)
   - ❌ KHÔNG nên: ADD (sẽ tăng loss)
   - Lý do: Trend đã đảo, position đi ngược xu hướng mới.

3. **Position đang LÃI và trend VẪN CÙNG CHIỀU:**
   - ✅ Nên: HOLD hoặc ADD (pyramiding để maximize)
   - ✅ Hoặc: Partial close một phần nhỏ (30-40%) để lock profit, giữ phần lớn để ride trend
   - Lý do: Trend mạnh, nên tối đa hóa lợi nhuận.

4. **Position đang LÃI nhưng trend CÓ DẤU HIỆU ĐẢO:**
   - ✅ Nên: Partial close (50-70%) để lock profit
   - ❌ KHÔNG nên: ADD (rủi ro cao)
   - Lý do: Lock profit trước khi trend đảo chiều hoàn toàn.

**VÍ DỤ CỤ THỂ:**
- SHORT đang lỗ -10% ROI, trend DOWNTREND → ✅ Suggest "add_to_short" (averaging down)
- SHORT đang lỗ -10% ROI, trend UPTREND (đảo chiều) → ✅ Suggest "close_short" hoặc "partial_close_short"
- SHORT đang lãi +8% ROI, trend DOWNTREND → ✅ Suggest "add_to_short" (pyramiding) hoặc "hold"
- SHORT đang lãi +8% ROI, trend UPTREND (đảo chiều) → ✅ Suggest "partial_close_short" (lock profit)

**Điều chỉnh vị thế:**
- "rebalance_long": Điều chỉnh size LONG về target (tăng/giảm để cân bằng với SHORT)
- "rebalance_short": Điều chỉnh size SHORT về target (tăng/giảm để cân bằng với LONG)
- "reduce_margin": Giảm margin/size của positions (nếu over-leveraged)

**Khác:**
- "increase_caution": Tăng cảnh giác (nếu thị trường choppy/nguy hiểm)
- "hold": Giữ nguyên positions (an toàn)

**LƯU Ý QUAN TRỌNG:**
- Mỗi lệnh phải có TỐI THIỂU 1 USDT margin
- Khi suggest "add_to_long" hoặc "add_to_short", phải đảm bảo:
  + Position hiện tại >= 1 USDT
  + Capital thêm vào >= 1 USDT
  + Free margin đủ để add
  + Trend rõ ràng và confidence cao
- Khi suggest "partial_close", phải đảm bảo:
  + Position sau khi đóng một phần vẫn >= 1 USDT
  + Percentage đóng hợp lý (ví dụ: 30-70%)
- Khi suggest "rebalance", phải đảm bảo:
  + Target size >= 1 USDT
  + Cân bằng giữa LONG và SHORT

**OUTPUT (JSON only, no markdown):**

{
  "trend": "uptrend" hoặc "downtrend" hoặc "unclear",
  "reason": "Giải thích chi tiết về xu hướng (cấu trúc thị trường, price action, indicators)",
  "confidence": "high" hoặc "medium" hoặc "low",
  "risk_assessment": {
    "margin_health": "healthy" hoặc "warning" hoặc "critical",
    "position_balance": "balanced" hoặc "unbalanced",
    "overall_risk": "low" hoặc "medium" hoặc "high"
  },
  "suggestions": [
    {
      "action": "open_long" | "open_short" | "close_long" | "close_short" | "partial_close_long" | "partial_close_short" | "add_to_long" | "add_to_short" | "rebalance_long" | "rebalance_short" | "reduce_margin" | "increase_caution" | "hold",
      "reason": "Lý do cụ thể",
      "priority": "low" | "medium" | "high" | "critical",
      "capital": <số USDT để add> (chỉ cho add_to_long/add_to_short, tối thiểu 1 USDT),
      "percentage": <phần trăm để đóng> (chỉ cho partial_close, ví dụ: 50 = đóng 50%),
      "target_size": <target size USDT> (chỉ cho rebalance, tối thiểu 1 USDT)
    }
  ]
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

