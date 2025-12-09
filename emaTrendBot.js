const {
  sleep,
  formatNumber,
  roundToTick,
  roundToStep,
  getDecimalsFromStep,
} = require('./utils');
const axios = require('axios');
const { EMA, ATR } = require('technicalindicators');

/**
 * EMA Trend Bot với 4 đường EMA (25, 50, 100, 200) và ATR cho TP
 * 
 * Logic:
 * - LONG: 4 EMA nằm theo thứ tự từ trên xuống (uptrend) + nến đỏ → Long. Đóng short nếu có.
 * - SHORT: 4 EMA nằm theo thứ tự từ dưới lên (downtrend) + nến xanh → Short. Đóng long nếu có.
 * - TP: Dùng ATR để tính (không có SL)
 */
class EmaTrendBot {
  constructor({ apiClient, config }) {
    this.api = apiClient;
    this.config = {
      symbol: 'BTCUSDT_UMCBL',
      marginCoin: 'USDT',
      capital: null, // Số tiền muốn vào lệnh (USDT), null = dùng toàn bộ equity
      leverage: 10, // Leverage mặc định

      // Indicator Parameters
      timeFrame: '5m',
      ema25: 25,
      ema50: 50,
      ema100: 100,
      ema200: 200,
      atrPeriod: 14, // Period cho ATR
      atrMultiplier: 2, // Multiplier cho TP (TP = entryPrice ± ATR * multiplier)

      // Technical
      priceTickSize: 0,
      sizeStep: 0,
      pollIntervalMs: 5 * 60 * 1000, // Check mỗi 5 phút (5m)

      ...config,
    };
    this.isRunning = false;
    this.priceTick = this.config.priceTickSize > 0 ? this.config.priceTickSize : null;
    this.sizeStep = this.config.sizeStep > 0 ? this.config.sizeStep : null;
    this.marketInfoLoaded = false;
    this.priceDecimals = this.priceTick ? getDecimalsFromStep(this.priceTick) : 4;
    this.currentPosition = null; // { direction, entryPrice, sl, tp, size, orderId, isActive }
    this.minLotSize = null; // Sẽ được set trong prepareMarketMeta
  }

  async run() {
    this.isRunning = true;
    console.log('[EMA-TREND] 🚀 Khởi động EMA Trend Bot với 4 đường EMA (25, 50, 100, 200)');
    const capitalStr = this.config.capital && this.config.capital > 0
      ? `${this.config.capital} ${this.config.marginCoin}`
      : 'Auto (toàn bộ equity)';
    console.table({
      'Cặp giao dịch': this.config.symbol,
      'Capital': capitalStr,
      'Leverage': `${this.config.leverage}x`,
      'Timeframe': this.config.timeFrame,
      'EMA Periods': `${this.config.ema25}, ${this.config.ema50}, ${this.config.ema100}, ${this.config.ema200}`,
      'ATR Period': this.config.atrPeriod,
      'ATR Multiplier': this.config.atrMultiplier,
    });

    await this.prepareMarketMeta();

    // Kiểm tra positions hiện tại
    console.log('[EMA-TREND] 🔍 Kiểm tra positions hiện tại...');
    const existingPosition = await this.getCurrentPosition();

    if (existingPosition) {
      console.log(`[EMA-TREND] ✅ Phát hiện position đang mở: ${existingPosition.direction.toUpperCase()}`);
      console.log(`  - Entry: ${formatNumber(existingPosition.entryPrice)}`);
      console.log(`  - TP: ${existingPosition.tp ? formatNumber(existingPosition.tp) : 'N/A'}`);
      console.log(`  - Size: ${formatNumber(existingPosition.size)}`);
      this.currentPosition = existingPosition;
    } else {
      console.log('[EMA-TREND] ℹ️ Không có position nào đang mở');
    }

    // Main loop - chạy đúng theo thời gian nến
    while (this.isRunning) {
      try {
        // Đợi đến đầu nến tiếp theo
        const waitTime = this.getTimeUntilNextCandle();
        if (waitTime > 1000) {
          const nextMinute = new Date(Date.now() + waitTime);
          console.log(`[EMA-TREND] ⏰ Đợi ${(waitTime / 1000).toFixed(1)}s đến nến tiếp theo (${nextMinute.toLocaleTimeString()})`);
        }
        await sleep(waitTime);

        // Sync position từ API
        const apiPosition = await this.getCurrentPosition();
        if (apiPosition && !this.currentPosition) {
          this.currentPosition = apiPosition;
        } else if (!apiPosition && this.currentPosition) {
          console.log('[EMA-TREND] ℹ️ Position đã được đóng (có thể từ bên ngoài)');
          this.currentPosition = null;
        }

        // Monitor position hiện tại (nếu có)
        if (this.currentPosition && this.currentPosition.isActive) {
          await this.monitorPosition();
        }

        // Luôn check entry signals để vào lệnh mới (dù có position hay không)
        await this.checkEntrySignals();
      } catch (err) {
        console.error(`[EMA-TREND] ❌ Lỗi trong main loop: ${err.message}`);
        if (err.stack && err.message.length < 200) {
          console.error('[EMA-TREND] Chi tiết lỗi:', err.stack.split('\n').slice(0, 3).join('\n'));
        }
        // Nếu lỗi, đợi đến nến tiếp theo
        const waitTime = this.getTimeUntilNextCandle();
        await sleep(waitTime);
      }
    }
  }

