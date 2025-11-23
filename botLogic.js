const {
  sleep,
  calcTargets,
  formatNumber,
  percentFormat,
  roundToTick,
  roundToStep,
  getDecimalsFromStep,
} = require('./utils');

class BotLogic {
  constructor({ apiClient, config }) {
    this.api = apiClient;
    this.config = {
      symbol: 'BTCUSDT_UMCBL',
      marginCoin: 'USDT',
      capitalPerSide: 6,
      leverage: 5,
      takeProfitPercent: 0.006,
      stopLossPercent: 0.003,
      priceTickSize: 0,
      sizeStep: 0,
      cooldownMs: 5 * 60 * 1000,
      maxPositionDurationMs: 15 * 60 * 1000,
      pollIntervalMs: 5 * 1000,
      ...config,
    };
    this.lastCycleEndedAt = 0;
    this.isRunning = false;
    this.priceTick = this.config.priceTickSize > 0 ? this.config.priceTickSize : null;
    this.sizeStep = this.config.sizeStep > 0 ? this.config.sizeStep : null;
    this.marketInfoLoaded = false;
    this.priceDecimals = this.priceTick ? getDecimalsFromStep(this.priceTick) : 4;
  }

  async run() {
    this.isRunning = true;
    console.log('[BOT] 🚀 Khởi động bot trading 2 chiều Bitget');
    const baseTp = (this.config.takeProfitPercent * 100) / this.config.leverage;
    const baseSl = (this.config.stopLossPercent * 100) / this.config.leverage;
    console.table({
      'Cặp giao dịch': this.config.symbol,
      'Đòn bẩy': `${this.config.leverage}x`,
      'Vốn mỗi bên': `${this.config.capitalPerSide} ${this.config.marginCoin}`,
      'Take Profit': `${percentFormat(this.config.takeProfitPercent)} (base ${baseTp.toFixed(2)}%)`,
      'Stop Loss': `${percentFormat(this.config.stopLossPercent)} (base ${baseSl.toFixed(2)}%)`,
      'Tick giá': this.config.priceTickSize || 'AUTO',
      'Bước khối lượng': this.config.sizeStep || 'AUTO',
      'Thời gian chờ': `${(this.config.cooldownMs / 60000).toFixed(1)} phút`,
      'Thời gian tối đa': `${(this.config.maxPositionDurationMs / 60000).toFixed(1)} phút`,
    });

    await this.prepareMarketMeta();

    while (this.isRunning) {
      try {
        await this.enforceCooldown();
        await this.executeCycle();
        this.lastCycleEndedAt = Date.now();
      } catch (err) {
        console.error(`[BOT] ❌ Lỗi trong chu kỳ: ${err.message}`);
        if (err.stack && err.message.length < 200) {
          console.error('[BOT] Chi tiết lỗi:', err.stack.split('\n').slice(0, 3).join('\n'));
        }
        
        // Nếu là lỗi nghiêm trọng (không thể tiếp tục), dừng bot
        const fatalErrors = [
          'Số dư không đủ',
          'Không thể mở cả 2 lệnh',
          'Không thể lấy giá ticker',
          'Entry price không hợp lệ',
          'Order size không hợp lệ',
        ];
        
        if (fatalErrors.some(msg => err.message.includes(msg))) {
          console.error('[BOT] 🛑 Lỗi nghiêm trọng - dừng bot để tránh rủi ro');
          this.isRunning = false;
          throw err; // Re-throw để main() catch và exit
        }
        
        console.error('[BOT] ⏳ Đợi 60 giây trước khi thử lại...');
        await sleep(60_000);
      }
    }
  }

