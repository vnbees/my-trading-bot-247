/**
 * Gemini AI Trading Bot
 * 
 * Bot tự động phân tích giá bằng Gemini AI và vào lệnh
 * - Lấy dữ liệu 5 phút trong 1 ngày gần nhất từ Binance
 * - Gửi tới Gemini AI để phân tích
 * - Tự động vào lệnh theo khuyến nghị của AI
 * - Chạy mỗi 1 giờ một lần
 */

const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const {
  sleep,
  formatNumber,
  roundToTick,
  roundToStep,
  getDecimalsFromStep,
} = require('./utils');

// Google Gemini API Configuration
const GOOGLE_API_KEY = 'AIzaSyBjtsO8MYNq8PMZH8dW_QkeAxL98Jexic0';

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

    // Main loop - chạy mỗi 1 giờ
    console.log(`[GEMINI-BOT] ⏰ Bot sẽ chạy mỗi 1 giờ...\n`);
    
    while (this.isRunning) {
      try {
        await this.executeCycle();
        
        // Đợi 1 giờ trước khi chạy lại
        const waitHours = 1;
        const waitMs = waitHours * 60 * 60 * 1000;
        const nextRun = new Date(Date.now() + waitMs);
        console.log(`\n[GEMINI-BOT] ⏳ Đợi ${waitHours} giờ... Lần chạy tiếp theo: ${nextRun.toLocaleString('vi-VN')}\n`);
        await sleep(waitMs);
      } catch (err) {
        console.error(`[GEMINI-BOT] ❌ Lỗi trong cycle: ${err.message}`);
        if (err.stack) {
          console.error(err.stack);
        }
        // Đợi 5 phút trước khi retry nếu có lỗi
        console.log('[GEMINI-BOT] ⏳ Đợi 5 phút trước khi retry...');
        await sleep(5 * 60 * 1000);
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

    // 1. Lấy dữ liệu từ Binance
    console.log('[GEMINI-BOT] 📥 Đang lấy dữ liệu từ Binance...');
    const binanceSymbol = this.config.symbol.replace('_UMCBL', ''); // BTCUSDT_UMCBL -> BTCUSDT
    const klines = await this.getBinanceKlines(binanceSymbol, '5m', 288);
    console.log(`[GEMINI-BOT] ✅ Đã lấy được ${klines.length} candles`);

    // 2. Format dữ liệu
    const priceData = this.formatPriceDataForGemini(klines, binanceSymbol);

    // 3. Phân tích bằng Gemini AI
    console.log('[GEMINI-BOT] 🤖 Đang phân tích bằng Gemini AI...');
    const analysis = await this.analyzeWithGemini(priceData, binanceSymbol);
    
    // 4. Parse kết quả và vào lệnh
    if (analysis && analysis.action && analysis.action !== 'none') {
      await this.executeTrade(analysis, klines);
    } else {
      console.log('[GEMINI-BOT] ℹ️ AI không khuyến nghị vào lệnh lúc này');
      console.log('Phân tích:', analysis);
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
      console.error('[GEMINI-BOT] ❌ Lỗi khi lấy dữ liệu từ Binance:', error.message);
      throw error;
    }
  }

  /**
   * Format dữ liệu giá để gửi tới Gemini
   */
  formatPriceDataForGemini(klines, symbol) {
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
    
    const avgVolume = klines.reduce((sum, k) => sum + k.volume, 0) / klines.length;
    const recent10 = klines.slice(-10);
    
    let dataText = `=== DỮ LIỆU GIÁ BINANCE (Khung 5 phút - 1 ngày gần nhất) ===\n\n`;
    dataText += `Symbol: ${symbol}\n`;
    dataText += `Thời gian: ${oldest.time} đến ${latest.time}\n`;
    dataText += `Số lượng candles: ${klines.length}\n\n`;
    
    dataText += `=== THỐNG KÊ TỔNG QUAN ===\n`;
    dataText += `Giá cao nhất: ${highest.toFixed(this.priceDecimals)} USDT\n`;
    dataText += `Giá thấp nhất: ${lowest.toFixed(this.priceDecimals)} USDT\n`;
    dataText += `Giá hiện tại: ${currentPrice.toFixed(this.priceDecimals)} USDT\n`;
    dataText += `Biến động: ${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(this.priceDecimals)} USDT (${priceChangePercent >= 0 ? '+' : ''}${priceChangePercent}%)\n`;
    dataText += `Volume trung bình: ${avgVolume.toFixed(2)}\n\n`;
    
    dataText += `=== 10 CANDLES GẦN NHẤT ===\n`;
    recent10.forEach((candle, idx) => {
      const change = candle.close - candle.open;
      const changePercent = ((change / candle.open) * 100).toFixed(2);
      dataText += `${idx + 1}. ${candle.time} | O:${candle.open.toFixed(this.priceDecimals)} H:${candle.high.toFixed(this.priceDecimals)} L:${candle.low.toFixed(this.priceDecimals)} C:${candle.close.toFixed(this.priceDecimals)} | ${change >= 0 ? '+' : ''}${changePercent}%\n`;
    });
    
    dataText += `\n=== TOÀN BỘ DỮ LIỆU (OHLCV) ===\n`;
    klines.slice(-50).forEach((candle, idx) => {
      dataText += `${idx + 1}. ${candle.time} | ${candle.open.toFixed(this.priceDecimals)} | ${candle.high.toFixed(this.priceDecimals)} | ${candle.low.toFixed(this.priceDecimals)} | ${candle.close.toFixed(this.priceDecimals)} | ${candle.volume.toFixed(2)}\n`;
    });

    return dataText;
  }

  /**
   * Phân tích bằng Gemini AI và trả về JSON với tín hiệu giao dịch
   */
  async analyzeWithGemini(priceData, symbol) {
    const prompt = `
Bạn là một chuyên gia phân tích kỹ thuật cryptocurrency chuyên nghiệp. 

Hãy phân tích dữ liệu giá sau đây từ Binance và đưa ra nhận định giao dịch:

${priceData}

**QUAN TRỌNG: Bạn PHẢI trả về kết quả dưới dạng JSON hợp lệ, không có text thêm. Format như sau:**

{
  "action": "long" hoặc "short" hoặc "none",
  "entry": số (giá vào lệnh),
  "takeProfit": số (mức chốt lời),
  "stopLoss": số (mức cắt lỗ),
  "reason": "Lý do tại sao đưa ra quyết định này",
  "confidence": "high" hoặc "medium" hoặc "low"
}

**Quy tắc:**
- "action": 
  - "long": Nếu khuyến nghị mua/long
  - "short": Nếu khuyến nghị bán/short
  - "none": Nếu không có tín hiệu rõ ràng, không nên vào lệnh
- "entry": Giá cụ thể để vào lệnh (sử dụng giá hiện tại hoặc giá gần nhất)
- "takeProfit": Mức giá để chốt lời
- "stopLoss": Mức giá để cắt lỗ
- "reason": Giải thích ngắn gọn lý do (tối đa 2 câu)
- "confidence": Mức độ tin cậy của tín hiệu

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