  /**
   * Lấy dữ liệu nến từ Binance
   */
  async fetchCandles(symbol, interval, limit = 200) {
    try {
      const binanceSymbol = symbol.replace('_UMCBL', '').replace('_CMCBL', '');
      const url = 'https://api.binance.com/api/v3/klines';
      const params = {
        symbol: binanceSymbol.toUpperCase(),
        interval: interval,
        limit: limit,
      };

      const response = await axios.get(url, { params });

      if (!Array.isArray(response.data)) {
        throw new Error('Binance API trả về dữ liệu không hợp lệ');
      }

      return response.data;
    } catch (err) {
      if (err.response) {
        throw new Error(`Binance API error: ${err.response.status} - ${err.response.data?.msg || err.message}`);
      } else if (err.request) {
        throw new Error(`Không thể kết nối đến Binance API: ${err.message}`);
      } else {
        throw new Error(`Lỗi request: ${err.message}`);
      }
    }
  }

  /**
   * Parse dữ liệu nến từ Binance
   */
  parseCandles(binanceCandles) {
    const highs = [];
    const lows = [];
    const closes = [];
    const opens = [];

    for (const candle of binanceCandles) {
      if (Array.isArray(candle) && candle.length >= 5) {
        const open = parseFloat(candle[1]);
        const high = parseFloat(candle[2]);
        const low = parseFloat(candle[3]);
        const close = parseFloat(candle[4]);

        if (!isNaN(high) && !isNaN(low) && !isNaN(close) && !isNaN(open) &&
          high > 0 && low > 0 && close > 0 && open > 0) {
          highs.push(high);
          lows.push(low);
          closes.push(close);
          opens.push(open);
        }
      }
    }

    return { highs, lows, closes, opens };
  }

  /**
   * Tính các chỉ báo EMA và ATR
   */
  async calculateIndicators() {
    try {
      // Lấy ít nhất 300 nến để đảm bảo có đủ 200 nến đã đóng sau khi loại bỏ nến cuối
      // EMA200 cần ít nhất 200 nến đã đóng
      const candles = await this.fetchCandles(this.config.symbol, this.config.timeFrame, 300);
      const { highs, lows, closes, opens } = this.parseCandles(candles);

      // Loại bỏ nến cuối cùng (nến đang chạy, chưa đóng) để chỉ dùng nến đã đóng
      const closedHighs = highs.slice(0, -1);
      const closedLows = lows.slice(0, -1);
      const closedCloses = closes.slice(0, -1);
      const closedOpens = opens.slice(0, -1);

      const maxPeriod = Math.max(this.config.ema25, this.config.ema50, this.config.ema100, this.config.ema200, this.config.atrPeriod);
      if (closedHighs.length < maxPeriod + 10) {
        throw new Error(`Không đủ dữ liệu để tính chỉ báo (cần ít nhất ${maxPeriod + 10}, có ${closedHighs.length})`);
      }

      // Tính 4 đường EMA
      const ema25Input = { values: closedCloses, period: this.config.ema25 };
      const ema25Result = EMA.calculate(ema25Input);
      const latestEMA25 = ema25Result[ema25Result.length - 1];

      const ema50Input = { values: closedCloses, period: this.config.ema50 };
      const ema50Result = EMA.calculate(ema50Input);
      const latestEMA50 = ema50Result[ema50Result.length - 1];

      const ema100Input = { values: closedCloses, period: this.config.ema100 };
      const ema100Result = EMA.calculate(ema100Input);
      const latestEMA100 = ema100Result[ema100Result.length - 1];

      const ema200Input = { values: closedCloses, period: this.config.ema200 };
      const ema200Result = EMA.calculate(ema200Input);
      const latestEMA200 = ema200Result[ema200Result.length - 1];

      // Tính ATR
      const atrInput = {
        high: closedHighs,
        low: closedLows,
        close: closedCloses,
        period: this.config.atrPeriod,
      };
      const atrResult = ATR.calculate(atrInput);
      const latestATR = atrResult.length > 0 ? atrResult[atrResult.length - 1] : 0;

      // Lấy nến đã đóng gần nhất để kiểm tra màu nến
      const lastClosedCandle = {
        open: closedOpens[closedOpens.length - 1],
        close: closedCloses[closedCloses.length - 1],
        high: closedHighs[closedHighs.length - 1],
        low: closedLows[closedLows.length - 1],
      };
      const isRedCandle = lastClosedCandle.close < lastClosedCandle.open;
      const isGreenCandle = lastClosedCandle.close > lastClosedCandle.open;

      return {
        ema25: latestEMA25 || 0,
        ema50: latestEMA50 || 0,
        ema100: latestEMA100 || 0,
        ema200: latestEMA200 || 0,
        atr: latestATR || 0,
        currentPrice: closes[closes.length - 1], // Giá hiện tại từ nến đang chạy
        isRedCandle,
        isGreenCandle,
        lastClosedCandle,
      };
    } catch (err) {
      console.error(`[EMA-TREND] ❌ Lỗi khi tính chỉ báo: ${err.message}`);
      return null;
    }
  }

