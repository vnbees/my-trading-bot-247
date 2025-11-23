const {
  sleep,
  calcTargets,
  formatNumber,
  percentFormat,
  roundToTick,
  roundToStep,
  getDecimalsFromStep,
} = require('./utils');
const axios = require('axios');
const { ADX } = require('technicalindicators');

/**
 * Bot Trading 2 chiều với ADX Filter
 * 
 * Logic giống start.js nhưng thêm ADX filter:
 * - Chỉ mở lệnh khi ADX < threshold (thị trường sideways)
 * - Mở 2 lệnh market (Long + Short) cùng lúc
 * - Monitor và đóng khi SL/TP
 */
class GridBot {
  constructor({ apiClient, config }) {
    this.api = apiClient;
    this.config = {
      symbol: 'BTCUSDT_UMCBL',
      marginCoin: 'USDT',
      capitalPerSide: 6,
      leverage: 5,
      takeProfitPercent: 0.006,
      priceTickSize: 0,
      sizeStep: 0,
      cooldownMs: 5 * 60 * 1000,
      maxPositionDurationMs: 15 * 60 * 1000,
      pollIntervalMs: 5 * 1000,
      
      // ADX Filter
      adxTimeFrame: '1m',
      adxPeriod: 14,
      adxThresholdMax: 25,
      
      ...config,
    };
    this.lastCycleEndedAt = 0;
    this.isRunning = false;
    this.priceTick = this.config.priceTickSize > 0 ? this.config.priceTickSize : null;
    this.sizeStep = this.config.sizeStep > 0 ? this.config.sizeStep : null;
    this.marketInfoLoaded = false;
    this.priceDecimals = this.priceTick ? getDecimalsFromStep(this.priceTick) : 4;
    this.lastADXCheck = 0;
    this.adxCheckInterval = 60 * 1000; // Check ADX mỗi 1 phút
    // Track tất cả positions đang mở (có thể có nhiều lệnh cùng loại)
    this.trackedPositions = []; // Array of { direction, entryPrice, tp, size, orderId, isActive }
    // Cache cho fill history và logical orders để tránh lấy lại nhiều lần
    this.positionFillHistoryCache = new Map(); // key: positionId, value: fillHistory
    this.positionLogicalOrdersCache = new Map(); // key: positionId, value: logicalOrders
  }

