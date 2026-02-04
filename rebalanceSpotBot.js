const { BitgetApi } = require('./bitgetApi');
const {
  parseCandleData,
  getCoinPrice,
  getSpotAccountInfo,
  calculateTotalAssets,
  roundToScale,
  sleep,
  formatNumber,
  formatTimestamp,
} = require('./getSpot4HCandles');

/**
 * Bot tự động rebalance danh mục spot
 * - Quản lý BGB trong khoảng 2-5%
 * - Sử dụng USDT dư để mua BTC/PAXG
 * - Giao dịch BTC/PAXG dựa trên nến 4H
 */
class RebalanceSpotBot {
  constructor({ apiClient, config = {} }) {
    this.api = apiClient;
    this.config = {
      intervalHours: config.intervalHours || 4,
      bgbMinPercent: config.bgbMinPercent || 2,
      bgbMaxPercent: config.bgbMaxPercent || 5,
      minChangePercent: config.minChangePercent || 0.5,
      minDivergencePercent: config.minDivergencePercent || 0.5, // Chênh lệch tối thiểu giữa BTC và PAXG
      minOrderValue: config.minOrderValue || 1, // Tối thiểu 1 USDT
    };
  }

  /**
   * Main loop - chạy bot liên tục
   */
  async run() {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🤖 REBALANCE SPOT BOT - BẮT ĐẦU`);
    console.log(`${'='.repeat(60)}`);
    console.log(`📋 Cấu hình:`);
    console.log(`   - Interval: ${this.config.intervalHours} giờ`);
    console.log(`   - BGB range: ${this.config.bgbMinPercent}% - ${this.config.bgbMaxPercent}%`);
    console.log(`   - Min change: ${this.config.minChangePercent}%`);
    console.log(`   - Min order value: ${this.config.minOrderValue} USDT`);
    console.log(`${'='.repeat(60)}\n`);

    // Chạy chu kỳ đầu tiên ngay lập tức, sau đó mới chờ nến/interval
    let isFirstRun = true;

    while (true) {
      try {
        if (isFirstRun) {
          console.log('⚡ Chạy chu kỳ đầu tiên ngay lập tức (không chờ nến)...\n');
        } else {
          // Đợi đến khi nến đóng cửa + 1 phút
          await this.waitForNextCandle(this.config.intervalHours);
        }

        // Thực thi một chu kỳ
        await this.executeCycle();

        // Từ vòng lặp thứ 2 trở đi mới chờ theo interval
        isFirstRun = false;
      } catch (err) {
        console.error(`\n❌ Lỗi trong chu kỳ: ${err.message}`);
        console.error(`   Chi tiết: ${err.stack}\n`);
        // Đợi 1 phút trước khi thử lại
        await sleep(60000);
      }
    }
  }

  /**
   * Đợi đến khi nến đóng cửa + 1 phút
   * Nếu không có intervalHours, chạy ngay
   * 
   * Logic: Tính thời điểm nến đóng cửa tiếp theo dựa trên intervalHours
   * Ví dụ: intervalHours = 4, nến đóng tại 0, 4, 8, 12, 16, 20 (UTC)
   * Hoặc có thể là 3, 7, 11, 15, 19, 23 tùy múi giờ
   */
  async waitForNextCandle(intervalHours) {
    if (!intervalHours) {
      console.log(`⚡ Chạy ngay lập tức (không có interval)\n`);
      return;
    }

    // Lấy một nến mẫu để xác định khung giờ đóng cửa
    try {
      const granularity = intervalHours * 3600; // Convert hours to seconds
      const sampleCandles = await this.api.getSpotCandles('BTCUSDT', granularity, 2);
      
      if (Array.isArray(sampleCandles) && sampleCandles.length > 0) {
        // Lấy nến đã đóng cửa gần nhất
        const now = Date.now();
        const intervalMs = granularity * 1000;
        let closedCandle = null;
        
        for (let i = sampleCandles.length - 1; i >= 0; i--) {
          const candle = sampleCandles[i];
          const candleTimestamp = parseInt(candle[0]);
          let candleOpenTime = candleTimestamp;
          if (candleOpenTime < 1e12) {
            candleOpenTime = candleOpenTime * 1000;
          }
          const candleCloseTime = candleOpenTime + intervalMs;
          
          if (candleCloseTime <= now) {
            closedCandle = candle;
            break;
          }
        }
        
        if (closedCandle) {
          const candleTimestamp = parseInt(closedCandle[0]);
          let candleOpenTime = candleTimestamp;
          if (candleOpenTime < 1e12) {
            candleOpenTime = candleOpenTime * 1000;
          }
          const candleCloseTime = candleOpenTime + intervalMs;
          
          // Tính thời điểm nến tiếp theo đóng cửa
          const nextCandleCloseTime = candleCloseTime + intervalMs;
          const nextCandleRunTime = nextCandleCloseTime + 60000; // +1 phút
          
          const waitTime = nextCandleRunTime - now;
          
          if (waitTime > 0) {
            const waitMinutes = Math.floor(waitTime / 60000);
            const waitSeconds = Math.floor((waitTime % 60000) / 1000);
            const nextRunDate = new Date(nextCandleRunTime);
            console.log(
              `⏳ Chờ đến khi nến đóng cửa: ${formatTimestamp(nextCandleRunTime)} (còn ${waitMinutes} phút ${waitSeconds} giây)\n`
            );
            await sleep(waitTime);
          } else {
            console.log(`⚡ Đã đến thời điểm chạy\n`);
          }
          return;
        }
      }
    } catch (err) {
      console.warn(`⚠️  Không thể lấy nến mẫu để tính timing: ${err.message}`);
      console.warn(`   Sử dụng logic tính toán mặc định\n`);
    }

    // Fallback: Tính toán dựa trên giờ hiện tại
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    // Tính các khung giờ đóng cửa (ví dụ: 0, 4, 8, 12, 16, 20 cho nến 4h)
    const candleHours = [];
    for (let h = 0; h < 24; h += intervalHours) {
      candleHours.push(h);
    }

    // Tìm khung giờ đóng cửa tiếp theo
    let nextCandleHour = null;
    let nextDay = 0;

    for (const hour of candleHours) {
      if (hour > currentHour || (hour === currentHour && currentMinute < 1)) {
        nextCandleHour = hour;
        break;
      }
    }

    // Nếu không tìm thấy trong ngày, lấy khung giờ đầu tiên của ngày hôm sau
    if (!nextCandleHour) {
      nextCandleHour = candleHours[0];
      nextDay = 1;
    }

    // Tính thời điểm đợi: nextCandleHour:01:00
    const nextCandleTime = new Date(now);
    nextCandleTime.setHours(nextCandleHour, 1, 0, 0); // 1 phút sau khi nến đóng
    if (nextDay > 0) {
      nextCandleTime.setDate(nextCandleTime.getDate() + nextDay);
    }

    const waitTime = nextCandleTime.getTime() - now.getTime();

    if (waitTime > 0) {
      const waitMinutes = Math.floor(waitTime / 60000);
      const waitSeconds = Math.floor((waitTime % 60000) / 1000);
      console.log(
        `⏳ Chờ đến khi nến đóng cửa: ${formatTimestamp(nextCandleTime.getTime())} (còn ${waitMinutes} phút ${waitSeconds} giây)\n`
      );
      await sleep(waitTime);
    } else {
      console.log(`⚡ Đã đến thời điểm chạy\n`);
    }
  }

  /**
   * Thực thi một chu kỳ rebalancing
   */
  async executeCycle() {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔄 BẮT ĐẦU CHU KỲ REBALANCING`);
    console.log(`${'='.repeat(60)}\n`);

