#!/usr/bin/env node

/**
 * Script tính ADX từ dữ liệu nến 5 phút của Bitget qua WebSocket
 * 
 * Usage: 
 *   node adx-websocket.js --symbol=XRPUSDT_UMCBL
 *   node adx-websocket.js --symbol=BTCUSDT_UMCBL --period=14 --minCandles=200
 */

const { hideBin } = require('yargs/helpers');
const yargs = require('yargs/yargs');
const WebSocket = require('ws');
const { ADX } = require('technicalindicators');

// Lưu trữ dữ liệu nến
let candles = [];
let isConnected = false;
let ws = null;

/**
 * Parse dữ liệu nến từ WebSocket message
 * Format Bitget WebSocket: [timestamp, open, high, low, close, volume, ...]
 */
function parseCandle(data) {
  if (!Array.isArray(data) || data.length < 5) {
    return null;
  }
  
  return {
    timestamp: parseInt(data[0]),
    open: parseFloat(data[1]),
    high: parseFloat(data[2]),
    low: parseFloat(data[3]),
    close: parseFloat(data[4]),
    volume: parseFloat(data[5] || 0),
  };
}

/**
 * Parse dữ liệu nến thành arrays cho ADX
 */
function parseCandlesForADX(candles) {
  const highs = [];
  const lows = [];
  const closes = [];

  for (const candle of candles) {
    if (candle && candle.high > 0 && candle.low > 0 && candle.close > 0) {
      highs.push(candle.high);
      lows.push(candle.low);
      closes.push(candle.close);
    }
  }

  return { highs, lows, closes };
}

/**
 * Tính ADX từ dữ liệu nến
 */
function calculateADX(candles, period = 14) {
  const { highs, lows, closes } = parseCandlesForADX(candles);
  
  if (highs.length < period + 1) {
    return null;
  }

  try {
    const result = ADX.calculate({
      high: highs,
      low: lows,
      close: closes,
      period: period,
    });

    if (!result || result.length === 0) {
      return null;
    }

    return result[result.length - 1];
  } catch (err) {
    console.error(`[ADX] Lỗi khi tính ADX: ${err.message}`);
    return null;
  }
}

/**
 * Kết nối WebSocket và subscribe candles
 */
