#!/usr/bin/env node

/**
 * Script tính ADX từ dữ liệu nến của Binance (thay thế cho Bitget)
 * Binance API ổn định và dễ sử dụng hơn Bitget
 * 
 * Usage: 
 *   node adx-binance.js --symbol=XRPUSDT --interval=5m
 *   node adx-binance.js --symbol=BTCUSDT --interval=15m --period=21
 */

const { hideBin } = require('yargs/helpers');
const yargs = require('yargs/yargs');
const axios = require('axios');
const { ADX } = require('technicalindicators');

const BINANCE_API_BASE = 'https://api.binance.com';

/**
 * Lấy dữ liệu nến từ Binance API
 * @param {string} symbol - Symbol (ví dụ: XRPUSDT, BTCUSDT)
 * @param {string} interval - Interval (1m, 3m, 5m, 15m, 30m, 1h, 4h, 1d)
 * @param {number} limit - Số nến cần lấy (mặc định 200)
 * @returns {Promise<Array>} - Mảng các nến
 */
async function fetchCandles(symbol, interval = '5m', limit = 200) {
  try {
    const url = `${BINANCE_API_BASE}/api/v3/klines`;
    const params = {
      symbol: symbol.toUpperCase(),
      interval: interval,
      limit: limit,
    };

    console.log(`[ADX] Đang lấy dữ liệu nến ${interval} cho ${symbol} từ Binance...`);
    const response = await axios.get(url, { params });

    if (!Array.isArray(response.data)) {
      throw new Error(`API trả về dữ liệu không hợp lệ: ${JSON.stringify(response.data)}`);
    }

    console.log(`[ADX] Đã nhận ${response.data.length} nến từ Binance`);
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
 * Parse dữ liệu nến từ Binance sang format chuẩn
 * Format Binance: [timestamp, open, high, low, close, volume, ...]
 */
function parseCandles(binanceCandles) {
  const highs = [];
  const lows = [];
  const closes = [];

  for (const candle of binanceCandles) {
    if (Array.isArray(candle) && candle.length >= 5) {
      const high = parseFloat(candle[2]);  // high
      const low = parseFloat(candle[3]);   // low
      const close = parseFloat(candle[4]); // close

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
        default: 'BTCUSDT',
        describe: 'Symbol cần tính ADX (ví dụ: BTCUSDT, XRPUSDT) - Lưu ý: Không có _UMCBL suffix',
      })
      .option('interval', {
        type: 'string',
        default: '5m',
        describe: 'Interval cho nến (1m, 3m, 5m, 15m, 30m, 1h, 4h, 1d)',
      })
      .option('period', {
        type: 'number',
        default: 14,
        describe: 'Period cho ADX (mặc định 14)',
      })
      .option('limit', {
        type: 'number',
        default: 200,
        describe: 'Số nến cần lấy (mặc định 200)',
      })
      .help()
      .alias('help', 'h').argv;

    console.log('[ADX-Binance] 🚀 Khởi động script ADX với Binance API');
    console.log(`[ADX-Binance] Symbol: ${argv.symbol}`);
    console.log(`[ADX-Binance] Interval: ${argv.interval}`);
    console.log(`[ADX-Binance] ADX Period: ${argv.period}`);
    console.log(`[ADX-Binance] Limit: ${argv.limit} nến`);
    console.log('');

    // Lấy dữ liệu nến
    const binanceCandles = await fetchCandles(argv.symbol, argv.interval, argv.limit);

    // Parse dữ liệu
    const { highs, lows, closes } = parseCandles(binanceCandles);

    // Validate số lượng nến đủ để tính ADX
    const minCandles = argv.period + 1;
    if (highs.length < minCandles) {
      throw new Error(`Không đủ dữ liệu để tính ADX. Cần ít nhất ${minCandles} nến, hiện có ${highs.length}`);
    }

    // Tính ADX
    console.log(`[ADX] Đang tính ADX với period ${argv.period}...`);
    const adxResult = calculateADX(highs, lows, closes, argv.period);

    if (!adxResult || adxResult.length === 0) {
      throw new Error('Không tính được ADX');
    }

    // Lấy giá trị ADX mới nhất
    const latestADX = adxResult[adxResult.length - 1];
    
    if (!latestADX) {
      throw new Error('Không có kết quả ADX');
    }

    const adxValue = latestADX.adx;
    const pdi = latestADX.pdi || 0;
    const mdi = latestADX.mdi || 0;

    if (typeof adxValue !== 'number' || isNaN(adxValue)) {
      throw new Error(`Giá trị ADX không hợp lệ: ${adxValue}`);
    }

    // Format và in kết quả
    console.log('');
    console.log('═══════════════════════════════════════');
    console.log('📊 KẾT QUẢ ADX');
    console.log('═══════════════════════════════════════');
    console.log(`Symbol: ${argv.symbol}`);
    console.log(`Interval: ${argv.interval}`);
    console.log(`Số nến: ${highs.length}`);
    console.log(`ADX Period: ${argv.period}`);
    console.log('');
    console.log(`Latest ADX: ${adxValue.toFixed(2)}`);
    console.log(`+DI: ${pdi.toFixed(2)}`);
    console.log(`-DI: ${mdi.toFixed(2)}`);
    console.log('');
    
    // Phân tích ADX
    if (adxValue > 25) {
      console.log('✅ ADX > 25: Xu hướng MẠNH - Có thể trade');
    } else if (adxValue > 20) {
      console.log('⚠️  ADX 20-25: Xu hướng TRUNG BÌNH');
    } else {
      console.log('❌ ADX < 20: Xu hướng YẾU - Nên tránh trade');
    }
    
    if (pdi > mdi) {
      console.log('📈 +DI > -DI: Xu hướng TĂNG');
    } else if (mdi > pdi) {
      console.log('📉 -DI > +DI: Xu hướng GIẢM');
    } else {
      console.log('➡️  +DI ≈ -DI: Không có xu hướng rõ ràng');
    }
    
    console.log('═══════════════════════════════════════');

  } catch (err) {
    console.error(`[ADX-Binance] ❌ Lỗi: ${err.message}`);
    if (err.stack) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

// Chạy script
main();

