/**
 * Gemini AI Trading Bot
 * 
 * Bot tự động phân tích giá bằng Gemini AI và vào lệnh
 * - Lấy dữ liệu 5 phút trong 1 ngày gần nhất từ Binance
 * - Gửi tới Gemini AI để phân tích
 * - Tự động vào lệnh theo khuyến nghị của AI
 * - Chạy mỗi 1 giờ một lần
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

class GeminiBot {
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
      
      // Run interval (1 giờ = 3600000ms)
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
    console.log('[GEMINI-BOT] 🚀 Khởi động Gemini AI Trading Bot');
    const capitalStr = this.config.capital && this.config.capital > 0 
      ? `${this.config.capital} ${this.config.marginCoin}` 
      : 'Auto (toàn bộ equity)';
    console.table({
      'Cặp giao dịch': this.config.symbol,
      'Capital': capitalStr,
      'Leverage': `${this.config.leverage}x`,
      'Chạy mỗi': '1 giờ',
      'Nguồn dữ liệu': 'Binance 5m (1 ngày)',
    });

    await this.prepareMarketMeta();
    await this.initializeGeminiModel();

    // Kiểm tra positions hiện tại
    console.log('[GEMINI-BOT] 🔍 Kiểm tra positions hiện tại...');
    const existingPosition = await this.getCurrentPosition();
    
    if (existingPosition) {
      console.log(`[GEMINI-BOT] ✅ Phát hiện position đang mở: ${existingPosition.direction.toUpperCase()}`);
      console.log(`  - Entry: ${formatNumber(existingPosition.entryPrice)}`);
      console.log(`  - SL: ${existingPosition.sl ? formatNumber(existingPosition.sl) : 'N/A'}`);
      console.log(`  - TP: ${existingPosition.tp ? formatNumber(existingPosition.tp) : 'N/A'}`);
      console.log(`  - Size: ${formatNumber(existingPosition.size)}`);
      this.currentPosition = existingPosition;
    } else {
      console.log('[GEMINI-BOT] ℹ️ Không có position nào đang mở');
    }

    // Main loop - AI tự ước tính thời gian chạy tiếp theo
    console.log(`[GEMINI-BOT] ⏰ Bot sẽ tự động điều chỉnh thời gian chạy dựa trên phân tích AI...\n`);
    
    while (this.isRunning) {
      try {
        const nextCheckMinutes = await this.executeCycle();
        
        // Sử dụng thời gian do AI đề xuất, với validation
        const validatedMinutes = this.validateNextCheckTime(nextCheckMinutes);
        const waitMs = validatedMinutes * 60 * 1000;
        const nextRun = new Date(Date.now() + waitMs);
        
        const hours = Math.floor(validatedMinutes / 60);
        const minutes = validatedMinutes % 60;
        const timeStr = hours > 0 
          ? `${hours} giờ ${minutes} phút`
          : `${minutes} phút`;
        
        console.log(`\n[GEMINI-BOT] ⏳ AI đề xuất đợi ${timeStr} (${validatedMinutes} phút)`);
        console.log(`  Lần chạy tiếp theo: ${nextRun.toLocaleString('vi-VN')}\n`);
        await sleep(waitMs);
      } catch (err) {
        console.error(`[GEMINI-BOT] ❌ Lỗi trong cycle: ${err.message}`);
        if (err.stack) {
          console.error(err.stack);
        }
        // Đợi 30 phút trước khi retry nếu có lỗi
        console.log('[GEMINI-BOT] ⏳ Đợi 30 phút trước khi retry...');
        await sleep(30 * 60 * 1000);
      }
    }
  }

  /**
   * Khởi tạo Gemini model
   */
  async initializeGeminiModel() {
    try {
      console.log('[GEMINI-BOT] 🤖 Đang khởi tạo Gemini AI...');
      
      // Thử các model theo thứ tự ưu tiên
      const modelsToTry = ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-pro'];
      
      for (const modelName of modelsToTry) {
        try {
          this.geminiModel = this.genAI.getGenerativeModel({ model: modelName });
          // Test với một prompt đơn giản
          const testResult = await this.geminiModel.generateContent('Test');
          console.log(`[GEMINI-BOT] ✅ Đã khởi tạo model: ${modelName}`);
          return;
        } catch (err) {
          console.log(`[GEMINI-BOT] ⚠️ Model ${modelName} không khả dụng, thử model khác...`);
          continue;
        }
      }
      
      throw new Error('Không tìm thấy model Gemini nào khả dụng');
    } catch (err) {
      console.error(`[GEMINI-BOT] ❌ Lỗi khi khởi tạo Gemini: ${err.message}`);
      throw err;
    }
  }

  /**
   * Chu kỳ chạy chính
   */
  async executeCycle() {
    console.log('\n' + '='.repeat(60));
    console.log(`[GEMINI-BOT] 🔄 Bắt đầu chu kỳ mới - ${new Date().toLocaleString('vi-VN')}`);
    console.log('='.repeat(60));

    // Kiểm tra position hiện tại
    const position = await this.getCurrentPosition();
    if (position) {
      console.log(`[GEMINI-BOT] ℹ️ Đang có position ${position.direction.toUpperCase()}, bỏ qua phân tích mới`);
      this.currentPosition = position;
      return;
    }

    // 1. Lấy dữ liệu đa khung thời gian từ Binance
    console.log('[GEMINI-BOT] 📥 Đang lấy dữ liệu đa khung thời gian từ Binance...');
    const binanceSymbol = this.config.symbol.replace('_UMCBL', ''); // BTCUSDT_UMCBL -> BTCUSDT
    
    const [klines5m, klines1h, klines4h, klines1d] = await Promise.all([
      this.getBinanceKlines(binanceSymbol, '5m', 288), // 1 ngày
      this.getBinanceKlines(binanceSymbol, '1h', 168), // 1 tuần
      this.getBinanceKlines(binanceSymbol, '4h', 90),  // 15 ngày
      this.getBinanceKlines(binanceSymbol, '1d', 30),  // 30 ngày
    ]);
    
    console.log(`[GEMINI-BOT] ✅ Đã lấy được dữ liệu:`);
    console.log(`  - 5m: ${klines5m.length} candles (1 ngày)`);
    console.log(`  - 1h: ${klines1h.length} candles (1 tuần)`);
    console.log(`  - 4h: ${klines4h.length} candles (15 ngày)`);
    console.log(`  - 1d: ${klines1d.length} candles (30 ngày)`);

    // 2. Tính toán các chỉ báo kỹ thuật
    console.log('[GEMINI-BOT] 📊 Đang tính toán các chỉ báo kỹ thuật...');
    const indicators = await this.calculateAllIndicators({
      '5m': klines5m,
      '1h': klines1h,
      '4h': klines4h,
      '1d': klines1d,
    });
    console.log('[GEMINI-BOT] ✅ Đã tính toán xong các chỉ báo');

    // 3. Format dữ liệu với chỉ báo
    const priceData = this.formatPriceDataForGemini(klines5m, binanceSymbol, indicators);

    // 4. Phân tích bằng Gemini AI
    console.log('[GEMINI-BOT] 🤖 Đang phân tích bằng Gemini AI...');
    const analysis = await this.analyzeWithGemini(priceData, binanceSymbol);
    
    // 5. Parse kết quả và vào lệnh
    if (analysis && analysis.action && analysis.action !== 'none') {
      await this.executeTrade(analysis, klines5m);
    } else {
      console.log('[GEMINI-BOT] ℹ️ AI không khuyến nghị vào lệnh lúc này');
      if (analysis) {
        console.log('Phân tích:', JSON.stringify(analysis, null, 2));
      }
    }

    // 6. Trả về thời gian chờ do AI đề xuất
    const nextCheckMinutes = analysis && analysis.nextCheckMinutes 
      ? analysis.nextCheckMinutes 
      : 60; // Fallback: 1 giờ nếu AI không trả về
    
    return nextCheckMinutes;
  }

  /**
   * Validate và điều chỉnh thời gian chờ do AI đề xuất
   */
  validateNextCheckTime(minutes) {
    const MIN_MINUTES = 15;  // Ít nhất 15 phút
    const MAX_MINUTES = 1440; // Nhiều nhất 24 giờ
    
    if (!minutes || isNaN(minutes)) {
      console.warn('[GEMINI-BOT] ⚠️ nextCheckMinutes không hợp lệ, dùng giá trị mặc định 60 phút');
      return 60;
    }
    
    const validated = Math.max(MIN_MINUTES, Math.min(MAX_MINUTES, Math.round(minutes)));
    
    if (validated !== minutes) {
      console.log(`[GEMINI-BOT] ⚠️ Điều chỉnh thời gian từ ${minutes} phút về ${validated} phút (min: ${MIN_MINUTES}, max: ${MAX_MINUTES})`);
    }
    
    return validated;
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
      console.error('[GEMINI-BOT] ❌ Lỗi khi lấy dữ liệu từ Binance:', error.message);
      throw error;
    }
  }

  /**
   * Tính toán tất cả các chỉ báo kỹ thuật từ 4 nhóm
   */
  async calculateAllIndicators(multiTimeframeData) {
    const result = {};
    
    for (const [timeframe, klines] of Object.entries(multiTimeframeData)) {
      if (!klines || klines.length < 50) {
        continue; // Bỏ qua nếu không đủ dữ liệu
      }

      const closes = klines.map(k => k.close);
      const highs = klines.map(k => k.high);
      const lows = klines.map(k => k.low);
      const opens = klines.map(k => k.open);
      const volumes = klines.map(k => k.volume);
      
      const currentPrice = closes[closes.length - 1];
      
      // 1. NHÓM CHỈ BÁO XU HƯỚNG (Trend Indicators)
      // EMA
      const ema10 = EMA.calculate({ values: closes, period: 10 });
      const ema20 = EMA.calculate({ values: closes, period: 20 });
      const ema50 = EMA.calculate({ values: closes, period: 50 });
      const ema200 = EMA.calculate({ values: closes, period: Math.min(200, closes.length - 1) });
      
      // SMA
      const sma20 = SMA.calculate({ values: closes, period: 20 });
      const sma50 = SMA.calculate({ values: closes, period: Math.min(50, closes.length - 1) });
      
      // MACD
      const macd = MACD.calculate({
        values: closes,
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9,
        SimpleMAOscillator: false,
        SimpleMASignal: false,
      });
      
      // ADX
      const adx = ADX.calculate({
        high: highs,
        low: lows,
        close: closes,
        period: 14,
      });
      
      // 2. NHÓM CHỈ BÁO ĐỘNG LƯỢNG (Momentum/Oscillator)
      // RSI
      const rsi = RSI.calculate({ values: closes, period: 14 });
      
      // Stochastic
      const stochastic = Stochastic.calculate({
        high: highs,
        low: lows,
        close: closes,
        period: 14,
        signalPeriod: 3,
      });
      
      // ROC
      const roc = ROC.calculate({ values: closes, period: 10 });
      
      // 3. NHÓM CHỈ BÁO BIẾN ĐỘNG (Volatility)
      // Bollinger Bands
      const bb = BollingerBands.calculate({
        values: closes,
        period: 20,
        stdDev: 2,
      });
      
      // ATR
      const atr = ATR.calculate({
        high: highs,
        low: lows,
        close: closes,
        period: 14,
      });
      
      // 4. NHÓM CHỈ BÁO KHỐI LƯỢNG (Volume)
      // OBV
      const obv = OBV.calculate({
        close: closes,
        volume: volumes,
      });
      
      // Feature Engineering
      const latestEma10 = ema10 && ema10.length > 0 ? ema10[ema10.length - 1] : null;
      const latestEma20 = ema20 && ema20.length > 0 ? ema20[ema20.length - 1] : null;
      const latestEma50 = ema50 && ema50.length > 0 ? ema50[ema50.length - 1] : null;
      const latestMacd = macd && macd.length > 0 ? macd[macd.length - 1] : null;
      const latestAdx = adx && adx.length > 0 ? adx[adx.length - 1] : null;
      const latestRsi = rsi && rsi.length > 0 ? rsi[rsi.length - 1] : null;
      const latestStoch = stochastic && stochastic.length > 0 ? stochastic[stochastic.length - 1] : null;
      const latestRoc = roc && roc.length > 0 ? roc[roc.length - 1] : null;
      const latestBB = bb && bb.length > 0 ? bb[bb.length - 1] : null;
      const latestATR = atr && atr.length > 0 ? atr[atr.length - 1] : null;
      const latestOBV = obv && obv.length > 0 ? obv[obv.length - 1] : null;
      
      // Tính slope của EMA (độ dốc)
      const ema10Slope = ema10 && ema10.length >= 2 
        ? ((ema10[ema10.length - 1] - ema10[ema10.length - 2]) / ema10[ema10.length - 2] * 100).toFixed(4)
        : null;
      const ema20Slope = ema20 && ema20.length >= 2
        ? ((ema20[ema20.length - 1] - ema20[ema20.length - 2]) / ema20[ema20.length - 2] * 100).toFixed(4)
        : null;
      
      // Khoảng cách giữa giá và MA (tính bằng %)
      const priceToEma20 = latestEma20 ? ((currentPrice - latestEma20) / latestEma20 * 100).toFixed(2) : null;
      const priceToEma50 = latestEma50 ? ((currentPrice - latestEma50) / latestEma50 * 100).toFixed(2) : null;
      
      // Boolean flags
      const rsiOverbought = latestRsi ? latestRsi > 70 : false;
      const rsiOversold = latestRsi ? latestRsi < 30 : false;
      const priceAboveBB = latestBB ? currentPrice > latestBB.upper : false;
      const priceBelowBB = latestBB ? currentPrice < latestBB.lower : false;
      const emaBullish = latestEma10 && latestEma20 ? latestEma10 > latestEma20 : false;
      const macdBullish = latestMacd ? latestMacd.MACD > latestMacd.signal : false;
      
      result[timeframe] = {
        // Trend Indicators
        trend: {
          ema10: latestEma10 ? latestEma10.toFixed(this.priceDecimals) : null,
          ema20: latestEma20 ? latestEma20.toFixed(this.priceDecimals) : null,
          ema50: latestEma50 ? latestEma50.toFixed(this.priceDecimals) : null,
          ema200: ema200 && ema200.length > 0 ? ema200[ema200.length - 1].toFixed(this.priceDecimals) : null,
          sma20: sma20 && sma20.length > 0 ? sma20[sma20.length - 1].toFixed(this.priceDecimals) : null,
          sma50: sma50 && sma50.length > 0 ? sma50[sma50.length - 1].toFixed(this.priceDecimals) : null,
          macd: latestMacd ? {
            macd: latestMacd.MACD.toFixed(4),
            signal: latestMacd.signal.toFixed(4),
            histogram: latestMacd.histogram.toFixed(4),
          } : null,
          adx: latestAdx ? latestAdx.adx.toFixed(2) : null,
        },
        // Momentum Indicators
        momentum: {
          rsi: latestRsi ? latestRsi.toFixed(2) : null,
          rsiOverbought,
          rsiOversold,
          stochastic: latestStoch ? {
            k: latestStoch.k.toFixed(2),
            d: latestStoch.d.toFixed(2),
          } : null,
          roc: latestRoc ? latestRoc.toFixed(2) : null,
        },
        // Volatility Indicators
        volatility: {
          bb: latestBB ? {
            upper: latestBB.upper.toFixed(this.priceDecimals),
            middle: latestBB.middle.toFixed(this.priceDecimals),
            lower: latestBB.lower.toFixed(this.priceDecimals),
            width: ((latestBB.upper - latestBB.lower) / latestBB.middle * 100).toFixed(2),
          } : null,
          atr: latestATR ? latestATR.toFixed(this.priceDecimals) : null,
          atrPercent: latestATR ? ((latestATR / currentPrice) * 100).toFixed(2) : null,
        },
        // Volume Indicators
        volume: {
          current: volumes[volumes.length - 1].toFixed(2),
          average: (volumes.reduce((a, b) => a + b, 0) / volumes.length).toFixed(2),
          obv: latestOBV ? latestOBV.toFixed(2) : null,
          obvChange: obv && obv.length >= 2 
            ? ((obv[obv.length - 1] - obv[obv.length - 2]) / Math.abs(obv[obv.length - 2]) * 100).toFixed(2)
            : null,
        },
        // Feature Engineering
        features: {
          ema10Slope,
          ema20Slope,
          priceToEma20,
          priceToEma50,
          emaBullish,
          macdBullish,
          priceAboveBB,
          priceBelowBB,
        },
      };
    }
    
    return result;
  }

  /**
   * Format dữ liệu giá với chỉ báo kỹ thuật để gửi tới Gemini
   */
  formatPriceDataForGemini(klines, symbol, indicators = {}) {
    if (!klines || klines.length === 0) {
      return 'Không có dữ liệu giá.';
    }

    const latest = klines[klines.length - 1];
    const oldest = klines[0];
    
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    
    const highest = Math.max(...highs);
    const lowest = Math.min(...lows);
    const currentPrice = latest.close;
    const priceChange = currentPrice - oldest.close;
    const priceChangePercent = ((priceChange / oldest.close) * 100).toFixed(2);
    
    let dataText = `=== DỮ LIỆU GIÁ VÀ CHỈ BÁO KỸ THUẬT - ${symbol} ===\n\n`;
    dataText += `Thời gian: ${oldest.time} đến ${latest.time}\n`;
    dataText += `Giá hiện tại: ${currentPrice.toFixed(this.priceDecimals)} USDT\n`;
    dataText += `Biến động 24h: ${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(this.priceDecimals)} USDT (${priceChangePercent >= 0 ? '+' : ''}${priceChangePercent}%)\n\n`;

    // Đa khung thời gian và chỉ báo
    const timeframes = ['5m', '1h', '4h', '1d'];
    for (const tf of timeframes) {
      if (indicators[tf]) {
        const ind = indicators[tf];
        dataText += `\n=== KHUNG THỜI GIAN ${tf.toUpperCase()} ===\n`;
        
        // Trend Indicators
        dataText += `\n📈 NHÓM CHỈ BÁO XU HƯỚNG (Trend):\n`;
        if (ind.trend) {
          if (ind.trend.ema10) dataText += `  - EMA(10): ${ind.trend.ema10}\n`;
          if (ind.trend.ema20) dataText += `  - EMA(20): ${ind.trend.ema20}\n`;
          if (ind.trend.ema50) dataText += `  - EMA(50): ${ind.trend.ema50}\n`;
          if (ind.trend.ema200) dataText += `  - EMA(200): ${ind.trend.ema200}\n`;
          if (ind.trend.macd) {
            dataText += `  - MACD: ${ind.trend.macd.macd} | Signal: ${ind.trend.macd.signal} | Histogram: ${ind.trend.macd.histogram}\n`;
            if (ind.features?.macdBullish) dataText += `    → MACD ${ind.features.macdBullish ? 'BULLISH' : 'BEARISH'} (MACD > Signal)\n`;
          }
          if (ind.trend.adx) {
            const adxVal = parseFloat(ind.trend.adx);
            const trendStrength = adxVal >= 25 ? 'MẠNH' : adxVal >= 20 ? 'TRUNG BÌNH' : 'YẾU';
            dataText += `  - ADX: ${ind.trend.adx} (Xu hướng: ${trendStrength})\n`;
          }
        }
        
        // Momentum Indicators
        dataText += `\n⚡ NHÓM CHỈ BÁO ĐỘNG LƯỢNG (Momentum):\n`;
        if (ind.momentum) {
          if (ind.momentum.rsi) {
            const rsiVal = parseFloat(ind.momentum.rsi);
            const rsiStatus = ind.momentum.rsiOverbought ? 'QUÁ MUA (>70)' : ind.momentum.rsiOversold ? 'QUÁ BÁN (<30)' : 'BÌNH THƯỜNG';
            dataText += `  - RSI(14): ${ind.momentum.rsi} → ${rsiStatus}\n`;
          }
          if (ind.momentum.stochastic) {
            dataText += `  - Stochastic: K=${ind.momentum.stochastic.k}, D=${ind.momentum.stochastic.d}\n`;
          }
          if (ind.momentum.roc) {
            dataText += `  - ROC(10): ${ind.momentum.roc}%\n`;
          }
        }
        
        // Volatility Indicators
        dataText += `\n📊 NHÓM CHỈ BÁO BIẾN ĐỘNG (Volatility):\n`;
        if (ind.volatility) {
          if (ind.volatility.bb) {
            dataText += `  - Bollinger Bands: Upper=${ind.volatility.bb.upper}, Middle=${ind.volatility.bb.middle}, Lower=${ind.volatility.bb.lower}\n`;
            dataText += `    - Band Width: ${ind.volatility.bb.width}% (${ind.features?.priceAboveBB ? 'Giá > Upper' : ind.features?.priceBelowBB ? 'Giá < Lower' : 'Giá trong band'})\n`;
          }
          if (ind.volatility.atr) {
            dataText += `  - ATR(14): ${ind.volatility.atr} (${ind.volatility.atrPercent}% so với giá)\n`;
            dataText += `    → Dùng để tính SL: SL nên cách entry ít nhất ${ind.volatility.atrPercent}%\n`;
          }
        }
        
        // Volume Indicators
        dataText += `\n📦 NHÓM CHỈ BÁO KHỐI LƯỢNG (Volume):\n`;
        if (ind.volume) {
          dataText += `  - Volume hiện tại: ${ind.volume.current}\n`;
          dataText += `  - Volume trung bình: ${ind.volume.average}\n`;
          if (ind.volume.obv) {
            dataText += `  - OBV: ${ind.volume.obv}`;
            if (ind.volume.obvChange) {
              dataText += ` (${ind.volume.obvChange >= 0 ? '+' : ''}${ind.volume.obvChange}%)\n`;
            } else {
              dataText += `\n`;
            }
          }
        }
        
        // Feature Engineering
        dataText += `\n🔧 FEATURE ENGINEERING:\n`;
        if (ind.features) {
          if (ind.features.ema10Slope) dataText += `  - EMA(10) Slope: ${ind.features.ema10Slope >= 0 ? '+' : ''}${ind.features.ema10Slope}%\n`;
          if (ind.features.priceToEma20) dataText += `  - Giá so với EMA(20): ${ind.features.priceToEma20 >= 0 ? '+' : ''}${ind.features.priceToEma20}%\n`;
          if (ind.features.emaBullish !== undefined) {
            dataText += `  - EMA Alignment: ${ind.features.emaBullish ? 'BULLISH' : 'BEARISH'} (EMA10 ${ind.features.emaBullish ? '>' : '<'} EMA20)\n`;
          }
        }
      }
    }

    // Thống kê giá
    dataText += `\n\n=== THỐNG KÊ GIÁ (5m - 1 ngày) ===\n`;
    dataText += `Giá cao nhất: ${highest.toFixed(this.priceDecimals)} USDT\n`;
    dataText += `Giá thấp nhất: ${lowest.toFixed(this.priceDecimals)} USDT\n`;
    dataText += `Biên độ: ${((highest - lowest) / currentPrice * 100).toFixed(2)}%\n\n`;

    // 10 candles gần nhất
    dataText += `=== 10 CANDLES GẦN NHẤT (5m) ===\n`;
    klines.slice(-10).forEach((candle, idx) => {
      const change = candle.close - candle.open;
      const changePercent = ((change / candle.open) * 100).toFixed(2);
      dataText += `${idx + 1}. ${candle.time} | O:${candle.open.toFixed(this.priceDecimals)} H:${candle.high.toFixed(this.priceDecimals)} L:${candle.low.toFixed(this.priceDecimals)} C:${candle.close.toFixed(this.priceDecimals)} | ${change >= 0 ? '+' : ''}${changePercent}% | Vol:${candle.volume.toFixed(2)}\n`;
    });

    return dataText;
  }

  /**
   * Phân tích bằng Gemini AI và trả về JSON với tín hiệu giao dịch
   */
  async analyzeWithGemini(priceData, symbol) {
    const prompt = `
Bạn là một chuyên gia phân tích kỹ thuật cryptocurrency chuyên nghiệp với nhiều năm kinh nghiệm.

Hãy phân tích DỮ LIỆU GIÁ VÀ CHỈ BÁO KỸ THUẬT sau đây từ Binance và đưa ra nhận định giao dịch:

${priceData}

**HƯỚNG DẪN PHÂN TÍCH:**

1. **XÁC ĐỊNH XU HƯỚNG TỔNG QUAN** (dựa trên khung thời gian lớn 4h, 1d):
   - Sử dụng EMA, MACD, ADX để xác định xu hướng chính
   - ADX >= 25: Xu hướng mạnh, có thể giao dịch theo trend
   - ADX < 20: Thị trường đi ngang, cần cẩn thận

2. **TÍN HIỆU VÀO LỆNH** (dựa trên khung 5m, 1h):
   - LONG: EMA bullish alignment (EMA10 > EMA20), MACD bullish, RSI không quá mua (< 70), giá trên EMA
   - SHORT: EMA bearish alignment (EMA10 < EMA20), MACD bearish, RSI không quá bán (> 30), giá dưới EMA
   - Xác nhận bằng Volume: OBV tăng cho LONG, OBV giảm cho SHORT

3. **TÍNH TOÁN TP/SL**:
   - Sử dụng ATR để tính SL: SL nên cách entry ít nhất 1-2x ATR
   - TP: Áp dụng Risk:Reward ratio 1:2 hoặc 1:3
   - Xem xét các mức kháng cự/hỗ trợ từ Bollinger Bands

4. **ĐIỀU KIỆN KHÔNG VÀO LỆNH (action = "none")**:
   - Xu hướng không rõ ràng (ADX thấp ở nhiều khung thời gian)
   - RSI quá mua/quá bán cực độ (>80 hoặc <20)
   - Tín hiệu mâu thuẫn giữa các khung thời gian
   - Volume thấp (dưới trung bình)

**QUAN TRỌNG: Bạn PHẢI trả về kết quả dưới dạng JSON hợp lệ, không có text thêm. Format như sau:**

{
  "action": "long" hoặc "short" hoặc "none",
  "entry": số (giá vào lệnh),
  "takeProfit": số (mức chốt lời),
  "stopLoss": số (mức cắt lỗ),
  "reason": "Lý do chi tiết dựa trên các chỉ báo (tối đa 3 câu)",
  "confidence": "high" hoặc "medium" hoặc "low",
  "nextCheckMinutes": số (số phút nên đợi trước khi phân tích lại, từ 15 đến 1440)
}

**Quy tắc:**
- "action": 
  - "long": Nếu có đủ tín hiệu bullish từ các chỉ báo
  - "short": Nếu có đủ tín hiệu bearish từ các chỉ báo
  - "none": Nếu không có tín hiệu rõ ràng hoặc tín hiệu mâu thuẫn
- "entry": Giá cụ thể để vào lệnh (sử dụng giá hiện tại hoặc giá gần nhất từ khung 5m)
- "takeProfit": Mức giá để chốt lời (tính dựa trên ATR và Risk:Reward 1:2 hoặc 1:3)
- "stopLoss": Mức giá để cắt lỗ (tính dựa trên ATR, thường là 1-2x ATR từ entry)
- "reason": Giải thích chi tiết dựa trên các chỉ báo bạn thấy (ví dụ: "EMA bullish alignment, MACD crossover bullish, RSI 45, ADX 28 cho thấy xu hướng tăng mạnh")
- "confidence": 
  - "high": Khi nhiều chỉ báo đồng thuận và xu hướng rõ ràng
  - "medium": Khi có tín hiệu nhưng một số chỉ báo còn mâu thuẫn
  - "low": Khi tín hiệu yếu hoặc thị trường đi ngang

- "nextCheckMinutes": Số phút nên đợi trước khi phân tích lại (từ 15 đến 1440 phút = 24 giờ)
  **QUAN TRỌNG**: Ước tính thời gian dựa trên:
  - Biến động thị trường (ATR cao → check thường xuyên hơn, ATR thấp → check ít hơn)
  - Độ tin cậy tín hiệu (confidence low → check lại sớm hơn để tìm cơ hội mới)
  - Xu hướng thị trường (xu hướng mạnh → check ít hơn, thị trường đi ngang → check thường xuyên hơn)
  - Có tín hiệu sắp xuất hiện (RSI gần vùng quá mua/quá bán, MACD sắp crossover → check sớm hơn)
  - **Gợi ý**:
    * Thị trường biến động mạnh + tín hiệu sắp xuất hiện: 15-30 phút
    * Tín hiệu rõ ràng + confidence high: 60-120 phút
    * Thị trường đi ngang + không có tín hiệu: 180-360 phút
    * Xu hướng ổn định + confidence high: 480-720 phút

**Chỉ trả về JSON, không có text hoặc markdown khác!**
`;

    try {
      const result = await this.geminiModel.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      
      // Parse JSON từ response
      // Loại bỏ markdown code blocks nếu có
      let jsonText = text.trim();
      jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      jsonText = jsonText.trim();
      
      try {
        const analysis = JSON.parse(jsonText);
        console.log('[GEMINI-BOT] ✅ Đã nhận phân tích từ AI:');
        console.log(JSON.stringify(analysis, null, 2));
        return analysis;
      } catch (parseErr) {
        console.error('[GEMINI-BOT] ❌ Không thể parse JSON từ AI response:');
        console.error('Response:', text);
        console.error('Error:', parseErr.message);
        
        // Fallback: Thử extract JSON từ text
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const analysis = JSON.parse(jsonMatch[0]);
            console.log('[GEMINI-BOT] ✅ Đã parse JSON từ text (fallback)');
            return analysis;
          } catch (e) {
            console.error('[GEMINI-BOT] ❌ Vẫn không thể parse JSON');
            return null;
          }
        }
        
        return null;
      }
    } catch (error) {
      console.error('[GEMINI-BOT] ❌ Lỗi khi gọi Gemini AI:', error.message);
      throw error;
    }
  }

  /**
   * Thực thi giao dịch dựa trên phân tích của AI
   */
  async executeTrade(analysis, klines) {
    try {
      if (!analysis || !analysis.action || analysis.action === 'none') {
        console.log('[GEMINI-BOT] ℹ️ Không có tín hiệu để vào lệnh');
        return;
      }

      const direction = analysis.action.toLowerCase(); // 'long' hoặc 'short'
      const entryPrice = parseFloat(analysis.entry) || klines[klines.length - 1].close;
      const takeProfit = parseFloat(analysis.takeProfit);
      const stopLoss = parseFloat(analysis.stopLoss);
      const reason = analysis.reason || 'Phân tích từ AI';
      const confidence = analysis.confidence || 'medium';

      console.log(`[GEMINI-BOT] 📊 Tín hiệu từ AI:`);
      console.log(`  - Action: ${direction.toUpperCase()}`);
      console.log(`  - Entry: ${formatNumber(entryPrice)}`);
      console.log(`  - TP: ${formatNumber(takeProfit)}`);
      console.log(`  - SL: ${formatNumber(stopLoss)}`);
      console.log(`  - Lý do: ${reason}`);
      console.log(`  - Độ tin cậy: ${confidence}`);

      // Validate giá
      if (!entryPrice || entryPrice <= 0) {
        throw new Error('Entry price không hợp lệ');
      }
      if (!takeProfit || takeProfit <= 0) {
        throw new Error('Take profit không hợp lệ');
      }
      if (!stopLoss || stopLoss <= 0) {
        throw new Error('Stop loss không hợp lệ');
      }

      // Validate direction
      if (direction !== 'long' && direction !== 'short') {
        throw new Error(`Direction không hợp lệ: ${direction}`);
      }

      // Round giá theo tick
      const roundedEntry = this.priceTick ? roundToTick(entryPrice, this.priceTick) : entryPrice;
      const roundedTP = this.priceTick ? roundToTick(takeProfit, this.priceTick) : takeProfit;
      const roundedSL = this.priceTick ? roundToTick(stopLoss, this.priceTick) : stopLoss;

      // Lấy equity
      const equity = await this.getEquity();

      // Tính lot size
      const lotSizeResult = this.calculateLotSize(roundedEntry, equity);

      console.log(`[GEMINI-BOT] 📈 Vào lệnh ${direction.toUpperCase()}:`);
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
        presetStopLossPrice: roundedSL.toString(),
        presetTakeProfitPrice: roundedTP.toString(),
      });

      console.log(`[GEMINI-BOT] ✅ Đã mở position ${direction.toUpperCase()} thành công`);

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
      console.error(`[GEMINI-BOT] ❌ Lỗi khi vào lệnh: ${err.message}`);
      throw err;
    }
  }

  // ========== Helper methods (copy from smartTrendBot) ==========

  async prepareMarketMeta() {
    if (this.marketInfoLoaded) return;

    try {
      console.log('[GEMINI-BOT] ⚙️ Đang lấy thông tin market...');
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

      console.log(`[GEMINI-BOT] ℹ️ Thông tin contract: tick giá=${this.priceTick || 'AUTO'}, bước khối lượng=${this.sizeStep || 'AUTO'}, min lot size=${formatNumber(this.minLotSize)}`);
    } catch (err) {
      console.warn(`[GEMINI-BOT] ⚠️ Không lấy được contract spec: ${err.message}`);
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
            console.warn(`[GEMINI-BOT] ⚠️ Lỗi khi set leverage cho ${side}: ${err.message}`);
            throw err;
          }),
        ),
      );
      console.log(`[GEMINI-BOT] ✅ Đã thiết lập đòn bẩy ${this.config.leverage}x thành công`);
    } catch (err) {
      console.error(`[GEMINI-BOT] ❌ Lỗi khi thiết lập leverage: ${err.message}`);
      throw new Error(`Không thể thiết lập leverage ${this.config.leverage}x: ${err.message}`);
    }
  }

  async getEquity() {
    try {
      const productType = this.config.symbol.includes('_UMCBL') ? 'umcbl' : 'umcbl';
      const account = await this.api.getAccount(productType, this.config.marginCoin);
      
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
      console.error(`[GEMINI-BOT] ❌ Lỗi khi lấy equity: ${err.message}`);
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

    // Sử dụng capital nếu được chỉ định, nếu không dùng equity
    const capital = this.config.capital && this.config.capital > 0 
      ? Math.min(this.config.capital, equity) 
      : equity;

    // Tính notional value (giá trị hợp đồng)
    const notional = capital * this.config.leverage;

    // Tính số contracts: size = notional / entryPrice
    let size = notional / entryPrice;

    // Round theo sizeStep
    if (this.sizeStep && this.sizeStep > 0) {
      size = roundToStep(size, this.sizeStep);
    }

    // Minimum lot size từ contract spec
    const minLotSize = this.minLotSize || (this.sizeStep && this.sizeStep > 0 ? this.sizeStep : 0.001);

    // Kiểm tra nếu size < minLotSize
    if (size < minLotSize) {
      // Nếu size < min lot size, tính lại capital tối thiểu cần thiết
      const minNotional = minLotSize * entryPrice;
      const minCapitalRequired = minNotional / this.config.leverage;
      
      return {
        size: Number(minLotSize.toFixed(8)),
        capital: capital,
        minCapitalRequired: minCapitalRequired,
        warning: `⚠️ Capital quá thấp. Lot size tính ra (${formatNumber(size)}) nhỏ hơn minimum lot size (${formatNumber(minLotSize)}). Cần ít nhất ${formatNumber(minCapitalRequired)} ${this.config.marginCoin} để mở lệnh với leverage ${this.config.leverage}x`,
        capitalTooLow: true,
      };
    }

    // Tính lại capital thực tế sau khi round
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
      
      // Xử lý nếu API trả về array
      let position = positionData;
      if (Array.isArray(positionData)) {
        if (positionData.length === 0) {
          return null;
        }
        // Lấy position đầu tiên có size > 0
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
      // Không có position hoặc lỗi
      return null;
    }
  }
}

module.exports = { GeminiBot };