  async run() {
    this.isRunning = true;
    console.log('[GRID] 🚀 Khởi động bot trading 2 chiều với ADX Filter');
    const baseTp = (this.config.takeProfitPercent * 100) / this.config.leverage;
    console.table({
      'Cặp giao dịch': this.config.symbol,
      'Đòn bẩy': `${this.config.leverage}x`,
      'Vốn mỗi bên': `${this.config.capitalPerSide} ${this.config.marginCoin}`,
      'Take Profit': `${percentFormat(this.config.takeProfitPercent)} (base ${baseTp.toFixed(2)}%)`,
      'ADX Filter': `< ${this.config.adxThresholdMax} (${this.config.adxTimeFrame})`,
      'Tick giá': this.config.priceTickSize || 'AUTO',
      'Bước khối lượng': this.config.sizeStep || 'AUTO',
      'Thời gian chờ': `${(this.config.cooldownMs / 60000).toFixed(1)} phút`,
      'Thời gian tối đa': `${(this.config.maxPositionDurationMs / 60000).toFixed(1)} phút`,
    });

    await this.prepareMarketMeta();

    // Khi bot khởi động, lấy danh sách các lệnh đang chạy từ Bitget
    console.log('[GRID] 🔍 Kiểm tra các lệnh đang chạy trên Bitget...');
    const initialPositions = await this.syncPositionsFromAPI();
    
    if (initialPositions.length > 0) {
      console.log(`[GRID] ✅ Phát hiện ${initialPositions.length} lệnh đang chạy trên Bitget:`);
      initialPositions.forEach((pos, idx) => {
        console.log(`  ${idx + 1}. ${pos.direction.toUpperCase()} - Entry: ${formatNumber(pos.entryPrice)}, TP: ${formatNumber(pos.tp)}, Size: ${formatNumber(pos.size)}`);
      });
      
      const hasLong = initialPositions.some(p => p.direction === 'long' && p.isActive);
      const hasShort = initialPositions.some(p => p.direction === 'short' && p.isActive);
      
      if (hasLong && hasShort) {
        console.log(`[GRID] ℹ️ Đã có cả Long và Short đang mở, bắt đầu monitor...`);
        const longState = initialPositions.find(p => p.direction === 'long' && p.isActive) || null;
        const shortState = initialPositions.find(p => p.direction === 'short' && p.isActive) || null;
        await this.monitorPositions({ longState, shortState });
      } else {
        console.log(`[GRID] ⚠️ Chỉ có ${hasLong ? 'Long' : 'Short'}, sẽ check ADX và mở lệnh còn lại nếu ADX < ${this.config.adxThresholdMax}`);
        // Tiếp tục vào vòng lặp chính để check ADX và mở lệnh còn lại
      }
    } else {
      console.log('[GRID] ℹ️ Không có lệnh nào đang chạy, sẽ check ADX và mở lệnh mới nếu ADX < 25');
    }

    while (this.isRunning) {
      try {
        await this.enforceCooldown();
        
        // Kiểm tra ADX trước khi mở lệnh
        const adx = await this.getADXFromBinance();
        if (adx === null) {
          console.warn('[GRID] ⚠️ Không thể lấy ADX, bỏ qua chu kỳ này');
          await sleep(60_000);
          continue;
        }
        
        console.log(`[GRID] 📊 ADX hiện tại: ${adx.toFixed(2)} (ngưỡng: ${this.config.adxThresholdMax})`);
        
        if (adx >= this.config.adxThresholdMax) {
          console.log(`[GRID] ⚠️ ADX >= ${this.config.adxThresholdMax} → TẠM DỪNG (thị trường có xu hướng, không mở lệnh)`);
          await sleep(60_000); // Đợi 1 phút rồi check lại
          continue;
        }
        
        console.log(`[GRID] ✅ ADX < ${this.config.adxThresholdMax} → KÍCH HOẠT (thị trường sideways, mở lệnh)`);
        
        // Kiểm tra positions hiện tại
        const activePositions = await this.syncPositionsFromAPI();
        const hasLong = activePositions.some(p => p.direction === 'long' && p.isActive);
        const hasShort = activePositions.some(p => p.direction === 'short' && p.isActive);
        
        if (activePositions.length === 0) {
          // Không có lệnh nào → mở 2 lệnh mới (Long + Short)
          await this.executeCycle();
          this.lastCycleEndedAt = Date.now();
        } else if (hasLong && hasShort) {
          // Đã có cả Long và Short → chỉ monitor, không mở lệnh mới
          console.log(`[GRID] ℹ️ Đã có cả Long và Short đang mở, tiếp tục monitor...`);
          const longState = activePositions.find(p => p.direction === 'long' && p.isActive) || null;
          const shortState = activePositions.find(p => p.direction === 'short' && p.isActive) || null;
          await this.monitorPositions({ longState, shortState });
        } else {
          // Chỉ có 1 chiều (Long hoặc Short) → Mở cả 2 chiều mới (Long + Short) tại giá hiện tại (KHÔNG đóng lệnh cũ)
          console.log(`[GRID] ⚠️ Chỉ có ${hasLong ? 'Long' : 'Short'}, mở cả Long + Short mới tại giá hiện tại (giữ lệnh cũ, chỉ đóng khi chạm TP)`);
          
          try {
            // Lấy giá hiện tại
            const ticker = await this.api.getTicker(this.config.symbol);
            const currentPrice = Number(ticker?.last || ticker?.markPrice);
            if (!currentPrice || currentPrice <= 0) {
              throw new Error('Không thể lấy giá hiện tại');
            }
            
            // Tính size
            const size = this.calculateOrderSize(currentPrice);
            
            // Mở cả 2 lệnh mới (Long + Short) tại giá hiện tại
            let newLongState = null;
            let newShortState = null;
            let longOpened = false;
            let shortOpened = false;
            
            // Mở Long mới
            try {
              newLongState = await this.openPosition({
                direction: 'long',
                size,
                entryPrice: currentPrice,
              });
              longOpened = true;
              console.log(`[GRID] ✅ Đã mở Long mới thành công`);
            } catch (err) {
              console.error(`[GRID] ❌ Lỗi khi mở Long mới: ${err.message}`);
            }
            
            // Mở Short mới
            try {
              newShortState = await this.openPosition({
                direction: 'short',
                size,
                entryPrice: currentPrice,
              });
              shortOpened = true;
              console.log(`[GRID] ✅ Đã mở Short mới thành công`);
            } catch (err) {
              console.error(`[GRID] ❌ Lỗi khi mở Short mới: ${err.message}`);
            }
            
            // Nếu cả 2 đều fail, throw error
            if (!longOpened && !shortOpened) {
              throw new Error('Không thể mở cả 2 lệnh Long và Short mới');
            }
            
            // Nếu chỉ một lệnh thành công, đóng lệnh đó ngay
            if (longOpened && !shortOpened) {
              console.warn(`[GRID] ⚠️ Chỉ Long mới được mở, Short mới fail - đóng Long mới để tránh rủi ro`);
              if (newLongState) {
                await this.closePosition(newLongState).catch(err => {
                  console.error(`[GRID] ❌ Không thể đóng Long mới: ${err.message}`);
                });
              }
              throw new Error('Short mới không thể mở - đã đóng Long mới để tránh rủi ro');
            }
            
            if (shortOpened && !longOpened) {
              console.warn(`[GRID] ⚠️ Chỉ Short mới được mở, Long mới fail - đóng Short mới để tránh rủi ro`);
              if (newShortState) {
                await this.closePosition(newShortState).catch(err => {
                  console.error(`[GRID] ❌ Không thể đóng Short mới: ${err.message}`);
                });
              }
              throw new Error('Long mới không thể mở - đã đóng Short mới để tránh rủi ro');
            }
            
            // Cả 2 lệnh mới đều thành công → Monitor tất cả lệnh (cả lệnh cũ và lệnh mới)
            const oldLongState = activePositions.find(p => p.direction === 'long' && p.isActive) || null;
            const oldShortState = activePositions.find(p => p.direction === 'short' && p.isActive) || null;
            
            // Kết hợp lệnh cũ và lệnh mới (ưu tiên lệnh mới nếu có cả 2)
            const finalLongState = newLongState || oldLongState;
            const finalShortState = newShortState || oldShortState;
            
            console.log(`[GRID] ✅ Đã mở cả Long + Short mới thành công. Monitor tất cả lệnh (cả lệnh cũ và lệnh mới)`);
            await this.monitorPositions({ longState: finalLongState, shortState: finalShortState });
          } catch (err) {
            console.error(`[GRID] ❌ Lỗi khi mở cả 2 lệnh mới: ${err.message}`);
            if (err.message.includes('ADX')) {
              console.log(`[GRID] ⚠️ Không mở lệnh mới vì ADX không phù hợp. Tiếp tục monitor lệnh cũ.`);
            }
            // Nếu không mở được lệnh mới, vẫn monitor lệnh cũ
            const longState = activePositions.find(p => p.direction === 'long' && p.isActive) || null;
            const shortState = activePositions.find(p => p.direction === 'short' && p.isActive) || null;
            await this.monitorPositions({ longState, shortState });
          }
        }
      } catch (err) {
        console.error(`[GRID] ❌ Lỗi trong chu kỳ: ${err.message}`);
        if (err.stack && err.message.length < 200) {
          console.error('[GRID] Chi tiết lỗi:', err.stack.split('\n').slice(0, 3).join('\n'));
        }
        
        const fatalErrors = [
          'Số dư không đủ',
          'Không thể mở cả 2 lệnh',
          'Không thể lấy giá ticker',
          'Entry price không hợp lệ',
          'Order size không hợp lệ',
        ];
        
        if (fatalErrors.some(msg => err.message.includes(msg))) {
          console.error('[GRID] 🛑 Lỗi nghiêm trọng - dừng bot để tránh rủi ro');
          this.isRunning = false;
          throw err;
        }
        
        console.error('[GRID] ⏳ Đợi 60 giây trước khi thử lại...');
        await sleep(60_000);
      }
    }
  }

  /**
   * Lấy ADX từ Binance
   */
  async getADXFromBinance() {
    try {
      const binanceSymbol = this.config.symbol.replace('_UMCBL', '').replace('_CMCBL', '');
      
      const url = 'https://api.binance.com/api/v3/klines';
      const params = {
        symbol: binanceSymbol.toUpperCase(),
        interval: this.config.adxTimeFrame,
        limit: 200,
      };

      const response = await axios.get(url, { params });
      
      if (!Array.isArray(response.data)) {
        throw new Error('Binance API trả về dữ liệu không hợp lệ');
      }

      const highs = [];
      const lows = [];
      const closes = [];

      for (const candle of response.data) {
        if (Array.isArray(candle) && candle.length >= 5) {
          highs.push(parseFloat(candle[2]));
          lows.push(parseFloat(candle[3]));
          closes.push(parseFloat(candle[4]));
        }
      }

      if (highs.length < this.config.adxPeriod + 1) {
        throw new Error(`Không đủ dữ liệu để tính ADX (cần ${this.config.adxPeriod + 1}, có ${highs.length})`);
      }

      const input = {
        high: highs,
        low: lows,
        close: closes,
        period: this.config.adxPeriod,
      };

      const result = ADX.calculate(input);
      
      if (!result || result.length === 0) {
        throw new Error('Không thể tính ADX');
      }

      const latestADX = result[result.length - 1].adx;
      return latestADX;
    } catch (err) {
      console.error(`[GRID] ❌ Lỗi khi lấy ADX: ${err.message}`);
      return null;
    }
  }