  /**
   * Kiểm tra xem 4 EMA có nằm theo thứ tự từ trên xuống (uptrend) không
   * Uptrend: EMA25 > EMA50 > EMA100 > EMA200
   */
  isUptrend(indicators) {
    if (!indicators || !indicators.ema25 || !indicators.ema50 || !indicators.ema100 || !indicators.ema200) {
      return false;
    }
    return indicators.ema25 > indicators.ema50 &&
      indicators.ema50 > indicators.ema100 &&
      indicators.ema100 > indicators.ema200;
  }

  /**
   * Kiểm tra xem 4 EMA có nằm theo thứ tự từ dưới lên (downtrend) không
   * Downtrend: EMA25 < EMA50 < EMA100 < EMA200
   */
  isDowntrend(indicators) {
    if (!indicators || !indicators.ema25 || !indicators.ema50 || !indicators.ema100 || !indicators.ema200) {
      return false;
    }
    return indicators.ema25 < indicators.ema50 &&
      indicators.ema50 < indicators.ema100 &&
      indicators.ema100 < indicators.ema200;
  }

  /**
   * Tính điểm chốt lời (Take Profit) dựa trên ATR
   * LONG: TP = entryPrice + (ATR * multiplier)
   * SHORT: TP = entryPrice - (ATR * multiplier)
   */
  calculateTakeProfit(entryPrice, atr, direction) {
    if (!entryPrice || entryPrice <= 0) {
      throw new Error('Entry price không hợp lệ');
    }

    if (!atr || atr <= 0) {
      throw new Error('ATR không hợp lệ');
    }

    const tpDistance = atr * this.config.atrMultiplier;
    let tp;

    if (direction === 'long') {
      tp = entryPrice + tpDistance;
    } else {
      tp = entryPrice - tpDistance;
    }

    // Round theo priceTick
    if (this.priceTick && this.priceTick > 0) {
      tp = roundToTick(tp, this.priceTick);
    }

    return Number(tp.toFixed(this.priceDecimals));
  }


  /**
   * Tính khối lượng lệnh dựa trên capital (số tiền muốn vào lệnh) và leverage
   */
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

  /**
   * Kiểm tra tín hiệu vào lệnh LONG
   * Điều kiện: Uptrend (EMA25 > EMA50 > EMA100 > EMA200) + nến đỏ
   */
  checkLongEntry(indicators) {
    if (!indicators) {
      return false;
    }

    const isUptrend = this.isUptrend(indicators);
    const hasRedCandle = indicators.isRedCandle;

    return isUptrend && hasRedCandle;
  }

  /**
   * Kiểm tra tín hiệu vào lệnh SHORT
   * Điều kiện: Downtrend (EMA25 < EMA50 < EMA100 < EMA200) + nến xanh
   */
  checkShortEntry(indicators) {
    if (!indicators) {
      return false;
    }

    const isDowntrend = this.isDowntrend(indicators);
    const hasGreenCandle = indicators.isGreenCandle;

    return isDowntrend && hasGreenCandle;
  }

