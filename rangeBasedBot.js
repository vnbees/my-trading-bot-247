/**
 * Range-Based Trading Bot
 * 
 * Bot này theo dõi chart 1h và giao dịch dựa trên:
 * - Tính trung bình biên độ (range) của 720 cây nến 1h gần nhất (1 tháng)
 * - ROI target = trung bình biên độ * leverage
 * - Quy tắc: nến xanh → SHORT, nến đỏ → LONG
 * - Chạy đúng vào đầu giờ (khi nến mới mở)
 */

require('dotenv').config();
const axios = require('axios');
const {
  sleep,
  formatNumber,
  roundToTick,
  roundToStep,
  getDecimalsFromStep,
} = require('./utils');

// Binance API
const BINANCE_API_URL = 'https://api.binance.com/api/v3/klines';

class RangeBasedBot {
  constructor({ apiClient, config }) {
    this.api = apiClient;
    this.config = {
      symbol: 'BTCUSDT_UMCBL',
      marginCoin: 'USDT',
      capital: 10, // USDT margin per trade
      leverage: 10,
      priceTickSize: 0,
      sizeStep: 0,
      ...config,
    };

    this.isRunning = false;
    this.priceTick = this.config.priceTickSize > 0 ? this.config.priceTickSize : null;
    this.sizeStep = this.config.sizeStep > 0 ? this.config.sizeStep : null;
    this.marketInfoLoaded = false;
    this.priceDecimals = this.priceTick ? getDecimalsFromStep(this.priceTick) : 4;
    this.minLotSize = null;
    this.lastProcessedHour = null; // Để tránh xử lý trùng lặp
  }

  async run() {
    this.isRunning = true;
    console.log('[RANGE-BOT] 🚀 Khởi động Range-Based Trading Bot');
    console.log(`  - Symbol: ${this.config.symbol}`);
    console.log(`  - Capital: ${this.config.capital} ${this.config.marginCoin}`);
    console.log(`  - Leverage: ${this.config.leverage}x`);
    console.log(`  - Timeframe: 1h`);

    await this.prepareMarketMeta();
    await this.configureLeverage();

    // Chờ đến đầu giờ tiếp theo
    await this.waitForNextHour();

    while (this.isRunning) {
      try {
        await this.executeCycle();
        // Chờ đến đầu giờ tiếp theo (60 phút)
        await this.waitForNextHour();
      } catch (err) {
        console.error(`[RANGE-BOT] ❌ Lỗi trong cycle: ${err.message}`);
        if (err.stack) {
          console.error(err.stack);
        }
        console.log('[RANGE-BOT] ⏳ Đợi 5 phút trước khi retry...');
        await sleep(5 * 60 * 1000);
      }
    }
  }

  /**
   * Chờ đến đầu giờ tiếp theo (khi nến 1h mới mở)
   */
  async waitForNextHour() {
    const now = new Date();
    const currentMinute = now.getMinutes();
    const currentSecond = now.getSeconds();
    const currentMs = now.getMilliseconds();

    // Tính số ms còn lại đến đầu giờ tiếp theo
    const msUntilNextHour =
      (60 - currentMinute) * 60 * 1000 - currentSecond * 1000 - currentMs;

    if (msUntilNextHour > 0) {
      const nextHour = new Date(now.getTime() + msUntilNextHour);
      console.log(
        `[RANGE-BOT] ⏳ Chờ đến đầu giờ tiếp theo: ${nextHour.toLocaleString('vi-VN')} (còn ${(msUntilNextHour / 1000 / 60).toFixed(1)} phút)`
      );
      await sleep(msUntilNextHour);
    }
  }

