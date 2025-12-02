/**
 * Gemini Auto Trading Bot
 *
 * Bot này giao toàn quyền quyết định cho Gemini AI:
 * - AI được cung cấp: dữ liệu giá đa khung thời gian (Binance), chỉ báo kỹ thuật,
 *   số dư ví, trạng thái vị thế hiện tại, lịch sử lệnh/khớp lệnh gần nhất,
 *   và nhật ký các quyết định trước đó của AI.
 * - AI trả về một tập các "actions" (open/close/add/partial/rebalance/hold...) ở dạng JSON.
 * - Bot chỉ kiểm tra các ràng buộc kỹ thuật (tối thiểu 1 USDT, size tối thiểu, v.v.)
 *   rồi thực thi chính xác các action đó trên Bitget.
 *
 * Ý tưởng: đưa cho AI "tài khoản + công cụ", AI phải tự tìm cách giao dịch và tối ưu vốn.
 */

require('dotenv').config();
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const {
  EMA,
  RSI,
  BollingerBands,
  ATR,
} = require('technicalindicators');
const {
  sleep,
  formatNumber,
  roundToTick,
  roundToStep,
  getDecimalsFromStep,
} = require('./utils');

// Google Gemini API Configuration
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || '';

if (!GOOGLE_API_KEY || GOOGLE_API_KEY === '') {
  throw new Error(
    'GOOGLE_API_KEY không được tìm thấy. Vui lòng thêm vào file .env hoặc export biến môi trường.'
  );
}

// Binance API
const BINANCE_API_URL = 'https://api.binance.com/api/v3/klines';