  /**
   * Kiểm tra tín hiệu vào lệnh
   */
  async checkEntrySignals() {
    const indicators = await this.calculateIndicators();
    if (!indicators) {
      return;
    }

    console.log(`[EMA-TREND] 📊 Chỉ báo:`);
    console.log(`  - EMA25: ${formatNumber(indicators.ema25)}`);
    console.log(`  - EMA50: ${formatNumber(indicators.ema50)}`);
    console.log(`  - EMA100: ${formatNumber(indicators.ema100)}`);
    console.log(`  - EMA200: ${formatNumber(indicators.ema200)}`);
    console.log(`  - ATR: ${formatNumber(indicators.atr)}`);
    console.log(`  - Price: ${formatNumber(indicators.currentPrice)}`);
    console.log(`  - Nến gần nhất: ${indicators.isRedCandle ? '🔴 Đỏ' : indicators.isGreenCandle ? '🟢 Xanh' : '⚪ Doji'}`);

    const isUptrend = this.isUptrend(indicators);
    const isDowntrend = this.isDowntrend(indicators);

    // Kiểm tra LONG entry
    if (this.checkLongEntry(indicators)) {
      console.log('[EMA-TREND] ✅ Tín hiệu LONG: Uptrend + nến đỏ');

      // Đóng short nếu có
      if (this.currentPosition && this.currentPosition.direction === 'short' && this.currentPosition.isActive) {
        console.log('[EMA-TREND] 🔄 Đóng lệnh SHORT trước khi vào LONG');
        await this.closePosition();
      }

      await this.enterPosition('long', indicators);
      return;
    }

    // Kiểm tra SHORT entry
    if (this.checkShortEntry(indicators)) {
      console.log('[EMA-TREND] ✅ Tín hiệu SHORT: Downtrend + nến xanh');

      // Đóng long nếu có
      if (this.currentPosition && this.currentPosition.direction === 'long' && this.currentPosition.isActive) {
        console.log('[EMA-TREND] 🔄 Đóng lệnh LONG trước khi vào SHORT');
        await this.closePosition();
      }

      await this.enterPosition('short', indicators);
      return;
    }

    // Không có tín hiệu vào lệnh
    if (isUptrend && !indicators.isRedCandle) {
      console.log(`[EMA-TREND] ⏳ Uptrend nhưng nến không phải đỏ - Chờ nến đỏ`);
    } else if (isDowntrend && !indicators.isGreenCandle) {
      console.log(`[EMA-TREND] ⏳ Downtrend nhưng nến không phải xanh - Chờ nến xanh`);
    } else if (!isUptrend && !isDowntrend) {
      console.log(`[EMA-TREND] ⏳ EMA chưa sắp xếp theo thứ tự (không phải uptrend hay downtrend)`);
    }
  }