    try {
      // 1. Lấy thông tin tài khoản
      console.log(`📡 Đang lấy thông tin tài khoản...`);
      const assets = await getSpotAccountInfo(this.api);
      const accountInfo = await calculateTotalAssets(this.api, assets);

      console.log(`💰 Tổng tài sản: ${formatNumber(parseFloat(accountInfo.totalUSDT), 2)} USDT\n`);

      // 2. Rebalance BGB (2-5%)
      try {
        await this.rebalanceBGB(accountInfo, assets);
      } catch (err) {
        console.error(`❌ Lỗi khi rebalance BGB: ${err.message}`);
        console.error(`   Chi tiết: ${err.stack}\n`);
        // Tiếp tục chạy các bước sau
      }

      // 3. Lấy lại thông tin tài khoản sau khi rebalance BGB
      let assetsAfterBGB;
      let accountInfoAfterBGB;
      try {
        assetsAfterBGB = await getSpotAccountInfo(this.api);
        accountInfoAfterBGB = await calculateTotalAssets(this.api, assetsAfterBGB);
      } catch (err) {
        console.error(`❌ Lỗi khi lấy thông tin tài khoản sau rebalance BGB: ${err.message}`);
        // Nếu không lấy được, sử dụng thông tin cũ
        assetsAfterBGB = assets;
        accountInfoAfterBGB = accountInfo;
      }

      // 4. Sử dụng USDT dư
      try {
        await this.useExcessUSDT(accountInfoAfterBGB);
      } catch (err) {
        console.error(`❌ Lỗi khi sử dụng USDT dư: ${err.message}`);
        console.error(`   Chi tiết: ${err.stack}\n`);
        // Tiếp tục chạy các bước sau
      }

      // 5. Lấy lại thông tin tài khoản sau khi sử dụng USDT dư
      let assetsAfterUSDT;
      let accountInfoAfterUSDT;
      try {
        assetsAfterUSDT = await getSpotAccountInfo(this.api);
        accountInfoAfterUSDT = await calculateTotalAssets(this.api, assetsAfterUSDT);
      } catch (err) {
        console.error(`❌ Lỗi khi lấy thông tin tài khoản sau sử dụng USDT: ${err.message}`);
        // Nếu không lấy được, sử dụng thông tin trước đó
        assetsAfterUSDT = assetsAfterBGB || assets;
        accountInfoAfterUSDT = accountInfoAfterBGB || accountInfo;
      }

      // 6. Trade BTC/PAXG dựa trên nến 4H (đã có try-catch bên trong)
      await this.tradeBTCAndPAXG(accountInfoAfterUSDT);

      console.log(`\n${'='.repeat(60)}`);
      console.log(`✅ HOÀN TẤT CHU KỲ REBALANCING`);
      console.log(`${'='.repeat(60)}\n`);
    } catch (err) {
      console.error(`❌ Lỗi không mong đợi trong executeCycle: ${err.message}`);
      console.error(`   Chi tiết: ${err.stack}\n`);
      throw err;
    }
  }

  /**
   * Rebalance BGB: giữ trong khoảng 2-5%
   */
  async rebalanceBGB(accountInfo, assets) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`📊 REBALANCE BGB`);
    console.log(`${'─'.repeat(60)}`);

    const bgbHolding = accountInfo.holdings.find((h) => h.coin === 'BGB');
    const totalUSDT = parseFloat(accountInfo.totalUSDT || '0');

    if (!bgbHolding) {
      console.log(`   ℹ️  Không có BGB trong danh mục\n`);
      return;
    }

    const valueBGB = parseFloat(bgbHolding.valueUSDT || '0');
    const currentBGBPercent = totalUSDT > 0 ? (valueBGB / totalUSDT) * 100 : 0;

    console.log(`   BGB hiện tại: ${formatNumber(valueBGB, 2)} USDT (${currentBGBPercent.toFixed(2)}%)`);
    console.log(`   Target: ${this.config.bgbMinPercent}% - ${this.config.bgbMaxPercent}%\n`);

    // Nếu BGB > 5%, bán phần dư và chia vào PAXG/BTC
    if (currentBGBPercent > this.config.bgbMaxPercent) {
      const targetValue = totalUSDT * (this.config.bgbMaxPercent / 100);
      const excessValue = valueBGB - targetValue;

      if (excessValue >= this.config.minOrderValue) {
        console.log(`   ⚠️  BGB vượt quá ${this.config.bgbMaxPercent}%, cần bán ${formatNumber(excessValue, 2)} USDT\n`);

        const bgbPrice = parseFloat(bgbHolding.price || '0');
        if (bgbPrice <= 0) {
          throw new Error('Không thể lấy giá BGB');
        }

        const bgbToSell = excessValue / bgbPrice;
        const availableBGB = parseFloat(bgbHolding.available || '0');

        if (bgbToSell > availableBGB) {
          console.log(`   ⚠️  Số dư khả dụng không đủ, chỉ bán ${formatNumber(availableBGB, 8)} BGB\n`);
          // Bán tất cả BGB khả dụng
          const actualExcessValue = availableBGB * bgbPrice;
          if (actualExcessValue >= this.config.minOrderValue) {
            await this.sellCoin('BGB', availableBGB);
            await sleep(2000);
            // Chia đều vào PAXG và BTC
            if (actualExcessValue >= 2) {
              const halfUSDT = actualExcessValue / 2;
              if (halfUSDT >= this.config.minOrderValue) {
                await this.buyCoin('PAXG', halfUSDT);
                await sleep(2000);
                await this.buyCoin('BTC', halfUSDT);
                await sleep(2000);
              }
            }
          }
        } else {
          await this.sellCoin('BGB', bgbToSell);
          await sleep(2000);
          // Chia đều vào PAXG và BTC
          if (excessValue >= 2) {
            const halfUSDT = excessValue / 2;
            if (halfUSDT >= this.config.minOrderValue) {
              await this.buyCoin('PAXG', halfUSDT);
              await sleep(2000);
              await this.buyCoin('BTC', halfUSDT);
              await sleep(2000);
            }
          }
        }
      } else {
        console.log(`   ℹ️  Giá trị dư quá nhỏ (${formatNumber(excessValue, 2)} USDT < ${this.config.minOrderValue} USDT), bỏ qua\n`);
      }
    }
    // Nếu BGB < 2%, bán BTC hoặc PAXG (ưu tiên tỉ trọng cao nhất) để mua BGB
    else if (currentBGBPercent < this.config.bgbMinPercent) {
      const targetValue = totalUSDT * (this.config.bgbMinPercent / 100);
      const neededValue = targetValue - valueBGB;

      if (neededValue >= this.config.minOrderValue) {
        console.log(`   ⚠️  BGB thấp hơn ${this.config.bgbMinPercent}%, cần mua thêm ${formatNumber(neededValue, 2)} USDT\n`);

        // Tìm coin có tỉ trọng cao nhất (BTC hoặc PAXG)
        const btcHolding = accountInfo.holdings.find((h) => h.coin === 'BTC');
        const paxgHolding = accountInfo.holdings.find((h) => h.coin === 'PAXG');

        const valueBTC = btcHolding ? parseFloat(btcHolding.valueUSDT || '0') : 0;
        const valuePAXG = paxgHolding ? parseFloat(paxgHolding.valueUSDT || '0') : 0;

        if (valueBTC > valuePAXG && btcHolding) {
          // Bán BTC
          const btcPrice = parseFloat(btcHolding.price || '0');
          if (btcPrice <= 0) {
            throw new Error('Không thể lấy giá BTC');
          }
          const btcToSell = neededValue / btcPrice;
          const availableBTC = parseFloat(btcHolding.available || '0');
          const actualSellValue = Math.min(btcToSell, availableBTC) * btcPrice;

          if (actualSellValue >= this.config.minOrderValue) {
            const actualBTCToSell = Math.min(btcToSell, availableBTC);
            await this.sellCoin('BTC', actualBTCToSell);
            await sleep(2000);
            await this.buyCoin('BGB', actualSellValue);
            await sleep(2000);
          } else {
            console.log(`   ⚠️  Giá trị bán BTC quá nhỏ (${formatNumber(actualSellValue, 2)} USDT < ${this.config.minOrderValue} USDT), bỏ qua\n`);
          }
        } else if (paxgHolding) {
          // Bán PAXG
          const paxgPrice = parseFloat(paxgHolding.price || '0');
          if (paxgPrice <= 0) {
            throw new Error('Không thể lấy giá PAXG');
          }
          const paxgToSell = neededValue / paxgPrice;
          const availablePAXG = parseFloat(paxgHolding.available || '0');
          const actualSellValue = Math.min(paxgToSell, availablePAXG) * paxgPrice;

          if (actualSellValue >= this.config.minOrderValue) {
            const actualPAXGToSell = Math.min(paxgToSell, availablePAXG);
            await this.sellCoin('PAXG', actualPAXGToSell);
            await sleep(2000);
            await this.buyCoin('BGB', actualSellValue);
            await sleep(2000);
          } else {
            console.log(`   ⚠️  Giá trị bán PAXG quá nhỏ (${formatNumber(actualSellValue, 2)} USDT < ${this.config.minOrderValue} USDT), bỏ qua\n`);
          }
        } else {
          console.log(`   ⚠️  Không có BTC hoặc PAXG để bán\n`);
        }
      } else {
        console.log(`   ℹ️  Giá trị cần mua quá nhỏ (${formatNumber(neededValue, 2)} USDT < ${this.config.minOrderValue} USDT), bỏ qua\n`);
      }
    } else {
      console.log(`   ✅ BGB trong khoảng hợp lệ (${currentBGBPercent.toFixed(2)}%)\n`);
    }
  }

  /**
   * Sử dụng USDT dư: chia đều vào BTC và PAXG
   */
  async useExcessUSDT(accountInfo) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`💰 SỬ DỤNG USDT DƯ`);
    console.log(`${'─'.repeat(60)}`);

    const usdtHolding = accountInfo.holdings.find((h) => h.coin === 'USDT');
    if (!usdtHolding) {
      console.log(`   ℹ️  Không có USDT trong danh mục\n`);
      return;
    }

    const availableUSDT = parseFloat(usdtHolding.available || '0');
    console.log(`   USDT khả dụng: ${formatNumber(availableUSDT, 2)} USDT\n`);

    // Nếu USDT dư >= 2 USDT, chia đều vào BTC và PAXG
    if (availableUSDT >= 2) {
      const halfUSDT = availableUSDT / 2;
      if (halfUSDT >= this.config.minOrderValue) {
        console.log(`   💸 Chia đều ${formatNumber(availableUSDT, 2)} USDT vào BTC và PAXG (mỗi coin ${formatNumber(halfUSDT, 2)} USDT)\n`);
        await this.buyCoin('BTC', halfUSDT);
        await sleep(2000);
        await this.buyCoin('PAXG', halfUSDT);
        await sleep(2000);
      } else {
        console.log(`   ℹ️  Mỗi phần chia đều (${formatNumber(halfUSDT, 2)} USDT) nhỏ hơn ${this.config.minOrderValue} USDT, bỏ qua\n`);
      }
    } else {
      console.log(`   ℹ️  USDT dư (${formatNumber(availableUSDT, 2)} USDT) < 2 USDT, không đủ để chia đều, bỏ qua\n`);
    }
  }

  /**
   * Trade BTC/PAXG dựa trên nến 4H đóng cửa
   */
  async tradeBTCAndPAXG(accountInfo) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`📈 TRADE BTC/PAXG DỰA TRÊN NẾN 4H`);
    console.log(`${'─'.repeat(60)}`);

    try {
      // Lấy nến 4H đóng cửa gần nhất cho BTC và PAXG
      const granularity = 14400; // 4 giờ = 14400 giây
      const limit = 2; // Lấy 2 nến để tìm nến đã đóng cửa

      const [btcCandles, paxgCandles] = await Promise.all([
        this.api.getSpotCandles('BTCUSDT', granularity, limit),
        this.api.getSpotCandles('PAXGUSDT', granularity, limit),
      ]);

      // Tìm nến đã đóng cửa gần nhất
      const now = Date.now();
      const intervalMs = granularity * 1000;

      const getClosedCandle = (candles) => {
        for (let i = candles.length - 1; i >= 0; i--) {
          const candle = candles[i];
          const candleTimestamp = parseInt(candle[0]);
          let candleOpenTime = candleTimestamp;
          if (candleOpenTime < 1e12) {
            candleOpenTime = candleOpenTime * 1000;
          }
          const candleCloseTime = candleOpenTime + intervalMs;
          if (candleCloseTime <= now) {
            return parseCandleData(candle, '');
          }
        }
        return null;
      };

      const btcCandle = getClosedCandle(btcCandles);
      const paxgCandle = getClosedCandle(paxgCandles);

      if (!btcCandle || !paxgCandle) {
        console.log(`   ⚠️  Không tìm thấy nến đã đóng cửa cho BTC hoặc PAXG\n`);
        return;
      }

      const btcChange = Math.abs(parseFloat(btcCandle.changePercent));
      const paxgChange = Math.abs(parseFloat(paxgCandle.changePercent));
      const btcChangePercent = parseFloat(btcCandle.changePercent);
      const paxgChangePercent = parseFloat(paxgCandle.changePercent);
      const divergence = Math.abs(btcChangePercent - paxgChangePercent); // Chênh lệch tuyệt đối giữa 2 coin

      console.log(`   BTC: ${btcChangePercent >= 0 ? '🟢' : '🔴'} ${btcChangePercent.toFixed(2)}% (biến động: ${btcChange.toFixed(2)}%)`);
      console.log(`   PAXG: ${paxgChangePercent >= 0 ? '🟢' : '🔴'} ${paxgChangePercent.toFixed(2)}% (biến động: ${paxgChange.toFixed(2)}%)`);
      console.log(`   Chênh lệch: ${divergence.toFixed(2)}%\n`);

      // Kiểm tra điều kiện: có 1 xanh 1 đỏ và chênh lệch >= 0.5%
      const hasOneGreenOneRed = (btcChangePercent > 0 && paxgChangePercent < 0) || (btcChangePercent < 0 && paxgChangePercent > 0);
      
      if (hasOneGreenOneRed && divergence >= this.config.minDivergencePercent) {
        if (btcChangePercent > 0 && paxgChangePercent < 0) {
          // BTC xanh, PAXG đỏ -> bán 1/10 BTC, mua PAXG
          console.log(`   ✅ Điều kiện đạt: BTC xanh, PAXG đỏ (chênh lệch: ${divergence.toFixed(2)}%)\n`);
          await this.executeTrade('BTC', 'PAXG', accountInfo);
        } else if (btcChangePercent < 0 && paxgChangePercent > 0) {
          // PAXG xanh, BTC đỏ -> bán 1/10 PAXG, mua BTC
          console.log(`   ✅ Điều kiện đạt: PAXG xanh, BTC đỏ (chênh lệch: ${divergence.toFixed(2)}%)\n`);
          await this.executeTrade('PAXG', 'BTC', accountInfo);
        }
      } else {
        if (!hasOneGreenOneRed) {
          console.log(`   ℹ️  Cả 2 coin cùng màu, bỏ qua\n`);
        } else {
          console.log(`   ℹ️  Chênh lệch không đủ (${divergence.toFixed(2)}% < ${this.config.minDivergencePercent}%), bỏ qua\n`);
        }
      }
    } catch (err) {
      console.error(`   ❌ Lỗi khi trade BTC/PAXG: ${err.message}\n`);
    }
  }

  /**
   * Thực thi trade: bán 1/10 coin xanh, mua coin đỏ
   */
  async executeTrade(sellCoin, buyCoin, accountInfo) {
    const sellHolding = accountInfo.holdings.find((h) => h.coin === sellCoin);
    if (!sellHolding) {
      console.log(`   ⚠️  Không có ${sellCoin} trong danh mục\n`);
      return;
    }

    const totalAmount = parseFloat(sellHolding.total || '0');
    const availableAmount = parseFloat(sellHolding.available || '0');
    const sellPrice = parseFloat(sellHolding.price || '0');

    if (totalAmount <= 0 || sellPrice <= 0) {
      console.log(`   ⚠️  Không đủ ${sellCoin} để bán\n`);
      return;
    }

    // Bán 1/10 số lượng
    const sellAmount = totalAmount / 10;
    const sellValue = sellAmount * sellPrice;

    console.log(`   📊 Thông tin trade:`);
    console.log(`      - ${sellCoin} hiện có: ${formatNumber(totalAmount, 8)}`);
    console.log(`      - Sẽ bán: ${formatNumber(sellAmount, 8)} ${sellCoin} (1/10)`);
    console.log(`      - Giá trị: ${formatNumber(sellValue, 2)} USDT\n`);

    if (sellValue < this.config.minOrderValue) {
      console.log(`   ⚠️  Giá trị bán (${formatNumber(sellValue, 2)} USDT) < ${this.config.minOrderValue} USDT, bỏ qua\n`);
      return;
    }

    if (sellAmount > availableAmount) {
      console.log(`   ⚠️  Số dư khả dụng không đủ, chỉ bán ${formatNumber(availableAmount, 8)} ${sellCoin}\n`);
      const actualSellValue = availableAmount * sellPrice;
      if (actualSellValue >= this.config.minOrderValue) {
        // Lấy số dư USDT trước khi bán
        const assetsBeforeSell = await getSpotAccountInfo(this.api);
        const usdtBeforeSell = assetsBeforeSell.find((asset) => {
          const coin = asset.coin || asset.currency || asset.asset;
          return coin === 'USDT';
        });
        const usdtInitial = parseFloat(usdtBeforeSell?.available || usdtBeforeSell?.total || 0);

        await this.sellCoin(sellCoin, availableAmount);
        await sleep(3000); // Đợi lệnh fill hoàn toàn

        // Lấy lại số dư USDT thực tế sau khi bán
        const assetsAfterSell = await getSpotAccountInfo(this.api);
        const usdtAfterSell = assetsAfterSell.find((asset) => {
          const coin = asset.coin || asset.currency || asset.asset;
          return coin === 'USDT';
        });
        const usdtAvailable = parseFloat(usdtAfterSell?.available || usdtAfterSell?.total || 0);
        const usdtReceived = usdtAvailable - usdtInitial;

        if (usdtReceived > 0 && usdtReceived >= this.config.minOrderValue) {
          // Sử dụng 99% số USDT nhận được để tránh lỗi do làm tròn
          const usdtToUse = usdtReceived * 0.99;
          console.log(`   💰 USDT nhận được: ${formatNumber(usdtReceived, 2)} USDT (sẽ dùng ${formatNumber(usdtToUse, 2)} USDT)\n`);
          await this.buyCoin(buyCoin, usdtToUse);
          await sleep(2000);
        } else {
          console.log(`   ⚠️  USDT nhận được (${formatNumber(usdtReceived, 2)} USDT) không đủ để mua, bỏ qua\n`);
        }
      }
    } else {
      // Lấy số dư USDT trước khi bán
      const assetsBeforeSell = await getSpotAccountInfo(this.api);
      const usdtBeforeSell = assetsBeforeSell.find((asset) => {
        const coin = asset.coin || asset.currency || asset.asset;
        return coin === 'USDT';
      });
      const usdtInitial = parseFloat(usdtBeforeSell?.available || usdtBeforeSell?.total || 0);

      await this.sellCoin(sellCoin, sellAmount);
      await sleep(3000); // Đợi lệnh fill hoàn toàn

      // Lấy lại số dư USDT thực tế sau khi bán
      const assetsAfterSell = await getSpotAccountInfo(this.api);
      const usdtAfterSell = assetsAfterSell.find((asset) => {
        const coin = asset.coin || asset.currency || asset.asset;
        return coin === 'USDT';
      });
      const usdtAvailable = parseFloat(usdtAfterSell?.available || usdtAfterSell?.total || 0);
      const usdtReceived = usdtAvailable - usdtInitial;

      if (usdtReceived > 0 && usdtReceived >= this.config.minOrderValue) {
        // Sử dụng 99% số USDT nhận được để tránh lỗi do làm tròn
        const usdtToUse = usdtReceived * 0.99;
        console.log(`   💰 USDT nhận được: ${formatNumber(usdtReceived, 2)} USDT (sẽ dùng ${formatNumber(usdtToUse, 2)} USDT)\n`);
        await this.buyCoin(buyCoin, usdtToUse);
        await sleep(2000);
      } else {
        console.log(`   ⚠️  USDT nhận được (${formatNumber(usdtReceived, 2)} USDT) không đủ để mua, bỏ qua\n`);
      }
    }
  }

  /**
   * Bán coin bằng lệnh market
   */
  async sellCoin(coin, amount) {
    try {
      const symbol = `${coin}USDT`;
      let roundedAmount;

      // Làm tròn theo coin (BGB: 4, BTC: 6, PAXG: 4)
      // Bitget API yêu cầu BTC chỉ 6 chữ số thập phân
      if (coin === 'BGB') {
        roundedAmount = roundToScale(amount, 4);
      } else if (coin === 'BTC') {
        roundedAmount = roundToScale(amount, 6);
      } else if (coin === 'PAXG') {
        roundedAmount = roundToScale(amount, 4);
      } else {
        roundedAmount = roundToScale(amount, 4); // Default
      }

      console.log(`   📤 Bán ${formatNumber(roundedAmount, 8)} ${coin}...`);
      const result = await this.api.placeSpotOrder({
        symbol,
        side: 'sell',
        orderType: 'market',
        size: roundedAmount.toString(),
      });
      console.log(`   ✅ Đã đặt lệnh bán ${coin}\n`);
      return result;
    } catch (err) {
      throw new Error(`Lỗi khi bán ${coin}: ${err.message}`);
    }
  }

  /**
   * Mua coin bằng lệnh market với số USDT có
   */
  async buyCoin(coin, usdtAmount) {
    try {
      const symbol = `${coin}USDT`;
      const roundedUSDT = roundToScale(usdtAmount, 2);

      // Validate giá trị tối thiểu
      if (roundedUSDT < this.config.minOrderValue) {
        throw new Error(`Giá trị mua (${roundedUSDT} USDT) < ${this.config.minOrderValue} USDT`);
      }

      console.log(`   📥 Mua ${coin} với ${formatNumber(roundedUSDT, 2)} USDT...`);
      const result = await this.api.placeSpotOrder({
        symbol,
        side: 'buy',
        orderType: 'market',
        size: roundedUSDT.toString(),
      });
      console.log(`   ✅ Đã đặt lệnh mua ${coin}\n`);
      return result;
    } catch (err) {
      throw new Error(`Lỗi khi mua ${coin}: ${err.message}`);
    }
  }
}

module.exports = { RebalanceSpotBot };