function connectWebSocket(symbol, interval = '5m') {
  return new Promise((resolve, reject) => {
    // Bitget WebSocket URL cho futures
    // Format: wss://ws.bitget.com/mix/v1/stream
    const wsUrl = 'wss://ws.bitget.com/mix/v1/stream';
    
    console.log(`[WS] Đang kết nối WebSocket: ${wsUrl}`);
    console.log(`[WS] Symbol: ${symbol}, Interval: ${interval}`);
    
    ws = new WebSocket(wsUrl);

    ws.on('open', () => {
      console.log('[WS] ✅ Đã kết nối WebSocket');
      isConnected = true;

      // Subscribe vào channel candles
      // Thử nhiều format khác nhau vì Bitget có thể dùng format khác
      const formats = [
        `mc/candle${interval}:${symbol}`,           // Format 1: mc/candle5m:XRPUSDT_UMCBL
        `candle${interval}_${symbol}`,              // Format 2: candle5m_XRPUSDT_UMCBL
        `candle${interval}-${symbol}`,                // Format 3: candle5m-XRPUSDT_UMCBL
        `candle${interval}.${symbol}`,               // Format 4: candle5m.XRPUSDT_UMCBL
        { instType: 'mc', channel: `candle${interval}`, instId: symbol }, // Format 5: Object
        `mix/candle${interval}:${symbol}`,          // Format 6: mix/candle5m:XRPUSDT_UMCBL
        `umcbl/candle${interval}:${symbol}`,        // Format 7: umcbl/candle5m:XRPUSDT_UMCBL
        `candle${interval}`,                         // Format 8: chỉ candle5m (có thể cần thêm params)
      ];
      
      let formatIndex = 0;
      let subscribeAttempts = 0;
      const maxAttempts = formats.length;
      
      const trySubscribe = () => {
        if (subscribeAttempts >= maxAttempts) {
          console.error(`[WS] ❌ Đã thử tất cả ${maxAttempts} format nhưng không thành công`);
          console.error(`[WS] 💡 Có thể channel candles không tồn tại hoặc cần format khác`);
          return;
        }
        
        const channel = formats[formatIndex];
        const subscribeMsg = {
          op: 'subscribe',
          args: Array.isArray(channel) ? channel : [channel],
        };

        console.log(`[WS] Đang subscribe (format ${formatIndex + 1}/${maxAttempts}): ${JSON.stringify(subscribeMsg)}`);
        ws.send(JSON.stringify(subscribeMsg));
        subscribeAttempts++;
      };
      
      // Thử subscribe ngay
      trySubscribe();
      
      // Nếu format hiện tại fail, thử format tiếp theo sau 2 giây
      const subscribeInterval = setInterval(() => {
        if (!isConnected && subscribeAttempts < maxAttempts) {
          formatIndex++;
          trySubscribe();
        } else if (isConnected) {
          clearInterval(subscribeInterval);
        }
      }, 2000);
      
      // Clear interval sau 30 giây
      setTimeout(() => clearInterval(subscribeInterval), 30000);
      
      resolve();
    });

    ws.on('message', (data) => {
      try {
        const rawMessage = data.toString();
        const message = JSON.parse(rawMessage);
        
        // Log raw message để debug
        if (rawMessage.length < 500) {
          console.log(`[WS] 📨 Message: ${rawMessage}`);
        }
        
        // Bitget WebSocket trả về:
        // - {"event":"subscribe","arg":{...}} - Xác nhận subscribe
        // - {"arg":{...},"data":[[timestamp,open,high,low,close,volume,...]]} - Dữ liệu nến
        // - {"action":"snapshot","arg":{...},"data":[...]} - Snapshot data
        // - {"action":"update","arg":{...},"data":[...]} - Update data
        
        if (message.event === 'subscribe' || message.event === 'unsubscribe') {
          console.log(`[WS] ✅ Event: ${message.event}, Arg: ${JSON.stringify(message.arg || message.args)}`);
          if (message.event === 'subscribe') {
            isConnected = true; // Đánh dấu đã subscribe thành công
          }
          return;
        }

        if (message.event === 'error') {
          const errorMsg = message.msg || message.message || 'Unknown error';
          const errorCode = message.code || 'N/A';
          console.error(`[WS] ❌ Lỗi từ server: ${errorMsg} (code: ${errorCode})`);
          
          // Nếu lỗi là channel không tồn tại, thử format khác
          if (errorMsg.includes("doesn't exist") || errorCode === 30001) {
            console.log(`[WS] 💡 Channel không tồn tại, sẽ thử format khác...`);
            // Format khác sẽ được thử tự động bởi interval
          }
          // Không đóng connection, chỉ log lỗi và thử format khác
          return;
        }

        if (message.action) {
          console.log(`[WS] 📊 Action: ${message.action}, Channel: ${JSON.stringify(message.arg)}`);
        }

        if (message.data && Array.isArray(message.data)) {
          // Xử lý dữ liệu nến
          for (const candleData of message.data) {
            const candle = parseCandle(candleData);
            if (!candle) continue;

            // Kiểm tra xem nến này đã tồn tại chưa (dựa trên timestamp)
            const existingIndex = candles.findIndex(c => c.timestamp === candle.timestamp);
            
            if (existingIndex >= 0) {
              // Cập nhật nến hiện có (nến đang hình thành)
              candles[existingIndex] = candle;
            } else {
              // Thêm nến mới
              candles.push(candle);
              // Sắp xếp theo timestamp
              candles.sort((a, b) => a.timestamp - b.timestamp);
              
              // Giữ chỉ số lượng nến cần thiết (ví dụ: 500 nến)
              if (candles.length > 500) {
                candles.shift();
              }
            }

            // Tính và hiển thị ADX nếu có đủ dữ liệu
            const adxResult = calculateADX(candles, 14);
            if (adxResult) {
              const adxValue = adxResult.adx;
              const pdi = adxResult.pdi || 0;
              const mdi = adxResult.mdi || 0;
              
              const timeStr = new Date(candle.timestamp).toLocaleTimeString('vi-VN');
              console.log(`[${timeStr}] Giá: ${candle.close.toFixed(4)} | ADX: ${adxValue.toFixed(2)} | +DI: ${pdi.toFixed(2)} | -DI: ${mdi.toFixed(2)} | Nến: ${candles.length}`);
            } else {
              const timeStr = new Date(candle.timestamp).toLocaleTimeString('vi-VN');
              console.log(`[${timeStr}] Giá: ${candle.close.toFixed(4)} | Đang thu thập dữ liệu... (${candles.length} nến)`);
            }
          }
        }
      } catch (err) {
        console.error(`[WS] ❌ Lỗi khi parse message: ${err.message}`);
        console.error(`[WS] Raw message: ${data.toString().substring(0, 200)}`);
      }
    });

    ws.on('error', (err) => {
      console.error(`[WS] ❌ Lỗi WebSocket: ${err.message}`);
      isConnected = false;
      reject(err);
    });

    ws.on('close', (code, reason) => {
      console.log(`[WS] ⚠️ WebSocket đã đóng (code: ${code}, reason: ${reason || 'N/A'})`);
      isConnected = false;
      
      // Chỉ reconnect nếu không phải là close bình thường (code 1000)
      if (code !== 1000) {
        // Tự động reconnect sau 5 giây
        console.log('[WS] Đang reconnect sau 5 giây...');
        setTimeout(() => {
          connectWebSocket(symbol, interval).catch(err => {
            console.error(`[WS] ❌ Reconnect thất bại: ${err.message}`);
          });
        }, 5000);
      }
    });
  });
}