  /**
   * Vào lệnh
   */
  async enterPosition(direction, indicators) {
    try {
      const entryPrice = indicators.currentPrice;
      const atr = indicators.atr;

      if (!atr || atr <= 0) {
        throw new Error('ATR không hợp lệ, không thể tính TP');
      }

      // Tính TP dựa trên ATR (không có SL)
      const takeProfit = this.calculateTakeProfit(entryPrice, atr, direction);

      // Lấy equity (vốn)
      const equity = await this.getEquity();

      // Tính lot size dựa trên capital và leverage
      const lotSizeResult = this.calculateLotSize(entryPrice, equity);

      console.log(`[EMA-TREND] 📈 Vào lệnh ${direction.toUpperCase()}:`);
      console.log(`  - Entry: ${formatNumber(entryPrice)}`);
      console.log(`  - ATR: ${formatNumber(atr)}`);
      console.log(`  - TP: ${formatNumber(takeProfit)} (distance: ${formatNumber(Math.abs(entryPrice - takeProfit))})`);
      console.log(`  - Lot Size: ${formatNumber(lotSizeResult.size)}`);
      console.log(`  - Capital sử dụng: ${formatNumber(lotSizeResult.actualCapital || lotSizeResult.capital)} ${this.config.marginCoin}`);
      console.log(`  - Leverage: ${this.config.leverage}x`);
      console.log(`  - Notional Value: ${formatNumber(lotSizeResult.notional || lotSizeResult.size * entryPrice)} ${this.config.marginCoin}`);

      // Hiển thị warning nếu có
      if (lotSizeResult.warning) {
        console.warn(`[EMA-TREND] ${lotSizeResult.warning}`);
      }

      // Set leverage
      await this.configureLeverage();

      // Kiểm tra nếu capital quá thấp
      if (lotSizeResult.capitalTooLow && lotSizeResult.minCapitalRequired) {
        throw new Error(`Capital quá thấp! Cần ít nhất ${formatNumber(lotSizeResult.minCapitalRequired)} ${this.config.marginCoin} để mở lệnh với leverage ${this.config.leverage}x. Hiện tại: ${formatNumber(lotSizeResult.capital)} ${this.config.marginCoin}`);
      }

      // Mở position chỉ với TP (không có SL)
      const side = direction === 'long' ? 'open_long' : 'open_short';
      await this.api.placeOrder({
        symbol: this.config.symbol,
        marginCoin: this.config.marginCoin,
        size: lotSizeResult.size.toString(),
        side,
        orderType: 'market',
        presetTakeProfitPrice: takeProfit.toString(),
      });

      console.log(`[EMA-TREND] ✅ Đã mở position ${direction.toUpperCase()} thành công (chỉ có TP, không có SL)`);

      // Lưu position state
      this.currentPosition = {
        direction,
        entryPrice,
        sl: null,
        tp: takeProfit,
        size: lotSizeResult.size,
        isActive: true,
        orderId: null,
      };

      // Đợi một chút để position được mở
      await sleep(2000);

      // Verify position
      const apiPosition = await this.getCurrentPosition();
      if (apiPosition) {
        this.currentPosition = apiPosition;
      }
    } catch (err) {
      console.error(`[EMA-TREND] ❌ Lỗi khi vào lệnh: ${err.message}`);
      throw err;
    }
  }

  /**
   * Tính thời gian đến nến tiếp theo dựa trên timeframe
   */
  getTimeUntilNextCandle() {
    const now = new Date();
    const currentSeconds = now.getSeconds();
    const currentMilliseconds = now.getMilliseconds();

    // Parse timeframe (1m, 5m, 15m, etc.)
    const timeframeMatch = this.config.timeFrame.match(/^(\d+)([mhd])$/i);
    if (!timeframeMatch) {
      // Fallback: mặc định 5 phút
      const minutes = 5;
      const currentMinutes = now.getMinutes();
      const minutesUntilNext = minutes - (currentMinutes % minutes);
      const secondsUntilNext = (minutesUntilNext * 60) - currentSeconds;
      return Math.max((secondsUntilNext * 1000) - currentMilliseconds, 100);
    }

    const interval = parseInt(timeframeMatch[1]);
    const unit = timeframeMatch[2].toLowerCase();

    let secondsUntilNext = 0;

    if (unit === 'm') {
      // Minutes
      const currentMinutes = now.getMinutes();
      const minutesUntilNext = interval - (currentMinutes % interval);
      secondsUntilNext = (minutesUntilNext * 60) - currentSeconds;
    } else if (unit === 'h') {
      // Hours
      const currentMinutes = now.getMinutes();
      const currentSecondsInHour = currentMinutes * 60 + currentSeconds;
      const intervalSeconds = interval * 3600;
      secondsUntilNext = intervalSeconds - (currentSecondsInHour % intervalSeconds);
    } else if (unit === 'd') {
      // Days
      const currentHours = now.getHours();
      const currentMinutes = now.getMinutes();
      const currentSecondsInDay = currentHours * 3600 + currentMinutes * 60 + currentSeconds;
      const intervalSeconds = interval * 86400;
      secondsUntilNext = intervalSeconds - (currentSecondsInDay % intervalSeconds);
    }

    const millisecondsUntilNext = (secondsUntilNext * 1000) - currentMilliseconds;

    // Đảm bảo ít nhất đợi 100ms để tránh chạy quá sớm
    return Math.max(millisecondsUntilNext, 100);
  }

  /**
   * Monitor position hiện tại
   */
  async monitorPosition() {
    if (!this.currentPosition || !this.currentPosition.isActive) {
      return;
    }

    try {
      // Lấy giá hiện tại từ API
      const ticker = await this.api.getTicker(this.config.symbol);
      const currentPrice = Number(ticker?.last || ticker?.markPrice);

      if (!currentPrice || currentPrice <= 0) {
        return;
      }

      const { direction, entryPrice } = this.currentPosition;

      // Chỉ log status, không đóng lệnh
      // TP được exchange tự động xử lý
      const pnlPercent = direction === 'long'
        ? ((currentPrice - entryPrice) / entryPrice) * 100
        : ((entryPrice - currentPrice) / entryPrice) * 100;

      console.log(`[EMA-TREND] 📊 Position ${direction.toUpperCase()}: Entry=${formatNumber(entryPrice)}, Current=${formatNumber(currentPrice)}, PnL=${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%`);
    } catch (err) {
      console.error(`[EMA-TREND] ❌ Lỗi khi monitor position: ${err.message}`);
    }
  }