  async prepareMarketMeta() {
    if (this.marketInfoLoaded) return;
    try {
      const productType = this.config.symbol.includes('_UMCBL') ? 'umcbl' : undefined;
      const contract = await this.api.getContract(this.config.symbol, productType);
      if (!contract) {
        console.warn(`[GRID] ⚠️ Không tìm thấy contract "${this.config.symbol}"`);
        const similar = await this.api.listAvailableContracts('umcbl', '');
        if (similar.length > 0) {
          console.log(`[GRID] 💡 Gợi ý các contract có sẵn (${similar.length} kết quả):`);
          similar.slice(0, 10).forEach((c) => {
            console.log(`   - ${c.symbol} (${c.symbolName || 'N/A'})`);
          });
        }
        throw new Error(`Không tìm thấy contract "${this.config.symbol}". Vui lòng kiểm tra lại symbol hoặc thử các contract được gợi ý ở trên.`);
      }
      
      const derivedPriceTick = Number(
        contract.priceTick || 
        contract.priceStep || 
        contract.minPriceChange || 
        contract.pricePlace || 
        contract.pricePrecision ||
        0
      );
      const derivedSizeStep = Number(
        contract.quantityTick || 
        contract.sizeTick || 
        contract.minTradeNum || 
        contract.sizeMultiplier ||
        0
      );
      
      if (!this.priceTick) {
        const ticker = await this.api.getTicker(this.config.symbol).catch(() => null);
        const currentPrice = ticker ? Number(ticker.last || ticker.markPrice || 0) : 0;
        
        if (derivedPriceTick > 0) {
          if (currentPrice > 0 && derivedPriceTick > currentPrice / 10) {
            console.warn(`[GRID] ⚠️ Tick size từ API (${derivedPriceTick}) có vẻ không đúng với giá ${currentPrice}, sẽ ước tính lại`);
            if (currentPrice < 0.1) {
              this.priceTick = 0.0001;
            } else if (currentPrice < 1) {
              this.priceTick = 0.001;
            } else if (currentPrice < 10) {
              this.priceTick = 0.01;
            } else if (currentPrice < 100) {
              this.priceTick = 0.1;
            } else {
              this.priceTick = 1;
            }
          } else {
            this.priceTick = derivedPriceTick;
          }
        } else {
          if (currentPrice > 0) {
            if (currentPrice < 0.1) {
              this.priceTick = 0.0001;
            } else if (currentPrice < 1) {
              this.priceTick = 0.001;
            } else if (currentPrice < 10) {
              this.priceTick = 0.01;
            } else if (currentPrice < 100) {
              this.priceTick = 0.1;
            } else {
              this.priceTick = 1;
            }
          } else {
            this.priceTick = 0.01;
          }
        }
        this.priceDecimals = getDecimalsFromStep(this.priceTick);
      }
      if (!this.sizeStep) {
        this.sizeStep = derivedSizeStep || 0.0001;
      }
      console.log(
        `[GRID] ℹ️ Thông tin contract: tick giá=${this.priceTick}, bước khối lượng=${this.sizeStep}`,
      );
      if (contract.priceTick || contract.priceStep) {
        console.log(`[GRID] 📋 Contract fields: priceTick=${contract.priceTick}, priceStep=${contract.priceStep}, quantityTick=${contract.quantityTick}`);
      }
    } catch (err) {
      console.warn(`[GRID] ⚠️ Không lấy được contract spec: ${err.message}`);
      this.priceTick = this.priceTick || 0.1;
      this.priceDecimals = getDecimalsFromStep(this.priceTick);
      this.sizeStep = this.sizeStep || 0.0001;
      console.log(`[GRID] ⚙️ Sử dụng giá trị mặc định: tick=${this.priceTick}, sizeStep=${this.sizeStep}`);
    } finally {
      this.marketInfoLoaded = true;
    }
  }

  async enforceCooldown() {
    if (!this.lastCycleEndedAt) return;
    const elapsed = Date.now() - this.lastCycleEndedAt;
    if (elapsed < this.config.cooldownMs) {
      const remaining = Math.ceil((this.config.cooldownMs - elapsed) / 1000);
      console.log(`[GRID] ⏳ Đợi cooldown: còn ${remaining} giây...`);
      await sleep(this.config.cooldownMs - elapsed);
    }
  }

