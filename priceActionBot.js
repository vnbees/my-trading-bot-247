/**
 * Price Action Trading Bot với Gemini AI
 * 
 * Bot tự động phân tích giá bằng Gemini AI theo phương pháp Price Action:
 * - Mô hình nến (Candlestick Patterns)
 * - Chart Patterns (Head & Shoulders, Double Top/Bottom, Triangles, Wedges, Flags, etc.)
 * - Support/Resistance levels
 * - Trend lines & Break structures
 * - Lấy dữ liệu đa khung thời gian từ Binance
 * - Tính toán các chỉ báo kỹ thuật (nhưng chỉ dùng để hỗ trợ, không phải tín hiệu chính)
 * - AI sẽ phân tích dựa trên Price Action thuần túy
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

class PriceActionBot {
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
      
      // Run interval (mặc định 1 giờ, nhưng AI sẽ tự điều chỉnh)
      runIntervalMs: 60 * 60 * 1000,
      
      ...config,
    };
    this.isRunning = false;
    this.priceTick = this.config.priceTickSize > 0 ? this.config.priceTickSize : null;
    this.sizeStep = this.config.sizeStep > 0 ? this.config.sizeStep : null;
    this.marketInfoLoaded = false;
    this.priceDecimals = this.priceTick ? getDecimalsFromStep(this.priceTick) : 4;
    this.currentPosition = null;
    this.minLotSize = null;
    
    // Gemini AI
    this.genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);
    this.geminiModel = null;
  }

  async run() {
    this.isRunning = true;
    console.log('[PRICE-ACTION-BOT] 🚀 Khởi động Price Action Trading Bot với Gemini AI');
    const capitalStr = this.config.capital && this.config.capital > 0 
      ? `${this.config.capital} ${this.config.marginCoin}` 
      : 'Auto (toàn bộ equity)';
    console.table({
      'Cặp giao dịch': this.config.symbol,
      'Capital': capitalStr,
      'Leverage': `${this.config.leverage}x`,
      'Phương pháp': 'Price Action + Candlestick + Chart Patterns',
      'Nguồn dữ liệu': 'Binance đa khung thời gian',
    });

    await this.prepareMarketMeta();
    await this.initializeGeminiModel();

    // Kiểm tra positions hiện tại
    console.log('[PRICE-ACTION-BOT] 🔍 Kiểm tra positions hiện tại...');
    const existingPosition = await this.getCurrentPosition();
    
    if (existingPosition) {
      console.log(`[PRICE-ACTION-BOT] ✅ Phát hiện position đang mở: ${existingPosition.direction.toUpperCase()}`);
      console.log(`  - Entry: ${formatNumber(existingPosition.entryPrice)}`);
      console.log(`  - SL: ${existingPosition.sl ? formatNumber(existingPosition.sl) : 'N/A'}`);
      console.log(`  - TP: ${existingPosition.tp ? formatNumber(existingPosition.tp) : 'N/A'}`);
      console.log(`  - Size: ${formatNumber(existingPosition.size)}`);
      this.currentPosition = existingPosition;
    } else {
      console.log('[PRICE-ACTION-BOT] ℹ️ Không có position nào đang mở');
    }

    // Main loop
    console.log(`[PRICE-ACTION-BOT] ⏰ Bot sẽ tự động điều chỉnh thời gian chạy dựa trên phân tích AI...\n`);
    
    while (this.isRunning) {
      try {
        const nextCheckMinutes = await this.executeCycle();
        
        if (!nextCheckMinutes || isNaN(nextCheckMinutes)) {
          console.warn('[PRICE-ACTION-BOT] ⚠️ Không có nextCheckMinutes từ executeCycle, sử dụng mặc định 60 phút');
          nextCheckMinutes = 60;
        }
        
        const validatedMinutes = this.validateNextCheckTime(nextCheckMinutes);
        const waitMs = validatedMinutes * 60 * 1000;
        const nextRun = new Date(Date.now() + waitMs);
        
        const hours = Math.floor(validatedMinutes / 60);
        const minutes = validatedMinutes % 60;
        const timeStr = hours > 0 
          ? `${hours} giờ ${minutes} phút`
          : `${minutes} phút`;
        
        const source = this.currentPosition && this.currentPosition.isActive 
          ? 'Monitor position' 
          : 'AI đề xuất';
        console.log(`\n[PRICE-ACTION-BOT] ⏳ ${source}: Đợi ${timeStr} (${validatedMinutes} phút)`);
        console.log(`  Lần chạy tiếp theo: ${nextRun.toLocaleString('vi-VN')}\n`);
        await sleep(waitMs);
      } catch (err) {
        console.error(`[PRICE-ACTION-BOT] ❌ Lỗi trong cycle: ${err.message}`);
        if (err.stack) {
          console.error(err.stack);
        }
        console.log('[PRICE-ACTION-BOT] ⏳ Đợi 30 phút trước khi retry...');
        await sleep(30 * 60 * 1000);
      }
    }
  }

  /**
   * Khởi tạo Gemini model
   */
  async initializeGeminiModel() {
    try {
      console.log('[PRICE-ACTION-BOT] 🤖 Đang khởi tạo Gemini AI...');
      
      const modelsToTry = ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-pro'];
      
      for (const modelName of modelsToTry) {
        try {
          this.geminiModel = this.genAI.getGenerativeModel({ model: modelName });
          const testResult = await this.geminiModel.generateContent('Test');
          console.log(`[PRICE-ACTION-BOT] ✅ Đã khởi tạo model: ${modelName}`);
          return;
        } catch (err) {
          console.log(`[PRICE-ACTION-BOT] ⚠️ Model ${modelName} không khả dụng, thử model khác...`);
          continue;
        }
      }
      
      throw new Error('Không tìm thấy model Gemini nào khả dụng');
    } catch (err) {
      console.error(`[PRICE-ACTION-BOT] ❌ Lỗi khi khởi tạo Gemini: ${err.message}`);
      throw err;
    }
  }

  /**
   * Chu kỳ chạy chính
   */
  async executeCycle() {
    console.log('\n' + '='.repeat(60));
    console.log(`[PRICE-ACTION-BOT] 🔄 Bắt đầu chu kỳ mới - ${new Date().toLocaleString('vi-VN')}`);
    console.log('='.repeat(60));

    // Kiểm tra position hiện tại
    const position = await this.getCurrentPosition();
    if (position) {
      console.log(`[PRICE-ACTION-BOT] ℹ️ Đang có position ${position.direction.toUpperCase()}, bỏ qua phân tích mới`);
      console.log(`  - Entry: ${formatNumber(position.entryPrice)}`);
      console.log(`  - SL: ${position.sl ? formatNumber(position.sl) : 'N/A'}`);
      console.log(`  - TP: ${position.tp ? formatNumber(position.tp) : 'N/A'}`);
      this.currentPosition = position;
      
      console.log(`[PRICE-ACTION-BOT] 📊 Sẽ monitor position và check lại sau 30 phút`);
      return 30;
    }

    // 1. Lấy dữ liệu đa khung thời gian từ Binance
    console.log('[PRICE-ACTION-BOT] 📥 Đang lấy dữ liệu đa khung thời gian từ Binance...');
    const binanceSymbol = this.config.symbol.replace('_UMCBL', '');
    
    const [klines5m, klines15m, klines1h, klines4h, klines1d] = await Promise.all([
      this.getBinanceKlines(binanceSymbol, '5m', 288),  // 1 ngày
      this.getBinanceKlines(binanceSymbol, '15m', 288), // 3 ngày
      this.getBinanceKlines(binanceSymbol, '1h', 168),  // 1 tuần
      this.getBinanceKlines(binanceSymbol, '4h', 90),   // 15 ngày
      this.getBinanceKlines(binanceSymbol, '1d', 60),   // 60 ngày
    ]);
    
    console.log(`[PRICE-ACTION-BOT] ✅ Đã lấy được dữ liệu:`);
    console.log(`  - 5m: ${klines5m.length} candles`);
    console.log(`  - 15m: ${klines15m.length} candles`);
    console.log(`  - 1h: ${klines1h.length} candles`);
    console.log(`  - 4h: ${klines4h.length} candles`);
    console.log(`  - 1d: ${klines1d.length} candles`);

    // 2. Tính toán các chỉ báo kỹ thuật (chỉ để hỗ trợ, không phải tín hiệu chính)
    console.log('[PRICE-ACTION-BOT] 📊 Đang tính toán các chỉ báo kỹ thuật...');
    const indicators = await this.calculateAllIndicators({
      '5m': klines5m,
      '15m': klines15m,
      '1h': klines1h,
      '4h': klines4h,
      '1d': klines1d,
    });
    console.log('[PRICE-ACTION-BOT] ✅ Đã tính toán xong các chỉ báo');

    // 3. Phân tích Price Action (mô hình nến, swing high/low, support/resistance)
    console.log('[PRICE-ACTION-BOT] 🕯️ Đang phân tích Price Action...');
    const priceActionAnalysis = this.analyzePriceAction({
      '5m': klines5m,
      '15m': klines15m,
      '1h': klines1h,
      '4h': klines4h,
      '1d': klines1d,
    });
    console.log('[PRICE-ACTION-BOT] ✅ Đã phân tích Price Action');

    // 4. Format dữ liệu để gửi tới Gemini
    const priceData = this.formatPriceDataForGemini(
      klines5m, 
      binanceSymbol, 
      indicators, 
      priceActionAnalysis
    );

    // 5. Phân tích bằng Gemini AI (theo Price Action)
    console.log('[PRICE-ACTION-BOT] 🤖 Đang phân tích bằng Gemini AI (Price Action)...');
    const analysis = await this.analyzeWithGemini(priceData, binanceSymbol);
    
    // 6. Parse kết quả và vào lệnh
    if (analysis && analysis.action && analysis.action !== 'none') {
      await this.executeTrade(analysis, klines5m);
    } else {
      console.log('[PRICE-ACTION-BOT] ℹ️ AI không tìm thấy setup Price Action phù hợp');
      if (analysis) {
        console.log('Phân tích:', JSON.stringify(analysis, null, 2));
      }
    }

    // 7. Trả về thời gian chờ do AI đề xuất
    const nextCheckMinutes = analysis && analysis.nextCheckMinutes 
      ? analysis.nextCheckMinutes 
      : 60;
    
    return nextCheckMinutes;
  }

  /**
   * Phân tích Price Action:
   * - Mô hình nến (Candlestick Patterns)
   * - Swing High/Low
   * - Support/Resistance levels
   * - Trend structure (Higher High, Higher Low, Lower High, Lower Low)
   */
  analyzePriceAction(multiTimeframeData) {
    const result = {};
    
    for (const [timeframe, klines] of Object.entries(multiTimeframeData)) {
      if (!klines || klines.length < 10) {
        continue;
      }

      // Lấy 50 candles gần nhất để phân tích
      const recent = klines.slice(-50);
      
      // 1. Phát hiện mô hình nến
      const candlestickPatterns = this.detectCandlestickPatterns(recent);
      
      // 2. Xác định Swing High/Low
      const swings = this.identifySwingPoints(recent);
      
      // 3. Xác định Support/Resistance
      const levels = this.identifySupportResistance(recent);
      
      // 4. Phân tích trend structure
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

  /**
   * Phát hiện các mô hình nến phổ biến
   */
  detectCandlestickPatterns(klines) {
    const patterns = [];
    const recentCandles = klines.slice(-5); // 5 candles gần nhất
    
    if (recentCandles.length < 2) return patterns;
    
    for (let i = 1; i < recentCandles.length; i++) {
      const prev = recentCandles[i - 1];
      const curr = recentCandles[i];
      
      const prevBody = Math.abs(prev.close - prev.open);
      const currBody = Math.abs(curr.close - curr.open);
      const prevRange = prev.high - prev.low;
      const currRange = curr.high - curr.low;
      
      const prevIsBullish = prev.close > prev.open;
      const currIsBullish = curr.close > curr.open;
      
      // Hammer / Shooting Star
      const upperWick = curr.high - Math.max(curr.open, curr.close);
      const lowerWick = Math.min(curr.open, curr.close) - curr.low;
      
      if (currBody > 0) {
        // Hammer (bullish reversal)
        if (lowerWick > currBody * 2 && upperWick < currBody * 0.3) {
          patterns.push({
            type: 'Hammer',
            signal: 'Bullish Reversal',
            candle: i,
            strength: 'Medium',
          });
        }
        
        // Shooting Star (bearish reversal)
        if (upperWick > currBody * 2 && lowerWick < currBody * 0.3) {
          patterns.push({
            type: 'Shooting Star',
            signal: 'Bearish Reversal',
            candle: i,
            strength: 'Medium',
          });
        }
      }
      
      // Doji (indecision)
      if (currBody < currRange * 0.1) {
        patterns.push({
          type: 'Doji',
          signal: 'Indecision / Reversal',
          candle: i,
          strength: 'Low',
        });
      }
      
      // Engulfing
      if (i >= 1) {
        // Bullish Engulfing
        if (!prevIsBullish && currIsBullish && 
            curr.close > prev.open && curr.open < prev.close) {
          patterns.push({
            type: 'Bullish Engulfing',
            signal: 'Bullish Reversal',
            candle: i,
            strength: 'Strong',
          });
        }
        
        // Bearish Engulfing
        if (prevIsBullish && !currIsBullish && 
            curr.close < prev.open && curr.open > prev.close) {
          patterns.push({
            type: 'Bearish Engulfing',
            signal: 'Bearish Reversal',
            candle: i,
            strength: 'Strong',
          });
        }
      }
      
      // Pin Bar
      if (currBody < currRange * 0.3) {
        if (lowerWick > currBody * 2) {
          patterns.push({
            type: 'Bullish Pin Bar',
            signal: 'Bullish Reversal',
            candle: i,
            strength: 'Medium',
          });
        }
        if (upperWick > currBody * 2) {
          patterns.push({
            type: 'Bearish Pin Bar',
            signal: 'Bearish Reversal',
            candle: i,
            strength: 'Medium',
          });
        }
      }
    }
    
    return patterns;
  }

  /**
   * Xác định Swing High/Low
   */
  identifySwingPoints(klines) {
    const swingHighs = [];
    const swingLows = [];
    
    // Cần ít nhất 5 candles để xác định swing
    if (klines.length < 5) {
      return { highs: swingHighs, lows: swingLows };
    }
    
    for (let i = 2; i < klines.length - 2; i++) {
      const curr = klines[i];
      const left1 = klines[i - 1];
      const left2 = klines[i - 2];
      const right1 = klines[i + 1];
      const right2 = klines[i + 2];
      
      // Swing High: high > 2 candles trái và 2 candles phải
      if (curr.high > left1.high && curr.high > left2.high &&
          curr.high > right1.high && curr.high > right2.high) {
        swingHighs.push({
          index: i,
          price: curr.high,
          time: curr.time,
        });
      }
      
      // Swing Low: low < 2 candles trái và 2 candles phải
      if (curr.low < left1.low && curr.low < left2.low &&
          curr.low < right1.low && curr.low < right2.low) {
        swingLows.push({
          index: i,
          price: curr.low,
          time: curr.time,
        });
      }
    }
    
    return { 
      highs: swingHighs.slice(-5), // 5 swing highs gần nhất
      lows: swingLows.slice(-5),   // 5 swing lows gần nhất
    };
  }

  /**
   * Xác định Support/Resistance levels
   */
  identifySupportResistance(klines) {
    if (klines.length < 10) return { support: [], resistance: [] };
    
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    
    // Tìm các mức giá được test nhiều lần (tolerance 0.5%)
    const tolerance = 0.005;
    const levels = [];
    
    // Gộp tất cả high và low
    const allPrices = [...highs, ...lows];
    
    // Nhóm các giá gần nhau
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
    
    // Lọc ra các levels được test >= 3 lần
    const significantLevels = levels
      .filter(l => l.touches >= 3)
      .sort((a, b) => b.touches - a.touches)
      .slice(0, 10); // Lấy 10 levels quan trọng nhất
    
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

  /**
   * Phân tích trend structure (HH, HL, LH, LL)
   */
  analyzeTrendStructure(swings) {
    const { highs, lows } = swings;
    
    if (highs.length < 2 || lows.length < 2) {
      return { trend: 'Unknown', structure: 'Insufficient data' };
    }
    
    // So sánh 2 swing highs gần nhất
    const recentHigh1 = highs[highs.length - 1];
    const recentHigh2 = highs[highs.length - 2];
    
    // So sánh 2 swing lows gần nhất
    const recentLow1 = lows[lows.length - 1];
    const recentLow2 = lows[lows.length - 2];
    
    const higherHigh = recentHigh1.price > recentHigh2.price;
    const lowerHigh = recentHigh1.price < recentHigh2.price;
    const higherLow = recentLow1.price > recentLow2.price;
    const lowerLow = recentLow1.price < recentLow2.price;
    
    // Xác định trend
    if (higherHigh && higherLow) {
      return { trend: 'Uptrend', structure: 'Higher Highs & Higher Lows', strength: 'Strong' };
    } else if (lowerHigh && lowerLow) {
      return { trend: 'Downtrend', structure: 'Lower Highs & Lower Lows', strength: 'Strong' };
    } else if (higherHigh && lowerLow) {
      return { trend: 'Expansion', structure: 'Widening Range', strength: 'Medium' };
    } else if (lowerHigh && higherLow) {
      return { trend: 'Consolidation', structure: 'Narrowing Range (Compression)', strength: 'Medium' };
    } else {
      return { trend: 'Mixed', structure: 'Unclear trend structure', strength: 'Weak' };
    }
  }

  /**
   * Lấy dữ liệu kline từ Binance
   */
  async getBinanceKlines(symbol = 'BTCUSDT', interval = '5m', limit = 288) {
    try {
      const response = await axios.get(BINANCE_API_URL, {
        params: {
          symbol: symbol,
          interval: interval,
          limit: limit,
        },
      });

      const klines = response.data.map((k) => ({
        time: new Date(k[0]).toISOString(),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
        closeTime: new Date(k[6]).toISOString(),
      }));

      return klines;
    } catch (error) {
      console.error('[PRICE-ACTION-BOT] ❌ Lỗi khi lấy dữ liệu từ Binance:', error.message);
      throw error;
    }
  }

  /**
   * Tính toán các chỉ báo kỹ thuật (để hỗ trợ Price Action)
   */
  async calculateAllIndicators(multiTimeframeData) {
    const result = {};
    
    for (const [timeframe, klines] of Object.entries(multiTimeframeData)) {
      if (!klines || klines.length < 50) {
        continue;
      }

      const closes = klines.map(k => k.close);
      const highs = klines.map(k => k.high);
      const lows = klines.map(k => k.low);
      const opens = klines.map(k => k.open);
      const volumes = klines.map(k => k.volume);
      
      const currentPrice = closes[closes.length - 1];
      
      // Trend Indicators
      const ema20 = EMA.calculate({ values: closes, period: 20 });
      const ema50 = EMA.calculate({ values: closes, period: 50 });
      const ema200 = EMA.calculate({ values: closes, period: Math.min(200, closes.length - 1) });
      
      // Momentum
      const rsi = RSI.calculate({ values: closes, period: 14 });
      
      // Volatility
      const atr = ATR.calculate({
        high: highs,
        low: lows,
        close: closes,
        period: 14,
      });
      
      const bb = BollingerBands.calculate({
        values: closes,
        period: 20,
        stdDev: 2,
      });
      
      // Volume
      const obv = OBV.calculate({
        close: closes,
        volume: volumes,
      });
      
      const latestEma20 = ema20 && ema20.length > 0 ? ema20[ema20.length - 1] : null;
      const latestEma50 = ema50 && ema50.length > 0 ? ema50[ema50.length - 1] : null;
      const latestEma200 = ema200 && ema200.length > 0 ? ema200[ema200.length - 1] : null;
      const latestRsi = rsi && rsi.length > 0 ? rsi[rsi.length - 1] : null;
      const latestATR = atr && atr.length > 0 ? atr[atr.length - 1] : null;
      const latestBB = bb && bb.length > 0 ? bb[bb.length - 1] : null;
      const latestOBV = obv && obv.length > 0 ? obv[obv.length - 1] : null;
      
      result[timeframe] = {
        ema20: latestEma20 ? latestEma20.toFixed(this.priceDecimals) : null,
        ema50: latestEma50 ? latestEma50.toFixed(this.priceDecimals) : null,
        ema200: latestEma200 ? latestEma200.toFixed(this.priceDecimals) : null,
        rsi: latestRsi ? latestRsi.toFixed(2) : null,
        atr: latestATR ? latestATR.toFixed(this.priceDecimals) : null,
        atrPercent: latestATR ? ((latestATR / currentPrice) * 100).toFixed(2) : null,
        bb: latestBB ? {
          upper: latestBB.upper.toFixed(this.priceDecimals),
          middle: latestBB.middle.toFixed(this.priceDecimals),
          lower: latestBB.lower.toFixed(this.priceDecimals),
        } : null,
        obv: latestOBV ? latestOBV.toFixed(2) : null,
        volume: {
          current: volumes[volumes.length - 1].toFixed(2),
          average: (volumes.reduce((a, b) => a + b, 0) / volumes.length).toFixed(2),
        },
      };
    }
    
    return result;
  }

  /**
   * Format dữ liệu để gửi tới Gemini (tập trung vào Price Action)
   */
  formatPriceDataForGemini(klines, symbol, indicators = {}, priceActionAnalysis = {}) {
    if (!klines || klines.length === 0) {
      return 'Không có dữ liệu giá.';
    }

    const latest = klines[klines.length - 1];
    const currentPrice = latest.close;
    
    let dataText = `=== PHÂN TÍCH PRICE ACTION - ${symbol} ===\n\n`;
    dataText += `Giá hiện tại: ${currentPrice.toFixed(this.priceDecimals)} USDT\n`;
    dataText += `Thời gian: ${latest.time}\n\n`;

    // Price Action Analysis
    const timeframes = ['5m', '15m', '1h', '4h', '1d'];
    for (const tf of timeframes) {
      if (priceActionAnalysis[tf]) {
        const pa = priceActionAnalysis[tf];
        dataText += `\n${'='.repeat(60)}\n`;
        dataText += `KHUNG THỜI GIAN ${tf.toUpperCase()} - PRICE ACTION ANALYSIS\n`;
        dataText += `${'='.repeat(60)}\n`;
        
        // 1. Candlestick Patterns
        dataText += `\n🕯️ MÔ HÌNH NẾN (Candlestick Patterns):\n`;
        if (pa.candlestickPatterns && pa.candlestickPatterns.length > 0) {
          pa.candlestickPatterns.forEach(pattern => {
            dataText += `  - ${pattern.type}: ${pattern.signal} (Strength: ${pattern.strength})\n`;
          });
        } else {
          dataText += `  - Không có mô hình nến đặc biệt\n`;
        }
        
        // 2. Trend Structure
        dataText += `\n📊 CẤU TRÚC THỊ TRƯỜNG (Market Structure):\n`;
        if (pa.trendStructure) {
          dataText += `  - Trend: ${pa.trendStructure.trend}\n`;
          dataText += `  - Structure: ${pa.trendStructure.structure}\n`;
          if (pa.trendStructure.strength) {
            dataText += `  - Strength: ${pa.trendStructure.strength}\n`;
          }
        }
        
        // 3. Swing Points
        dataText += `\n🔺 SWING HIGH/LOW:\n`;
        if (pa.swings) {
          if (pa.swings.highs && pa.swings.highs.length > 0) {
            dataText += `  Swing Highs (gần nhất):\n`;
            pa.swings.highs.slice(-3).forEach((sh, idx) => {
              dataText += `    ${idx + 1}. ${sh.price.toFixed(this.priceDecimals)} @ ${sh.time}\n`;
            });
          }
          if (pa.swings.lows && pa.swings.lows.length > 0) {
            dataText += `  Swing Lows (gần nhất):\n`;
            pa.swings.lows.slice(-3).forEach((sl, idx) => {
              dataText += `    ${idx + 1}. ${sl.price.toFixed(this.priceDecimals)} @ ${sl.time}\n`;
            });
          }
        }
        
        // 4. Support/Resistance
        dataText += `\n🎯 SUPPORT/RESISTANCE LEVELS:\n`;
        if (pa.levels) {
          if (pa.levels.resistance && pa.levels.resistance.length > 0) {
            dataText += `  Resistance (từ gần đến xa):\n`;
            pa.levels.resistance.forEach((r, idx) => {
              const distance = ((r.price - currentPrice) / currentPrice * 100).toFixed(2);
              dataText += `    ${idx + 1}. ${r.price.toFixed(this.priceDecimals)} (+${distance}%, tested ${r.touches} lần)\n`;
            });
          }
          if (pa.levels.support && pa.levels.support.length > 0) {
            dataText += `  Support (từ gần đến xa):\n`;
            pa.levels.support.forEach((s, idx) => {
              const distance = ((currentPrice - s.price) / currentPrice * 100).toFixed(2);
              dataText += `    ${idx + 1}. ${s.price.toFixed(this.priceDecimals)} (-${distance}%, tested ${s.touches} lần)\n`;
            });
          }
        }
        
        // 5. Chỉ báo kỹ thuật (chỉ để tham khảo)
        if (indicators[tf]) {
          const ind = indicators[tf];
          dataText += `\n📈 CHỈ BÁO KỸ THUẬT (Tham khảo):\n`;
          if (ind.ema20) dataText += `  - EMA(20): ${ind.ema20}\n`;
          if (ind.ema50) dataText += `  - EMA(50): ${ind.ema50}\n`;
          if (ind.rsi) dataText += `  - RSI: ${ind.rsi}\n`;
          if (ind.atr) dataText += `  - ATR: ${ind.atr} (${ind.atrPercent}% của giá) → Dùng để tính SL\n`;
          if (ind.bb) {
            dataText += `  - Bollinger Bands: Upper=${ind.bb.upper}, Middle=${ind.bb.middle}, Lower=${ind.bb.lower}\n`;
          }
        }
      }
    }

    // Recent candles (20 candles gần nhất của 5m để AI có thể nhìn rõ price action)
    dataText += `\n${'='.repeat(60)}\n`;
    dataText += `20 CANDLES GẦN NHẤT (5m) - Chi tiết OHLC\n`;
    dataText += `${'='.repeat(60)}\n`;
    klines.slice(-20).forEach((candle, idx) => {
      const body = candle.close - candle.open;
      const bodyPercent = ((body / candle.open) * 100).toFixed(2);
      const upperWick = candle.high - Math.max(candle.open, candle.close);
      const lowerWick = Math.min(candle.open, candle.close) - candle.low;
      const candleType = body > 0 ? 'BULLISH' : body < 0 ? 'BEARISH' : 'DOJI';
      
      dataText += `${idx + 1}. [${candleType}] ${candle.time}\n`;
      dataText += `   O:${candle.open.toFixed(this.priceDecimals)} H:${candle.high.toFixed(this.priceDecimals)} `;
      dataText += `L:${candle.low.toFixed(this.priceDecimals)} C:${candle.close.toFixed(this.priceDecimals)} `;
      dataText += `| Body: ${bodyPercent >= 0 ? '+' : ''}${bodyPercent}% `;
      dataText += `| Wicks: U=${upperWick.toFixed(this.priceDecimals)} L=${lowerWick.toFixed(this.priceDecimals)}\n`;
    });

    return dataText;
  }

  /**
   * Phân tích bằng Gemini AI (theo Price Action)
   */
  async analyzeWithGemini(priceData, symbol) {
    const prompt = `
Bạn là một CHUYÊN GIA PRICE ACTION TRADING với hơn 10 năm kinh nghiệm giao dịch cryptocurrency.

**PHƯƠNG PHÁP CỦA BẠN:**
- Phân tích dựa trên Price Action THUẦN TÚY (không phụ thuộc vào chỉ báo)
- Tập trung vào: Mô hình nến, Chart Patterns, Support/Resistance, Market Structure
- Chỉ báo kỹ thuật CHỈ dùng để hỗ trợ xác nhận, KHÔNG PHẢI tín hiệu chính
- Tìm kiếm các setup có xác suất cao với Risk:Reward tốt (tối thiểu 1:2)

**DỮ LIỆU CẦN PHÂN TÍCH:**

${priceData}

**NHIỆM VỤ CỦA BẠN:**

Hãy phân tích dữ liệu trên theo phương pháp Price Action chuyên nghiệp và tìm setup giao dịch:

1. **Phân tích Market Structure (Cấu trúc thị trường):**
   - Trend hiện tại: Uptrend (HH, HL), Downtrend (LH, LL), hay Sideways/Consolidation?
   - Break of Structure (BOS) hay Change of Character (ChoCh)?
   - Market đang ở giai đoạn nào: Accumulation, Markup, Distribution, Markdown?

2. **Phân tích Candlestick Patterns (Mô hình nến):**
   - Có mô hình nến đảo chiều nào quan trọng? (Hammer, Shooting Star, Engulfing, Pin Bar, Doji, etc.)
   - Vị trí của mô hình nến (tại support/resistance, trend line, v.v.)?
   - Mức độ tin cậy của mô hình?

3. **Chart Patterns (Mô hình biểu đồ):**
   - Có phát hiện chart pattern nào? (Head & Shoulders, Double Top/Bottom, Triangle, Wedge, Flag, Pennant, Cup & Handle, etc.)
   - Pattern đang trong giai đoạn nào (đang hình thành, đã confirm, hay đã breakout)?
   - Mục tiêu giá dựa trên pattern?

4. **Support/Resistance & Key Levels:**
   - Các mức Support/Resistance quan trọng
   - Giá đang ở vị trí nào so với các levels này?
   - Có test lại level nào không? (Retest sau breakout)
   - Supply & Demand zones

5. **Entry Setup (Điểm vào lệnh):**
   - Tìm setup có xác suất cao:
     * Rejection từ Support/Resistance
     * Breakout/Breakdown với confirmation
     * Pullback trong trend
     * False breakout (liquidity grab)
   - Entry phải có lý do rõ ràng dựa trên Price Action

6. **Risk Management:**
   - Stop Loss: Đặt dưới/trên swing low/high, hoặc ngoài zone quan trọng
   - Take Profit: Dựa trên:
     * Support/Resistance tiếp theo
     * Fibonacci levels (nếu trong trend)
     * Measured move từ chart pattern
   - Risk:Reward PHẢI tối thiểu 1:2 (tốt nhất >= 1:3)

7. **Confirmation & Confluences (Xác nhận & Điểm hội tụ):**
   - Càng nhiều yếu tố hội tụ tại 1 điểm, độ tin cậy càng cao:
     * Candlestick pattern + Support/Resistance
     * Chart pattern + Volume confirmation
     * Multiple timeframe alignment
     * Fibonacci + Key levels
   - Sử dụng chỉ báo (RSI, EMA, ATR) chỉ để XÁC NHẬN, không phải tín hiệu chính

**NGUYÊN TẮC QUAN TRỌNG:**

✅ **LUÔN TÌM KIẾM SETUP CÓ EDGE:**
   - Setup phải có lý do Price Action rõ ràng
   - Risk:Reward >= 1:2 (tối thiểu)
   - Có confirmation từ nhiều yếu tố (confluences)

✅ **ƯU TIÊN CHẤT LƯỢNG HƠN SỐ LƯỢNG:**
   - Chỉ vào lệnh khi setup thực sự tốt
   - Không ép buộc tìm tín hiệu khi market không có setup rõ ràng
   - action = "none" khi KHÔNG có setup Price Action chất lượng cao

✅ **QUẢN LÝ RỦI RO:**
   - SL phải hợp lý (dựa trên ATR, swing points, hoặc structure)
   - TP phải có logic (không đoán mò)
   - Bảo vệ vốn là ưu tiên số 1

**OUTPUT FORMAT:**

Trả về JSON hợp lệ (KHÔNG có markdown, KHÔNG có text thêm):

{
  "action": "long" hoặc "short" hoặc "none",
  "entry": số (giá vào lệnh),
  "takeProfit": số (mức TP),
  "stopLoss": số (mức SL),
  "reason": "Giải thích CHI TIẾT về Price Action setup: Market structure, Candlestick/Chart patterns, Support/Resistance, Entry trigger, Confluences, Risk:Reward calculation",
  "confidence": "high" hoặc "medium" hoặc "low",
  "riskReward": số (ví dụ: 3.5 nghĩa là R:R = 1:3.5),
  "setupType": "Reversal" hoặc "Breakout" hoặc "Pullback" hoặc "Range" hoặc "None",
  "nextCheckMinutes": số (từ 15 đến 1440)
}

**LƯU Ý:**
- "action": Chỉ chọn long/short khi có setup Price Action rõ ràng và R:R >= 1:2
- "reason": Phải giải thích đầy đủ về Price Action (không chỉ dựa vào chỉ báo)
- "riskReward": Tính toán R:R = (TP - Entry) / (Entry - SL) cho long, hoặc (Entry - TP) / (SL - Entry) cho short
- "setupType": Loại setup bạn đang giao dịch
- "nextCheckMinutes": Thời gian check lại (15-60 phút nếu đang chờ setup, 60-240 nếu chưa có setup rõ)

Chỉ trả về JSON, KHÔNG có text hay markdown khác!
`;

    try {
      const result = await this.geminiModel.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      
      // Parse JSON
      let jsonText = text.trim();
      jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      jsonText = jsonText.trim();
      
      try {
        const analysis = JSON.parse(jsonText);
        console.log('[PRICE-ACTION-BOT] ✅ Đã nhận phân tích từ AI:');
        console.log(JSON.stringify(analysis, null, 2));
        return analysis;
      } catch (parseErr) {
        console.error('[PRICE-ACTION-BOT] ❌ Không thể parse JSON từ AI response:');
        console.error('Response:', text);
        console.error('Error:', parseErr.message);
        
        // Fallback: extract JSON
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const analysis = JSON.parse(jsonMatch[0]);
            console.log('[PRICE-ACTION-BOT] ✅ Đã parse JSON từ text (fallback)');
            return analysis;
          } catch (e) {
            console.error('[PRICE-ACTION-BOT] ❌ Vẫn không thể parse JSON');
            return null;
          }
        }
        
        return null;
      }
    } catch (error) {
      console.error('[PRICE-ACTION-BOT] ❌ Lỗi khi gọi Gemini AI:', error.message);
      throw error;
    }
  }

  /**
   * Thực thi giao dịch dựa trên phân tích Price Action
   */
  async executeTrade(analysis, klines) {
    try {
      if (!analysis || !analysis.action || analysis.action === 'none') {
        console.log('[PRICE-ACTION-BOT] ℹ️ Không có setup Price Action phù hợp');
        return;
      }

      const direction = analysis.action.toLowerCase();
      const entryPrice = parseFloat(analysis.entry) || klines[klines.length - 1].close;
      let takeProfit = parseFloat(analysis.takeProfit);
      let stopLoss = parseFloat(analysis.stopLoss);
      const reason = analysis.reason || 'Price Action setup';
      const confidence = analysis.confidence || 'medium';
      const setupType = analysis.setupType || 'Unknown';
      const riskReward = analysis.riskReward || 'N/A';

      console.log(`[PRICE-ACTION-BOT] 📊 Setup từ AI:`);
      console.log(`  - Action: ${direction.toUpperCase()}`);
      console.log(`  - Setup Type: ${setupType}`);
      console.log(`  - Entry: ${formatNumber(entryPrice)}`);
      console.log(`  - TP: ${formatNumber(takeProfit)}`);
      console.log(`  - SL: ${formatNumber(stopLoss)}`);
      console.log(`  - Risk:Reward: ${riskReward}`);
      console.log(`  - Confidence: ${confidence}`);
      console.log(`  - Lý do: ${reason}`);

      // Validate
      if (!entryPrice || entryPrice <= 0) {
        throw new Error('Entry price không hợp lệ');
      }
      if (!takeProfit || takeProfit <= 0) {
        throw new Error('Take profit không hợp lệ');
      }
      if (!stopLoss || stopLoss <= 0) {
        throw new Error('Stop loss không hợp lệ');
      }
      if (direction !== 'long' && direction !== 'short') {
        throw new Error(`Direction không hợp lệ: ${direction}`);
      }

      // Round giá
      const roundedEntry = this.priceTick ? roundToTick(entryPrice, this.priceTick) : parseFloat(entryPrice.toFixed(this.priceDecimals));
      const roundedTP = this.priceTick ? roundToTick(takeProfit, this.priceTick) : parseFloat(takeProfit.toFixed(this.priceDecimals));
      const roundedSL = this.priceTick ? roundToTick(stopLoss, this.priceTick) : parseFloat(stopLoss.toFixed(this.priceDecimals));

      // Lấy equity và tính lot size
      const equity = await this.getEquity();
      const lotSizeResult = this.calculateLotSize(roundedEntry, equity);

      console.log(`[PRICE-ACTION-BOT] 📈 Vào lệnh ${direction.toUpperCase()}:`);
      console.log(`  - Entry: ${formatNumber(roundedEntry)}`);
      console.log(`  - SL: ${formatNumber(roundedSL)}`);
      console.log(`  - TP: ${formatNumber(roundedTP)}`);
      console.log(`  - Lot Size: ${formatNumber(lotSizeResult.size)}`);
      console.log(`  - Capital: ${formatNumber(lotSizeResult.actualCapital || lotSizeResult.capital)} ${this.config.marginCoin}`);

      // Set leverage
      await this.configureLeverage();

      // Kiểm tra capital
      if (lotSizeResult.capitalTooLow && lotSizeResult.minCapitalRequired) {
        throw new Error(`Capital quá thấp! Cần ít nhất ${formatNumber(lotSizeResult.minCapitalRequired)} ${this.config.marginCoin}`);
      }

      // Đặt lệnh
      const side = direction === 'long' ? 'open_long' : 'open_short';
      await this.api.placeOrder({
        symbol: this.config.symbol,
        marginCoin: this.config.marginCoin,
        size: lotSizeResult.size.toString(),
        side,
        orderType: 'market',
        presetStopLossPrice: roundedSL.toFixed(this.priceDecimals),
        presetTakeProfitPrice: roundedTP.toFixed(this.priceDecimals),
      });

      console.log(`[PRICE-ACTION-BOT] ✅ Đã mở position ${direction.toUpperCase()} thành công`);

      // Lưu position state
      this.currentPosition = {
        direction,
        entryPrice: roundedEntry,
        sl: roundedSL,
        tp: roundedTP,
        size: lotSizeResult.size,
        isActive: true,
      };

      await sleep(2000);
      
      // Verify position
      const apiPosition = await this.getCurrentPosition();
      if (apiPosition) {
        this.currentPosition = apiPosition;
      }

    } catch (err) {
      console.error(`[PRICE-ACTION-BOT] ❌ Lỗi khi vào lệnh: ${err.message}`);
      throw err;
    }
  }

  /**
   * Validate thời gian chờ
   */
  validateNextCheckTime(minutes) {
    const MIN_MINUTES = 15;
    const MAX_MINUTES = 1440;
    
    if (!minutes || isNaN(minutes)) {
      console.warn('[PRICE-ACTION-BOT] ⚠️ nextCheckMinutes không hợp lệ, dùng mặc định 60 phút');
      return 60;
    }
    
    const validated = Math.max(MIN_MINUTES, Math.min(MAX_MINUTES, Math.round(minutes)));
    
    if (validated !== minutes) {
      console.log(`[PRICE-ACTION-BOT] ⚠️ Điều chỉnh thời gian từ ${minutes} về ${validated} phút`);
    }
    
    return validated;
  }

  // ========== Helper methods ==========

  async prepareMarketMeta() {
    if (this.marketInfoLoaded) return;

    try {
      console.log('[PRICE-ACTION-BOT] ⚙️ Đang lấy thông tin market...');
      const productType = this.config.symbol.includes('_UMCBL') ? 'umcbl' : undefined;
      const contract = await this.api.getContract(this.config.symbol, productType);

      if (!contract) {
        throw new Error(`Không tìm thấy contract "${this.config.symbol}"`);
      }

      const derivedPriceTick = Number(
        contract.priceTick ||
        contract.priceStep ||
        contract.minPriceChange ||
        0
      );

      const derivedSizeStep = Number(
        contract.quantityTick ||
        contract.sizeTick ||
        contract.minTradeNum ||
        0
      );

      if (!this.priceTick && derivedPriceTick > 0) {
        this.priceTick = derivedPriceTick;
        this.priceDecimals = getDecimalsFromStep(this.priceTick);
      }

      if (!this.sizeStep && derivedSizeStep > 0) {
        this.sizeStep = derivedSizeStep;
      }

      this.minLotSize = Number(
        contract.minTradeNum ||
        contract.minSize ||
        contract.minOrderSize ||
        this.sizeStep ||
        0.001
      );

      console.log(`[PRICE-ACTION-BOT] ℹ️ Thông tin contract: tick giá=${this.priceTick || 'AUTO'}, bước khối lượng=${this.sizeStep || 'AUTO'}, min lot size=${formatNumber(this.minLotSize)}`);
    } catch (err) {
      console.warn(`[PRICE-ACTION-BOT] ⚠️ Không lấy được contract spec: ${err.message}`);
      this.priceTick = this.priceTick || 0.01;
      this.priceDecimals = getDecimalsFromStep(this.priceTick);
      this.sizeStep = this.sizeStep || 0.0001;
    } finally {
      this.marketInfoLoaded = true;
    }
  }

  async configureLeverage() {
    try {
      await Promise.all(
        ['long', 'short'].map((side) =>
          this.api.setLeverage({
            symbol: this.config.symbol,
            marginCoin: this.config.marginCoin,
            leverage: this.config.leverage,
            holdSide: side,
          }).catch(err => {
            console.warn(`[PRICE-ACTION-BOT] ⚠️ Lỗi khi set leverage cho ${side}: ${err.message}`);
            throw err;
          }),
        ),
      );
      console.log(`[PRICE-ACTION-BOT] ✅ Đã thiết lập đòn bẩy ${this.config.leverage}x thành công`);
    } catch (err) {
      console.error(`[PRICE-ACTION-BOT] ❌ Lỗi khi thiết lập leverage: ${err.message}`);
      throw new Error(`Không thể thiết lập leverage ${this.config.leverage}x: ${err.message}`);
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
      console.error(`[PRICE-ACTION-BOT] ❌ Lỗi khi lấy equity: ${err.message}`);
      throw err;
    }
  }

  calculateLotSize(entryPrice, equity) {
    if (!entryPrice || entryPrice <= 0) {
      throw new Error('Entry price không hợp lệ');
    }

    if (!equity || equity <= 0) {
      throw new Error('Equity không hợp lệ');
    }

    const capital = this.config.capital && this.config.capital > 0 
      ? Math.min(this.config.capital, equity) 
      : equity;

    const notional = capital * this.config.leverage;
    let size = notional / entryPrice;

    if (this.sizeStep && this.sizeStep > 0) {
      size = roundToStep(size, this.sizeStep);
    }

    const minLotSize = this.minLotSize || (this.sizeStep && this.sizeStep > 0 ? this.sizeStep : 0.001);

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

  async getCurrentPosition() {
    try {
      const positionData = await this.api.getPosition(this.config.symbol, this.config.marginCoin);
      
      let position = positionData;
      if (Array.isArray(positionData)) {
        if (positionData.length === 0) {
          return null;
        }
        position = positionData.find(p => {
          const size = Number(p.total || p.holdSize || p.size || 0);
          return size > 0;
        });
        if (!position) {
          return null;
        }
      }
      
      if (!position) {
        return null;
      }

      const totalSize = Number(position.total || position.holdSize || position.size || 0);
      if (totalSize <= 0) {
        return null;
      }

      const direction = position.holdSide || position.side || position.direction;
      const entryPrice = Number(position.averageOpenPrice || position.openPriceAvg || position.entryPrice || position.avgEntryPrice || 0);

      if (entryPrice <= 0) {
        return null;
      }

      return {
        direction: direction === 'long' ? 'long' : 'short',
        entryPrice,
        size: totalSize,
        isActive: true,
        orderId: position.positionId || null,
        sl: position.stopLossPrice ? parseFloat(position.stopLossPrice) : null,
        tp: position.takeProfitPrice ? parseFloat(position.takeProfitPrice) : null,
      };
    } catch (err) {
      return null;
    }
  }
}

module.exports = { PriceActionBot };



