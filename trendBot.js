const {
  sleep,
  formatNumber,
  percentFormat,
  roundToTick,
  roundToStep,
  getDecimalsFromStep,
} = require('./utils');
const axios = require('axios');
const { EMA, RSI } = require('technicalindicators');

/**
 * Bot Trading theo xu hướng với EMA Crossover + RSI Filter
 * 
 * Logic:
 * - Sử dụng EMA 12/26 để xác định xu hướng (crossover)
 * - Sử dụng RSI 14 để lọc tín hiệu giả (ngưỡng 50)
 * - Chỉ mở 1 vị thế tại một thời điểm (LONG hoặc SHORT)
 * - Thoát lệnh khi EMA cắt ngược
 */
class TrendBot {
  constructor({ apiClient, config }) {
    this.api = apiClient;
    this.config = {
      symbol: 'BTCUSDT_UMCBL',
      marginCoin: 'USDT',
      capital: null, // Số tiền muốn vào lệnh (USDT), null = dùng toàn bộ equity
      leverage: 10, // Leverage mặc định
      
      // Indicator Parameters
      timeFrame: '1m',
      emaFast: 12,
      emaSlow: 26,
      rsiPeriod: 14,
      rsiThreshold: 50,
      
      // Technical
      priceTickSize: 0,
      sizeStep: 0,
      pollIntervalMs: 60 * 1000, // Check mỗi phút (1m)
      
      ...config,
    };
    this.isRunning = false;
    this.priceTick = this.config.priceTickSize > 0 ? this.config.priceTickSize : null;
    this.sizeStep = this.config.sizeStep > 0 ? this.config.sizeStep : null;
    this.marketInfoLoaded = false;
    this.priceDecimals = this.priceTick ? getDecimalsFromStep(this.priceTick) : 4;
    this.currentPosition = null; // { direction, entryPrice, size, orderId, isActive }
    this.emaFastHistory = []; // Lưu lịch sử EMA 12 để detect crossover
    this.emaSlowHistory = []; // Lưu lịch sử EMA 26 để detect crossover
    this.minLotSize = null; // Sẽ được set trong prepareMarketMeta
  }