  async executeCycle() {
    console.log('[GRID] 🔄 Bắt đầu chu kỳ mới (Long + Short)');
    
    // Kiểm tra số dư
    try {
      const productType = this.config.symbol.includes('_UMCBL') ? 'umcbl' : 'umcbl';
      const account = await this.api.getAccount(productType, this.config.marginCoin);
      
      const available = Number(
        account?.available || 
        account?.availableBalance || 
        account?.availableEquity ||
        account?.equity ||
        0
      );
      
      const requiredMargin = this.config.capitalPerSide * 2;
      console.log(`[GRID] 💰 Số dư khả dụng: ${formatNumber(available)} ${this.config.marginCoin}`);
      
      if (available < requiredMargin) {
        console.warn(`[GRID] ⚠️ Cảnh báo: Số dư (${formatNumber(available)}) có thể không đủ cho vốn yêu cầu (${requiredMargin} ${this.config.marginCoin})`);
        if (available > 0) {
          console.warn(`[GRID] 💡 Gợi ý: Giảm --capital xuống ${Math.floor(available / 2)} hoặc nạp thêm ${this.config.marginCoin}`);
        }
      }
    } catch (err) {
      console.warn(`[GRID] ⚠️ Không thể kiểm tra số dư: ${err.message}`);
    }
    
    // Lấy giá hiện tại
    let ticker = null;
    let markPrice = null;
    let markPriceStr = null;
    let retryCount = 0;
    const maxRetries = 3;
    
    while (retryCount < maxRetries && !markPrice) {
      try {
        ticker = await this.api.getTicker(this.config.symbol);
        console.log(`[GRID] 🔍 Raw ticker response từ API:`, JSON.stringify(ticker, null, 2));
        const rawLast = ticker?.last;
        const rawMarkPrice = ticker?.markPrice;
        const rawBestAsk = ticker?.bestAsk;
        console.log(`[GRID] 🔍 Raw giá từ API: last=${rawLast}, markPrice=${rawMarkPrice}, bestAsk=${rawBestAsk}`);
        
        markPriceStr = ticker?.last || ticker?.markPrice || ticker?.bestAsk;
        if (!markPriceStr) {
          throw new Error('Không có giá nào trong ticker response');
        }
        
        markPrice = Number(markPriceStr);
        console.log(`[GRID] 🔍 Giá sau khi convert to Number: ${markPrice} (raw string: ${markPriceStr})`);
        
        if (!markPrice || Number.isNaN(markPrice) || markPrice <= 0) {
          throw new Error(`Giá không hợp lệ: ${markPrice}`);
        }
        
        this.lastEntryPriceStr = markPriceStr;
        break;
      } catch (err) {
        retryCount++;
        if (retryCount < maxRetries) {
          const waitMs = Math.min(1000 * Math.pow(2, retryCount - 1), 5000);
          console.warn(`[GRID] ⚠️ Lỗi khi lấy giá ticker (lần thử ${retryCount}/${maxRetries}): ${err.message}. Đợi ${waitMs}ms...`);
          await sleep(waitMs);
        } else {
          throw new Error(`Không thể lấy giá ticker sau ${maxRetries} lần thử: ${err.message}`);
        }
      }
    }
    
    if (!markPrice) {
      throw new Error('Không thể lấy giá ticker hợp lệ');
    }

    const size = this.calculateOrderSize(markPrice);
    console.log(`[GRID] 📊 Giá hiện tại (formatted): ${formatNumber(markPrice)} | Raw: ${markPrice} | Kích thước lệnh: ${size} contracts`);

    await this.configureLeverage();

    if (!markPrice || markPrice <= 0 || Number.isNaN(markPrice)) {
      throw new Error(`Entry price không hợp lệ: ${markPrice}`);
    }

    let longState = null;
    let shortState = null;
    let longOpened = false;
    let shortOpened = false;

    // Đặt lệnh Long
    try {
      longState = await this.openPosition({
        direction: 'long',
        size,
        entryPrice: markPrice,
      });
      longOpened = true;
      console.log(`[GRID] ✅ Long position đã được mở thành công`);
    } catch (err) {
      console.error(`[GRID] ❌ Lỗi khi mở Long position: ${err.message}`);
    }

    // Đặt lệnh Short
    try {
      shortState = await this.openPosition({
        direction: 'short',
        size,
        entryPrice: markPrice,
      });
      shortOpened = true;
      console.log(`[GRID] ✅ Short position đã được mở thành công`);
    } catch (err) {
      console.error(`[GRID] ❌ Lỗi khi mở Short position: ${err.message}`);
    }

    // Kiểm tra nếu cả 2 đều fail
    if (!longOpened && !shortOpened) {
      throw new Error('Không thể mở cả 2 lệnh Long và Short. Vui lòng kiểm tra lại số dư, leverage và thử lại.');
    }

    // Nếu chỉ một lệnh thành công, đóng lệnh đó ngay
    if (longOpened && !shortOpened) {
      console.warn(`[GRID] ⚠️ Chỉ Long được mở, Short fail - đóng Long để tránh rủi ro`);
      if (longState) {
        await this.closePosition(longState).catch(err => {
          console.error(`[GRID] ❌ Không thể đóng Long: ${err.message}`);
        });
      }
      throw new Error('Short position không thể mở - đã đóng Long để tránh rủi ro');
    }

    if (shortOpened && !longOpened) {
      console.warn(`[GRID] ⚠️ Chỉ Short được mở, Long fail - đóng Short để tránh rủi ro`);
      if (shortState) {
        await this.closePosition(shortState).catch(err => {
          console.error(`[GRID] ❌ Không thể đóng Short: ${err.message}`);
        });
      }
      throw new Error('Long position không thể mở - đã đóng Short để tránh rủi ro');
    }

    // Cả 2 đều thành công → monitor (monitorPositions sẽ quay lại run() nếu không còn lệnh)
    await this.monitorPositions({ longState, shortState });
    // Sau khi monitorPositions kết thúc (không còn lệnh), quay lại run() để check ADX
  }

  calculateOrderSize(entryPrice) {
    if (!entryPrice || entryPrice <= 0) {
      throw new Error(`Entry price không hợp lệ: ${entryPrice}`);
    }
    
    const notional = this.config.capitalPerSide * this.config.leverage;
    const size = notional / entryPrice;
    const step = this.sizeStep || 0.0001;
    const rounded = roundToStep(size, step);
    const finalSize = Number(rounded.toFixed(8));
    
    if (finalSize <= 0) {
      throw new Error(`Order size không hợp lệ: ${finalSize} (notional: ${notional}, entryPrice: ${entryPrice})`);
    }
    
    if (finalSize < step) {
      console.warn(`[GRID] ⚠️ Order size ${finalSize} nhỏ hơn step size ${step} - có thể không đặt được lệnh`);
    }
    
    return finalSize;
  }

  async configureLeverage() {
    console.log(`[GRID] ⚙️  Thiết lập đòn bẩy ${this.config.leverage}x cho Long và Short`);
    try {
      await Promise.all(
        ['long', 'short'].map((side) =>
          this.api.setLeverage({
            symbol: this.config.symbol,
            marginCoin: this.config.marginCoin,
            leverage: this.config.leverage,
            holdSide: side,
          }).catch(err => {
            console.error(`[GRID] ⚠️ Lỗi khi set leverage cho ${side}: ${err.message}`);
            throw err;
          }),
        ),
      );
      console.log(`[GRID] ✅ Đã thiết lập đòn bẩy ${this.config.leverage}x`);
    } catch (err) {
      console.error(`[GRID] ❌ Lỗi khi thiết lập đòn bẩy: ${err.message}`);
      throw err;
    }
  }