  /**
   * Đóng position
   */
  async closePosition() {
    // Lấy position từ API để đảm bảo có dữ liệu mới nhất
    const apiPosition = await this.getCurrentPosition();

    if (!apiPosition || !apiPosition.isActive) {
      // Nếu không có position từ API, clear local state
      if (this.currentPosition) {
        this.currentPosition.isActive = false;
        this.currentPosition = null;
      }
      return;
    }

    try {
      const { direction, size } = apiPosition;

      // Thử đóng bằng closePosition API trước
      try {
        await this.api.closePosition({
          symbol: this.config.symbol,
          marginCoin: this.config.marginCoin,
          holdSide: direction,
        });
        console.log(`[EMA-TREND] ✅ Đã đóng position ${direction.toUpperCase()}`);
      } catch (closeErr) {
        // Nếu closePosition fail, dùng placeOrder
        console.log(`[EMA-TREND] ⚠️ closePosition API fail, dùng placeOrder: ${closeErr.message}`);
        const side = direction === 'long' ? 'close_long' : 'close_short';
        await this.api.placeOrder({
          symbol: this.config.symbol,
          marginCoin: this.config.marginCoin,
          size: size ? size.toString() : '0',
          side,
          orderType: 'market',
        });
        console.log(`[EMA-TREND] ✅ Đã đóng position ${direction.toUpperCase()} bằng placeOrder`);
      }

      // Clear local state
      this.currentPosition.isActive = false;
      this.currentPosition = null;
    } catch (err) {
      console.error(`[EMA-TREND] ❌ Lỗi khi đóng position: ${err.message}`);
      // Vẫn clear local state dù có lỗi
      if (this.currentPosition) {
        this.currentPosition.isActive = false;
        this.currentPosition = null;
      }
      throw err;
    }
  }

  /**
   * Lấy position hiện tại từ API
   */
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
      };
    } catch (err) {
      // Không có position hoặc lỗi
      return null;
    }
  }

  /**
   * Lấy equity (vốn) hiện tại
   */
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
      console.error(`[EMA-TREND] ❌ Lỗi khi lấy equity: ${err.message}`);
      throw err;
    }
  }

  /**
   * Set leverage
   */
  async configureLeverage() {
    if (this.config.leverage && this.config.leverage > 0) {
      try {
        // Set leverage cho cả Long và Short
        await Promise.all([
          this.api.setLeverage({
            symbol: this.config.symbol,
            marginCoin: this.config.marginCoin,
            leverage: this.config.leverage,
            holdSide: 'long',
          }),
          this.api.setLeverage({
            symbol: this.config.symbol,
            marginCoin: this.config.marginCoin,
            leverage: this.config.leverage,
            holdSide: 'short',
          }),
        ]);
        console.log(`[EMA-TREND] ✅ Đã set leverage ${this.config.leverage}x cho Long và Short`);
      } catch (err) {
        console.warn(`[EMA-TREND] ⚠️ Không thể set leverage: ${err.message}`);
      }
    }
  }

  /**
   * Chuẩn bị market metadata
   */
  async prepareMarketMeta() {
    if (this.marketInfoLoaded) return;

    try {
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

      // Lấy min lot size từ contract (nếu có)
      this.minLotSize = Number(
        contract.minTradeNum ||
        contract.minSize ||
        contract.minOrderSize ||
        this.sizeStep ||
        0.001
      );

      console.log(`[EMA-TREND] ℹ️ Thông tin contract: tick giá=${this.priceTick || 'AUTO'}, bước khối lượng=${this.sizeStep || 'AUTO'}, min lot size=${formatNumber(this.minLotSize)}`);
    } catch (err) {
      console.warn(`[EMA-TREND] ⚠️ Không lấy được contract spec: ${err.message}`);
      this.priceTick = this.priceTick || 0.01;
      this.priceDecimals = getDecimalsFromStep(this.priceTick);
      this.sizeStep = this.sizeStep || 0.0001;
    } finally {
      this.marketInfoLoaded = true;
    }
  }
}

module.exports = { EmaTrendBot };

