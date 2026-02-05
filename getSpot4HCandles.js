const { BitgetApi } = require('./bitgetApi');

/**
 * Script để lấy giá spot BTC và PAXG từ nến 4h gần nhất
 * Usage: node getSpot4HCandles.js
 */

/**
 * Parse dữ liệu nến và tính toán các metrics
 * Format Bitget: [timestamp, open, high, low, close, volume]
 */
function parseCandleData(candle, symbol) {
  if (!Array.isArray(candle) || candle.length < 6) {
    throw new Error(`Dữ liệu nến không hợp lệ cho ${symbol}`);
  }

  const timestamp = parseInt(candle[0]);
  const open = parseFloat(candle[1]);
  const high = parseFloat(candle[2]);
  const low = parseFloat(candle[3]);
  const close = parseFloat(candle[4]);
  const volume = parseFloat(candle[5]);

  // Validate dữ liệu
  if (isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close) || isNaN(volume)) {
    throw new Error(`Dữ liệu nến chứa giá trị không hợp lệ cho ${symbol}`);
  }

  // Tính toán các metrics
  const changeAmount = close - open;
  const changePercent = ((changeAmount / open) * 100).toFixed(2);
  const range = high - low;
  const rangePercent = ((range / open) * 100).toFixed(2);

  return {
    symbol,
    timestamp,
    open,
    high,
    low,
    close,
    volume,
    changeAmount,
    changePercent,
    range,
    rangePercent,
  };
}

/**
 * Format timestamp thành chuỗi dễ đọc
 * Bitget API trả về timestamp dạng string, có thể là milliseconds hoặc seconds
 */