  async openPosition({ direction, size, entryPrice }) {
    // Tính TP (không có SL)
    const tp = direction === 'long'
      ? entryPrice * (1 + this.config.takeProfitPercent)
      : entryPrice * (1 - this.config.takeProfitPercent);

    const tick = this.priceTick || 0.0001;
    let actualTick = tick;
    
    if (this.lastEntryPriceStr) {
      actualTick = this.detectActualTickSize(this.lastEntryPriceStr, entryPrice);
    }

    let tpRounded = roundToTick(tp, actualTick);

    // Validate và điều chỉnh TP
    if (direction === 'long') {
      if (tpRounded <= 0 || tpRounded <= entryPrice) {
        tpRounded = roundToTick(entryPrice * (1 + this.config.takeProfitPercent * 1.1), actualTick);
        if (tpRounded <= entryPrice || tpRounded <= 0) {
          tpRounded = roundToTick(entryPrice * 1.003, actualTick);
        }
      }
    } else {
      if (tpRounded <= 0 || tpRounded >= entryPrice) {
        tpRounded = roundToTick(entryPrice * (1 - this.config.takeProfitPercent * 1.1), actualTick);
        if (tpRounded >= entryPrice || tpRounded <= 0) {
          tpRounded = roundToTick(entryPrice * 0.997, actualTick);
        }
      }
    }

    if (tpRounded <= 0) {
      throw new Error(`Không thể tính TP hợp lệ: TP=${tpRounded}, Entry=${entryPrice}, Tick=${tick}`);
    }
    
    if (direction === 'long') {
      if (tpRounded <= entryPrice) {
        throw new Error(`Long TP (${tpRounded}) phải lớn hơn entry price (${entryPrice})`);
      }
    } else {
      if (tpRounded >= entryPrice) {
        throw new Error(`Short TP (${tpRounded}) phải nhỏ hơn entry price (${entryPrice})`);
      }
    }
    
    const tpFormatted = this.formatPrice(tpRounded);

    const side = direction === 'long' ? 'open_long' : 'open_short';
    const directionText = direction === 'long' ? 'LONG' : 'SHORT';
    console.log(
      `[GRID] 📈 Mở lệnh ${directionText} | Size: ${size} | Entry: ${this.formatPrice(entryPrice)} (raw: ${entryPrice}) | TP: ${tpFormatted} (raw: ${tpRounded})`,
    );

    let orderPlaced = false;
    let retryCount = 0;
    const maxRetries = 3;
    
    while (!orderPlaced && retryCount < maxRetries) {
      try {
        await this.api.placeOrder({
          symbol: this.config.symbol,
          marginCoin: this.config.marginCoin,
          size,
          side,
          orderType: 'market',
        });
        orderPlaced = true;
        console.log(`[GRID] ✅ Lệnh ${directionText} đã được đặt thành công`);
      } catch (err) {
        retryCount++;
        
        if (err.message.includes('40762') || err.message.includes('exceeds the balance')) {
          throw new Error(`Số dư không đủ để đặt lệnh. Cần ít nhất ${this.config.capitalPerSide} ${this.config.marginCoin} cho mỗi bên.`);
        }
        
        if (retryCount < maxRetries) {
          const waitMs = Math.min(1000 * Math.pow(2, retryCount - 1), 5000);
          console.warn(`[GRID] ⚠️ Lỗi khi đặt lệnh ${directionText} (lần thử ${retryCount}/${maxRetries}): ${err.message}. Đợi ${waitMs}ms...`);
          await sleep(waitMs);
        } else {
          throw new Error(`Không thể đặt lệnh ${directionText} sau ${maxRetries} lần thử: ${err.message}`);
        }
      }
    }
    
    if (!orderPlaced) {
      throw new Error(`Không thể đặt lệnh ${directionText}`);
    }

    await sleep(1000);
    
    try {
      const position = await this.api.getPosition(this.config.symbol, this.config.marginCoin);
      if (position) {
        const actualSize = Number(position.total || position.holdSize || 0);
        const actualSide = position.holdSide || position.side;
        console.log(`[GRID] 📋 Position thực tế: ${actualSide} ${actualSize} contracts`);
        
        if (actualSize > 0 && actualSide === direction) {
          console.log(`[GRID] ✅ Position ${directionText} đã được mở thành công (${actualSize} contracts)`);
        } else if (actualSize === 0) {
          console.warn(`[GRID] ⚠️ CẢNH BÁO: Position ${directionText} chưa được mở (size = 0). Có thể order chưa được fill.`);
        } else {
          console.warn(`[GRID] ⚠️ CẢNH BÁO: Position không khớp - mong đợi ${direction}, thực tế ${actualSide}`);
        }
      }
    } catch (err) {
      console.warn(`[GRID] ⚠️ Không thể kiểm tra position thực tế: ${err.message}`);
    }

    const positionState = {
      direction,
      size,
      entryPrice,
      tp: Number(tpFormatted),
      isActive: true,
      orderId: null, // Sẽ được cập nhật sau khi lấy position từ API
    };
    
    // Lưu vào trackedPositions để monitor (nếu chưa có)
    // Kiểm tra xem đã có position với cùng direction và entryPrice chưa
    if (!this.trackedPositions) {
      this.trackedPositions = [];
    }
    const existing = this.trackedPositions.find(p => 
      p.direction === direction && 
      Math.abs(p.entryPrice - entryPrice) < 0.0001
    );
    if (!existing) {
      this.trackedPositions.push(positionState);
    }
    
    // Lưu vào trackedPositions để monitor
    this.trackedPositions.push(positionState);
    
    return positionState;
  }

  /**
   * Mở lại 2 lệnh mới tại giá hiện tại (giống executeCycle nhưng không check số dư)
   * PHẢI check ADX trước khi mở lệnh
   */
  async openNewCycle(entryPrice) {
    // Kiểm tra ADX trước khi mở lệnh mới
    const adx = await this.getADXFromBinance();
    if (adx === null) {
      console.warn('[GRID] ⚠️ Không thể lấy ADX, không mở lệnh mới');
      throw new Error('Không thể lấy ADX để mở lệnh mới');
    }
    
    console.log(`[GRID] 📊 ADX hiện tại: ${adx.toFixed(2)} (ngưỡng: ${this.config.adxThresholdMax})`);
    
    if (adx >= this.config.adxThresholdMax) {
      console.log(`[GRID] ⚠️ ADX >= ${this.config.adxThresholdMax} → KHÔNG MỞ LỆNH MỚI (thị trường có xu hướng)`);
      throw new Error(`ADX >= ${this.config.adxThresholdMax}, không mở lệnh mới`);
    }
    
    console.log(`[GRID] ✅ ADX < ${this.config.adxThresholdMax} → MỞ LỆNH MỚI`);
    const size = this.calculateOrderSize(entryPrice);
    console.log(`[GRID] 📊 Giá hiện tại: ${formatNumber(entryPrice)} | Kích thước lệnh: ${size} contracts`);

    let longState = null;
    let shortState = null;
    let longOpened = false;
    let shortOpened = false;

    // Đặt lệnh Long
    try {
      longState = await this.openPosition({
        direction: 'long',
        size,
        entryPrice: entryPrice,
      });
      longOpened = true;
      console.log(`[GRID] ✅ Long position đã được mở thành công`);
    } catch (err) {
      console.error(`[GRID] ❌ Lỗi khi mở Long position: ${err.message}`);
    }

    // Đặt lệnh Short
    try {
      shortState = await this.openPosition({
        direction: 'short',
        size,
        entryPrice: entryPrice,
      });
      shortOpened = true;
      console.log(`[GRID] ✅ Short position đã được mở thành công`);
    } catch (err) {
      console.error(`[GRID] ❌ Lỗi khi mở Short position: ${err.message}`);
    }

    // Nếu cả 2 đều fail, throw error
    if (!longOpened && !shortOpened) {
      throw new Error('Không thể mở cả 2 lệnh Long và Short mới. Vui lòng kiểm tra lại số dư, leverage và thử lại.');
    }

    // Nếu chỉ một lệnh thành công, đóng lệnh đó ngay
    if (longOpened && !shortOpened) {
      console.warn(`[GRID] ⚠️ Chỉ Long được mở, Short fail - đóng Long để tránh rủi ro`);
      if (longState) {
        await this.closePosition(longState).catch(err => {
          console.error(`[GRID] ❌ Không thể đóng Long: ${err.message}`);
        });
      }
      throw new Error('Short position không thể mở - đã đóng Long để tránh rủi ro');
    }

    if (shortOpened && !longOpened) {
      console.warn(`[GRID] ⚠️ Chỉ Short được mở, Long fail - đóng Short để tránh rủi ro`);
      if (shortState) {
        await this.closePosition(shortState).catch(err => {
          console.error(`[GRID] ❌ Không thể đóng Short: ${err.message}`);
        });
      }
      throw new Error('Long position không thể mở - đã đóng Short để tránh rủi ro');
    }

    // Cả 2 đều thành công → tiếp tục monitor
    return { longState, shortState };
  }