class GeminiAutoBot {
  constructor({ apiClient, config }) {
    this.api = apiClient;
    this.config = {
      symbol: 'BTCUSDT_UMCBL',
      marginCoin: 'USDT',
      capital: null, // Số tiền muốn sử dụng tối đa (USDT), null = dùng toàn bộ equity
      leverage: 10,

      // Technical
      priceTickSize: 0,
      sizeStep: 0,

      // Run interval mặc định (sẽ override bằng nextCheckMinutes của AI)
      runIntervalMs: 30 * 60 * 1000,

      ...config,
    };

    this.isRunning = false;
    this.priceTick = this.config.priceTickSize > 0 ? this.config.priceTickSize : null;
    this.sizeStep = this.config.sizeStep > 0 ? this.config.sizeStep : null;
    this.marketInfoLoaded = false;
    this.priceDecimals = this.priceTick ? getDecimalsFromStep(this.priceTick) : 4;
    this.minLotSize = null;

    // AI / logging
    this.genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);
    this.geminiModel = null;
    this.aiDecisionLog = []; // Lưu 20 quyết định gần nhất của AI
    this.maxDecisionLog = 20;
  }

  async run() {
    this.isRunning = true;
    console.log('[GEMINI-AUTO] 🚀 Khởi động Gemini Auto Trading Bot');

    const capitalStr =
      this.config.capital && this.config.capital > 0
        ? `${this.config.capital} ${this.config.marginCoin}`
        : 'Auto (dùng tối đa toàn bộ equity)';

    console.table({
      'Cặp giao dịch': this.config.symbol,
      Capital: capitalStr,
      Leverage: `${this.config.leverage}x`,
      'Chế độ': 'AI toàn quyền (full auto)',
      'Nguồn giá': 'Binance đa khung thời gian',
      AI: 'Google Gemini',
    });

    await this.prepareMarketMeta();
    await this.initializeGeminiModel();

    while (this.isRunning) {
      try {
        const nextCheckMinutes = await this.executeCycle();

        const validatedMinutes = this.validateNextCheckTime(nextCheckMinutes);
        const waitMs = validatedMinutes * 60 * 1000;
        const nextRun = new Date(Date.now() + waitMs);

        console.log(
          `\n[GEMINI-AUTO] ⏳ Chờ ${validatedMinutes} phút trước chu kỳ tiếp theo (dựa trên đề xuất AI)`
        );
        console.log(
          `  Lần chạy tiếp theo: ${nextRun.toLocaleString('vi-VN')}\n`
        );

        await sleep(waitMs);
      } catch (err) {
        console.error(`[GEMINI-AUTO] ❌ Lỗi trong cycle: ${err.message}`);
        if (err.stack) {
          console.error(err.stack);
        }
        console.log('[GEMINI-AUTO] ⏳ Đợi 30 phút trước khi retry...');
        await sleep(30 * 60 * 1000);
      }
    }
  }

  async initializeGeminiModel() {
    try {
      console.log('[GEMINI-AUTO] 🤖 Đang khởi tạo Gemini AI...');

      const modelsToTry = ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-pro'];

      for (const modelName of modelsToTry) {
        try {
          this.geminiModel = this.genAI.getGenerativeModel({ model: modelName });
          await this.geminiModel.generateContent('ping');
          console.log(`[GEMINI-AUTO] ✅ Đã khởi tạo model: ${modelName}`);
          return;
        } catch (err) {
          console.log(
            `[GEMINI-AUTO] ⚠️ Model ${modelName} không khả dụng, thử model khác...`
          );
        }
      }

      throw new Error('Không tìm thấy model Gemini nào khả dụng');
    } catch (err) {
      console.error(
        `[GEMINI-AUTO] ❌ Lỗi khi khởi tạo Gemini model: ${err.message}`
      );
      throw err;
    }
  }

  validateNextCheckTime(minutes) {
    const MIN_MINUTES = 5;
    const MAX_MINUTES = 24 * 60;

    if (!minutes || isNaN(minutes)) {
      console.warn(
        '[GEMINI-AUTO] ⚠️ nextCheckMinutes từ AI không hợp lệ, dùng mặc định 30 phút'
      );
      return 30;
    }

    const validated = Math.max(
      MIN_MINUTES,
      Math.min(MAX_MINUTES, Math.round(minutes))
    );

    if (validated !== minutes) {
      console.log(
        `[GEMINI-AUTO] ℹ️ Điều chỉnh thời gian chờ từ ${minutes} → ${validated} phút (min=${MIN_MINUTES}, max=${MAX_MINUTES})`
      );
    }

    return validated;
  }

  async executeCycle() {
    console.log('\n' + '='.repeat(70));
    console.log(
      `[GEMINI-AUTO] 🔄 Bắt đầu chu kỳ mới - ${new Date().toLocaleString(
        'vi-VN'
      )}`
    );
    console.log('='.repeat(70));

    // 1. Lấy trạng thái tài khoản + position hiện tại
    const accountStatus = await this.getAccountStatus();
    const position = await this.getCurrentPosition();

    if (position) {
      console.log(
        `[GEMINI-AUTO] 📌 Đang có position ${
          position.direction.toUpperCase()
        } (size=${formatNumber(position.size)})`
      );
    } else {
      console.log('[GEMINI-AUTO] 📌 Hiện không có position đang mở');
    }

    // 2. Lấy lịch sử lệnh / fills gần nhất từ Bitget
    const [orderHistory, fillsHistory] = await this.getRecentTradeHistory();

    // 3. Lấy dữ liệu đa khung thời gian từ Binance
    const binanceSymbol = this.config.symbol.replace('_UMCBL', '');

    const [klines5m, klines15m, klines1h, klines4h, klines1d] = await Promise.all(
      [
        this.getBinanceKlines(binanceSymbol, '5m', 288),
        this.getBinanceKlines(binanceSymbol, '15m', 288),
        this.getBinanceKlines(binanceSymbol, '1h', 168),
        this.getBinanceKlines(binanceSymbol, '4h', 90),
        this.getBinanceKlines(binanceSymbol, '1d', 60),
      ]
    );

    // 4. Tính chỉ báo cho các khung chính
    const indicators = await this.calculateAllIndicators({
      '5m': klines5m,
      '15m': klines15m,
      '1h': klines1h,
      '4h': klines4h,
      '1d': klines1d,
    });

    // 5. Gộp dữ liệu thành text cho AI
    const contextText = this.formatContextForGemini({
      binanceSymbol,
      klines5m,
      indicators,
      accountStatus,
      position,
      orderHistory,
      fillsHistory,
    });

    // 6. Gọi Gemini để lấy kế hoạch giao dịch
    const aiPlan = await this.analyzeWithGemini(contextText, binanceSymbol);

    if (!aiPlan) {
      console.log(
        '[GEMINI-AUTO] ⚠️ AI không trả về kế hoạch hợp lệ, giữ nguyên trạng thái.'
      );
      return 30;
    }

    console.log(
      '[GEMINI-AUTO] ✅ Phân tích AI (tóm tắt):',
      JSON.stringify(
        {
          strategy_name: aiPlan.strategy_name,
          trend_view: aiPlan.trend_view,
          risk_profile: aiPlan.risk_profile,
          actions: aiPlan.actions?.map((a) => a.action) || [],
        },
        null,
        2
      )
    );

    // 7. Thực thi các actions AI đề xuất
    const lastPrice = klines5m[klines5m.length - 1].close;
    await this.executeAIActions(aiPlan.actions || [], lastPrice, accountStatus);

    // 8. Lưu vào nhật ký quyết định của AI
    this.saveDecisionToLog(aiPlan, accountStatus, position);

    // 9. Trả về thời gian chờ lần tới
    return aiPlan.nextCheckMinutes || 30;
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
      console.error(
        '[GEMINI-AUTO] ❌ Lỗi khi lấy dữ liệu từ Binance:',
        error.message
      );
      throw error;
    }
  }

  async calculateAllIndicators(multiTimeframeData) {
    const result = {};

    for (const [timeframe, klines] of Object.entries(multiTimeframeData)) {
      if (!klines || klines.length < 50) continue;

      const closes = klines.map((k) => k.close);
      const highs = klines.map((k) => k.high);
      const lows = klines.map((k) => k.low);
      const currentPrice = closes[closes.length - 1];

      const ema20 = EMA.calculate({ values: closes, period: 20 });
      const ema50 = EMA.calculate({ values: closes, period: 50 });
      const ema200 = EMA.calculate({
        values: closes,
        period: Math.min(200, closes.length - 1),
      });
      const rsi = RSI.calculate({ values: closes, period: 14 });
      const atr = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
      const bb = BollingerBands.calculate({
        values: closes,
        period: 20,
        stdDev: 2,
      });

      result[timeframe] = {
        ema20: ema20?.length ? ema20[ema20.length - 1].toFixed(this.priceDecimals) : null,
        ema50: ema50?.length ? ema50[ema50.length - 1].toFixed(this.priceDecimals) : null,
        ema200: ema200?.length
          ? ema200[ema200.length - 1].toFixed(this.priceDecimals)
          : null,
        rsi: rsi?.length ? rsi[rsi.length - 1].toFixed(2) : null,
        atr: atr?.length ? atr[atr.length - 1].toFixed(this.priceDecimals) : null,
        atrPercent: atr?.length
          ? ((atr[atr.length - 1] / currentPrice) * 100).toFixed(2)
          : null,
        bb:
          bb?.length > 0
            ? {
                upper: bb[bb.length - 1].upper.toFixed(this.priceDecimals),
                middle: bb[bb.length - 1].middle.toFixed(this.priceDecimals),
                lower: bb[bb.length - 1].lower.toFixed(this.priceDecimals),
              }
            : null,
      };
    }

    return result;
  }

  formatContextForGemini({
    binanceSymbol,
    klines5m,
    indicators,
    accountStatus,
    position,
    orderHistory,
    fillsHistory,
  }) {
    if (!klines5m || !klines5m.length) {
      return 'Không có dữ liệu giá.';
    }

    const latest = klines5m[klines5m.length - 1];
    const oldest = klines5m[0];
    const highs = klines5m.map((k) => k.high);
    const lows = klines5m.map((k) => k.low);
    const highest = Math.max(...highs);
    const lowest = Math.min(...lows);
    const currentPrice = latest.close;
    const priceChange = currentPrice - oldest.close;
    const priceChangePercent = ((priceChange / oldest.close) * 100).toFixed(2);

    let text = '';

    text += `=== THÔNG TIN THỊ TRƯỜNG - ${binanceSymbol} ===\n`;
    text += `Thời gian dữ liệu (5m): ${oldest.time} → ${latest.time}\n`;
    text += `Giá hiện tại: ${currentPrice.toFixed(this.priceDecimals)} USDT\n`;
    text += `Biến động 24h (5m data): ${
      priceChange >= 0 ? '+' : ''
    }${priceChange.toFixed(this.priceDecimals)} USDT (${
      priceChangePercent >= 0 ? '+' : ''
    }${priceChangePercent}%)\n`;
    text += `Giá cao nhất 24h: ${highest.toFixed(this.priceDecimals)}\n`;
    text += `Giá thấp nhất 24h: ${lowest.toFixed(this.priceDecimals)}\n\n`;

    // Chỉ báo tóm tắt một vài khung quan trọng
    const tfList = ['5m', '15m', '1h', '4h', '1d'];
    for (const tf of tfList) {
      if (!indicators[tf]) continue;
      const ind = indicators[tf];
      text += `--- KHUNG ${tf.toUpperCase()} ---\n`;
      if (ind.ema20) text += `EMA20: ${ind.ema20}\n`;
      if (ind.ema50) text += `EMA50: ${ind.ema50}\n`;
      if (ind.ema200) text += `EMA200: ${ind.ema200}\n`;
      if (ind.rsi) text += `RSI(14): ${ind.rsi}\n`;
      if (ind.atr && ind.atrPercent)
        text += `ATR(14): ${ind.atr} (${ind.atrPercent}% so với giá)\n`;
      if (ind.bb) {
        text += `Bollinger Bands (20,2): upper=${ind.bb.upper}, middle=${ind.bb.middle}, lower=${ind.bb.lower}\n`;
      }
      text += '\n';
    }

    // Thông tin tài khoản
    if (accountStatus) {
      text += `=== TÀI KHOẢN & QUẢN LÝ VỐN ===\n`;
      text += `Tổng Equity: ${formatNumber(accountStatus.equity)} USDT\n`;
      text += `Số dư khả dụng (Available): ${formatNumber(
        accountStatus.available
      )} USDT\n`;
      text += `Margin đang dùng: ${formatNumber(
        accountStatus.totalMarginUsed
      )} USDT\n`;
      text += `Free margin: ${formatNumber(accountStatus.freeMargin)} USDT\n`;
      text += `Margin Level: ${accountStatus.marginLevel.toFixed(2)}%\n`;
      text += `Tổng PnL chưa chốt: ${
        accountStatus.totalUnrealizedPnL >= 0 ? '+' : ''
      }${formatNumber(accountStatus.totalUnrealizedPnL)} USDT\n`;
      text += `Leverage hiện tại: ${accountStatus.leverage}x\n`;
      if (accountStatus.configCapital) {
        text += `Config capital tối đa cho bot: ${formatNumber(
          accountStatus.configCapital
        )} USDT\n`;
      }
      text += '\n';
    }

    // Trạng thái position hiện tại
    text += `=== VỊ THẾ HIỆN TẠI TRÊN ${this.config.symbol} ===\n`;
    if (!position) {
      text += `Hiện KHÔNG có position đang mở.\n\n`;
    } else {
      text += `Direction: ${position.direction.toUpperCase()}\n`;
      text += `Entry: ${formatNumber(position.entryPrice)}\n`;

      if (accountStatus) {
        const posInfo =
          position.direction === 'long'
            ? accountStatus.longPosition
            : accountStatus.shortPosition;
        if (posInfo) {
          text += `Size: ${formatNumber(posInfo.size)}\n`;
          text += `Notional: ${formatNumber(posInfo.notional)} USDT\n`;
          text += `Margin sử dụng: ${formatNumber(posInfo.marginUsed)} USDT\n`;
          text += `ROI: ${
            posInfo.roiPercent >= 0 ? '+' : ''
          }${posInfo.roiPercent.toFixed(2)}%\n`;
          text += `Unrealized PnL: ${
            posInfo.unrealizedPnL >= 0 ? '+' : ''
          }${formatNumber(posInfo.unrealizedPnL)} USDT\n`;
        }
      }
      text += '\n';
    }

    // Lịch sử lệnh / fills
    text += `=== LỊCH SỬ LỆNH GẦN NHẤT (Bitget) ===\n`;
    if (orderHistory && orderHistory.length) {
      orderHistory.slice(0, 10).forEach((o, idx) => {
        text += `${idx + 1}. side=${o.side || o.direction} | tradeSide=${
          o.tradeSide || o.posSide || ''
        } | size=${o.size || o.billSize || o.notionalValue || ''} | price=${
          o.fillPrice || o.price || ''
        } | pnl=${o.pnl || o.closeProfit || ''} | time=${o.cTime || o.endTime || ''}\n`;
      });
    } else {
      text += 'Không có order history.\n';
    }

    text += `\n=== LỊCH SỬ KHỚP LỆNH (FILLS) GẦN NHẤT ===\n`;
    if (fillsHistory && fillsHistory.length) {
      let winCount = 0;
      let loseCount = 0;
      fillsHistory.forEach((f) => {
        const pnl = Number(f.pnl || f.profit || 0);
        if (pnl > 0) winCount += 1;
        else if (pnl < 0) loseCount += 1;
      });
      const total = winCount + loseCount;
      const winRate = total ? ((winCount / total) * 100).toFixed(2) : '0.00';
      text += `Tổng trade đóng gần nhất: ${total}, Win: ${winCount}, Lose: ${loseCount}, Winrate ≈ ${winRate}%\n`;

      fillsHistory.slice(0, 10).forEach((f, idx) => {
        const pnl = Number(f.pnl || f.profit || 0);
        text += `${idx + 1}. side=${f.side || f.direction} | ${
          pnl >= 0 ? 'WIN' : 'LOSS'
        } | pnl=${pnl} | price=${f.fillPrice || f.price} | size=${
          f.size || f.qty || ''
        }\n`;
      });
    } else {
      text += 'Không có fills history.\n';
    }

    // Nhật ký quyết định AI trước đó
    if (this.aiDecisionLog.length) {
      text += `\n=== NHẬT KÝ QUYẾT ĐỊNH CỦA AI (gần nhất → xa hơn) ===\n`;
      this.aiDecisionLog.forEach((log, idx) => {
        text += `#${idx + 1} | ${log.timestamp} | strategy=${log.strategy_name} | trend=${log.trend_view} | risk=${log.risk_profile} | actions=${(
          log.actions || []
        )
          .map((a) => a.action)
          .join(', ')} | resultHint=${log.resultHint || ''}\n`;
      });
    }

    // 10 candles gần nhất
    text += `\n=== 10 CANDLES 5M GẦN NHẤT ===\n`;
    klines5m.slice(-10).forEach((c, i) => {
      const type = c.close > c.open ? 'BULL' : c.close < c.open ? 'BEAR' : 'DOJI';
      text += `${i + 1}. [${type}] O:${c.open.toFixed(
        this.priceDecimals
      )} H:${c.high.toFixed(this.priceDecimals)} L:${c.low.toFixed(
        this.priceDecimals
      )} C:${c.close.toFixed(this.priceDecimals)} Vol:${c.volume.toFixed(2)}\n`;
    });

    return text;
  }

  async analyzeWithGemini(contextText, symbol) {
    const prompt = `
Bạn là một **AI trader chuyên nghiệp** chịu trách nhiệm giao dịch **toàn bộ tài khoản futures USDT-M trên Bitget** cho chủ tài khoản.

Bạn được cấp:
- Dữ liệu giá đa khung thời gian từ Binance cho cặp ${symbol} (OHLCV chi tiết, 10 nến gần nhất, range 24h, high/low, v.v.)
- Một số chỉ báo kỹ thuật cơ bản (EMA, RSI, ATR, Bollinger Bands...) **chỉ để tham khảo**
- Trạng thái tài khoản (equity, free margin, unrealized PnL, leverage...)
- Trạng thái vị thế đang mở (nếu có)
- (Nếu API hỗ trợ) lịch sử lệnh & khớp lệnh gần nhất (kết quả win/lose, winrate)
- Nhật ký các quyết định AI trước đó

NHIỆM VỤ:
- Tự xây dựng chiến lược, vào/thoát lệnh và quản lý vốn **hoàn toàn tự động**
- Tận dụng cả dữ liệu giá thô (OHLCV) + chỉ báo + lịch sử lệnh & nhật ký (nếu có) để **tối ưu cách vào lệnh và quản lý rủi ro**
- Ưu tiên: Bảo toàn vốn, drawdown thấp, lợi nhuận ổn định lâu dài (không all-in, không đánh bạc)
- Trong mọi trạng thái thị trường (trend, sideways, biến động mạnh/yếu) bạn **phải tìm cách giao dịch hợp lý** (có thể giảm size, scalp nhỏ, chờ setup đẹp hơn... nhưng vẫn phải có kế hoạch rõ ràng)

RẤT QUAN TRỌNG – VỀ MÔ HÌNH NẾN / MÔ HÌNH GIÁ:
- Bot KHÔNG cung cấp sẵn danh sách mô hình nến hay mô hình giá.
- Bạn phải **tự đọc dữ liệu OHLC** (open, high, low, close, volume) để:
  - Tự phát hiện mô hình nến (Hammer, Engulfing, Pin Bar, Doji, v.v. nếu có)
  - Tự phát hiện mô hình giá / cấu trúc (range, channel, trendline, tam giác, H&S, double top/bottom, v.v. nếu có)
  - Tự xác định vùng support/resistance, swing high/low, market structure (HH/HL/LH/LL, BOS, ChoCh, v.v.) dựa trên giá
- Hãy **phân tích sâu** từ dữ liệu giá được cung cấp: so sánh nhiều khung thời gian, xem hành vi nến gần nhất, biên độ dao động (ATR), vị trí giá trong range 24h, v.v.

RÀNG BUỘC KỸ THUẬT (rất quan trọng – bot sẽ reject nếu vi phạm):
- Mỗi lệnh (LONG/SHORT) phải dùng **tối thiểu 1 USDT margin**
- Khi "add_to_long"/"add_to_short": capital thêm vào **>= 1 USDT**
- Khi "partial_close_*": sau khi đóng một phần, phần còn lại vẫn phải >= 1 USDT
- Khi "rebalance_*": target_size (USDT margin) phải >= 1 USDT
- Không vượt quá tổng capital tối đa được cấp cho bot (nếu có trong dữ liệu)

NGUYÊN TẮC QUẢN LÝ VỐN GỢI Ý (bạn có thể tự tinh chỉnh):
- Không bao giờ dùng > 20-30% tổng equity cho 1 vị thế đơn lẻ (trừ khi tài khoản rất nhỏ)
- Có thể chia capital thành nhiều phần để scale in/scale out
- Ưu tiên risk:reward tốt (>= 1:1.5 hoặc 1:2) khi có trend rõ
- Khi thị trường nhiễu/sideways: giảm size, TP/SL ngắn hơn, ưu tiên bảo toàn vốn

LINH HOẠT CHIẾN LƯỢC (PHẢI XEM XÉT NHIỀU CÁCH TIẾP CẬN):
- Bạn không bị giới hạn bởi một phương pháp duy nhất. Mỗi lần phân tích, hãy cân nhắc:
  - Trend following (theo xu hướng trên khung lớn)
  - Mean reversion / range trading (sideways, quay về trung bình, chơi trong vùng)
  - Breakout / breakdown (phá biên, phá vùng cản)
  - Volatility trading (khi ATR/Bollinger mở rộng/thu hẹp)
  - Scalping ngắn hạn trên 5m khi thị trường nhiễu nhưng có sóng nhỏ
  - Kết hợp nhiều khung thời gian (multi-timeframe confluence)
- Tùy bối cảnh cụ thể, hãy chọn hoặc kết hợp các hướng tiếp cận trên, xác định rõ:
  - Tại sao chiến lược đó phù hợp với cấu trúc giá và chỉ báo hiện tại
  - Khi nào chiến lược đó **không còn phù hợp** và cần đổi cách tiếp cận

HÃY ĐỌC KỸ DỮ LIỆU SAU:

${contextText}

SAU KHI PHÂN TÍCH, HÃY TRẢ VỀ KẾ HOẠCH GIAO DỊCH DƯỚI DẠNG JSON DUY NHẤT (KHÔNG TEXT KHÁC), THEO FORMAT:

{
  "strategy_name": "Tên ngắn gọn cho chiến lược hiện tại (ví dụ: trend-follow 4h, range scalp 5m, volatility breakout...)",
  "trend_view": "Mô tả ngắn về xu hướng đa khung (ví dụ: uptrend mạnh 4h, sideways 5m, downtrend daily...)",
  "risk_profile": "low" | "medium" | "high",
  "comment": "Giải thích chi tiết tại sao chọn chiến lược này, cách dùng lịch sử lệnh & trạng thái tài khoản để điều chỉnh.",
  "nextCheckMinutes": số phút nên đợi trước khi chạy lại phân tích (từ 5 đến 1440),
  "actions": [
    {
      "action": "open_long" | "open_short" | "close_long" | "close_short" | "add_to_long" | "add_to_short" | "partial_close_long" | "partial_close_short" | "rebalance_long" | "rebalance_short" | "hold",
      "reason": "Lý do cụ thể cho action này, tham chiếu rõ tới xu hướng, chỉ báo, lịch sử lệnh, trạng thái position.",
      "capital": số_USDT_dùng_cho_action_này_hoặc_0,  // chỉ dùng cho open_/add_/rebalance, >=1 nếu sử dụng
      "percentage": số_%_đóng (0-100) cho partial_close_* nếu dùng, ví dụ 50 = đóng 50%,
      "target_size": số_USDT_margin_mục_tiêu_cho_rebalance_* nếu dùng (>= 1),
      "priority": "low" | "medium" | "high" | "critical"
    }
  ]
}

LƯU Ý:
- Nếu đã có vị thế, bạn có thể chọn: giữ nguyên (hold), chốt bớt, đảo chiều, thêm vị thế, v.v.
- Nếu chưa có vị thế, bạn có thể: mở vị thế mới (open_long/open_short) HOẶC giữ tiền (hold) nhưng cần lý do rõ ràng.
- Có thể trả về nhiều actions (ví dụ: partial_close_long + add_to_short) nếu hợp lý.
- **Không được trả về text ngoài JSON**, không được bọc trong \`\`\`; chỉ JSON thuần.
`;

    try {
      const result = await this.geminiModel.generateContent(prompt);
      const response = await result.response;
      const text = response.text().trim();

      let jsonText = text
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      try {
        const parsed = JSON.parse(jsonText);
        return parsed;
      } catch (parseErr) {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return parsed;
        }
        console.error(
          '[GEMINI-AUTO] ❌ Không parse được JSON từ AI:',
          parseErr.message
        );
        return null;
      }
    } catch (err) {
      console.error('[GEMINI-AUTO] ❌ Lỗi khi gọi Gemini:', err.message);
      return null;
    }
  }

  async executeAIActions(actions, currentPrice, accountStatus) {
    if (!actions || !actions.length) {
      console.log('[GEMINI-AUTO] ℹ️ AI không đề xuất action nào.');
      return;
    }

    for (const actionObj of actions) {
      const { action, reason, capital, percentage, target_size, priority } =
        actionObj || {};
      console.log(
        `\n[GEMINI-AUTO] 💡 AI Action: ${action} | priority=${
          priority || 'medium'
        }\n  Lý do: ${reason}`
      );

      try {
        switch (action) {
          case 'open_long':
            await this.openPosition('long', currentPrice, capital, accountStatus);
            break;
          case 'open_short':
            await this.openPosition('short', currentPrice, capital, accountStatus);
            break;
          case 'close_long':
            await this.closePosition('long');
            break;
          case 'close_short':
            await this.closePosition('short');
            break;
          case 'add_to_long': {
            let addCap = capital && capital > 0 ? capital : 0;
            if (addCap < 1.0) {
              console.log(
                `[GEMINI-AUTO] ℹ️ AI đề xuất add_to_long với capital=${addCap} < 1 USDT → tự động nâng lên 1 USDT`
              );
              addCap = 1.0;
            }
            await this.addToPosition('long', currentPrice, addCap, accountStatus);
            break;
          }
          case 'add_to_short': {
            let addCap = capital && capital > 0 ? capital : 0;
            if (addCap < 1.0) {
              console.log(
                `[GEMINI-AUTO] ℹ️ AI đề xuất add_to_short với capital=${addCap} < 1 USDT → tự động nâng lên 1 USDT`
              );
              addCap = 1.0;
            }
            await this.addToPosition('short', currentPrice, addCap, accountStatus);
            break;
          }
          case 'partial_close_long':
            if (percentage && percentage > 0 && percentage < 100) {
              await this.partialClose('long', percentage);
            } else {
              console.log(
                `[GEMINI-AUTO] ⚠️ percentage không hợp lệ cho partial_close_long: ${percentage}`
              );
            }
            break;
          case 'partial_close_short':
            if (percentage && percentage > 0 && percentage < 100) {
              await this.partialClose('short', percentage);
            } else {
              console.log(
                `[GEMINI-AUTO] ⚠️ percentage không hợp lệ cho partial_close_short: ${percentage}`
              );
            }
            break;
          case 'rebalance_long': {
            let tgt = target_size && target_size > 0 ? target_size : 0;
            if (tgt < 1.0) {
              console.log(
                `[GEMINI-AUTO] ℹ️ AI đề xuất rebalance_long với target_size=${tgt} < 1 USDT → tự động nâng lên 1 USDT`
              );
              tgt = 1.0;
            }
            await this.rebalancePosition('long', tgt, currentPrice, accountStatus);
            break;
          }
          case 'rebalance_short': {
            let tgt = target_size && target_size > 0 ? target_size : 0;
            if (tgt < 1.0) {
              console.log(
                `[GEMINI-AUTO] ℹ️ AI đề xuất rebalance_short với target_size=${tgt} < 1 USDT → tự động nâng lên 1 USDT`
              );
              tgt = 1.0;
            }
            await this.rebalancePosition('short', tgt, currentPrice, accountStatus);
            break;
          }
          case 'hold':
          default:
            console.log('[GEMINI-AUTO] ℹ️ Action hold/unknown → không làm gì.');
        }
      } catch (err) {
        console.error(
          `[GEMINI-AUTO] ❌ Lỗi khi thực thi action "${action}": ${err.message}`
        );
      }
    }
  }

  saveDecisionToLog(aiPlan, accountStatus, position) {
    const entry = {
      timestamp: new Date().toISOString(),
      strategy_name: aiPlan.strategy_name || '',
      trend_view: aiPlan.trend_view || '',
      risk_profile: aiPlan.risk_profile || '',
      actions: aiPlan.actions || [],
      resultHint: '',
      equity: accountStatus ? accountStatus.equity : null,
      freeMargin: accountStatus ? accountStatus.freeMargin : null,
      hasPosition: !!position,
    };

    this.aiDecisionLog.unshift(entry);
    if (this.aiDecisionLog.length > this.maxDecisionLog) {
      this.aiDecisionLog = this.aiDecisionLog.slice(0, this.maxDecisionLog);
    }
  }

  /**
   * ================== Bitget helpers & trading actions ==================
   */

  async prepareMarketMeta() {
    if (this.marketInfoLoaded) return;

    try {
      console.log('[GEMINI-AUTO] ⚙️ Đang lấy thông tin contract từ Bitget...');
      const productType = this.config.symbol.includes('_UMCBL') ? 'umcbl' : 'umcbl';
      const contract = await this.api.getContract(this.config.symbol, productType);

      if (!contract) {
        throw new Error(`Không tìm thấy contract "${this.config.symbol}"`);
      }

      const derivedPriceTick = Number(
        contract.priceTick || contract.priceStep || contract.minPriceChange || 0
      );
      const derivedSizeStep = Number(
        contract.quantityTick || contract.sizeTick || contract.minTradeNum || 0
      );

      if (!this.priceTick && derivedPriceTick > 0) {
        this.priceTick = derivedPriceTick;
        this.priceDecimals = getDecimalsFromStep(this.priceTick);
      }

      if (!this.sizeStep && derivedSizeStep > 0) {
        this.sizeStep = derivedSizeStep;
      }

      this.minLotSize = Number(
        contract.minTradeNum || contract.minSize || this.sizeStep || 0.001
      );

      console.log(
        `[GEMINI-AUTO] ℹ️ Contract spec: tick=${this.priceTick}, step=${this.sizeStep}, minLot=${formatNumber(
          this.minLotSize
        )}`
      );
    } catch (err) {
      console.warn(
        `[GEMINI-AUTO] ⚠️ Không lấy được contract spec: ${err.message} → dùng default`
      );
      this.priceTick = this.priceTick || 0.01;
      this.priceDecimals = getDecimalsFromStep(this.priceTick);
      this.sizeStep = this.sizeStep || 0.0001;
      this.minLotSize = this.minLotSize || 0.001;
    } finally {
      this.marketInfoLoaded = true;
    }
  }

  async configureLeverage() {
    try {
      // Set margin mode = crossed (an toàn hơn cho tài khoản nhỏ)
      try {
        await this.api.setMarginMode({
          symbol: this.config.symbol,
          marginCoin: this.config.marginCoin,
          marginMode: 'crossed',
        });
      } catch (err) {
        console.warn(
          `[GEMINI-AUTO] ⚠️ setMarginMode: ${err.message} (có thể đã set từ trước)`
        );
      }

      await Promise.all(
        ['long', 'short'].map((side) =>
          this.api
            .setLeverage({
              symbol: this.config.symbol,
              marginCoin: this.config.marginCoin,
              leverage: this.config.leverage,
              holdSide: side,
            })
            .catch((err) => {
              console.warn(
                `[GEMINI-AUTO] ⚠️ Lỗi khi set leverage cho ${side}: ${err.message}`
              );
            })
        )
      );
      console.log(
        `[GEMINI-AUTO] ✅ Đã set leverage ${this.config.leverage}x (crossed)`
      );
    } catch (err) {
      console.error(
        `[GEMINI-AUTO] ❌ Lỗi khi config leverage/margin: ${err.message}`
      );
      throw err;
    }
  }

  async getEquity() {
    const productType = this.config.symbol.includes('_UMCBL') ? 'umcbl' : 'umcbl';
    const account = await this.api.getAccount(
      productType,
      this.config.marginCoin,
      this.config.symbol
    );

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
  }

  async getAccountStatus() {
    try {
      const currentPrice = await this.getCurrentPrice();
      const equity = await this.getEquity();
      const productType = this.config.symbol.includes('_UMCBL') ? 'umcbl' : 'umcbl';
      const accountData = await this.api.getAccount(
        productType,
        this.config.marginCoin,
        this.config.symbol
      );

      const available = Number(
        accountData?.available ||
          accountData?.availableBalance ||
          accountData?.availableEquity ||
          equity
      );

      // Lấy position để tính PnL / margin
      const position = await this.getCurrentPosition();
      const leverage = this.config.leverage || 10;
      let longInfo = null;
      let shortInfo = null;
      let totalMarginUsed = 0;
      let totalUnrealizedPnL = 0;

      if (position) {
        const notional = position.size * position.entryPrice;
        const marginUsed = notional / leverage;
        const priceChangePercent =
          position.direction === 'long'
            ? ((currentPrice - position.entryPrice) / position.entryPrice) * 100
            : ((position.entryPrice - currentPrice) / position.entryPrice) * 100;
        const roiPercent = priceChangePercent * leverage;
        const unrealizedPnL = (roiPercent / 100) * marginUsed;

        const posInfo = {
          side: position.direction.toUpperCase(),
          entryPrice: position.entryPrice,
          currentPrice,
          size: position.size,
          notional,
          marginUsed,
          priceChangePercent,
          roiPercent,
          unrealizedPnL,
        };

        if (position.direction === 'long') longInfo = posInfo;
        else shortInfo = posInfo;

        totalMarginUsed += marginUsed;
        totalUnrealizedPnL += unrealizedPnL;
      }

      const freeMargin = equity - totalMarginUsed;
      const marginLevel = totalMarginUsed > 0 ? (equity / totalMarginUsed) * 100 : 0;

      return {
        equity,
        available,
        totalMarginUsed,
        freeMargin,
        marginLevel,
        totalUnrealizedPnL,
        leverage,
        longPosition: longInfo,
        shortPosition: shortInfo,
        configCapital: this.config.capital || null,
      };
    } catch (err) {
      console.error(
        `[GEMINI-AUTO] ❌ Lỗi khi lấy account status: ${err.message}`
      );
      return null;
    }
  }

  async getCurrentPrice() {
    const binanceSymbol = this.config.symbol
      .replace('_UMCBL', '')
      .replace('_CMCBL', '')
      .replace('_DMCBL', '');
    const klines = await this.getBinanceKlines(binanceSymbol, '1m', 1);
    if (!klines || !klines.length) {
      throw new Error('Không lấy được giá hiện tại từ Binance');
    }
    const price = klines[0].close;
    if (!price || price <= 0) {
      throw new Error('Giá hiện tại không hợp lệ');
    }
    return price;
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
        capital,
        minCapitalRequired,
        warning: `Capital quá thấp. Cần ít nhất ${formatNumber(
          minCapitalRequired
        )} ${this.config.marginCoin}`,
        capitalTooLow: true,
      };
    }

    const actualNotional = size * entryPrice;
    const actualCapital = actualNotional / this.config.leverage;

    return {
      size: Number(size.toFixed(8)),
      capital,
      actualCapital,
      notional: actualNotional,
      capitalTooLow: false,
      warning: null,
    };
  }

  async openPosition(side, currentPrice, capitalFromAI, accountStatus) {
    const directionLabel = side.toUpperCase();
    await this.configureLeverage();

    const equity = await this.getEquity();
    const maxCapital =
      this.config.capital && this.config.capital > 0
        ? Math.min(this.config.capital, equity)
        : equity;

    let capital = capitalFromAI && capitalFromAI > 0 ? capitalFromAI : maxCapital * 0.1;

    if (capital < 1.0) {
      console.log(
        `[GEMINI-AUTO] ⚠️ Capital đề xuất cho ${directionLabel} (${capital}) < 1 USDT → nâng lên 1 USDT`
      );
      capital = 1.0;
    }

    if (accountStatus && capital > accountStatus.freeMargin) {
      console.log(
        `[GEMINI-AUTO] ⚠️ Capital ${capital} > freeMargin ${formatNumber(
          accountStatus.freeMargin
        )} → giảm về freeMargin`
      );
      capital = Math.max(1.0, accountStatus.freeMargin * 0.9);
    }

    const lotSizeResult = this.calculateLotSize(currentPrice, capital);
    if (lotSizeResult.capitalTooLow) {
      console.log(
        `[GEMINI-AUTO] ❌ Không thể mở ${directionLabel}: ${lotSizeResult.warning}`
      );
      return;
    }

    console.log(`[GEMINI-AUTO] 📈 Mở ${directionLabel}:`);
    console.log(
      `  Entry≈${formatNumber(currentPrice)}, Size=${formatNumber(
        lotSizeResult.size
      )}, Capital≈${formatNumber(
        lotSizeResult.actualCapital || lotSizeResult.capital
      )} USDT`
    );

    const apiSide = side === 'long' ? 'open_long' : 'open_short';

    await this.api.placeOrder({
      symbol: this.config.symbol,
      marginCoin: this.config.marginCoin,
      size: lotSizeResult.size.toString(),
      side: apiSide,
      orderType: 'market',
    });

    console.log(`[GEMINI-AUTO] ✅ Đã mở ${directionLabel} thành công`);
    await sleep(2000);
  }

  async closePosition(side) {
    const position = await this.getCurrentPosition();
    if (!position || position.direction !== side) {
      console.log(
        `[GEMINI-AUTO] ℹ️ Không có position ${side.toUpperCase()} để đóng.`
      );
      return;
    }

    console.log(`[GEMINI-AUTO] 🔴 Đóng ${side.toUpperCase()} size=${formatNumber(
      position.size
    )}`);

    await this.api.closePosition({
      symbol: this.config.symbol,
      marginCoin: this.config.marginCoin,
      holdSide: side,
      size: position.size.toString(),
    });

    console.log(`[GEMINI-AUTO] ✅ Đã đóng ${side.toUpperCase()} thành công`);
    await sleep(2000);
  }

  async addToPosition(side, currentPrice, additionalCapital, accountStatus) {
    const position = await this.getCurrentPosition();
    if (!position || position.direction !== side) {
      throw new Error(
        `Không có position ${side.toUpperCase()} hiện tại để thêm vào.`
      );
    }

    if (additionalCapital < 1.0) {
      throw new Error(
        `Capital thêm vào phải >= 1 USDT. Nhận được: ${additionalCapital}`
      );
    }

    if (accountStatus && accountStatus.freeMargin < additionalCapital) {
      throw new Error(
        `Free margin không đủ để add. Cần ${formatNumber(
          additionalCapital
        )} USDT, chỉ có ${formatNumber(accountStatus.freeMargin)} USDT`
      );
    }

    console.log(
      `[GEMINI-AUTO] ➕ Thêm vào ${side.toUpperCase()} hiện có: capital=${formatNumber(
        additionalCapital
      )} USDT`
    );

    const lotSizeResult = this.calculateLotSize(currentPrice, additionalCapital);
    if (lotSizeResult.capitalTooLow) {
      throw new Error(lotSizeResult.warning || 'Capital quá thấp để add position.');
    }

    const apiSide = side === 'long' ? 'open_long' : 'open_short';
    await this.api.placeOrder({
      symbol: this.config.symbol,
      marginCoin: this.config.marginCoin,
      size: lotSizeResult.size.toString(),
      side: apiSide,
      orderType: 'market',
    });

    console.log(
      `[GEMINI-AUTO] ✅ Đã add ${formatNumber(
        lotSizeResult.size
      )} vào ${side.toUpperCase()}`
    );
    await sleep(2000);
  }

  async partialClose(side, percentage) {
    const position = await this.getCurrentPosition();
    if (!position || position.direction !== side) {
      throw new Error(
        `Không có position ${side.toUpperCase()} để partial close.`
      );
    }

    const closeSize = position.size * (percentage / 100);
    const remainingSize = position.size - closeSize;
    const leverage = this.config.leverage || 10;
    const currentPrice = await this.getCurrentPrice();
    const currentNotional = position.size * position.entryPrice;
    const currentMargin = currentNotional / leverage;
    const remainingMargin = currentMargin * (remainingSize / position.size);

    if (remainingMargin < 1.0) {
      throw new Error(
        `Sau khi đóng ${percentage}%, position còn lại chỉ ${
          remainingMargin >= 0 ? '' : '-'
        }${formatNumber(
          remainingMargin
        )} USDT (<1 USDT). Giảm percentage hoặc đóng full.`
      );
    }

    console.log(
      `[GEMINI-AUTO] 🔻 Partial close ${percentage}% ${side.toUpperCase()}: closeSize=${formatNumber(
        closeSize
      )}, remaining=${formatNumber(remainingSize)}`
    );

    await this.api.closePosition({
      symbol: this.config.symbol,
      marginCoin: this.config.marginCoin,
      holdSide: side,
      size: closeSize.toString(),
    });

    console.log(`[GEMINI-AUTO] ✅ Partial close ${side.toUpperCase()} xong`);
    await sleep(2000);
  }

  async rebalancePosition(side, targetSizeUSDT, currentPrice, accountStatus) {
    const position = await this.getCurrentPosition();
    if (!position || position.direction !== side) {
      // Nếu chưa có position và target >= 1 USDT → mở mới
      if (targetSizeUSDT >= 1.0) {
        console.log(
          `[GEMINI-AUTO] ⚖️ Chưa có ${side.toUpperCase()}, mở mới với target ${formatNumber(
            targetSizeUSDT
          )} USDT`
        );
        await this.openPosition(side, currentPrice, targetSizeUSDT, accountStatus);
        return;
      }
      throw new Error(
        `target_size ${targetSizeUSDT} USDT < 1 USDT và chưa có position để rebalance`
      );
    }

    if (targetSizeUSDT < 1.0) {
      throw new Error(
        `target_size phải >= 1 USDT. Nhận được: ${targetSizeUSDT}`
      );
    }

    const leverage = this.config.leverage || 10;
    const currentNotional = position.size * position.entryPrice;
    const currentMargin = currentNotional / leverage;
    const targetNotional = targetSizeUSDT * leverage;
    const targetContracts = targetNotional / currentPrice;

    console.log(
      `[GEMINI-AUTO] ⚖️ Rebalance ${side.toUpperCase()} | currentMargin=${formatNumber(
        currentMargin
      )} USDT → target=${formatNumber(targetSizeUSDT)} USDT`
    );

    if (Math.abs(currentMargin - targetSizeUSDT) < 0.01) {
      console.log('[GEMINI-AUTO] ℹ️ Margin hiện tại đã gần target, bỏ qua.');
      return;
    }

    if (targetSizeUSDT > currentMargin) {
      // Cần thêm margin
      const additionalCapital = targetSizeUSDT - currentMargin;
      await this.addToPosition(side, currentPrice, additionalCapital, accountStatus);
    } else {
      // Cần đóng bớt
      const percentageToClose = ((currentMargin - targetSizeUSDT) / currentMargin) * 100;
      await this.partialClose(side, percentageToClose);
    }
  }

  async getCurrentPosition() {
    try {
      const data = await this.api.getPosition(
        this.config.symbol,
        this.config.marginCoin
      );

      let position = data;
      if (Array.isArray(data)) {
        position = data.find((p) => Number(p.total || p.holdSize || p.size || 0) > 0);
      }

      if (!position) return null;

      const size = Number(
        position.total || position.holdSize || position.size || position.quantity || 0
      );
      if (size <= 0) return null;

      const direction =
        position.holdSide || position.side || position.direction || 'long';
      const entryPrice = Number(
        position.averageOpenPrice ||
          position.openPriceAvg ||
          position.entryPrice ||
          position.avgEntryPrice ||
          0
      );

      if (entryPrice <= 0) return null;

      return {
        direction: direction === 'short' ? 'short' : 'long',
        entryPrice,
        size,
      };
    } catch (err) {
      console.warn(
        `[GEMINI-AUTO] ⚠️ Lỗi khi getCurrentPosition: ${err.message}`
      );
      return null;
    }
  }

  async getRecentTradeHistory() {
    try {
      const productType = this.config.symbol.includes('_UMCBL') ? 'umcbl' : 'umcbl';
      const now = Date.now();
      const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
      const startTime = now - oneWeekMs;

      const [fills, orders] = await Promise.all([
        this.api
          .getFills(this.config.symbol, productType, startTime, now, 50)
          .catch((err) => {
            // Một số account/config không hỗ trợ endpoint history → bỏ qua cho đỡ ồn.
            return [];
          }),
        this.api
          .getOrderHistory(this.config.symbol, productType, startTime, now, 50)
          .catch((err) => {
            // Trường hợp Classic Account không hỗ trợ Unified API (40084) hoặc endpoint khác region → bỏ qua.
            return [];
          }),
      ]);

      return [orders || [], fills || []];
    } catch (err) {
      // Nếu có lỗi tổng, coi như không có lịch sử, không ảnh hưởng logic chính của bot.
      return [[], []];
    }
  }
}

module.exports = { GeminiAutoBot };


