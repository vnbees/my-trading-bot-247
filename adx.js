#!/usr/bin/env node

/**
 * Script tính ADX từ dữ liệu nến 5 phút của Bitget
 * 
 * Usage: 
 *   node adx.js --symbol=BTCUSDT_UMCBL
 *   node adx.js --symbol=XRPUSDT_UMCBL --key=... --secret=... --passphrase=...
 * 
 * Note: Endpoint candles có thể cần authentication, nên cần cung cấp API key
 */

const { hideBin } = require('yargs/helpers');
const yargs = require('yargs/yargs');
const { ADX } = require('technicalindicators');
const { BitgetApi } = require('./bitgetApi');

/**
 * Lấy dữ liệu nến 5 phút từ Bitget API
 * @param {BitgetApi} apiClient - BitgetApi client instance
 * @param {string} symbol - Symbol cần lấy (ví dụ: BTCUSDT_UMCBL)
 * @param {number} limit - Số nến cần lấy (mặc định 200)
 * @returns {Promise<Array>} - Mảng các nến
 */
async function fetchCandles(apiClient, symbol = 'BTCUSDT_UMCBL', limit = 200) {
  try {
    console.log(`[ADX] Đang lấy dữ liệu nến 5 phút cho ${symbol}...`);
    
    // Sử dụng method getCandles từ BitgetApi (đã có fallback logic)
    const candles = await apiClient.getCandles(symbol, 300, limit);

    if (!Array.isArray(candles) || candles.length === 0) {
      throw new Error(`API trả về dữ liệu không hợp lệ: ${JSON.stringify(candles)}`);
    }

    console.log(`[ADX] Đã nhận ${candles.length} nến`);
    return candles;
  } catch (err) {
    if (err.message && err.message.includes('API error')) {
      throw err;
    }
    throw new Error(`Lỗi khi lấy dữ liệu nến: ${err.message}`);
  }
}

/**
 * Parse dữ liệu nến từ format Bitget sang arrays
 * Format Bitget: [timestamp, open, high, low, close, volume, turnover]
 * @param {Array} candles - Mảng các nến từ API
 * @returns {Object} - Object chứa highs, lows, closes
 */
function parseCandles(candles) {
  const highs = [];
  const lows = [];
  const closes = [];

  for (const candle of candles) {
    // Bitget trả về: [timestamp, open, high, low, close, volume, turnover]
    if (Array.isArray(candle) && candle.length >= 5) {
      const high = Number(candle[2]); // high
      const low = Number(candle[3]);  // low
      const close = Number(candle[4]); // close

      // Validate giá trị
      if (!isNaN(high) && !isNaN(low) && !isNaN(close) && high > 0 && low > 0 && close > 0) {
        highs.push(high);
        lows.push(low);
        closes.push(close);
      }
    }
  }

  if (highs.length === 0) {
    throw new Error('Không có dữ liệu nến hợp lệ để tính ADX');
  }

  console.log(`[ADX] Đã parse ${highs.length} nến hợp lệ`);
  return { highs, lows, closes };
}

/**
 * Tính ADX từ dữ liệu OHLC
 * @param {Array} highs - Mảng giá cao
 * @param {Array} lows - Mảng giá thấp
 * @param {Array} closes - Mảng giá đóng
 * @param {number} period - Period cho ADX (mặc định 14)
 * @returns {Array} - Mảng kết quả ADX
 */
function calculateADX(highs, lows, closes, period = 14) {
  try {
    const input = {
      high: highs,
      low: lows,
      close: closes,
      period: period,
    };

    const result = ADX.calculate(input);
    return result;
  } catch (err) {
    throw new Error(`Lỗi khi tính ADX: ${err.message}`);
  }
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
      .option('key', {
        type: 'string',
        describe: 'Bitget API key (có thể cần cho endpoint candles)',
        demandOption: false,
      })
      .option('secret', {
        type: 'string',
        describe: 'Bitget API secret',
        demandOption: false,
      })
      .option('passphrase', {
        type: 'string',
        describe: 'Bitget API passphrase',
        demandOption: false,
      })
      .option('limit', {
        type: 'number',
        default: 200,
        describe: 'Số nến cần lấy (mặc định 200)',
      })
      .help()
      .alias('help', 'h').argv;

    // Khởi tạo API client
    // Nếu có key/secret thì dùng, nếu không thì thử public API
    let apiClient;
    if (argv.key && argv.secret) {
      console.log('[ADX] Sử dụng API key để authenticate...');
      apiClient = new BitgetApi({
        apiKey: argv.key,
        apiSecret: argv.secret,
        passphrase: argv.passphrase || '',
      });
    } else {
      console.log('[ADX] ⚠️  Cảnh báo: Không có API key. Endpoint candles có thể cần authentication.');
      console.log('[ADX] 💡 Gợi ý: Thêm --key, --secret, --passphrase nếu gặp lỗi');
      // Tạo một client đơn giản chỉ để gọi public endpoint
      apiClient = new BitgetApi({
        apiKey: 'dummy',
        apiSecret: 'dummy',
        passphrase: '',
      });
    }

    // Lấy dữ liệu nến
    const candles = await fetchCandles(apiClient, argv.symbol, argv.limit);

    // Parse dữ liệu
    const { highs, lows, closes } = parseCandles(candles);

    // Validate số lượng nến đủ để tính ADX (cần ít nhất period + 1 nến)
    const minCandles = 15; // ADX period 14 cần ít nhất 15 nến
    if (highs.length < minCandles) {
      throw new Error(`Không đủ dữ liệu để tính ADX. Cần ít nhất ${minCandles} nến, hiện có ${highs.length}`);
    }

    // Tính ADX
    console.log(`[ADX] Đang tính ADX với period 14...`);
    const adxResult = calculateADX(highs, lows, closes, 14);

    if (!adxResult || adxResult.length === 0) {
      throw new Error('Không tính được ADX');
    }

    // Lấy giá trị ADX mới nhất
    // ADX.calculate() trả về array of objects: [{ adx, pdi, mdi }, ...]
    const latestADX = adxResult[adxResult.length - 1];
    
    if (!latestADX) {
      throw new Error('Không có kết quả ADX');
    }

    // Lấy giá trị adx từ object
    const adxValue = latestADX.adx;

    if (typeof adxValue !== 'number' || isNaN(adxValue)) {
      throw new Error(`Giá trị ADX không hợp lệ: ${adxValue}`);
    }

    // Format và in kết quả
    console.log(`Latest ADX: ${adxValue.toFixed(2)}`);

  } catch (err) {
    console.error(`[ADX] ❌ Lỗi: ${err.message}`);
    console.error(`[ADX] 💡 Lưu ý: Endpoint candles của Bitget API có vấn đề với futures contracts.`);
    console.error(`[ADX] 💡 Giải pháp thay thế:`);
    console.error(`[ADX]    1. Sử dụng WebSocket để lấy dữ liệu nến real-time`);
    console.error(`[ADX]    2. Lấy dữ liệu nến từ exchange khác (Binance, OKX) rồi tính ADX`);
    console.error(`[ADX]    3. Tích hợp ADX vào bot trading để tính từ dữ liệu ticker`);
    if (err.stack) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

// Chạy script
main();