  /**
   * Lấy lịch sử lệnh đã fill từ Bitget để xác định entry price thực tế
   * Sử dụng cache để tránh lấy lại nhiều lần
   */
  async getPositionFillHistory(apiPosition) {
    const positionId = apiPosition.positionId || `${apiPosition.holdSide || apiPosition.side}_${apiPosition.averageOpenPrice || apiPosition.openPriceAvg}`;
    
    // Kiểm tra cache
    if (this.positionFillHistoryCache.has(positionId)) {
      return this.positionFillHistoryCache.get(positionId);
    }
    
    try {
      const direction = apiPosition.holdSide || apiPosition.side;
      const productType = this.config.symbol.includes('_UMCBL') ? 'umcbl' : 'umcbl';
      
      // Lấy lịch sử lệnh đã fill (chỉ lấy lệnh mở position, không lấy lệnh đóng)
      // Side: 'open_long' hoặc 'open_short'
      const side = direction === 'long' ? 'open_long' : 'open_short';
      
      // Lấy lịch sử trong 30 ngày gần nhất
      const endTime = Date.now();
      const startTime = endTime - (30 * 24 * 60 * 60 * 1000);
      
      const fills = await this.api.getFills(
        this.config.symbol,
        productType,
        startTime,
        endTime,
        200 // Lấy tối đa 200 lệnh
      );
      
      // Parse fills từ response
      const fillList = Array.isArray(fills) 
        ? fills 
        : (fills?.data && Array.isArray(fills.data) ? fills.data : []);
      
      // Lọc chỉ lấy lệnh mở position (open_long hoặc open_short) và đã fill
      const openFills = fillList.filter(fill => {
        const fillSide = fill.side || fill.orderSide || fill.holdSide;
        const fillStatus = fill.status || fill.orderStatus;
        const isOpenOrder = fillSide === side || fillSide === direction || fillSide === 'open_long' || fillSide === 'open_short';
        const isFilled = fillStatus === 'filled' || fillStatus === 'partially_filled' || !fillStatus;
        return isOpenOrder && isFilled;
      });
      
      // Sắp xếp theo thời gian (mới nhất trước)
      openFills.sort((a, b) => {
        const timeA = Number(a.cTime || a.fillTime || a.tradeTime || 0);
        const timeB = Number(b.cTime || b.fillTime || b.tradeTime || 0);
        return timeB - timeA;
      });
      
      // Lưu vào cache
      this.positionFillHistoryCache.set(positionId, openFills);
      
      return openFills;
    } catch (err) {
      console.warn(`[GRID] ⚠️ Không thể lấy lịch sử lệnh: ${err.message}`);
      return [];
    }
  }

  /**
   * Chia position lớn thành nhiều lệnh logic nhỏ hơn dựa trên lịch sử lệnh thực tế
   * Mỗi lệnh logic có entry price riêng từ lịch sử lệnh
   * Sử dụng cache để tránh tính toán lại
   */
  async splitPositionIntoLogicalOrders(apiPosition) {
    const direction = apiPosition.holdSide || apiPosition.side;
    const averageEntryPrice = Number(apiPosition.averageOpenPrice || apiPosition.openPriceAvg || apiPosition.entryPrice || 0);
    const totalSize = Number(apiPosition.total || apiPosition.size || 0);
    const positionId = apiPosition.positionId || `${direction}_${averageEntryPrice}_${totalSize}`;
    
    if (averageEntryPrice <= 0 || totalSize <= 0) {
      return [];
    }
    
    // Kiểm tra cache
    if (this.positionLogicalOrdersCache.has(positionId)) {
      return this.positionLogicalOrdersCache.get(positionId);
    }
    
    // Tính size của 1 lệnh bot (dựa trên vốn bot)
    const botOrderSize = this.calculateOrderSize(averageEntryPrice);
    
    // Lấy lịch sử lệnh đã fill (có cache)
    const fillHistory = await this.getPositionFillHistory(apiPosition);
    
    if (fillHistory.length === 0) {
      // Không có lịch sử lệnh, chia đều với average entry price
      console.log(`[GRID] ⚠️ Không có lịch sử lệnh, sử dụng average entry price ${formatNumber(averageEntryPrice)}`);
      const numLogicalOrders = Math.ceil(totalSize / botOrderSize);
      const logicalOrders = [];
      
      for (let i = 0; i < numLogicalOrders; i++) {
        const logicalSize = i === numLogicalOrders - 1 
          ? totalSize - (botOrderSize * (numLogicalOrders - 1))
          : botOrderSize;
        
        const tp = direction === 'long'
          ? averageEntryPrice * (1 + this.config.takeProfitPercent)
          : averageEntryPrice * (1 - this.config.takeProfitPercent);
        
        const tick = this.priceTick || 0.0001;
        const tpRounded = roundToTick(tp, tick);
        
        logicalOrders.push({
          direction,
          size: logicalSize,
          entryPrice: averageEntryPrice,
          tp: tpRounded,
          isActive: true,
          orderId: positionId,
          isLogical: true,
          originalTotalSize: totalSize,
        });
      }
      
      // Lưu vào cache
      this.positionLogicalOrdersCache.set(positionId, logicalOrders);
      
      return logicalOrders;
    }
    
    // Có lịch sử lệnh, chia dựa trên entry price thực tế
    const logicalOrders = [];
    let remainingSize = totalSize;
    const tick = this.priceTick || 0.0001;
    
    // Duyệt lịch sử lệnh từ mới nhất đến cũ nhất
    // Chia mỗi fill thành nhiều lệnh logic nếu fillSize > botOrderSize
    for (const fill of fillHistory) {
      if (remainingSize <= 0) break;
      
      // Lấy thông tin từ fill (thử nhiều field)
      const fillPrice = Number(
        fill.price || 
        fill.fillPrice || 
        fill.avgPrice || 
        fill.tradePrice ||
        fill.priceAvg ||
        fill.avgFillPrice ||
        averageEntryPrice
      );
      // Bitget API dùng sizeQty cho size
      let fillSize = Number(
        fill.sizeQty ||  // Bitget API dùng sizeQty
        fill.size || 
        fill.fillSize || 
        fill.quantity || 
        fill.tradeSize ||
        fill.fillQty ||
        0
      );
      
      if (fillPrice <= 0 || fillSize <= 0) {
        continue;
      }
      
      // Lấy phần fillSize còn lại (không vượt quá remainingSize)
      fillSize = Math.min(fillSize, remainingSize);
      
      // Chia fill này thành nhiều lệnh logic nếu fillSize > botOrderSize
      while (fillSize > 0 && remainingSize > 0) {
        const logicalSize = Math.min(botOrderSize, remainingSize, fillSize);
        
        // Tính TP cho lệnh logic này
        const tp = direction === 'long'
          ? fillPrice * (1 + this.config.takeProfitPercent)
          : fillPrice * (1 - this.config.takeProfitPercent);
        
        const tpRounded = roundToTick(tp, tick);
        
        logicalOrders.push({
          direction,
          size: logicalSize,
          entryPrice: fillPrice, // Entry price thực tế từ lịch sử
          tp: tpRounded,
          isActive: true,
          orderId: positionId,
          isLogical: true,
          originalTotalSize: totalSize,
        });
        
        remainingSize -= logicalSize;
        fillSize -= logicalSize;
      }
    }
    
    // Nếu còn size thừa, thêm lệnh logic với average entry price
    if (remainingSize > 0) {
      const numRemainingOrders = Math.ceil(remainingSize / botOrderSize);
      
      for (let i = 0; i < numRemainingOrders; i++) {
        const logicalSize = i === numRemainingOrders - 1 
          ? remainingSize - (botOrderSize * (numRemainingOrders - 1))
          : botOrderSize;
        
        const tp = direction === 'long'
          ? averageEntryPrice * (1 + this.config.takeProfitPercent)
          : averageEntryPrice * (1 - this.config.takeProfitPercent);
        
        const tpRounded = roundToTick(tp, tick);
        
        logicalOrders.push({
          direction,
          size: logicalSize,
          entryPrice: averageEntryPrice,
          tp: tpRounded,
          isActive: true,
          orderId: positionId,
          isLogical: true,
          originalTotalSize: totalSize,
        });
      }
    }
    
    // Lưu vào cache
    this.positionLogicalOrdersCache.set(positionId, logicalOrders);
    
    return logicalOrders;
  }