/**
 * Hàm main
 */
async function main() {
  try {
    // Parse CLI arguments
    const argv = yargs(hideBin(process.argv))
      .option('symbol', {
        type: 'string',
        default: 'BTCUSDT_UMCBL',
        describe: 'Symbol cần tính ADX (ví dụ: BTCUSDT_UMCBL, XRPUSDT_UMCBL)',
      })
      .option('interval', {
        type: 'string',
        default: '5m',
        describe: 'Interval cho nến (1m, 3m, 5m, 15m, 30m, 1H, 4H, 1D)',
      })
      .option('period', {
        type: 'number',
        default: 14,
        describe: 'Period cho ADX (mặc định 14)',
      })
      .option('minCandles', {
        type: 'number',
        default: 200,
        describe: 'Số nến tối thiểu cần thu thập trước khi tính ADX',
      })
      .help()
      .alias('help', 'h').argv;

    console.log('[ADX-WS] 🚀 Khởi động script ADX qua WebSocket');
    console.log(`[ADX-WS] Symbol: ${argv.symbol}`);
    console.log(`[ADX-WS] Interval: ${argv.interval}`);
    console.log(`[ADX-WS] ADX Period: ${argv.period}`);
    console.log(`[ADX-WS] Min Candles: ${argv.minCandles}`);
    console.log('');

    // Kết nối WebSocket
    await connectWebSocket(argv.symbol, argv.interval);

    // Giữ script chạy
    console.log('[ADX-WS] ✅ Script đang chạy. Nhấn Ctrl+C để dừng.');
    console.log('[ADX-WS] 💡 Đang chờ dữ liệu nến từ WebSocket...');
    console.log('');

  } catch (err) {
    console.error(`[ADX-WS] ❌ Lỗi: ${err.message}`);
    if (err.stack) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

// Xử lý khi dừng script
process.on('SIGINT', () => {
  console.log('\n[ADX-WS] ⏹️  Đang dừng script...');
  if (ws) {
    ws.close();
  }
  process.exit(0);
});

// Chạy script
main();