  /**
   * Lấy dữ liệu nến từ Binance
   */
  async getBinanceKlines(symbol = 'BTCUSDT', interval = '1h', limit = 24) {
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
        '[RANGE-BOT] ❌ Lỗi khi lấy dữ liệu từ Binance:',
        error.message
      );
      throw error;
    }
  }

  /**
   * Tính trung bình biên độ của các nến (dưới dạng phần trăm)
   * Sử dụng dữ liệu 1 tháng (720 nến 1h) để tính toán
   */
  calculateAverageRange(klines) {
    if (!klines || klines.length === 0) {
      throw new Error('Không có dữ liệu nến để tính toán');
    }

    const ranges = klines.map((k) => {
      // Biên độ = (high - low) / close (dưới dạng phần trăm)
      return ((k.high - k.low) / k.close) * 100;
    });

    const sum = ranges.reduce((acc, val) => acc + val, 0);
    const average = sum / ranges.length;

    console.log(`[RANGE-BOT] 📊 Đã tính toán từ ${klines.length} nến 1h (${(klines.length / 24).toFixed(1)} ngày)`);

    return {
      averageRangePercent: average,
      ranges: ranges,
      minRange: Math.min(...ranges),
      maxRange: Math.max(...ranges),
      candleCount: klines.length,
    };
  }

  /**
   * Tính ROI target dựa trên trung bình biên độ và leverage
   * ROI target là lợi nhuận mong đợi (dưới dạng phần trăm)
   */
  calculateROITarget(averageRangePercent, leverage) {
    // ROI target = trung bình biên độ * leverage
    // Ví dụ: biên độ trung bình 0.5%, leverage 10x → ROI target = 5%
    // Điều này có nghĩa: nếu giá di chuyển đúng bằng biên độ trung bình (0.5%),
    // thì với leverage 10x, lợi nhuận sẽ là 5%
    return averageRangePercent * leverage;
  }

  /**
   * Xác định màu nến và hướng giao dịch
   * @returns {Object} { isGreen, isRed, direction, candle }
   */
  analyzeCandle(candle) {
    const isGreen = candle.close > candle.open;
    const isRed = candle.close < candle.open;
    const isDoji = candle.close === candle.open;

    let direction = null;
    if (isGreen) {
      direction = 'short'; // Nến xanh → vào SHORT
    } else if (isRed) {
      direction = 'long'; // Nến đỏ → vào LONG
    }

    return {
      isGreen,
      isRed,
      isDoji,
      direction,
      candle,
    };
  }

  async executeCycle() {
    const now = new Date();
    const currentHour = now.getHours();

    // Kiểm tra xem đã xử lý giờ này chưa
    if (this.lastProcessedHour === currentHour) {
      console.log(
        `[RANGE-BOT] ℹ️ Đã xử lý giờ ${currentHour}h rồi, bỏ qua.`
      );
      return;
    }

    console.log('\n' + '='.repeat(70));
    console.log(
      `[RANGE-BOT] 🔄 Bắt đầu chu kỳ mới - ${now.toLocaleString('vi-VN')}`
    );
    console.log('='.repeat(70));

    // Lấy symbol Binance (bỏ suffix _UMCBL)
    const binanceSymbol = this.config.symbol
      .replace('_UMCBL', '')
      .replace('_CMCBL', '')
      .replace('_DMCBL', '');

    // Lấy 720 cây nến 1h gần nhất (1 tháng = 30 ngày × 24 giờ)
    console.log('[RANGE-BOT] 📊 Đang lấy dữ liệu nến 1h từ Binance (1 tháng = 720 nến)...');
    const klines = await this.getBinanceKlines(binanceSymbol, '1h', 720);

    if (!klines || klines.length < 720) {
      console.warn(`[RANGE-BOT] ⚠️ Chỉ lấy được ${klines?.length || 0} nến, cần 720 nến (1 tháng)`);
      if (!klines || klines.length < 24) {
        throw new Error(`Không đủ dữ liệu nến (cần ít nhất 24 nến, nhận được ${klines?.length || 0})`);
      }
    }

    // Tính trung bình biên độ (từ 1 tháng dữ liệu)
    const rangeData = this.calculateAverageRange(klines);
    console.log(
      `[RANGE-BOT] 📈 Trung bình biên độ (1 tháng): ${rangeData.averageRangePercent.toFixed(4)}%`
    );
    console.log(
      `  - Số nến: ${rangeData.candleCount} (${(rangeData.candleCount / 24).toFixed(1)} ngày)`
    );
    console.log(
      `  - Min: ${rangeData.minRange.toFixed(4)}%, Max: ${rangeData.maxRange.toFixed(4)}%`
    );

    // Tính ROI target (để hiển thị)
    const roiTargetPercent = this.calculateROITarget(
      rangeData.averageRangePercent,
      this.config.leverage
    );
    console.log('\n' + '─'.repeat(70));
    console.log(`[RANGE-BOT] 🎯 ROI TARGET ĐÃ TÍNH TOÁN:`);
    console.log(`  - Biên độ trung bình: ${rangeData.averageRangePercent.toFixed(4)}%`);
    console.log(`  - Leverage: ${this.config.leverage}x`);
    console.log(`  - ROI Target: ${roiTargetPercent.toFixed(4)}%`);
    console.log(`  - Công thức: ${rangeData.averageRangePercent.toFixed(4)}% × ${this.config.leverage}x = ${roiTargetPercent.toFixed(4)}%`);
    console.log('─'.repeat(70) + '\n');
    console.log(
      `[RANGE-BOT] 📊 TP sẽ được đặt dựa trên biên độ trung bình: ${rangeData.averageRangePercent.toFixed(4)}%`
    );

    // Lấy cây nến trước đó (ví dụ: lúc 9h lấy nến 8h)
    // Nến cuối cùng trong mảng có thể là nến đang hình thành (chưa đóng cửa)
    // Nên lấy nến thứ 2 từ cuối (nến đã đóng cửa gần nhất)
    // Nếu chỉ có 1 nến, lấy nến đó
    // Lưu ý: Binance trả về nến theo thứ tự thời gian tăng dần
    // Nến cuối cùng là nến mới nhất, có thể chưa đóng cửa
    let previousCandleIndex = klines.length >= 2 ? klines.length - 2 : klines.length - 1;
    let previousCandle = klines[previousCandleIndex];
    
    // Kiểm tra xem nến có đóng cửa chưa (closeTime < nowTimestamp)
    const nowTimestamp = Date.now();
    let candleCloseTime = new Date(previousCandle.closeTime).getTime();
    
    // Nếu nến chưa đóng cửa, lấy nến trước đó
    while (candleCloseTime > nowTimestamp && previousCandleIndex > 0) {
      previousCandleIndex--;
      previousCandle = klines[previousCandleIndex];
      candleCloseTime = new Date(previousCandle.closeTime).getTime();
    }
    
    const previousCandleTime = new Date(previousCandle.time);
    console.log(
      `[RANGE-BOT] 📍 Cây nến được phân tích: ${previousCandleTime.toLocaleString('vi-VN')}`
    );
    console.log(
      `  O: ${previousCandle.open.toFixed(this.priceDecimals)}, H: ${previousCandle.high.toFixed(this.priceDecimals)}, L: ${previousCandle.low.toFixed(this.priceDecimals)}, C: ${previousCandle.close.toFixed(this.priceDecimals)}`
    );

    // Phân tích nến
    const analysis = this.analyzeCandle(previousCandle);

    if (analysis.isDoji) {
      console.log(
        '[RANGE-BOT] ⚠️ Cây nến là Doji (open = close), bỏ qua giao dịch.'
      );
      this.lastProcessedHour = currentHour;
      return;
    }

    if (!analysis.direction) {
      console.log(
        '[RANGE-BOT] ⚠️ Không xác định được hướng giao dịch, bỏ qua.'
      );
      this.lastProcessedHour = currentHour;
      return;
    }

    console.log(
      `[RANGE-BOT] 💡 Tín hiệu: Nến ${analysis.isGreen ? 'XANH' : 'ĐỎ'} → Vào lệnh ${analysis.direction.toUpperCase()}`
    );

    // Kiểm tra position hiện tại
    const currentPosition = await this.getCurrentPosition();
    if (currentPosition) {
      console.log(
        `[RANGE-BOT] ⚠️ Đang có position ${currentPosition.direction.toUpperCase()}, đóng trước khi vào lệnh mới.`
      );
      await this.closePosition(currentPosition.direction);
      await sleep(2000);
    }

    // Lấy giá hiện tại
    const currentPrice = await this.getCurrentPrice();

    // Vào lệnh (truyền biên độ trung bình để tính TP, không phải ROI target)
    await this.openPosition(
      analysis.direction,
      currentPrice,
      rangeData.averageRangePercent
    );

    this.lastProcessedHour = currentHour;
  }

  /**
   * ================== Bitget helpers & trading actions ==================
   */

  async prepareMarketMeta() {
    if (this.marketInfoLoaded) return;

    try {
      console.log('[RANGE-BOT] ⚙️ Đang lấy thông tin contract từ Bitget...');
      const productType = this.config.symbol.includes('_UMCBL')
        ? 'umcbl'
        : 'umcbl';
      const contract = await this.api.getContract(
        this.config.symbol,
        productType
      );

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
        contract.minTradeNum || contract.minSize || this.sizeStep || 0.001
      );

      console.log(
        `[RANGE-BOT] ℹ️ Contract spec: tick=${this.priceTick}, step=${this.sizeStep}, minLot=${formatNumber(
          this.minLotSize
        )}`
      );
    } catch (err) {
      console.warn(
        `[RANGE-BOT] ⚠️ Không lấy được contract spec: ${err.message} → dùng default`
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
      // Set margin mode = crossed
      try {
        await this.api.setMarginMode({
          symbol: this.config.symbol,
          marginCoin: this.config.marginCoin,
          marginMode: 'crossed',
        });
      } catch (err) {
        console.warn(
          `[RANGE-BOT] ⚠️ setMarginMode: ${err.message} (có thể đã set từ trước)`
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
                `[RANGE-BOT] ⚠️ Lỗi khi set leverage cho ${side}: ${err.message}`
              );
            })
        )
      );
      console.log(
        `[RANGE-BOT] ✅ Đã set leverage ${this.config.leverage}x (crossed)`
      );
    } catch (err) {
      console.error(
        `[RANGE-BOT] ❌ Lỗi khi config leverage/margin: ${err.message}`
      );
      throw err;
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

  /**
   * Tính giá TP dựa trên biên độ trung bình (phần trăm)
   * TP được đặt dựa trên biên độ trung bình, không phải ROI target
   * Với leverage, nếu giá di chuyển đúng bằng biên độ trung bình,
   * thì ROI sẽ đạt target (biên độ trung bình × leverage)
   */
  calculateTakeProfitPrice(entryPrice, direction, averageRangePercent) {
    // Biên độ trung bình là phần trăm, cần chuyển về decimal
    const rangeDecimal = averageRangePercent / 100;

    if (direction === 'long') {
      // Long: TP = entryPrice * (1 + rangeDecimal)
      // Ví dụ: entryPrice = 100, range = 0.5% → TP = 100 * 1.005 = 100.5
      // Với leverage 10x, ROI = 0.5% * 10 = 5% ✅
      return entryPrice * (1 + rangeDecimal);
    } else {
      // Short: TP = entryPrice * (1 - rangeDecimal)
      // Ví dụ: entryPrice = 100, range = 0.5% → TP = 100 * 0.995 = 99.5
      // Với leverage 10x, ROI = 0.5% * 10 = 5% ✅
      return entryPrice * (1 - rangeDecimal);
    }
  }

  async openPosition(side, currentPrice, averageRangePercent) {
    const directionLabel = side.toUpperCase();
    await this.configureLeverage();

    // Kiểm tra số dư
    const accountStatus = await this.getAccountStatus();
    const equity = accountStatus.equity;
    const available = accountStatus.available || accountStatus.freeMargin || equity;
    let capital = this.config.capital;

    if (capital < 1.0) {
      console.log(
        `[RANGE-BOT] ⚠️ Capital ${capital} < 1 USDT → nâng lên 1 USDT`
      );
      capital = 1.0;
    }

    // Tính số tiền cần thiết
    const lotSizeResult = this.calculateLotSize(currentPrice, capital);
    if (lotSizeResult.capitalTooLow) {
      console.log(
        `[RANGE-BOT] ❌ Không thể mở ${directionLabel}: ${lotSizeResult.warning}`
      );
      return;
    }

    const requiredCapital = lotSizeResult.actualCapital || lotSizeResult.capital;

    // Kiểm tra xem có đủ tiền không
    if (available < requiredCapital) {
      console.log(
        `[RANGE-BOT] ⚠️ Không đủ tiền để vào lệnh. Cần: ${formatNumber(requiredCapital)} USDT, Có: ${formatNumber(available)} USDT`
      );
      console.log(`[RANGE-BOT] 🔍 Đang tìm position để cắt bớt...`);

      // Tìm position có PnL nhỏ nhất và cắt bớt
      const freedCapital = await this.freeUpCapital(requiredCapital - available);
      
      if (freedCapital < requiredCapital - available) {
        console.log(
          `[RANGE-BOT] ❌ Không thể giải phóng đủ vốn. Cần thêm: ${formatNumber(requiredCapital - available - freedCapital)} USDT`
        );
        return;
      }

      // Đợi một chút để đảm bảo vốn đã được giải phóng
      await sleep(2000);
      
      // Kiểm tra lại số dư
      const newAccountStatus = await this.getAccountStatus();
      const newAvailable = newAccountStatus.available || newAccountStatus.freeMargin || newAccountStatus.equity;
      
      if (newAvailable < requiredCapital) {
        console.log(
          `[RANGE-BOT] ⚠️ Vẫn không đủ tiền sau khi cắt position. Cần: ${formatNumber(requiredCapital)} USDT, Có: ${formatNumber(newAvailable)} USDT`
        );
        // Giảm capital xuống mức có thể
        capital = Math.max(1.0, newAvailable * 0.9);
        console.log(`[RANGE-BOT] 💡 Giảm capital xuống: ${formatNumber(capital)} USDT`);
        
        const adjustedLotSizeResult = this.calculateLotSize(currentPrice, capital);
        if (adjustedLotSizeResult.capitalTooLow) {
          console.log(
            `[RANGE-BOT] ❌ Vẫn không đủ để vào lệnh với capital tối thiểu`
          );
          return;
        }
        // Cập nhật lại lotSizeResult
        Object.assign(lotSizeResult, adjustedLotSizeResult);
      }
    }

    // Tính giá TP dựa trên biên độ trung bình
    const tpPrice = this.calculateTakeProfitPrice(
      currentPrice,
      side,
      averageRangePercent
    );
    const roundedTpPrice = this.priceTick
      ? roundToTick(tpPrice, this.priceTick)
      : tpPrice;

    // Tính ROI target để hiển thị
    const roiTargetPercent = averageRangePercent * this.config.leverage;

    console.log(`[RANGE-BOT] 📈 Mở ${directionLabel}:`);
    console.log(
      `  Entry≈${formatNumber(currentPrice)}, Size=${formatNumber(
        lotSizeResult.size
      )}, Capital≈${formatNumber(
        lotSizeResult.actualCapital || lotSizeResult.capital
      )} USDT`
    );
    console.log(
      `  TP: ${formatNumber(roundedTpPrice)} (biên độ: ${averageRangePercent.toFixed(4)}%, ROI target: ${roiTargetPercent.toFixed(4)}%)`
    );

    const apiSide = side === 'long' ? 'open_long' : 'open_short';

    await this.api.placeOrder({
      symbol: this.config.symbol,
      marginCoin: this.config.marginCoin,
      size: lotSizeResult.size.toString(),
      side: apiSide,
      orderType: 'market',
      presetTakeProfitPrice: roundedTpPrice.toString(),
      // Không có SL
    });

    console.log(`[RANGE-BOT] ✅ Đã mở ${directionLabel} thành công với TP`);
    await sleep(2000);
  }

  async closePosition(side) {
    const position = await this.getCurrentPosition();
    if (!position || position.direction !== side) {
      console.log(
        `[RANGE-BOT] ℹ️ Không có position ${side.toUpperCase()} để đóng.`
      );
      return;
    }

    console.log(
      `[RANGE-BOT] 🔴 Đóng ${side.toUpperCase()} size=${formatNumber(
        position.size
      )}`
    );

    await this.api.closePosition({
      symbol: this.config.symbol,
      marginCoin: this.config.marginCoin,
      holdSide: side,
      size: position.size.toString(),
    });

    console.log(`[RANGE-BOT] ✅ Đã đóng ${side.toUpperCase()} thành công`);
    await sleep(2000);
  }

  async getEquity() {
    const productType = this.config.symbol.includes('_UMCBL')
      ? 'umcbl'
      : 'umcbl';
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
      const productType = this.config.symbol.includes('_UMCBL')
        ? 'umcbl'
        : 'umcbl';
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

      // Tính total margin used từ tất cả positions
      const allPositions = await this.getAllPositions();
      let totalMarginUsed = 0;

      if (allPositions && allPositions.length > 0) {
        allPositions.forEach((pos) => {
          const size = Number(pos.total || pos.holdSize || pos.size || 0);
          const entryPrice = Number(
            pos.averageOpenPrice ||
              pos.openPriceAvg ||
              pos.entryPrice ||
              pos.avgEntryPrice ||
              0
          );
          if (size > 0 && entryPrice > 0) {
            const notional = size * entryPrice;
            const marginUsed = notional / this.config.leverage;
            totalMarginUsed += marginUsed;
          }
        });
      }

      const freeMargin = equity - totalMarginUsed;

      return {
        equity,
        available,
        totalMarginUsed,
        freeMargin,
      };
    } catch (err) {
      console.error(
        `[RANGE-BOT] ❌ Lỗi khi lấy account status: ${err.message}`
      );
      return {
        equity: 0,
        available: 0,
        totalMarginUsed: 0,
        freeMargin: 0,
      };
    }
  }

  /**
   * Lấy tất cả positions từ tài khoản
   */
  async getAllPositions() {
    try {
      const productType = this.config.symbol.includes('_UMCBL')
        ? 'umcbl'
        : 'umcbl';
      const positions = await this.api.getAllPositions(productType, this.config.marginCoin);

      if (!positions) return [];
      if (Array.isArray(positions)) {
        return positions.filter(
          (p) => Number(p.total || p.holdSize || p.size || 0) > 0
        );
      }
      return [];
    } catch (err) {
      console.warn(
        `[RANGE-BOT] ⚠️ Lỗi khi getAllPositions: ${err.message}`
      );
      return [];
    }
  }

  /**
   * Lấy giá hiện tại cho một symbol
   */
  async getPriceForSymbol(symbol) {
    try {
      // Normalize symbol để so sánh
      const normalizeSymbol = (s) => {
        return s
          .replace('_UMCBL', '')
          .replace('_CMCBL', '')
          .replace('_DMCBL', '')
          .toUpperCase();
      };

      // Nếu là symbol hiện tại, dùng getCurrentPrice
      if (normalizeSymbol(symbol) === normalizeSymbol(this.config.symbol)) {
        return await this.getCurrentPrice();
      }

      // Lấy giá từ Binance cho symbol khác
      const binanceSymbol = normalizeSymbol(symbol);
      const klines = await this.getBinanceKlines(binanceSymbol, '1m', 1);
      if (!klines || !klines.length) {
        // Fallback: dùng giá từ position data nếu có
        return null;
      }
      return klines[0].close;
    } catch (err) {
      console.warn(`[RANGE-BOT] ⚠️ Không lấy được giá cho ${symbol}: ${err.message}`);
      return null;
    }
  }

  /**
   * Tính PnL cho một position
   */
  async calculatePositionPnL(position) {
    const size = Number(
      position.total || position.holdSize || position.size || position.quantity || 0
    );
    const entryPrice = Number(
      position.averageOpenPrice ||
        position.openPriceAvg ||
        position.entryPrice ||
        position.avgEntryPrice ||
        0
    );
    const direction =
      position.holdSide || position.side || position.direction || 'long';
    const symbol = position.symbol || this.config.symbol;

    if (size <= 0 || entryPrice <= 0) {
      return null;
    }

    // Lấy giá hiện tại cho symbol này
    const currentPrice = await this.getPriceForSymbol(symbol);
    if (!currentPrice || currentPrice <= 0) {
      // Nếu không lấy được giá, dùng entryPrice (PnL = 0)
      console.warn(`[RANGE-BOT] ⚠️ Không lấy được giá cho ${symbol}, dùng entryPrice`);
      return {
        symbol,
        direction: direction === 'short' || direction === 'open_short' ? 'short' : 'long',
        size,
        entryPrice,
        currentPrice: entryPrice,
        marginUsed: (size * entryPrice) / this.config.leverage,
        priceChangePercent: 0,
        roiPercent: 0,
        unrealizedPnL: 0,
        position,
      };
    }

    const notional = size * entryPrice;
    const marginUsed = notional / this.config.leverage;

    // Tính PnL
    let priceChangePercent = 0;
    if (direction === 'long' || direction === 'open_long') {
      priceChangePercent = ((currentPrice - entryPrice) / entryPrice) * 100;
    } else {
      priceChangePercent = ((entryPrice - currentPrice) / entryPrice) * 100;
    }

    const roiPercent = priceChangePercent * this.config.leverage;
    const unrealizedPnL = (roiPercent / 100) * marginUsed;

    return {
      symbol,
      direction: direction === 'short' || direction === 'open_short' ? 'short' : 'long',
      size,
      entryPrice,
      currentPrice,
      marginUsed,
      priceChangePercent,
      roiPercent,
      unrealizedPnL,
      position, // Giữ nguyên position object để dùng sau
    };
  }

  /**
   * Tìm position có PnL nhỏ nhất (lãi ít hoặc lỗ ít) và cắt bớt một phần
   * @param {number} requiredCapital - Số tiền cần giải phóng (USDT)
   * @returns {number} - Số tiền đã giải phóng được (USDT)
   */
  async freeUpCapital(requiredCapital) {
    try {
      const allPositions = await this.getAllPositions();

      if (!allPositions || allPositions.length === 0) {
        console.log(`[RANGE-BOT] ℹ️ Không có position nào để cắt bớt`);
        return 0;
      }

      // Tính PnL cho tất cả positions
      const positionsWithPnL = [];
      for (const pos of allPositions) {
        const pnlData = await this.calculatePositionPnL(pos);
        if (pnlData) {
          positionsWithPnL.push(pnlData);
        }
      }

      if (positionsWithPnL.length === 0) {
        console.log(`[RANGE-BOT] ℹ️ Không có position hợp lệ để cắt bớt`);
        return 0;
      }

      // Sắp xếp theo PnL (từ nhỏ đến lớn) - lãi ít hoặc lỗ ít nhất
      positionsWithPnL.sort((a, b) => a.unrealizedPnL - b.unrealizedPnL);

      console.log(
        `[RANGE-BOT] 📊 Tìm thấy ${positionsWithPnL.length} position(s):`
      );
      positionsWithPnL.forEach((p, idx) => {
        console.log(
          `  ${idx + 1}. ${p.symbol} ${p.direction.toUpperCase()} | PnL: ${p.unrealizedPnL >= 0 ? '+' : ''}${formatNumber(p.unrealizedPnL)} USDT | Margin: ${formatNumber(p.marginUsed)} USDT`
        );
      });

      // Lấy position có PnL nhỏ nhất
      const targetPosition = positionsWithPnL[0];
      console.log(
        `[RANGE-BOT] 🎯 Chọn position để cắt bớt: ${targetPosition.symbol} ${targetPosition.direction.toUpperCase()} (PnL: ${targetPosition.unrealizedPnL >= 0 ? '+' : ''}${formatNumber(targetPosition.unrealizedPnL)} USDT)`
      );

      // Tính số tiền cần cắt bớt (cộng thêm một chút buffer)
      const capitalNeeded = requiredCapital * 1.1; // Thêm 10% buffer
      const percentageToClose = Math.min(
        90,
        (capitalNeeded / targetPosition.marginUsed) * 100
      );

      if (percentageToClose >= 100) {
        // Cần đóng toàn bộ position
        console.log(
          `[RANGE-BOT] 🔴 Đóng toàn bộ position ${targetPosition.symbol} ${targetPosition.direction.toUpperCase()}`
        );
        await this.api.closePosition({
          symbol: targetPosition.symbol,
          marginCoin: this.config.marginCoin,
          holdSide: targetPosition.direction,
          size: targetPosition.size.toString(),
        });
        return targetPosition.marginUsed;
      } else {
        // Partial close
        console.log(
          `[RANGE-BOT] 🔻 Cắt bớt ${percentageToClose.toFixed(2)}% position ${targetPosition.symbol} ${targetPosition.direction.toUpperCase()}`
        );
        await this.partialClosePosition(
          targetPosition.symbol,
          targetPosition.direction,
          percentageToClose
        );
        return targetPosition.marginUsed * (percentageToClose / 100);
      }
    } catch (err) {
      console.error(
        `[RANGE-BOT] ❌ Lỗi khi freeUpCapital: ${err.message}`
      );
      return 0;
    }
  }

  /**
   * Partial close một position
   */
  async partialClosePosition(symbol, direction, percentage) {
    try {
      const position = await this.api.getPosition(symbol, this.config.marginCoin);
      let pos = position;
      if (Array.isArray(position)) {
        pos = position.find(
          (p) => Number(p.total || p.holdSize || p.size || 0) > 0
        );
      }

      if (!pos) {
        throw new Error(`Không tìm thấy position ${symbol} ${direction}`);
      }

      const size = Number(
        pos.total || pos.holdSize || pos.size || pos.quantity || 0
      );
      if (size <= 0) {
        throw new Error(`Position ${symbol} ${direction} có size = 0`);
      }

      const closeSize = size * (percentage / 100);
      const remainingSize = size - closeSize;

      // Kiểm tra xem sau khi đóng, position còn lại có >= 1 USDT margin không
      const entryPrice = Number(
        pos.averageOpenPrice ||
          pos.openPriceAvg ||
          pos.entryPrice ||
          pos.avgEntryPrice ||
          0
      );
      const remainingNotional = remainingSize * entryPrice;
      const remainingMargin = remainingNotional / this.config.leverage;

      if (remainingMargin < 1.0 && remainingSize > 0) {
        // Nếu còn lại quá ít, đóng toàn bộ
        console.log(
          `[RANGE-BOT] ⚠️ Sau khi partial close, position còn lại quá nhỏ (<1 USDT), đóng toàn bộ`
        );
        await this.api.closePosition({
          symbol,
          marginCoin: this.config.marginCoin,
          holdSide: direction,
          size: size.toString(),
        });
      } else {
        await this.api.closePosition({
          symbol,
          marginCoin: this.config.marginCoin,
          holdSide: direction,
          size: closeSize.toString(),
        });
      }

      console.log(
        `[RANGE-BOT] ✅ Đã partial close ${percentage.toFixed(2)}% position ${symbol} ${direction.toUpperCase()}`
      );
      await sleep(2000);
    } catch (err) {
      console.error(
        `[RANGE-BOT] ❌ Lỗi khi partialClosePosition: ${err.message}`
      );
      throw err;
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
        position = data.find(
          (p) => Number(p.total || p.holdSize || p.size || 0) > 0
        );
      }

      if (!position) return null;

      const size = Number(
        position.total ||
          position.holdSize ||
          position.size ||
          position.quantity ||
          0
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
        `[RANGE-BOT] ⚠️ Lỗi khi getCurrentPosition: ${err.message}`
      );
      return null;
    }
  }
}

module.exports = { RangeBasedBot };