  /**
   * Lấy tất cả positions thực tế từ API và sync với trackedPositions
   * Chia positions lớn thành nhiều lệnh logic nhỏ hơn
   */
  async syncPositionsFromAPI() {
    try {
      const productType = this.config.symbol.includes('_UMCBL') ? 'umcbl' : 'umcbl';
      const allPositions = await this.api.getAllPositions(productType, this.config.marginCoin);
      
      // Parse positions từ API response
      const positions = Array.isArray(allPositions) 
        ? allPositions 
        : (allPositions?.data && Array.isArray(allPositions.data) ? allPositions.data : []);
      
      // Lọc positions cho symbol này
      const symbolPositions = positions.filter(p => 
        p.symbol === this.config.symbol && 
        Number(p.total || p.size || 0) > 0
      );
      
      // Kiểm tra xem có position mới không (chỉ rebuild khi cần)
      const currentPositionKeys = new Set();
      symbolPositions.forEach(p => {
        const direction = p.holdSide || p.side;
        const entryPrice = Number(p.averageOpenPrice || p.openPriceAvg || p.entryPrice || 0);
        const totalSize = Number(p.total || p.size || 0);
        if (entryPrice > 0 && totalSize > 0) {
          const positionId = p.positionId || `${direction}_${entryPrice}_${totalSize}`;
          currentPositionKeys.add(positionId);
        }
      });
      
      const existingPositionKeys = new Set();
      this.trackedPositions.forEach(p => {
        if (p.orderId) {
          existingPositionKeys.add(p.orderId);
        }
      });
      
      const hasNewPositions = symbolPositions.some(p => {
        const direction = p.holdSide || p.side;
        const entryPrice = Number(p.averageOpenPrice || p.openPriceAvg || p.entryPrice || 0);
        const totalSize = Number(p.total || p.size || 0);
        if (entryPrice > 0 && totalSize > 0) {
          const positionId = p.positionId || `${direction}_${entryPrice}_${totalSize}`;
          return !existingPositionKeys.has(positionId);
        }
        return false;
      });
      
      // Chỉ rebuild nếu có position mới hoặc trackedPositions rỗng
      if (hasNewPositions || this.trackedPositions.length === 0) {
        // Xóa tất cả trackedPositions cũ (sẽ rebuild từ API)
        const oldTracked = [...this.trackedPositions];
        this.trackedPositions = [];
        
        // Sync: thêm positions từ API (chia thành lệnh logic nếu cần)
        for (const apiPos of symbolPositions) {
          const direction = apiPos.holdSide || apiPos.side;
          const entryPrice = Number(apiPos.averageOpenPrice || apiPos.openPriceAvg || apiPos.entryPrice || 0);
          const totalSize = Number(apiPos.total || apiPos.size || 0);
          
          if (entryPrice > 0 && totalSize > 0) {
            // Chia position thành các lệnh logic (có cache, chỉ tính 1 lần)
            const logicalOrders = await this.splitPositionIntoLogicalOrders(apiPos);
            
            console.log(`[GRID] 🔍 Position từ API: ${direction.toUpperCase()} ${formatNumber(totalSize)} contracts, avg entry=${formatNumber(entryPrice)}`);
            console.log(`[GRID] 📊 Chia thành ${logicalOrders.length} lệnh logic để monitor:`);
            logicalOrders.forEach((order, idx) => {
              console.log(`  ${idx + 1}. Size: ${formatNumber(order.size)}, Entry: ${formatNumber(order.entryPrice)}, TP: ${formatNumber(order.tp)}`);
            });
            
            // Thêm các lệnh logic vào trackedPositions
            this.trackedPositions.push(...logicalOrders);
          }
        }
        
        // Giữ lại các lệnh đã đóng (isActive = false) từ oldTracked
        const closedOrders = oldTracked.filter(p => p.isActive === false);
        this.trackedPositions.push(...closedOrders);
      }
      
      return this.trackedPositions.filter(p => p.isActive);
    } catch (err) {
      console.warn(`[GRID] ⚠️ Lỗi khi sync positions từ API: ${err.message}`);
      // Trả về trackedPositions hiện tại nếu không lấy được từ API
      return this.trackedPositions.filter(p => p.isActive);
    }
  }