  async prepareMarketMeta() {
    if (this.marketInfoLoaded) return;
    try {
      const productType = this.config.symbol.includes('_UMCBL') ? 'umcbl' : undefined;
      const contract = await this.api.getContract(this.config.symbol, productType);
      if (!contract) {
        console.warn(`[BOT] ⚠️ Không tìm thấy contract "${this.config.symbol}"`);
        const similar = await this.api.listAvailableContracts('umcbl', '');
        if (similar.length > 0) {
          console.log(`[BOT] 💡 Gợi ý các contract có sẵn (${similar.length} kết quả):`);
          similar.slice(0, 10).forEach((c) => {
            console.log(`   - ${c.symbol} (${c.symbolName || 'N/A'})`);
          });
        }
        throw new Error(`Không tìm thấy contract "${this.config.symbol}". Vui lòng kiểm tra lại symbol hoặc thử các contract được gợi ý ở trên.`);
      }
      // Thử nhiều field để lấy tick size
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
        // Lấy giá hiện tại để validate tick size
        const ticker = await this.api.getTicker(this.config.symbol).catch(() => null);
        const currentPrice = ticker ? Number(ticker.last || ticker.markPrice || 0) : 0;
        
        if (derivedPriceTick > 0) {
          // Validate tick size: nếu tick size > giá/10 thì có thể sai
          if (currentPrice > 0 && derivedPriceTick > currentPrice / 10) {
            console.warn(`[BOT] ⚠️ Tick size từ API (${derivedPriceTick}) có vẻ không đúng với giá ${currentPrice}, sẽ ước tính lại`);
            // Ước tính tick size dựa trên giá
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
          // Ước tính tick size dựa trên giá
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
            this.priceTick = 0.01; // Mặc định an toàn
          }
        }
        this.priceDecimals = getDecimalsFromStep(this.priceTick);
      }
      if (!this.sizeStep) {
        this.sizeStep = derivedSizeStep || 0.1;
      }
      console.log(
        `[BOT] ℹ️ Thông tin contract: tick giá=${this.priceTick}, bước khối lượng=${this.sizeStep}`,
      );
      if (contract.priceTick || contract.priceStep) {
        console.log(`[BOT] 📋 Contract fields: priceTick=${contract.priceTick}, priceStep=${contract.priceStep}, quantityTick=${contract.quantityTick}`);
      }
    } catch (err) {
      console.warn(`[BOT] ⚠️ Không lấy được contract spec: ${err.message}`);
      this.priceTick = this.priceTick || 0.1;
      this.priceDecimals = getDecimalsFromStep(this.priceTick);
      this.sizeStep = this.sizeStep || 0.0001;
      console.log(`[BOT] ⚙️ Sử dụng giá trị mặc định: tick=${this.priceTick}, sizeStep=${this.sizeStep}`);
    } finally {
      this.marketInfoLoaded = true;
    }
  }

  async enforceCooldown() {
    if (!this.lastCycleEndedAt) return;
    const elapsed = Date.now() - this.lastCycleEndedAt;
    if (elapsed >= this.config.cooldownMs) return;
    const waitMs = this.config.cooldownMs - elapsed;
    console.log(`[BOT] ⏸️  Đang chờ cooldown (còn ${(waitMs / 1000).toFixed(0)} giây)`);
    await sleep(waitMs);
  }

  async executeCycle() {
    console.log('[BOT] 🔄 Bắt đầu chu kỳ mới (Long + Short)');
    
    // Kiểm tra số dư trước
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
      
      const requiredMargin = this.config.capitalPerSide * 2; // Cần cho cả Long và Short
      console.log(`[BOT] 💰 Số dư khả dụng: ${formatNumber(available)} ${this.config.marginCoin}`);
      
      if (available < requiredMargin) {
        console.warn(`[BOT] ⚠️ Cảnh báo: Số dư (${formatNumber(available)}) có thể không đủ cho vốn yêu cầu (${requiredMargin} ${this.config.marginCoin})`);
        if (available > 0) {
          console.warn(`[BOT] 💡 Gợi ý: Giảm --capital xuống ${Math.floor(available / 2)} hoặc nạp thêm ${this.config.marginCoin}`);
        }
      }
    } catch (err) {
      console.warn(`[BOT] ⚠️ Không thể kiểm tra số dư: ${err.message}`);
    }
    
    // Retry logic cho getTicker
    let ticker = null;
    let markPrice = null;
    let markPriceStr = null;
    let retryCount = 0;
    const maxRetries = 3;
    
    while (retryCount < maxRetries && !markPrice) {
      try {
        ticker = await this.api.getTicker(this.config.symbol);
        console.log(`[BOT] 🔍 Raw ticker response từ API:`, JSON.stringify(ticker, null, 2));
        const rawLast = ticker?.last;
        const rawMarkPrice = ticker?.markPrice;
        const rawBestAsk = ticker?.bestAsk;
        console.log(`[BOT] 🔍 Raw giá từ API: last=${rawLast}, markPrice=${rawMarkPrice}, bestAsk=${rawBestAsk}`);
        
        // Giữ nguyên string để giữ full precision, chỉ convert khi cần tính toán
        markPriceStr = ticker?.last || ticker?.markPrice || ticker?.bestAsk;
        if (!markPriceStr) {
          throw new Error('Không có giá nào trong ticker response');
        }
        
        markPrice = Number(markPriceStr);
        console.log(`[BOT] 🔍 Giá sau khi convert to Number: ${markPrice} (raw string: ${markPriceStr})`);
        
        // Validate giá hợp lệ
        if (!markPrice || Number.isNaN(markPrice) || markPrice <= 0) {
          throw new Error(`Giá không hợp lệ: ${markPrice}`);
        }
        
        // Lưu raw string để dùng cho detectActualTickSize
        this.lastEntryPriceStr = markPriceStr;
        break; // Thành công
      } catch (err) {
        retryCount++;
        if (retryCount < maxRetries) {
          const waitMs = Math.min(1000 * Math.pow(2, retryCount - 1), 5000);
          console.warn(`[BOT] ⚠️ Lỗi khi lấy giá ticker (lần thử ${retryCount}/${maxRetries}): ${err.message}. Đợi ${waitMs}ms...`);
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
    console.log(`[BOT] 📊 Giá hiện tại (formatted): ${formatNumber(markPrice)} | Raw: ${markPrice} | Kích thước lệnh: ${size} contracts`);

    await this.configureLeverage();

    // Validate entry price trước khi đặt lệnh
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
      console.log(`[BOT] ✅ Long position đã được mở thành công`);
    } catch (err) {
      console.error(`[BOT] ❌ Lỗi khi mở Long position: ${err.message}`);
      // Nếu Long fail, vẫn thử mở Short (có thể là lỗi tạm thời)
    }

    // Đặt lệnh Short
    try {
      shortState = await this.openPosition({
        direction: 'short',
        size,
        entryPrice: markPrice,
      });
      shortOpened = true;
      console.log(`[BOT] ✅ Short position đã được mở thành công`);
    } catch (err) {
      console.error(`[BOT] ❌ Lỗi khi mở Short position: ${err.message}`);
    }

    // Kiểm tra nếu cả 2 đều fail
    if (!longOpened && !shortOpened) {
      throw new Error('Không thể mở cả 2 lệnh Long và Short. Vui lòng kiểm tra lại số dư, leverage và thử lại.');
    }

    // Nếu chỉ một lệnh thành công, đóng lệnh đó ngay để tránh rủi ro
    if (longOpened && !shortOpened) {
      console.warn(`[BOT] ⚠️ Chỉ Long được mở, Short fail - đóng Long để tránh rủi ro`);
      if (longState) {
        await this.closePosition(longState).catch(err => {
          console.error(`[BOT] ❌ Không thể đóng Long: ${err.message}`);
        });
      }
      throw new Error('Short position không thể mở - đã đóng Long để tránh rủi ro');
    }

    if (shortOpened && !longOpened) {
      console.warn(`[BOT] ⚠️ Chỉ Short được mở, Long fail - đóng Short để tránh rủi ro`);
      if (shortState) {
        await this.closePosition(shortState).catch(err => {
          console.error(`[BOT] ❌ Không thể đóng Short: ${err.message}`);
        });
      }
      throw new Error('Long position không thể mở - đã đóng Short để tránh rủi ro');
    }

    // Cả 2 đều thành công → monitor
    await this.monitorPositions({ longState, shortState });
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
    
    // Validate order size
    if (finalSize <= 0) {
      throw new Error(`Order size không hợp lệ: ${finalSize} (notional: ${notional}, entryPrice: ${entryPrice})`);
    }
    
    // Cảnh báo nếu size quá nhỏ (có thể không đủ để trade)
    if (finalSize < step) {
      console.warn(`[BOT] ⚠️ Order size ${finalSize} nhỏ hơn step size ${step} - có thể không đặt được lệnh`);
    }
    
    return finalSize;
  }

  async configureLeverage() {
    console.log(`[BOT] ⚙️  Thiết lập đòn bẩy ${this.config.leverage}x cho Long và Short`);
    try {
      await Promise.all(
        ['long', 'short'].map((side) =>
          this.api.setLeverage({
            symbol: this.config.symbol,
            marginCoin: this.config.marginCoin,
            leverage: this.config.leverage,
            holdSide: side,
          }).catch(err => {
            console.error(`[BOT] ⚠️ Lỗi khi set leverage cho ${side}: ${err.message}`);
            throw err;
          }),
        ),
      );
      console.log(`[BOT] ✅ Đã thiết lập đòn bẩy ${this.config.leverage}x thành công`);
    } catch (err) {
      console.error(`[BOT] ❌ Lỗi khi thiết lập leverage: ${err.message}`);
      throw new Error(`Không thể thiết lập leverage ${this.config.leverage}x: ${err.message}`);
    }
  }

  async openPosition({ direction, size, entryPrice }) {
    // Debug: log giá trị để kiểm tra
    console.log(`[BOT] 🔍 Debug TP/SL calculation:`);
    console.log(`  - Entry Price (raw): ${entryPrice}`);
    console.log(`  - takeProfitPercent: ${this.config.takeProfitPercent} (${(this.config.takeProfitPercent * 100).toFixed(2)}%)`);
    console.log(`  - stopLossPercent: ${this.config.stopLossPercent} (${(this.config.stopLossPercent * 100).toFixed(2)}%)`);
    
    const rawTargets = calcTargets({
      entryPrice,
      takeProfitPercent: this.config.takeProfitPercent,
      stopLossPercent: this.config.stopLossPercent,
      side: direction,
    });
    
    // Sử dụng tick size nhỏ hơn để giữ độ chính xác (0.0001 thay vì 0.01)
    // Hoặc không round nếu muốn full precision
    const tick = this.priceTick || this.config.priceTickSize || 0.01;
    // Tìm tick size thực tế từ giá - có thể nhỏ hơn 0.01
    // Ví dụ: giá 2.1002 có thể có tick = 0.0001
    const actualTick = this.detectActualTickSize(entryPrice, tick);
    console.log(`  - Tick size: ${tick}, Actual tick: ${actualTick}`);
    
    let tp = roundToTick(rawTargets.tp, actualTick);
    let sl = roundToTick(rawTargets.sl, actualTick);
    
    // Debug: log kết quả tính toán
    const tpPercent = ((tp - entryPrice) / entryPrice * 100).toFixed(2);
    const slPercent = direction === 'long' 
      ? ((entryPrice - sl) / entryPrice * 100).toFixed(2)
      : ((sl - entryPrice) / entryPrice * 100).toFixed(2);
    console.log(`  - Raw TP: ${rawTargets.tp}, Rounded TP: ${tp} (${tpPercent}% từ entry)`);
    console.log(`  - Raw SL: ${rawTargets.sl}, Rounded SL: ${sl} (${slPercent}% từ entry)`);

    // Validate và điều chỉnh nếu cần
    if (direction === 'long') {
      // Long: SL phải < entryPrice, TP phải > entryPrice, và cả hai phải > 0
      if (sl <= 0 || sl >= entryPrice) {
        // Tính lại SL với margin an toàn
        sl = roundToTick(entryPrice * (1 - this.config.stopLossPercent * 1.1), actualTick);
        if (sl >= entryPrice || sl <= 0) {
          sl = roundToTick(entryPrice * 0.997, actualTick); // Fallback: giảm 0.3%
        }
      }
      if (tp <= 0 || tp <= entryPrice) {
        // Tính lại TP với margin an toàn
        tp = roundToTick(entryPrice * (1 + this.config.takeProfitPercent * 1.1), actualTick);
        if (tp <= entryPrice || tp <= 0) {
          tp = roundToTick(entryPrice * 1.003, actualTick); // Fallback: tăng 0.3%
        }
      }
    } else {
      // Short: SL phải > entryPrice, TP phải < entryPrice, và cả hai phải > 0
      if (sl <= 0 || sl <= entryPrice) {
        // Tính lại SL với margin an toàn
        sl = roundToTick(entryPrice * (1 + this.config.stopLossPercent * 1.1), actualTick);
        if (sl <= entryPrice || sl <= 0) {
          sl = roundToTick(entryPrice * 1.003, actualTick); // Fallback: tăng 0.3%
        }
      }
      if (tp <= 0 || tp >= entryPrice) {
        // Tính lại TP với margin an toàn
        tp = roundToTick(entryPrice * (1 - this.config.takeProfitPercent * 1.1), actualTick);
        if (tp >= entryPrice || tp <= 0) {
          tp = roundToTick(entryPrice * 0.997, actualTick); // Fallback: giảm 0.3%
        }
      }
    }

    // Final validation: đảm bảo > 0 và hợp lệ
    if (tp <= 0 || sl <= 0) {
      throw new Error(`Không thể tính TP/SL hợp lệ: TP=${tp}, SL=${sl}, Entry=${entryPrice}, Tick=${tick}`);
    }
    
    // Validate TP/SL so với entry price
    if (direction === 'long') {
      if (tp <= entryPrice) {
        throw new Error(`Long TP (${tp}) phải lớn hơn entry price (${entryPrice})`);
      }
      if (sl >= entryPrice) {
        throw new Error(`Long SL (${sl}) phải nhỏ hơn entry price (${entryPrice})`);
      }
    } else {
      if (tp >= entryPrice) {
        throw new Error(`Short TP (${tp}) phải nhỏ hơn entry price (${entryPrice})`);
      }
      if (sl <= entryPrice) {
        throw new Error(`Short SL (${sl}) phải lớn hơn entry price (${entryPrice})`);
      }
    }
    
    // Validate TP/SL không quá xa entry (có thể là lỗi tính toán)
    const tpDistance = Math.abs(tp - entryPrice) / entryPrice;
    const slDistance = Math.abs(sl - entryPrice) / entryPrice;
    if (tpDistance > 0.1 || slDistance > 0.1) {
      console.warn(`[BOT] ⚠️ CẢNH BÁO: TP/SL cách entry quá xa (>10%): TP=${tpDistance.toFixed(2)}%, SL=${slDistance.toFixed(2)}%`);
    }

    const tpFormatted = this.formatPrice(tp);
    const slFormatted = this.formatPrice(sl);

    const side = direction === 'long' ? 'open_long' : 'open_short';
    const directionText = direction === 'long' ? 'LONG' : 'SHORT';
    console.log(
      `[BOT] 📈 Mở lệnh ${directionText} | Size: ${size} | Entry: ${this.formatPrice(entryPrice)} (raw: ${entryPrice}) | TP: ${tpFormatted} (raw: ${tp}) | SL: ${slFormatted} (raw: ${sl})`,
    );

    // Đặt lệnh không có TP/SL (Bitget có thể không hỗ trợ preset với market order)
    // Bot sẽ tự monitor và đóng lệnh khi đạt TP/SL
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
          // Không set TP/SL ở đây, sẽ monitor và đóng thủ công
        });
        orderPlaced = true;
        console.log(`[BOT] ✅ Lệnh ${directionText} đã được đặt thành công`);
      } catch (err) {
        retryCount++;
        
        // Xử lý các lỗi cụ thể
        if (err.message.includes('40762') || err.message.includes('exceeds the balance')) {
          throw new Error(`Số dư không đủ để đặt lệnh. Cần ít nhất ${this.config.capitalPerSide} ${this.config.marginCoin} cho mỗi bên.`);
        }
        
        if (err.message.includes('45001') || err.message.includes('preset')) {
          // Lỗi preset, thử lại không có preset (đã không có rồi)
          console.warn(`[BOT] ⚠️ Lỗi preset (có thể bỏ qua): ${err.message}`);
          orderPlaced = true; // Coi như thành công vì đã không dùng preset
          break;
        }
        
        if (retryCount < maxRetries) {
          const waitMs = Math.min(1000 * Math.pow(2, retryCount - 1), 5000);
          console.warn(`[BOT] ⚠️ Lỗi khi đặt lệnh ${directionText} (lần thử ${retryCount}/${maxRetries}): ${err.message}. Đợi ${waitMs}ms...`);
          await sleep(waitMs);
        } else {
          throw new Error(`Không thể đặt lệnh ${directionText} sau ${maxRetries} lần thử: ${err.message}`);
        }
      }
    }
    
    if (!orderPlaced) {
      throw new Error(`Không thể đặt lệnh ${directionText}`);
    }

    // Đợi một chút để order được fill
    await sleep(1000);
    
    // Kiểm tra position thực tế (optional - có thể bỏ qua nếu API không hỗ trợ)
    try {
      const position = await this.api.getPosition(this.config.symbol, this.config.marginCoin);
      if (position) {
        const actualSize = Number(position.total || position.holdSize || 0);
        const actualSide = position.holdSide || position.side;
        console.log(`[BOT] 📋 Position thực tế: ${actualSide} ${actualSize} contracts`);
        
        // Validate position
        if (actualSize > 0 && actualSide === direction) {
          console.log(`[BOT] ✅ Position ${directionText} đã được mở thành công (${actualSize} contracts)`);
        } else if (actualSize === 0) {
          console.warn(`[BOT] ⚠️ CẢNH BÁO: Position ${directionText} chưa được mở (size = 0). Có thể order chưa được fill.`);
        } else {
          console.warn(`[BOT] ⚠️ CẢNH BÁO: Position không khớp - mong đợi ${direction}, thực tế ${actualSide}`);
        }
      }
    } catch (err) {
      // Không throw - chỉ log warning vì có thể API không hỗ trợ hoặc có lỗi tạm thời
      console.warn(`[BOT] ⚠️ Không thể kiểm tra position thực tế: ${err.message}`);
    }

    return {
      direction,
      size,
      entryPrice,
      tp: Number(tpFormatted),
      sl: Number(slFormatted),
      isActive: true,
    };
  }

  async monitorPositions({ longState, shortState }) {
    const start = Date.now();
    const activeStates = { long: longState, short: shortState };
    let checkCount = 0;

    console.log(`[BOT] 🔍 Bắt đầu monitor positions (kiểm tra mỗi ${this.config.pollIntervalMs / 1000}s)`);

    while (Date.now() - start < this.config.maxPositionDurationMs) {
      await sleep(this.config.pollIntervalMs);
      checkCount++;
      
      // Retry logic cho getTicker với exponential backoff
      let ticker = null;
      let lastPrice = null;
      let retryCount = 0;
      const maxRetries = 3;
      
      while (retryCount < maxRetries && !lastPrice) {
        try {
          ticker = await this.api.getTicker(this.config.symbol);
          const rawLast = ticker?.last;
          const rawMarkPrice = ticker?.markPrice;
          console.log(`[BOT] 🔍 [Check #${checkCount}] Raw giá từ API: last=${rawLast}, markPrice=${rawMarkPrice}`);
          lastPrice = Number(ticker?.last || ticker?.markPrice);
          console.log(`[BOT] 🔍 [Check #${checkCount}] Giá sau khi convert to Number: ${lastPrice} (raw: ${rawLast || rawMarkPrice})`);
          
          // Validate giá hợp lệ
          if (!lastPrice || Number.isNaN(lastPrice) || lastPrice <= 0) {
            throw new Error(`Giá không hợp lệ: ${lastPrice}`);
          }
          
          // Validate giá không quá khác biệt so với entry (có thể là lỗi API)
          if (activeStates.long?.isActive || activeStates.short?.isActive) {
            const entryPrice = activeStates.long?.entryPrice || activeStates.short?.entryPrice;
            if (entryPrice && Math.abs(lastPrice - entryPrice) / entryPrice > 0.5) {
              console.warn(`[BOT] ⚠️ [Check #${checkCount}] Giá ${lastPrice} khác biệt quá lớn so với entry ${entryPrice} (>50%) - có thể là lỗi API`);
              // Vẫn dùng giá này nhưng log cảnh báo
              // Không skip check này vì có thể là giá thật (flash crash/pump)
            }
            
            // Validate giá không quá nhỏ hoặc quá lớn (có thể là lỗi)
            if (lastPrice < entryPrice * 0.1 || lastPrice > entryPrice * 10) {
              console.error(`[BOT] ❌ [Check #${checkCount}] Giá ${lastPrice} bất thường so với entry ${entryPrice} - có thể là lỗi API. Bỏ qua lần check này.`);
              continue; // Skip check này
            }
          }
          
          break; // Thành công, thoát vòng lặp
        } catch (err) {
          retryCount++;
          if (retryCount < maxRetries) {
            const waitMs = Math.min(1000 * Math.pow(2, retryCount - 1), 5000); // Exponential backoff, max 5s
            console.warn(`[BOT] ⚠️ [Check #${checkCount}] Lỗi khi lấy giá (lần thử ${retryCount}/${maxRetries}): ${err.message}. Đợi ${waitMs}ms...`);
            await sleep(waitMs);
          } else {
            console.error(`[BOT] ❌ [Check #${checkCount}] Không thể lấy giá sau ${maxRetries} lần thử: ${err.message}`);
            // Tiếp tục vòng lặp, sẽ thử lại ở lần check tiếp theo
            continue;
          }
        }
      }
      
      if (!lastPrice) {
        console.warn(`[BOT] ⚠️  [Check #${checkCount}] Không đọc được giá - bỏ qua lần check này`);
        continue;
      }

      // Log mỗi lần check
      const elapsed = Math.floor((Date.now() - start) / 1000);
      const longStatus = activeStates.long?.isActive 
        ? `Long: ${this.formatPrice(activeStates.long.entryPrice)} → TP:${this.formatPrice(activeStates.long.tp)} SL:${this.formatPrice(activeStates.long.sl)}`
        : 'Long: -';
      const shortStatus = activeStates.short?.isActive
        ? `Short: ${this.formatPrice(activeStates.short.entryPrice)} → TP:${this.formatPrice(activeStates.short.tp)} SL:${this.formatPrice(activeStates.short.sl)}`
        : 'Short: -';
      console.log(`[BOT] 🔍 [Check #${checkCount}] Giá hiện tại: ${this.formatPrice(lastPrice)} | ${longStatus} | ${shortStatus} | Thời gian: ${elapsed}s`);

      // Check cả 2 bên cùng lúc
      const longCheck = this.checkSideShouldClose(activeStates.long, lastPrice);
      const shortCheck = this.checkSideShouldClose(activeStates.short, lastPrice);
      
      // Kiểm tra nếu cả 2 lệnh đã đóng → dừng monitor ngay
      const hasActivePositions = (activeStates.long?.isActive || false) || (activeStates.short?.isActive || false);
      if (!hasActivePositions) {
        console.log(`[BOT] ✅ Cả 2 lệnh đã được đóng - dừng monitor`);
        return;
      }
      
      // Ưu tiên: Check SL trước (rủi ro cao hơn)
      // Nếu có SL chạm → đóng bên đó trước, không đợi TP
      if (longCheck.shouldClose && longCheck.reason === 'sl') {
        console.log(`[BOT] 📞 Gọi closePosition() - Long chạm SL (ưu tiên)`);
        try {
          await this.closePosition(activeStates.long);
          console.log(`[BOT] 💡 Giữ lệnh Short để chờ TP/SL hoặc timeout`);
          activeStates.long = null;
          // Kiểm tra lại nếu cả 2 đã đóng
          if (!activeStates.short?.isActive) {
            console.log(`[BOT] ✅ Cả 2 lệnh đã được đóng - dừng monitor`);
            return;
          }
          continue;
        } catch (err) {
          console.error(`[BOT] ❌ Lỗi khi đóng Long SL: ${err.message}`);
          // Tiếp tục monitor, sẽ thử lại lần sau
        }
      }
      
      if (shortCheck.shouldClose && shortCheck.reason === 'sl') {
        console.log(`[BOT] 📞 Gọi closePosition() - Short chạm SL (ưu tiên)`);
        try {
          await this.closePosition(activeStates.short);
          console.log(`[BOT] 💡 Giữ lệnh Long để chờ TP/SL hoặc timeout`);
          activeStates.short = null;
          // Kiểm tra lại nếu cả 2 đã đóng
          if (!activeStates.long?.isActive) {
            console.log(`[BOT] ✅ Cả 2 lệnh đã được đóng - dừng monitor`);
            return;
          }
          continue;
        } catch (err) {
          console.error(`[BOT] ❌ Lỗi khi đóng Short SL: ${err.message}`);
          // Tiếp tục monitor, sẽ thử lại lần sau
        }
      }
      
      // Sau đó check TP: nếu có TP chạm → đóng cả 2
      if (longCheck.shouldClose && longCheck.reason === 'tp') {
        console.log(`[BOT] 📞 Gọi closeBoth() - Long chạm TP`);
        await this.closeBoth(activeStates, `Long chạm TP tại ${formatNumber(lastPrice)}`);
        return;
      }
      
      if (shortCheck.shouldClose && shortCheck.reason === 'tp') {
        console.log(`[BOT] 📞 Gọi closeBoth() - Short chạm TP`);
        await this.closeBoth(activeStates, `Short chạm TP tại ${formatNumber(lastPrice)}`);
        return;
      }
      
      // Edge case: Cả 2 cùng chạm SL cùng lúc
      if (longCheck.shouldClose && longCheck.reason === 'sl' && shortCheck.shouldClose && shortCheck.reason === 'sl') {
        console.log(`[BOT] ⚠️ Cả 2 lệnh cùng chạm SL - đóng cả 2 ngay lập tức`);
        await this.closeBoth(activeStates, `Cả 2 chạm SL tại ${formatNumber(lastPrice)}`);
        return;
      }
      
      // Edge case: Cả 2 cùng chạm TP cùng lúc (hiếm nhưng có thể xảy ra)
      if (longCheck.shouldClose && longCheck.reason === 'tp' && shortCheck.shouldClose && shortCheck.reason === 'tp') {
        console.log(`[BOT] 🎉 Cả 2 lệnh cùng chạm TP - đóng cả 2 ngay lập tức`);
        await this.closeBoth(activeStates, `Cả 2 chạm TP tại ${formatNumber(lastPrice)}`);
        return;
      }
    }

    // Timeout: đóng các lệnh còn lại
    const elapsed = Math.floor((Date.now() - start) / 1000);
    const stillActive = Object.values(activeStates).filter(s => s?.isActive).length;
    
    if (stillActive > 0) {
      console.log(`[BOT] ⏰ Đã đạt thời gian tối đa (${elapsed}s) - đóng ${stillActive} lệnh còn lại`);
      console.log(`[BOT] 📞 Gọi closeBoth() - Timeout`);
      await this.closeBoth(activeStates, 'Hết thời gian');
    } else {
      console.log(`[BOT] ✅ Đã đạt thời gian tối đa nhưng cả 2 lệnh đã được đóng trước đó`);
    }
  }

  checkSideShouldClose(state, price) {
    if (!state?.isActive) return false;
    if (state.direction === 'long') {
      if (price >= state.tp) {
        console.log(`[BOT] ✅ Long chạm Take Profit tại ${formatNumber(price)}`);
        return { shouldClose: true, reason: 'tp' };
      }
      if (price <= state.sl) {
        console.log(`[BOT] ❌ Long chạm Stop Loss tại ${formatNumber(price)}`);
        return { shouldClose: true, reason: 'sl' };
      }
    } else if (state.direction === 'short') {
      if (price <= state.tp) {
        console.log(`[BOT] ✅ Short chạm Take Profit tại ${formatNumber(price)}`);
        return { shouldClose: true, reason: 'tp' };
      }
      if (price >= state.sl) {
        console.log(`[BOT] ❌ Short chạm Stop Loss tại ${formatNumber(price)}`);
        return { shouldClose: true, reason: 'sl' };
      }
    }
    return { shouldClose: false };
  }

  async closeBoth(states, reason) {
    console.log(`[BOT] 🔒 Đóng cả 2 lệnh (Lý do: ${reason})`);
    const activeCount = Object.values(states).filter(s => s?.isActive).length;
    
    if (activeCount === 0) {
      console.log(`[BOT] ℹ️ Cả 2 lệnh đã được đóng trước đó`);
      return;
    }
    
    console.log(`[BOT] 📞 Gọi closePosition() cho ${activeCount} lệnh đang active`);
    
    // Đóng cả 2 song song nhưng có error handling riêng
    const closePromises = Object.values(states)
      .filter(state => state?.isActive)
      .map((state) =>
        this.closePosition(state).catch((err) => {
          console.error(`[BOT] ❌ Không thể đóng lệnh ${state.direction}: ${err.message}`);
          // Không throw để đảm bảo lệnh kia vẫn được đóng
        })
      );
    
    await Promise.all(closePromises);
    
    // Kiểm tra lại xem cả 2 đã đóng chưa
    const stillActive = Object.values(states).filter(s => s?.isActive).length;
    if (stillActive > 0) {
      console.warn(`[BOT] ⚠️ CẢNH BÁO: Vẫn còn ${stillActive} lệnh chưa được đóng. Vui lòng kiểm tra thủ công trên sàn!`);
    } else {
      console.log(`[BOT] ✅ Hoàn thành đóng cả 2 lệnh`);
    }
  }

  async closePosition(state) {
    if (!state?.isActive) {
      console.log(`[BOT] ⚠️  Lệnh ${state?.direction || 'unknown'} đã được đóng trước đó, bỏ qua`);
      return;
    }
    
    const holdSide = state.direction === 'long' ? 'long' : 'short';
    console.log(`[BOT] 📞 Đang gọi API closePosition() cho ${state.direction.toUpperCase()} | Size: ${state.size} | HoldSide: ${holdSide}`);
    
    // Đánh dấu inactive trước để tránh đóng 2 lần
    state.isActive = false;
    
    let retryCount = 0;
    const maxRetries = 3;
    let closed = false;
    
    while (!closed && retryCount < maxRetries) {
      try {
        await this.api.closePosition({
          symbol: this.config.symbol,
          marginCoin: this.config.marginCoin,
          holdSide,
          size: state.size,
        });
        console.log(`[BOT] ✅ Đã đóng lệnh ${state.direction.toUpperCase()} thành công`);
        closed = true;
      } catch (err) {
        retryCount++;
        
        // Xử lý các lỗi cụ thể
        if (err.message.includes('40404') || err.message.includes('NOT FOUND')) {
          // Position không tồn tại - có thể đã được đóng rồi
          console.warn(`[BOT] ⚠️ Position ${state.direction.toUpperCase()} không tồn tại (có thể đã được đóng) - coi như thành công`);
          closed = true;
          break;
        }
        
        if (err.message.includes('40778') || err.message.includes('no position')) {
          // Không có position
          console.warn(`[BOT] ⚠️ Không có position ${state.direction.toUpperCase()} để đóng - coi như thành công`);
          closed = true;
          break;
        }
        
        if (retryCount < maxRetries) {
          const waitMs = Math.min(1000 * Math.pow(2, retryCount - 1), 5000);
          console.warn(`[BOT] ⚠️ Lỗi khi đóng ${state.direction.toUpperCase()} (lần thử ${retryCount}/${maxRetries}): ${err.message}. Đợi ${waitMs}ms...`);
          await sleep(waitMs);
        } else {
          console.error(`[BOT] ❌ Không thể đóng lệnh ${state.direction.toUpperCase()} sau ${maxRetries} lần thử: ${err.message}`);
          // Không throw để không block việc đóng lệnh kia
          // Nhưng log lỗi để user biết
        }
      }
    }
    
    if (!closed) {
      console.error(`[BOT] ⚠️ CẢNH BÁO: Không thể đóng lệnh ${state.direction.toUpperCase()} sau ${maxRetries} lần thử. Vui lòng kiểm tra thủ công trên sàn!`);
    }
  }

  formatPrice(value) {
    // Luôn hiển thị ít nhất 4 chữ số thập phân để giữ độ chính xác
    // Nếu giá có nhiều chữ số hơn, giữ nguyên
    const str = String(value);
    if (str.includes('.')) {
      const parts = str.split('.');
      const decimals = Math.max(parts[1]?.length || 0, 4);
      return Number(value).toFixed(decimals);
    }
    return Number(value).toFixed(4);
  }
  
  detectActualTickSize(price, defaultTick) {
    // Tìm tick size thực tế từ giá raw string (nếu có) hoặc từ giá number
    // Ưu tiên dùng raw string để giữ full precision
    const priceStr = this.lastEntryPriceStr || String(price);
    console.log(`[BOT] 🔍 detectActualTickSize: price=${price}, priceStr=${priceStr}, defaultTick=${defaultTick}`);
    if (priceStr.includes('.')) {
      const decimals = priceStr.split('.')[1].length;
      console.log(`[BOT] 🔍 Số chữ số thập phân: ${decimals}`);
      // Nếu có 4+ chữ số thập phân, tick có thể là 0.0001
      if (decimals >= 4) {
        console.log(`[BOT] 🔍 Dùng tick: 0.0001`);
        return 0.0001;
      }
      // Nếu có 3 chữ số thập phân, tick có thể là 0.001
      if (decimals >= 3) {
        console.log(`[BOT] 🔍 Dùng tick: 0.001`);
        return 0.001;
      }
      // Nếu có 2 chữ số thập phân, tick có thể là 0.01
      if (decimals >= 2) {
        console.log(`[BOT] 🔍 Dùng tick: 0.01`);
        return 0.01;
      }
    }
    console.log(`[BOT] 🔍 Dùng default tick: ${defaultTick}`);
    return defaultTick;
  }
}

module.exports = { BotLogic };