function formatTimestamp(timestamp) {
  // Convert string to number
  let ts = typeof timestamp === 'string' ? parseInt(timestamp) : timestamp;
  
  // Nếu timestamp < 1e12 (nhỏ hơn năm 2001), có thể là seconds, cần convert sang milliseconds
  if (ts < 1e12) {
    ts = ts * 1000;
  }
  
  const date = new Date(ts);
  return date.toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Format số với dấu phẩy phân cách hàng nghìn
 */
function formatNumber(num, decimals = 2) {
  return num.toLocaleString('vi-VN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Hiển thị thông tin nến
 */
function displayCandleInfo(data) {
  const symbolDisplay = data.symbol.replace('USDT', '/USDT');
  const changeSign = parseFloat(data.changePercent) >= 0 ? '+' : '';
  const changeColor = parseFloat(data.changePercent) >= 0 ? '🟢' : '🔴';

  console.log(`\n${'='.repeat(50)}`);
  console.log(`📊 ${symbolDisplay} - Nến 4H Gần Nhất`);
  console.log(`${'='.repeat(50)}`);
  console.log(`⏰ Thời gian đóng: ${formatTimestamp(data.timestamp)}`);
  console.log(`\n💰 Giá:`);
  console.log(`   Mở:  ${formatNumber(data.open, 2)}`);
  console.log(`   Cao: ${formatNumber(data.high, 2)}`);
  console.log(`   Thấp: ${formatNumber(data.low, 2)}`);
  console.log(`   Đóng: ${formatNumber(data.close, 2)}`);
  console.log(`\n📈 Biến động:`);
  console.log(`   ${changeColor} ${changeSign}${data.changePercent}% (${changeSign}${formatNumber(data.changeAmount, 2)})`);
  console.log(`\n📊 Range (Cao - Thấp):`);
  console.log(`   ${data.rangePercent}% (${formatNumber(data.range, 2)})`);
  console.log(`\n💹 Volume: ${formatNumber(data.volume, 2)}`);
  console.log(`${'='.repeat(50)}\n`);
}

/**
 * Lấy giá hiện tại cho một coin từ candles API (thay vì ticker vì ticker API có vấn đề)
 */
async function getCoinPrice(api, coin) {
  if (coin === 'USDT') {
    return 1; // USDT luôn = 1
  }
  
  try {
    const symbol = `${coin}USDT`;
    // Sử dụng candles API để lấy giá close của nến gần nhất (1 phút)
    // Vì ticker API trả về 40404, candles API đã được chứng minh hoạt động tốt
    const candles = await api.getSpotCandles(symbol, 60, 1); // 60 giây = 1 phút, lấy 1 nến
    
    if (Array.isArray(candles) && candles.length > 0) {
      // Lấy nến gần nhất (phần tử cuối cùng)
      const latestCandle = candles[candles.length - 1];
      // Format: [timestamp, open, high, low, close, volume]
      const price = parseFloat(latestCandle[4]); // close price
      return price > 0 ? price : 0;
    }
    
    return 0;
  } catch (err) {
    console.warn(`⚠️  Không thể lấy giá cho ${coin}: ${err.message}`);
    return 0;
  }
}

/**
 * Lấy thông tin tài khoản spot
 */
async function getSpotAccountInfo(api) {
  try {
    const assets = await api.getSpotAssets();
    return assets || [];
  } catch (err) {
    throw new Error(`Không thể lấy thông tin tài khoản spot: ${err.message}`);
  }
}

/**
 * Tính tổng tài sản và lấy giá cho các coin
 * Giữ nguyên giá trị gốc từ API, không làm tròn
 * Chỉ tính tổng từ USDT + BTC + PAXG + BGB
 */
async function calculateTotalAssets(api, assets) {
  const holdings = [];
  const importantCoins = ['USDT', 'BTC', 'PAXG', 'BGB']; // Chỉ tính tổng từ các coin này
  const skipCoins = ['EDU', 'PHY']; // Bỏ qua các coin không có trading pair USDT
  let totalUSDT = 0;
  
  // Lọc các coin có số dư > 0 - giữ nguyên giá trị gốc
  const coinsWithBalance = assets.filter(asset => {
    const total = asset.total || asset.available || '0';
    return parseFloat(total) > 0;
  });
  
  // Lấy giá cho từng coin
  for (const asset of coinsWithBalance) {
    const coin = asset.coin || asset.currency || asset.asset;
    
    // Bỏ qua các coin không có trading pair USDT
    if (skipCoins.includes(coin)) {
      continue;
    }
    
    // Giữ nguyên giá trị gốc từ API (string)
    const total = (asset.total || asset.available || '0').toString();
    const available = (asset.available || '0').toString();
    const frozen = (asset.frozen || asset.locked || '0').toString();
    
    let price = 0;
    let valueUSDT = '0';
    
    if (coin === 'USDT') {
      price = 1;
      valueUSDT = total; // Giữ nguyên string
    } else {
      price = await getCoinPrice(api, coin);
      
      // Nếu lấy giá thất bại (price = 0) và là coin quan trọng (BGB, BTC, PAXG), thử lại 1 lần
      if (price === 0 && importantCoins.includes(coin)) {
        console.log(`   ⚠️  Lần đầu không lấy được giá ${coin}, thử lại...`);
        await sleep(1000); // Đợi 1 giây trước khi thử lại
        price = await getCoinPrice(api, coin);
        if (price > 0) {
          console.log(`   ✅ Đã lấy được giá ${coin} sau lần thử lại: ${price.toFixed(2)} USDT`);
        }
      }
      
      // Tính valueUSDT nhưng giữ nguyên precision
      const totalNum = parseFloat(total);
      const valueNum = totalNum * price;
      valueUSDT = valueNum.toString(); // Convert sang string để giữ precision
    }
    
    // Chỉ tính vào tổng nếu là coin quan trọng
    const isImportantCoin = importantCoins.includes(coin);
    if (isImportantCoin) {
      totalUSDT += parseFloat(valueUSDT);
    }
    
    holdings.push({
      coin,
      total, // Giữ nguyên string từ API
      available, // Giữ nguyên string từ API
      frozen, // Giữ nguyên string từ API
      price: price.toString(), // Convert sang string
      valueUSDT, // String để giữ precision
      isImportantCoin, // Đánh dấu coin quan trọng
      raw: asset, // Lưu toàn bộ object gốc
    });
  }
  
  // Sắp xếp: coin quan trọng trước, sau đó theo giá trị USDT giảm dần
  holdings.sort((a, b) => {
    if (a.isImportantCoin && !b.isImportantCoin) return -1;
    if (!a.isImportantCoin && b.isImportantCoin) return 1;
    return parseFloat(b.valueUSDT) - parseFloat(a.valueUSDT);
  });
  
  return {
    holdings,
    totalUSDT: totalUSDT.toString(), // Convert sang string để giữ precision
    importantCoins, // Trả về danh sách coin quan trọng
  };
}

/**
 * Hiển thị thông tin tài khoản spot
 * Hiển thị giá trị gốc từ API, không làm tròn
 * Hiển thị phần trăm cho các coin quan trọng (USDT, BTC, PAXG, BGB)
 */
function displaySpotAccountInfo(accountInfo) {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`💼 Tài Khoản Spot`);
  console.log(`${'='.repeat(50)}`);
  // Hiển thị tổng tài sản (chỉ tính từ USDT + BTC + PAXG + BGB)
  const totalUSDTNum = parseFloat(accountInfo.totalUSDT || '0');
  console.log(`💰 Tổng tài sản (USDT + BTC + PAXG + BGB): ${displayRawNumber(accountInfo.totalUSDT)} USDT\n`);
  
  if (accountInfo.holdings.length === 0) {
    console.log('   Không có coin nào trong tài khoản.\n');
    console.log(`${'='.repeat(50)}\n`);
    return;
  }
  
  // Phân loại coin quan trọng và coin khác
  const importantHoldings = accountInfo.holdings.filter(h => h.isImportantCoin);
  const otherHoldings = accountInfo.holdings.filter(h => !h.isImportantCoin);
  
  // Hiển thị coin quan trọng với phần trăm
  if (importantHoldings.length > 0) {
    console.log('📊 Danh mục coin (tính vào tổng tài sản):\n');
    
    for (const holding of importantHoldings) {
      const coinDisplay = holding.coin.padEnd(8);
      // Hiển thị giá trị gốc, không làm tròn
      const amountStr = displayRawNumber(holding.total);
      const valueStr = displayRawNumber(holding.valueUSDT);
      
      // Tính phần trăm
      const valueNum = parseFloat(holding.valueUSDT || '0');
      const percentage = totalUSDTNum > 0 ? (valueNum / totalUSDTNum * 100) : 0;
      const percentageStr = percentage.toFixed(2);
      
      if (holding.coin === 'USDT') {
        console.log(`   ${coinDisplay}: ${amountStr} USDT = ${valueStr} USDT (${percentageStr}%)`);
      } else {
        const priceStr = displayRawNumber(holding.price);
        const frozenStr = parseFloat(holding.frozen || '0') > 0 ? ` (đóng băng: ${displayRawNumber(holding.frozen)})` : '';
        console.log(`   ${coinDisplay}: ${amountStr} ${holding.coin} = ${valueStr} USDT (${percentageStr}%) | giá: ${priceStr} USDT${frozenStr}`);
      }
    }
  }
  
  // Hiển thị coin khác (không tính vào tổng)
  if (otherHoldings.length > 0) {
    console.log(`\n📋 Các coin khác (không tính vào tổng tài sản):\n`);
    
    for (const holding of otherHoldings) {
      const coinDisplay = holding.coin.padEnd(8);
      // Hiển thị giá trị gốc, không làm tròn
      const amountStr = displayRawNumber(holding.total);
      const valueStr = displayRawNumber(holding.valueUSDT);
      
      if (holding.coin === 'USDT') {
        console.log(`   ${coinDisplay}: ${amountStr} USDT = ${valueStr} USDT`);
      } else {
        const priceStr = displayRawNumber(holding.price);
        const frozenStr = parseFloat(holding.frozen || '0') > 0 ? ` (đóng băng: ${displayRawNumber(holding.frozen)})` : '';
        console.log(`   ${coinDisplay}: ${amountStr} ${holding.coin} = ${valueStr} USDT | giá: ${priceStr} USDT${frozenStr}`);
      }
    }
  }
  
  console.log(`\n${'='.repeat(50)}\n`);
}

/**
 * Sleep helper function
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Làm tròn số lượng theo scale (số chữ số thập phân)
 */
function roundToScale(value, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.floor(value * factor) / factor;
}

/**
 * Bán BGB bằng lệnh market
 */
async function sellBGB(api, bgbAmount) {
  try {
    // Làm tròn BGB xuống 4 chữ số thập phân (theo yêu cầu API)
    const roundedBGB = roundToScale(bgbAmount, 4);
    
    console.log(`\n📤 Đang bán ${formatNumber(roundedBGB, 4)} BGB bằng lệnh market...`);
    console.log(`   (Số lượng gốc: ${formatNumber(bgbAmount, 8)}, đã làm tròn xuống 4 chữ số)`);
    
    const result = await api.placeSpotOrder({
      symbol: 'BGBUSDT',
      side: 'sell',
      orderType: 'market',
      size: roundedBGB.toString(),
    });
    
    console.log(`✅ Lệnh bán BGB đã được đặt:`, result);
    
    // Đợi một chút để lệnh fill
    await sleep(2000);
    
    return result;
  } catch (err) {
    throw new Error(`Lỗi khi bán BGB: ${err.message}`);
  }
}

/**
 * Mua PAXG bằng lệnh market với số USDT có
 */
async function buyPAXG(api, usdtAmount) {
  try {
    // Làm tròn USDT xuống 2 chữ số thập phân (chuẩn cho USDT)
    const roundedUSDT = roundToScale(usdtAmount, 2);
    
    console.log(`\n📥 Đang mua PAXG với ${formatNumber(roundedUSDT, 2)} USDT bằng lệnh market...`);
    console.log(`   (Số lượng gốc: ${formatNumber(usdtAmount, 2)}, đã làm tròn xuống 2 chữ số)`);
    
    const result = await api.placeSpotOrder({
      symbol: 'PAXGUSDT',
      side: 'buy',
      orderType: 'market',
      size: roundedUSDT.toString(), // Số lượng USDT muốn dùng
    });
    
    console.log(`✅ Lệnh mua PAXG đã được đặt:`, result);
    
    // Đợi một chút để lệnh fill
    await sleep(2000);
    
    return result;
  } catch (err) {
    throw new Error(`Lỗi khi mua PAXG: ${err.message}`);
  }
}

/**
 * Thực thi logic test trading
 */
async function executeTestTrading(api, assets) {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`🧪 BẮT ĐẦU TEST TRADING`);
  console.log(`${'='.repeat(50)}\n`);
  
  // Tìm BGB trong danh mục
  const bgbAsset = assets.find(asset => {
    const coin = asset.coin || asset.currency || asset.asset;
    return coin === 'BGB';
  });
  
  if (!bgbAsset) {
    throw new Error('Không tìm thấy BGB trong danh mục');
  }
  
  const totalBGB = parseFloat(bgbAsset.total || bgbAsset.available || 0);
  const availableBGB = parseFloat(bgbAsset.available || 0);
  
  if (totalBGB <= 0) {
    throw new Error('Số dư BGB không đủ để bán');
  }
  
  // Tính 1/10 số lượng BGB
  const bgbToSell = totalBGB / 10;
  
  if (bgbToSell > availableBGB) {
    throw new Error(`Số dư khả dụng BGB (${formatNumber(availableBGB, 8)}) không đủ để bán ${formatNumber(bgbToSell, 8)}`);
  }
  
  console.log(`📊 Thông tin trước khi trading:`);
  console.log(`   - Tổng BGB: ${formatNumber(totalBGB, 8)}`);
  console.log(`   - BGB khả dụng: ${formatNumber(availableBGB, 8)}`);
  console.log(`   - Sẽ bán: ${formatNumber(bgbToSell, 8)} BGB (1/10 tổng số)`);
  
  // Lấy giá BGB để ước tính số USDT sẽ nhận được
  const bgbPrice = await getCoinPrice(api, 'BGB');
  if (bgbPrice > 0) {
    const estimatedUSDT = bgbToSell * bgbPrice;
    console.log(`   - Giá BGB hiện tại: ${formatNumber(bgbPrice, 4)} USDT`);
    console.log(`   - Ước tính nhận được: ~${formatNumber(estimatedUSDT, 2)} USDT`);
  }
  
  // Bước 1: Bán BGB
  console.log(`\n${'─'.repeat(50)}`);
  const sellResult = await sellBGB(api, bgbToSell);
  
  // Lấy số USDT thực tế nhận được (có thể từ order result hoặc lấy lại balance)
  await sleep(3000); // Đợi lệnh fill hoàn toàn
  
  // Lấy lại balance để biết số USDT thực tế
  const assetsAfterSell = await getSpotAccountInfo(api);
  const usdtAfterSell = assetsAfterSell.find(asset => {
    const coin = asset.coin || asset.currency || asset.asset;
    return coin === 'USDT';
  });
  
  const usdtBeforeBuy = parseFloat(usdtAfterSell?.available || usdtAfterSell?.total || 0);
  
  // Tính số USDT vừa nhận được (so với số USDT ban đầu)
  // Lấy số USDT ban đầu từ assets đầu vào
  const usdtBeforeSell = assets.find(asset => {
    const coin = asset.coin || asset.currency || asset.asset;
    return coin === 'USDT';
  });
  const usdtInitial = parseFloat(usdtBeforeSell?.available || usdtBeforeSell?.total || 0);
  const usdtReceived = usdtBeforeBuy - usdtInitial;
  
  console.log(`\n💰 Số USDT nhận được sau khi bán: ${formatNumber(usdtReceived, 2)} USDT`);
  console.log(`   (USDT trước: ${formatNumber(usdtInitial, 2)}, USDT sau: ${formatNumber(usdtBeforeBuy, 2)})`);
  
  if (usdtReceived <= 0) {
    throw new Error('Không nhận được USDT sau khi bán BGB');
  }
  
  // Bước 2: Mua PAXG với số USDT vừa nhận được
  console.log(`\n${'─'.repeat(50)}`);
  const buyResult = await buyPAXG(api, usdtReceived);
  
  // Đợi lệnh fill
  await sleep(3000);
  
  console.log(`\n${'='.repeat(50)}`);
  console.log(`✅ TEST TRADING HOÀN TẤT`);
  console.log(`${'='.repeat(50)}\n`);
  
  return {
    sellResult,
    buyResult,
    bgbSold: bgbToSell,
    usdtUsed: usdtReceived,
  };
}

/**
 * Lấy lịch sử giao dịch spot
 */
async function getSpotTradeHistory(api, limit = 20) {
  try {
    const [orders, fills] = await Promise.all([
      api.getSpotOrderHistory(null, limit).catch(err => {
        console.warn(`⚠️  Không thể lấy order history: ${err.message}`);
        return [];
      }),
      api.getSpotFills(null, limit).catch(err => {
        console.warn(`⚠️  Không thể lấy fills history: ${err.message}`);
        return [];
      }),
    ]);

    return {
      orders: Array.isArray(orders) ? orders : [],
      fills: Array.isArray(fills) ? fills : [],
    };
  } catch (err) {
    throw new Error(`Không thể lấy lịch sử giao dịch spot: ${err.message}`);
  }
}

/**
 * Format và sắp xếp lịch sử giao dịch
 * Giữ nguyên giá trị gốc từ API, không làm tròn
 */
function formatTradeHistory(orders, fills) {
  // Format orders - giữ nguyên giá trị gốc
  const formattedOrders = (orders || []).map(order => {
    const timestamp = parseInt(order.cTime || order.createTime || order.timestamp || 0);
    const symbol = order.symbol || '';
    const side = order.side || '';
    // Giữ nguyên giá trị gốc từ API (string hoặc number)
    const size = order.size || order.quantity || '0';
    const price = order.price || order.orderPrice || '0';
    const status = order.status || order.orderStatus || 'unknown';
    const orderId = order.orderId || order.id || '';

    return {
      timestamp,
      symbol,
      side: side.toLowerCase(),
      size: size.toString(), // Giữ nguyên string từ API
      price: price.toString(), // Giữ nguyên string từ API
      status,
      orderId,
      type: 'order',
      raw: order, // Lưu toàn bộ object gốc
    };
  }).sort((a, b) => b.timestamp - a.timestamp); // Sắp xếp mới nhất trước

  // Format fills - giữ nguyên giá trị gốc
  const formattedFills = (fills || []).map(fill => {
    const timestamp = parseInt(fill.cTime || fill.fillTime || fill.timestamp || 0);
    const symbol = fill.symbol || '';
    const side = fill.side || '';
    // Giữ nguyên giá trị gốc từ API
    const size = fill.size || fill.quantity || fill.fillSize || '0';
    const price = fill.price || fill.fillPrice || '0';
    // Tính totalValue nhưng giữ nguyên precision
    const totalValue = (parseFloat(size) * parseFloat(price)).toString();
    const orderId = fill.orderId || fill.id || '';

    return {
      timestamp,
      symbol,
      side: side.toLowerCase(),
      size: size.toString(), // Giữ nguyên string từ API
      price: price.toString(), // Giữ nguyên string từ API
      totalValue,
      orderId,
      type: 'fill',
      raw: fill, // Lưu toàn bộ object gốc
    };
  }).sort((a, b) => b.timestamp - a.timestamp); // Sắp xếp mới nhất trước

  return {
    orders: formattedOrders,
    fills: formattedFills,
  };
}

/**
 * Hiển thị số không làm tròn (giữ nguyên giá trị gốc)
 */
function displayRawNumber(value) {
  if (value === null || value === undefined || value === '') {
    return '0';
  }
  // Giữ nguyên string hoặc convert sang string không format
  return value.toString();
}

/**
 * Hiển thị lịch sử giao dịch spot
 * Hiển thị giá trị gốc từ API, không làm tròn
 */
function displaySpotTradeHistory(history) {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`📜 Lịch Sử Giao Dịch Spot`);
  console.log(`${'='.repeat(50)}\n`);

  // Hiển thị lệnh đã đặt
  if (history.orders.length > 0) {
    console.log(`📋 Lệnh đã đặt (${history.orders.length} gần nhất):\n`);
    
    for (const order of history.orders.slice(0, 10)) {
      const timeStr = formatTimestamp(order.timestamp);
      const sideDisplay = order.side === 'buy' ? '🟢 BUY' : '🔴 SELL';
      const symbolDisplay = order.symbol.replace('USDT', '/USDT');
      // Hiển thị giá trị gốc, không làm tròn
      const sizeStr = displayRawNumber(order.size);
      const priceStr = parseFloat(order.price) > 0 ? displayRawNumber(order.price) : 'Market';
      const statusStr = order.status.toUpperCase();
      
      console.log(`   ${timeStr} | ${symbolDisplay.padEnd(12)} | ${sideDisplay.padEnd(8)} | ${sizeStr.padStart(20)} | ${priceStr.padStart(20)} | ${statusStr}`);
    }
  } else {
    console.log(`📋 Lệnh đã đặt: Không có lệnh nào\n`);
  }

  console.log('');

  // Hiển thị lệnh đã fill
  if (history.fills.length > 0) {
    console.log(`💰 Lệnh đã fill (${history.fills.length} gần nhất):\n`);
    
    for (const fill of history.fills.slice(0, 10)) {
      const timeStr = formatTimestamp(fill.timestamp);
      const sideDisplay = fill.side === 'buy' ? '🟢 BUY' : '🔴 SELL';
      const symbolDisplay = fill.symbol.replace('USDT', '/USDT');
      // Hiển thị giá trị gốc, không làm tròn
      const sizeStr = displayRawNumber(fill.size);
      const priceStr = displayRawNumber(fill.price);
      const valueStr = displayRawNumber(fill.totalValue);
      
      console.log(`   ${timeStr} | ${symbolDisplay.padEnd(12)} | ${sideDisplay.padEnd(8)} | ${sizeStr.padStart(20)} | ${priceStr.padStart(20)} USDT | ${valueStr.padStart(20)} USDT`);
    }
  } else {
    console.log(`💰 Lệnh đã fill: Không có lệnh nào\n`);
  }

  console.log(`${'='.repeat(50)}\n`);
}