  async monitorPositions({ longState, shortState }) {
    // Khởi tạo trackedPositions với lệnh ban đầu
    this.trackedPositions = [];
    if (longState) this.trackedPositions.push(longState);
    if (shortState) this.trackedPositions.push(shortState);
    
    let checkCount = 0;

    console.log(`[GRID] 🔍 Bắt đầu monitor positions (kiểm tra mỗi ${this.config.pollIntervalMs / 1000}s)`);

    // Monitor vô hạn (không có timeout)
    // Lưu ý: Không đóng lệnh khi ADX tăng, chỉ đóng khi chạm TP
    while (this.isRunning) {
      await sleep(this.config.pollIntervalMs);
      checkCount++;
      
      // Sync positions từ API mỗi lần check (để phát hiện positions mới)
      const activePositions = await this.syncPositionsFromAPI();
      
      let ticker = null;
      let lastPrice = null;
      let retryCount = 0;
      const maxRetries = 3;
      
      while (retryCount < maxRetries && !lastPrice) {
        try {
          ticker = await this.api.getTicker(this.config.symbol);
          const rawLast = ticker?.last;
          const rawMarkPrice = ticker?.markPrice;
          console.log(`[GRID] 🔍 [Check #${checkCount}] Raw giá từ API: last=${rawLast}, markPrice=${rawMarkPrice}`);
          lastPrice = Number(ticker?.last || ticker?.markPrice);
          console.log(`[GRID] 🔍 [Check #${checkCount}] Giá sau khi convert to Number: ${lastPrice} (raw: ${rawLast || rawMarkPrice})`);
          
          if (!lastPrice || Number.isNaN(lastPrice) || lastPrice <= 0) {
            throw new Error(`Giá không hợp lệ: ${lastPrice}`);
          }
          
          if (activePositions.length > 0) {
            const firstEntry = activePositions[0]?.entryPrice;
            if (firstEntry && Math.abs(lastPrice - firstEntry) / firstEntry > 0.5) {
              console.warn(`[GRID] ⚠️ [Check #${checkCount}] Giá ${lastPrice} khác biệt quá lớn so với entry ${firstEntry} (>50%) - có thể là lỗi API`);
            }
            
            if (firstEntry && (lastPrice < firstEntry * 0.1 || lastPrice > firstEntry * 10)) {
              console.error(`[GRID] ❌ [Check #${checkCount}] Giá ${lastPrice} bất thường so với entry ${firstEntry} - có thể là lỗi API. Bỏ qua lần check này.`);
              continue;
            }
          }
          
          break;
        } catch (err) {
          retryCount++;
          if (retryCount < maxRetries) {
            const waitMs = Math.min(1000 * Math.pow(2, retryCount - 1), 5000);
            console.warn(`[GRID] ⚠️ Lỗi khi lấy giá (lần thử ${retryCount}/${maxRetries}): ${err.message}. Đợi ${waitMs}ms...`);
            await sleep(waitMs);
          } else {
            console.error(`[GRID] ❌ Không thể lấy giá sau ${maxRetries} lần thử: ${err.message}`);
            lastPrice = null;
          }
        }
      }
      
      if (!lastPrice) {
        console.warn(`[GRID] ⚠️ [Check #${checkCount}] Không thể lấy giá, bỏ qua lần check này`);
        continue;
      }

      // Kiểm tra TP cho TẤT CẢ positions (không chỉ 1 lệnh)
      const positionsToClose = [];
      
      for (const position of activePositions) {
        if (!position.isActive) continue;
        
        const entryPrice = position.entryPrice;
        const tp = position.tp;
        const direction = position.direction;
        
        let shouldClose = false;
        if (direction === 'long' && lastPrice >= tp) {
          shouldClose = true;
        } else if (direction === 'short' && lastPrice <= tp) {
          shouldClose = true;
        }
        
        if (shouldClose) {
          console.log(`[GRID] ✅ [Check #${checkCount}] ${direction.toUpperCase()} chạm TP (Entry: ${formatNumber(entryPrice)}, TP: ${formatNumber(tp)}, Current: ${formatNumber(lastPrice)})`);
          positionsToClose.push(position);
        }
      }
      
      // Đóng tất cả positions đã chạm TP
      // Nhóm các lệnh logic cùng positionId để tránh đóng nhiều lần
      const closedPositionIds = new Set();
      
      for (const position of positionsToClose) {
        try {
          // Nếu là lệnh logic và đã đóng position này rồi, skip
          if (position.isLogical && position.orderId && closedPositionIds.has(position.orderId)) {
            position.isActive = false;
            continue;
          }
          
          await this.closePosition(position);
          position.isActive = false;
          
          // Đánh dấu đã đóng position này (nếu là lệnh logic)
          if (position.isLogical && position.orderId) {
            closedPositionIds.add(position.orderId);
            
            // Đóng tất cả lệnh logic khác cùng positionId
            const samePositionOrders = this.trackedPositions.filter(p => 
              p.isLogical && 
              p.orderId === position.orderId && 
              p.isActive
            );
            samePositionOrders.forEach(p => {
              p.isActive = false;
              console.log(`[GRID] 🔄 Đánh dấu lệnh logic ${p.direction.toUpperCase()} (size: ${formatNumber(p.size)}) đã đóng cùng position`);
            });
          }
          
          // Mở lại 2 lệnh mới tại giá hiện tại (nếu ADX cho phép)
          console.log(`[GRID] 🔄 Thử mở lại 2 lệnh mới tại giá ${formatNumber(lastPrice)}`);
          try {
            const newStates = await this.openNewCycle(lastPrice);
            // Thêm lệnh mới vào trackedPositions (đã được thêm trong openPosition)
            console.log(`[GRID] ✅ Đã mở lại 2 lệnh mới thành công`);
            // Reset checkCount cho chu kỳ mới
            checkCount = 0;
          } catch (err) {
            if (err.message.includes('ADX')) {
              console.log(`[GRID] ⚠️ Không mở lệnh mới vì ADX không phù hợp. Tiếp tục monitor các lệnh còn lại.`);
            } else {
              console.error(`[GRID] ❌ Lỗi khi mở lệnh mới: ${err.message}`);
            }
          }
        } catch (err) {
          console.error(`[GRID] ❌ Lỗi khi đóng position ${position.direction}: ${err.message}`);
        }
      }

      // Log trạng thái
      if (checkCount % 10 === 0) {
        const activeCount = activePositions.filter(p => p.isActive).length;
        console.log(`[GRID] 📊 [Check #${checkCount}] Giá: ${formatNumber(lastPrice)} | Active positions: ${activeCount}`);
      }
    }
  }

  async closePosition(state) {
    try {
      await this.api.closePosition({
        symbol: this.config.symbol,
        marginCoin: this.config.marginCoin,
        holdSide: state.direction,
      });
      console.log(`[GRID] ✅ Đã đóng position ${state.direction.toUpperCase()}`);
    } catch (err) {
      console.error(`[GRID] ❌ Lỗi khi đóng position ${state.direction}: ${err.message}`);
      // Fallback: thử đóng bằng placeOrder
      try {
        const side = state.direction === 'long' ? 'close_long' : 'close_short';
        await this.api.placeOrder({
          symbol: this.config.symbol,
          marginCoin: this.config.marginCoin,
          size: state.size.toString(),
          side,
          orderType: 'market',
        });
        console.log(`[GRID] ✅ Đã đóng position ${state.direction.toUpperCase()} bằng fallback method`);
      } catch (fallbackErr) {
        console.error(`[GRID] ❌ Fallback method cũng fail: ${fallbackErr.message}`);
      }
    }
  }

  formatPrice(price) {
    if (!price || Number.isNaN(price)) return '0';
    if (this.priceDecimals !== undefined) {
      return price.toFixed(this.priceDecimals);
    }
    return price.toFixed(8);
  }

  detectActualTickSize(priceStr, numericPrice) {
    if (!priceStr || !numericPrice) return this.priceTick || 0.0001;
    
    const parts = priceStr.split('.');
    if (parts.length !== 2) return this.priceTick || 0.0001;
    
    const decimals = parts[1];
    if (!decimals) return this.priceTick || 0.0001;
    
    const significantDecimals = decimals.replace(/0+$/, '');
    if (significantDecimals.length === 0) return this.priceTick || 0.0001;
    
    const tick = Math.pow(10, -significantDecimals.length);
    return tick;
  }
}

module.exports = { GridBot };