  async run() {
    this.isRunning = true;
    console.log('[TREND] 🚀 Khởi động bot trading theo xu hướng với EMA Crossover + RSI Filter');
    const capitalStr = this.config.capital && this.config.capital > 0 
      ? `${this.config.capital} ${this.config.marginCoin}` 
      : 'Auto (toàn bộ equity)';
    console.table({
      'Cặp giao dịch': this.config.symbol,
      'Capital': capitalStr,
      'Leverage': `${this.config.leverage}x`,
      'Timeframe': this.config.timeFrame,
      'EMA Fast': this.config.emaFast,
      'EMA Slow': this.config.emaSlow,
      'RSI Period': this.config.rsiPeriod,
      'RSI Threshold': this.config.rsiThreshold,
    });

    await this.prepareMarketMeta();

    // Kiểm tra positions hiện tại
    console.log('[TREND] 🔍 Kiểm tra positions hiện tại...');
    const existingPosition = await this.getCurrentPosition();
    
    if (existingPosition) {
      console.log(`[TREND] ✅ Phát hiện position đang mở: ${existingPosition.direction.toUpperCase()}`);
      console.log(`  - Entry: ${formatNumber(existingPosition.entryPrice)}`);
      console.log(`  - Size: ${formatNumber(existingPosition.size)}`);
      this.currentPosition = existingPosition;
    } else {
      console.log('[TREND] ℹ️ Không có position nào đang mở');
    }

    // Main loop - chạy đúng theo thời gian nến 1m
    while (this.isRunning) {
      try {
        // Đợi đến đầu nến 1m tiếp theo
        const waitTime = this.getTimeUntilNextCandle();
        if (waitTime > 1000) {
          const nextMinute = new Date(Date.now() + waitTime);
          console.log(`[TREND] ⏰ Đợi ${(waitTime / 1000).toFixed(1)}s đến nến tiếp theo (${nextMinute.toLocaleTimeString()})`);
        }
        await sleep(waitTime);

        // Sync position từ API
        const apiPosition = await this.getCurrentPosition();
        if (apiPosition && !this.currentPosition) {
          this.currentPosition = apiPosition;
        } else if (!apiPosition && this.currentPosition) {
          console.log('[TREND] ℹ️ Position đã được đóng (có thể từ bên ngoài)');
          this.currentPosition = null;
        }

        if (this.currentPosition && this.currentPosition.isActive) {
          // Monitor position hiện tại
          await this.monitorPosition();
        } else {
          // Tìm cơ hội vào lệnh mới
          await this.checkEntrySignals();
        }
      } catch (err) {
        console.error(`[TREND] ❌ Lỗi trong main loop: ${err.message}`);
        if (err.stack && err.message.length < 200) {
          console.error('[TREND] Chi tiết lỗi:', err.stack.split('\n').slice(0, 3).join('\n'));
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
   * Tính các chỉ báo EMA, RSI
   */
  async calculateIndicators() {
    try {
      const candles = await this.fetchCandles(this.config.symbol, this.config.timeFrame, 200);
      const { highs, lows, closes, opens } = this.parseCandles(candles);

      const maxPeriod = Math.max(this.config.emaFast, this.config.emaSlow, this.config.rsiPeriod);
      if (highs.length < maxPeriod + 10) {
        throw new Error(`Không đủ dữ liệu để tính chỉ báo (cần ít nhất ${maxPeriod + 10}, có ${highs.length})`);
      }

      // Tính EMA Fast (12)
      const emaFastInput = {
        values: closes,
        period: this.config.emaFast,
      };
      const emaFastResult = EMA.calculate(emaFastInput);
      const latestEMAFast = emaFastResult[emaFastResult.length - 1];

      // Tính EMA Slow (26)
      const emaSlowInput = {
        values: closes,
        period: this.config.emaSlow,
      };
      const emaSlowResult = EMA.calculate(emaSlowInput);
      const latestEMASlow = emaSlowResult[emaSlowResult.length - 1];

      // Tính RSI
      const rsiInput = {
        values: closes,
        period: this.config.rsiPeriod,
      };
      const rsiResult = RSI.calculate(rsiInput);
      const latestRSI = rsiResult[rsiResult.length - 1];

      // Lưu lịch sử EMA để detect crossover (lấy 3 giá trị gần nhất)
      this.emaFastHistory = emaFastResult.slice(-3);
      this.emaSlowHistory = emaSlowResult.slice(-3);

      return {
        emaFast: latestEMAFast || 0,
        emaSlow: latestEMASlow || 0,
        rsi: latestRSI || 50,
        currentPrice: closes[closes.length - 1],
        emaFastHistory: this.emaFastHistory,
        emaSlowHistory: this.emaSlowHistory,
      };
    } catch (err) {
      console.error(`[TREND] ❌ Lỗi khi tính chỉ báo: ${err.message}`);
      return null;
    }
  }

  /**
   * Tính khối lượng lệnh dựa trên capital (số tiền muốn vào lệnh) và leverage
   * Formula: size = (capital × leverage) / entryPrice
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


  /**
   * Kiểm tra tín hiệu vào lệnh LONG
   * Điều kiện: EMA 12 cắt lên trên EMA 26 VÀ RSI > 50
   */
  checkLongEntry(indicators) {
    // Kiểm tra có đủ dữ liệu EMA history
    if (!indicators.emaFastHistory || !indicators.emaSlowHistory || 
        indicators.emaFastHistory.length < 2 || indicators.emaSlowHistory.length < 2) {
      return false;
    }

    const emaFastPrev = indicators.emaFastHistory[indicators.emaFastHistory.length - 2];
    const emaSlowPrev = indicators.emaSlowHistory[indicators.emaSlowHistory.length - 2];
    const emaFastCurr = indicators.emaFast;
    const emaSlowCurr = indicators.emaSlow;

    // 1. EMA 12 cắt lên trên EMA 26 (crossover)
    // Kiểm tra: EMA 12 trước <= EMA 26 trước VÀ EMA 12 hiện tại > EMA 26 hiện tại
    const emaCrossover = emaFastPrev <= emaSlowPrev && emaFastCurr > emaSlowCurr;

    // 2. RSI > 50 (lọc tín hiệu giả)
    const rsiFilter = indicators.rsi > this.config.rsiThreshold;

    return emaCrossover && rsiFilter;
  }

  /**
   * Kiểm tra tín hiệu vào lệnh SHORT
   * Điều kiện: EMA 12 cắt xuống dưới EMA 26 VÀ RSI < 50
   */
  checkShortEntry(indicators) {
    // Kiểm tra có đủ dữ liệu EMA history
    if (!indicators.emaFastHistory || !indicators.emaSlowHistory || 
        indicators.emaFastHistory.length < 2 || indicators.emaSlowHistory.length < 2) {
      return false;
    }

    const emaFastPrev = indicators.emaFastHistory[indicators.emaFastHistory.length - 2];
    const emaSlowPrev = indicators.emaSlowHistory[indicators.emaSlowHistory.length - 2];
    const emaFastCurr = indicators.emaFast;
    const emaSlowCurr = indicators.emaSlow;

    // 1. EMA 12 cắt xuống dưới EMA 26 (crossover)
    // Kiểm tra: EMA 12 trước >= EMA 26 trước VÀ EMA 12 hiện tại < EMA 26 hiện tại
    const emaCrossover = emaFastPrev >= emaSlowPrev && emaFastCurr < emaSlowCurr;

    // 2. RSI < 50 (lọc tín hiệu giả)
    const rsiFilter = indicators.rsi < this.config.rsiThreshold;

    return emaCrossover && rsiFilter;
  }

  /**
   * Kiểm tra tín hiệu thoát lệnh (EMA crossover ngược)
   */
  checkEMAExit(indicators, direction) {
    // Kiểm tra có đủ dữ liệu EMA history
    if (!indicators.emaFastHistory || !indicators.emaSlowHistory || 
        indicators.emaFastHistory.length < 2 || indicators.emaSlowHistory.length < 2) {
      return false;
    }

    const emaFastPrev = indicators.emaFastHistory[indicators.emaFastHistory.length - 2];
    const emaSlowPrev = indicators.emaSlowHistory[indicators.emaSlowHistory.length - 2];
    const emaFastCurr = indicators.emaFast;
    const emaSlowCurr = indicators.emaSlow;

    if (direction === 'long') {
      // LONG: Thoát khi EMA 12 cắt xuống dưới EMA 26
      return emaFastPrev > emaSlowPrev && emaFastCurr <= emaSlowCurr;
    } else {
      // SHORT: Thoát khi EMA 12 cắt lên trên EMA 26
      return emaFastPrev < emaSlowPrev && emaFastCurr >= emaSlowCurr;
    }
  }


  /**
   * Kiểm tra tín hiệu vào lệnh
   */
  async checkEntrySignals() {
    const indicators = await this.calculateIndicators();
    if (!indicators) {
      return;
    }

    console.log(`[TREND] 📊 Chỉ báo: EMA12=${formatNumber(indicators.emaFast)}, EMA26=${formatNumber(indicators.emaSlow)}, RSI=${indicators.rsi.toFixed(2)}, Price=${formatNumber(indicators.currentPrice)}`);

    // Kiểm tra LONG entry
    if (this.checkLongEntry(indicators)) {
      console.log('[TREND] ✅ Tín hiệu LONG: EMA12 cắt lên EMA26, RSI > 50');
      
      // Verify position từ API trước
      const apiPosition = await this.getCurrentPosition();
      
      // Đóng lệnh cũ nếu có (bất kể chiều nào, vì chỉ mở 1 lệnh tại một thời điểm)
      if (apiPosition && apiPosition.isActive) {
        console.log(`[TREND] 🔄 Đóng lệnh ${apiPosition.direction.toUpperCase()} cũ trước khi mở LONG mới`);
        await this.closePosition();
        // Đợi và verify lại cho đến khi position đã đóng hoàn toàn
        let retries = 0;
        while (retries < 5) {
          await sleep(1000);
          const verifyPosition = await this.getCurrentPosition();
          if (!verifyPosition || !verifyPosition.isActive) {
            console.log('[TREND] ✅ Đã đóng position cũ thành công');
            break;
          }
          retries++;
          if (retries >= 5) {
            console.warn('[TREND] ⚠️ Position cũ vẫn chưa đóng sau 5 lần thử, tiếp tục mở lệnh mới');
          }
        }
      }
      
      await this.enterPosition('long', indicators);
      return;
    }

    // Kiểm tra SHORT entry
    if (this.checkShortEntry(indicators)) {
      console.log('[TREND] ✅ Tín hiệu SHORT: EMA12 cắt xuống EMA26, RSI < 50');
      
      // Verify position từ API trước
      const apiPosition = await this.getCurrentPosition();
      
      // Đóng lệnh cũ nếu có (bất kể chiều nào, vì chỉ mở 1 lệnh tại một thời điểm)
      if (apiPosition && apiPosition.isActive) {
        console.log(`[TREND] 🔄 Đóng lệnh ${apiPosition.direction.toUpperCase()} cũ trước khi mở SHORT mới`);
        await this.closePosition();
        // Đợi và verify lại cho đến khi position đã đóng hoàn toàn
        let retries = 0;
        while (retries < 5) {
          await sleep(1000);
          const verifyPosition = await this.getCurrentPosition();
          if (!verifyPosition || !verifyPosition.isActive) {
            console.log('[TREND] ✅ Đã đóng position cũ thành công');
            break;
          }
          retries++;
          if (retries >= 5) {
            console.warn('[TREND] ⚠️ Position cũ vẫn chưa đóng sau 5 lần thử, tiếp tục mở lệnh mới');
          }
        }
      }
      
      await this.enterPosition('short', indicators);
      return;
    }

    // Không có tín hiệu vào lệnh
    const emaAbove = indicators.emaFast > indicators.emaSlow;
    const rsiAbove = indicators.rsi > this.config.rsiThreshold;
    
    if (emaAbove && !rsiAbove) {
      console.log(`[TREND] ⏳ EMA12 > EMA26 (xu hướng tăng) nhưng RSI=${indicators.rsi.toFixed(2)} <= ${this.config.rsiThreshold} - Chờ RSI tăng`);
    } else if (!emaAbove && rsiAbove) {
      console.log(`[TREND] ⏳ EMA12 < EMA26 (xu hướng giảm) nhưng RSI=${indicators.rsi.toFixed(2)} > ${this.config.rsiThreshold} - Chờ RSI giảm`);
    } else if (emaAbove && rsiAbove) {
      console.log(`[TREND] ⏳ EMA12 > EMA26 và RSI > ${this.config.rsiThreshold} nhưng chưa có crossover (đã cắt từ trước)`);
    } else {
      console.log(`[TREND] ⏳ EMA12 < EMA26 và RSI < ${this.config.rsiThreshold} nhưng chưa có crossover (đã cắt từ trước)`);
    }
  }

  /**
   * Vào lệnh
   */
  async enterPosition(direction, indicators) {
    try {
      const entryPrice = indicators.currentPrice;

      // Lấy equity (vốn)
      const equity = await this.getEquity();

      // Tính lot size dựa trên capital và leverage
      const lotSizeResult = this.calculateLotSize(entryPrice, equity);

      console.log(`[TREND] 📈 Vào lệnh ${direction.toUpperCase()}:`);
      console.log(`  - Entry: ${formatNumber(entryPrice)}`);
      console.log(`  - Lot Size: ${formatNumber(lotSizeResult.size)}`);
      console.log(`  - Capital sử dụng: ${formatNumber(lotSizeResult.actualCapital || lotSizeResult.capital)} ${this.config.marginCoin} (${this.config.capital && this.config.capital > 0 ? `đã chỉ định: ${this.config.capital}` : 'toàn bộ equity'})`);
      console.log(`  - Leverage: ${this.config.leverage}x`);
      console.log(`  - Notional Value: ${formatNumber(lotSizeResult.notional || lotSizeResult.size * entryPrice)} ${this.config.marginCoin}`);

      // Hiển thị warning nếu có
      if (lotSizeResult.warning) {
        console.warn(`[TREND] ${lotSizeResult.warning}`);
      }

      // Set leverage
      await this.configureLeverage();

      // Kiểm tra nếu capital quá thấp
      if (lotSizeResult.capitalTooLow && lotSizeResult.minCapitalRequired) {
        throw new Error(`Capital quá thấp! Cần ít nhất ${formatNumber(lotSizeResult.minCapitalRequired)} ${this.config.marginCoin} để mở lệnh với leverage ${this.config.leverage}x. Hiện tại: ${formatNumber(lotSizeResult.capital)} ${this.config.marginCoin}`);
      }

      // Mở position (không set SL/TP)
      const side = direction === 'long' ? 'open_long' : 'open_short';
      await this.api.placeOrder({
        symbol: this.config.symbol,
        marginCoin: this.config.marginCoin,
        size: lotSizeResult.size.toString(),
        side,
        orderType: 'market',
      });

      console.log(`[TREND] ✅ Đã mở position ${direction.toUpperCase()} thành công`);

      // Lưu position state
      this.currentPosition = {
        direction,
        entryPrice,
        sl: null,
        tp: null,
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
      console.error(`[TREND] ❌ Lỗi khi vào lệnh: ${err.message}`);
      throw err;
    }
  }

  /**
   * Tính thời gian đến nến 1m tiếp theo (tính bằng milliseconds)
   * Ví dụ: Nếu hiện tại là 10:00:30, nến tiếp theo là 10:01:00 → trả về 30000ms
   */
  getTimeUntilNextCandle() {
    const now = new Date();
    const currentSeconds = now.getSeconds();
    const currentMilliseconds = now.getMilliseconds();
    
    // Tính thời gian đến phút tiếp theo (làm tròn lên)
    // Nếu đang ở giây 30, đợi 30 giây đến phút tiếp theo
    const secondsUntilNextMinute = 60 - currentSeconds;
    const millisecondsUntilNextMinute = (secondsUntilNextMinute * 1000) - currentMilliseconds;
    
    // Đảm bảo ít nhất đợi 100ms để tránh chạy quá sớm
    return Math.max(millisecondsUntilNextMinute, 100);
  }

  /**
   * Monitor position hiện tại
   */
  async monitorPosition() {
    if (!this.currentPosition || !this.currentPosition.isActive) {
      return;
    }

    try {
      // Lấy chỉ báo hiện tại
      const indicators = await this.calculateIndicators();
      if (!indicators) {
        return;
      }

      // Lấy giá hiện tại từ API
      const ticker = await this.api.getTicker(this.config.symbol);
      const currentPrice = Number(ticker?.last || ticker?.markPrice);

      if (!currentPrice || currentPrice <= 0) {
        return;
      }

      const { direction, entryPrice } = this.currentPosition;

      // Kiểm tra EMA crossover ngược (exit signal)
      let shouldClose = false;
      let closeReason = '';

      if (this.checkEMAExit(indicators, direction)) {
        shouldClose = true;
        closeReason = `EMA Crossover ngược (EMA12 ${direction === 'long' ? 'cắt xuống' : 'cắt lên'} EMA26)`;
      }

      if (shouldClose) {
        console.log(`[TREND] 🔔 Thoát lệnh: ${closeReason}`);
        
        // Kiểm tra xem có tín hiệu vào lệnh mới ngay không
        const hasLongSignal = this.checkLongEntry(indicators);
        const hasShortSignal = this.checkShortEntry(indicators);
        
        if (hasLongSignal || hasShortSignal) {
          // Có tín hiệu vào lệnh mới → Đóng lệnh cũ và mở lệnh mới cùng lúc
          const newDirection = hasLongSignal ? 'long' : 'short';
          console.log(`[TREND] 🔄 Phát hiện tín hiệu ${newDirection.toUpperCase()} mới, đóng lệnh cũ và mở lệnh mới ngay lập tức`);
          
          // Đóng lệnh cũ
          await this.closePosition();
          
          // Đợi và verify lại cho đến khi position đã đóng hoàn toàn
          let retries = 0;
          while (retries < 5) {
            await sleep(1000);
            const verifyPosition = await this.getCurrentPosition();
            if (!verifyPosition || !verifyPosition.isActive) {
              console.log('[TREND] ✅ Đã đóng position cũ thành công');
              break;
            }
            retries++;
            if (retries >= 5) {
              console.warn('[TREND] ⚠️ Position cũ vẫn chưa đóng sau 5 lần thử, tiếp tục mở lệnh mới');
            }
          }
          
          // Mở lệnh mới ngay lập tức
          await this.enterPosition(newDirection, indicators);
        } else {
          // Không có tín hiệu vào lệnh mới → Chỉ đóng lệnh
          await this.closePosition();
        }
      } else {
        // Log status
        const pnlPercent = direction === 'long'
          ? ((currentPrice - entryPrice) / entryPrice) * 100
          : ((entryPrice - currentPrice) / entryPrice) * 100;

        console.log(`[TREND] 📊 Position ${direction.toUpperCase()}: Entry=${formatNumber(entryPrice)}, Current=${formatNumber(currentPrice)}, PnL=${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%`);
      }
    } catch (err) {
      console.error(`[TREND] ❌ Lỗi khi monitor position: ${err.message}`);
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
        console.log(`[TREND] ✅ Đã đóng position ${direction.toUpperCase()}`);
      } catch (closeErr) {
        // Nếu closePosition fail, dùng placeOrder
        console.log(`[TREND] ⚠️ closePosition API fail, dùng placeOrder: ${closeErr.message}`);
        const side = direction === 'long' ? 'close_long' : 'close_short';
        await this.api.placeOrder({
          symbol: this.config.symbol,
          marginCoin: this.config.marginCoin,
          size: size ? size.toString() : '0',
          side,
          orderType: 'market',
        });
        console.log(`[TREND] ✅ Đã đóng position ${direction.toUpperCase()} bằng placeOrder`);
      }

      // Clear local state
      this.currentPosition.isActive = false;
      this.currentPosition = null;

      // Clear history
      this.emaFastHistory = [];
      this.emaSlowHistory = [];
    } catch (err) {
      console.error(`[TREND] ❌ Lỗi khi đóng position: ${err.message}`);
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
      console.error(`[TREND] ❌ Lỗi khi lấy equity: ${err.message}`);
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
        console.log(`[TREND] ✅ Đã set leverage ${this.config.leverage}x cho Long và Short`);
      } catch (err) {
        console.warn(`[TREND] ⚠️ Không thể set leverage: ${err.message}`);
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

      console.log(`[TREND] ℹ️ Thông tin contract: tick giá=${this.priceTick || 'AUTO'}, bước khối lượng=${this.sizeStep || 'AUTO'}, min lot size=${formatNumber(this.minLotSize)}`);
    } catch (err) {
      console.warn(`[TREND] ⚠️ Không lấy được contract spec: ${err.message}`);
      this.priceTick = this.priceTick || 0.01;
      this.priceDecimals = getDecimalsFromStep(this.priceTick);
      this.sizeStep = this.sizeStep || 0.0001;
    } finally {
      this.marketInfoLoaded = true;
    }
  }
}

module.exports = { TrendBot };