/**
 * Main function
 */
async function main() {
  // Parse command line arguments để lấy API credentials (nếu có)
  const args = process.argv.slice(2);
  let apiKey = 'public';
  let apiSecret = 'public';
  let passphrase = '';
  let testTrading = false;
  let historyLimit = 20; // Mặc định 20 lệnh
  
  for (const arg of args) {
    if (arg.startsWith('--key=')) {
      apiKey = arg.split('=')[1];
    } else if (arg.startsWith('--secret=')) {
      apiSecret = arg.split('=')[1];
    } else if (arg.startsWith('--passphrase=')) {
      passphrase = arg.split('=')[1];
    } else if (arg === '--test-trading') {
      testTrading = true;
    } else if (arg.startsWith('--history-limit=')) {
      const limit = parseInt(arg.split('=')[1]);
      if (!isNaN(limit) && limit > 0) {
        historyLimit = Math.min(limit, 100); // Tối đa 100
      }
    }
  }
  
  const hasValidCredentials = apiKey !== 'public' && apiSecret !== 'public';
  
  console.log('🚀 Đang lấy dữ liệu nến 4H từ Bitget Spot API...\n');

  // Khởi tạo API client
  const api = new BitgetApi({
    apiKey,
    apiSecret,
    passphrase,
  });

  const symbols = ['BTCUSDT', 'PAXGUSDT'];
  const granularity = 14400; // 4 giờ = 14400 giây
  const limit = 2; // Lấy 2 nến để đảm bảo có nến đã đóng cửa

  const results = [];

  for (const symbol of symbols) {
    try {
      console.log(`📡 Đang lấy dữ liệu cho ${symbol}...`);
      const candles = await api.getSpotCandles(symbol, granularity, limit);

      if (!Array.isArray(candles) || candles.length === 0) {
        throw new Error(`Không có dữ liệu nến cho ${symbol}`);
      }

      // Tìm nến đã đóng cửa gần nhất
      // Format Bitget: [timestamp, open, high, low, close, volume]
      // Timestamp là thời gian mở cửa của nến, thời gian đóng cửa = timestamp + interval
      const now = Date.now();
      const intervalMs = granularity * 1000; // 4 giờ = 14400 giây = 14400000 ms
      let closedCandle = null;
      
      // Tìm từ cuối lên, nến đầu tiên có thời gian đóng cửa <= now là nến đã đóng cửa
      for (let i = candles.length - 1; i >= 0; i--) {
        const candle = candles[i];
        const candleTimestamp = parseInt(candle[0]);
        
        // Convert timestamp sang milliseconds nếu cần
        let candleOpenTime = candleTimestamp;
        if (candleOpenTime < 1e12) {
          candleOpenTime = candleOpenTime * 1000;
        }
        
        // Thời gian đóng cửa = thời gian mở cửa + interval
        const candleCloseTime = candleOpenTime + intervalMs;
        
        // Nếu thời gian đóng cửa <= now, đây là nến đã đóng cửa
        if (candleCloseTime <= now) {
          closedCandle = candle;
          break;
        }
      }
      
      // Nếu không tìm thấy nến đã đóng cửa, lấy nến thứ 2 từ cuối (thường là nến đã đóng)
      if (!closedCandle && candles.length >= 2) {
        closedCandle = candles[candles.length - 2];
        console.log(`⚠️  Không tìm thấy nến đã đóng cửa rõ ràng, dùng nến thứ 2 từ cuối`);
      } else if (!closedCandle) {
        // Fallback: lấy nến cuối cùng nếu chỉ có 1 nến
        closedCandle = candles[candles.length - 1];
        console.log(`⚠️  Chỉ có 1 nến, có thể là nến đang chạy`);
      }
      
      const candleData = parseCandleData(closedCandle, symbol);
      results.push(candleData);
      displayCandleInfo(candleData);
    } catch (err) {
      console.error(`❌ Lỗi khi lấy dữ liệu cho ${symbol}: ${err.message}`);
      console.error(`   Chi tiết: ${err.stack}\n`);
    }
  }

  // Tóm tắt candles
  if (results.length > 0) {
    console.log(`\n✅ Đã lấy thành công ${results.length}/${symbols.length} cặp tiền tệ\n`);
  } else {
    console.log(`\n❌ Không thể lấy dữ liệu cho bất kỳ cặp tiền tệ nào\n`);
  }

  // Lấy thông tin tài khoản spot nếu có API credentials
  if (hasValidCredentials) {
    try {
      console.log('📡 Đang lấy thông tin tài khoản spot...\n');
      const assets = await getSpotAccountInfo(api);
      const accountInfo = await calculateTotalAssets(api, assets);
      displaySpotAccountInfo(accountInfo);
      
      // Lấy và hiển thị lịch sử giao dịch spot
      try {
        console.log(`📡 Đang lấy lịch sử giao dịch spot (${historyLimit} lệnh gần nhất)...\n`);
        const tradeHistory = await getSpotTradeHistory(api, historyLimit);
        const formattedHistory = formatTradeHistory(tradeHistory.orders, tradeHistory.fills);
        displaySpotTradeHistory(formattedHistory);
      } catch (err) {
        console.error(`❌ Lỗi khi lấy lịch sử giao dịch spot: ${err.message}\n`);
      }
      
      // Thực thi test trading nếu có flag --test-trading
      if (testTrading) {
        try {
          const tradingResult = await executeTestTrading(api, assets);
          
          // Đợi một chút để đảm bảo tất cả lệnh đã fill
          console.log('⏳ Đang đợi các lệnh hoàn tất...\n');
          await sleep(5000);
          
          // Cập nhật lại danh mục sau khi trading
          console.log('📡 Đang cập nhật danh mục sau khi trading...\n');
          const newAssets = await getSpotAccountInfo(api);
          const newAccountInfo = await calculateTotalAssets(api, newAssets);
          
          console.log(`\n${'='.repeat(50)}`);
          console.log(`📊 DANH MỤC SAU KHI TRADING`);
          console.log(`${'='.repeat(50)}`);
          displaySpotAccountInfo(newAccountInfo);
          
          // Tóm tắt kết quả
          console.log(`\n${'='.repeat(50)}`);
          console.log(`📋 TÓM TẮT TEST TRADING`);
          console.log(`${'='.repeat(50)}`);
          console.log(`   ✅ Đã bán: ${formatNumber(tradingResult.bgbSold, 8)} BGB`);
          console.log(`   ✅ Đã dùng: ${formatNumber(tradingResult.usdtUsed, 2)} USDT để mua PAXG`);
          console.log(`   💰 Tổng tài sản trước: ${formatNumber(accountInfo.totalUSDT, 2)} USDT`);
          console.log(`   💰 Tổng tài sản sau: ${formatNumber(newAccountInfo.totalUSDT, 2)} USDT`);
          console.log(`${'='.repeat(50)}\n`);
        } catch (err) {
          console.error(`\n❌ Lỗi khi thực thi test trading: ${err.message}\n`);
          console.error(`   Chi tiết: ${err.stack}\n`);
        }
      }
    } catch (err) {
      console.error(`❌ Lỗi khi lấy thông tin tài khoản spot: ${err.message}\n`);
      console.error(`   💡 Lưu ý: Cần API key hợp lệ để xem thông tin tài khoản\n`);
    }
  } else {
    console.log(`\n💡 Lưu ý: Để xem thông tin tài khoản spot, vui lòng chạy với API credentials:\n`);
    console.log(`   node getSpot4HCandles.js --key=YOUR_API_KEY --secret=YOUR_SECRET --passphrase=YOUR_PASSPHRASE\n`);
    
    if (testTrading) {
      console.log(`\n⚠️  Cần API credentials để thực thi test trading!\n`);
    }
  }
}

// Chạy script
if (require.main === module) {
  main().catch((err) => {
    console.error('❌ Lỗi không mong đợi:', err);
    process.exit(1);
  });
}

module.exports = {
  parseCandleData,
  formatTimestamp,
  formatNumber,
  displayCandleInfo,
  getCoinPrice,
  getSpotAccountInfo,
  calculateTotalAssets,
  displaySpotAccountInfo,
  roundToScale,
  sleep,
  displayRawNumber,
};
