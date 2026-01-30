#!/usr/bin/env node

/**
 * Entry point cho Price Action Trading Bot
 * 
 * Bot tự động phân tích giá bằng Gemini AI theo phương pháp Price Action:
 * - Mô hình nến (Candlestick Patterns): Hammer, Shooting Star, Engulfing, Pin Bar, Doji, etc.
 * - Chart Patterns: Head & Shoulders, Double Top/Bottom, Triangles, Wedges, Flags, Pennants, etc.
 * - Support/Resistance levels
 * - Market Structure: Higher Highs, Higher Lows, Lower Highs, Lower Lows
 * - Break of Structure (BOS) và Change of Character (ChoCh)
 * - Swing High/Low analysis
 * 
 * Lấy dữ liệu đa khung thời gian từ Binance (5m, 15m, 1h, 4h, 1d)
 * Chỉ báo kỹ thuật chỉ dùng để hỗ trợ, không phải tín hiệu chính
 * 
 * Usage:
 *   node startPriceActionBot.js --key=... --secret=... --passphrase=... --symbol=BTCUSDT_UMCBL
 */

const { hideBin } = require('yargs/helpers');
const yargs = require('yargs/yargs');
require('dotenv').config();

const { PriceActionBot } = require('./priceActionBot');
const { BitgetApi } = require('./bitgetApi');

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option('key', {
      type: 'string',
      describe: 'Bitget API key',
      demandOption: true,
    })
    .option('secret', {
      type: 'string',
      describe: 'Bitget API secret',
      demandOption: true,
    })
    .option('passphrase', {
      type: 'string',
      describe: 'Bitget API passphrase (if enabled)',
      demandOption: false,
    })
    .option('symbol', {
      type: 'string',
      default: process.env.PRICE_ACTION_BOT_SYMBOL || 'BTCUSDT_UMCBL',
      describe: 'Perpetual contract symbol',
    })
    .option('margin', {
      type: 'string',
      default: process.env.PRICE_ACTION_BOT_MARGIN_COIN || 'USDT',
      describe: 'Margin coin (USDT)',
    })
    .option('capital', {
      type: 'number',
      default: Number(process.env.PRICE_ACTION_BOT_CAPITAL) || 0,
      describe: 'Capital (vốn) để trade. Nếu 0 sẽ dùng toàn bộ equity hiện có',
    })
    .option('leverage', {
      type: 'number',
      default: Number(process.env.PRICE_ACTION_BOT_LEVERAGE) || 10,
      describe: 'Leverage - Mặc định: 10x',
    })
    // Technical
    .option('tick', {
      type: 'number',
      default: Number(process.env.PRICE_ACTION_BOT_PRICE_TICK) || 0,
      describe: 'Price tick size (set 0 to auto detect)',
    })
    .option('sizeStep', {
      type: 'number',
      default: Number(process.env.PRICE_ACTION_BOT_SIZE_STEP) || 0,
      describe: 'Quantity step size (set 0 to auto detect)',
    })
    .help()
    .alias('help', 'h').argv;

  const apiClient = new BitgetApi({
    apiKey: argv.key,
    apiSecret: argv.secret,
    passphrase: argv.passphrase || process.env.BITGET_PASSPHRASE || '',
  });

  // Parse capital
  let capital = argv.capital;
  
  if (typeof capital !== 'number') {
    capital = capital ? Number(capital) : 0;
  }
  
  if (isNaN(capital)) {
    capital = 0;
  }

  console.log(`[CONFIG] Cấu hình Price Action Bot:`);
  console.log(`  - Symbol: ${argv.symbol}`);
  console.log(`  - Margin Coin: ${argv.margin}`);
  console.log(`  - Capital: ${capital > 0 ? `${capital} ${argv.margin} (số tiền vào lệnh)` : 'Tự động (dùng toàn bộ equity)'}`);
  console.log(`  - Leverage: ${argv.leverage}x`);
  console.log(`  - Phương pháp: Price Action + Candlestick Patterns + Chart Patterns`);
  console.log(`  - Thời gian chạy: AI tự điều chỉnh (15 phút - 24 giờ)`);
  console.log(`  - Nguồn dữ liệu: Binance đa khung thời gian (5m, 15m, 1h, 4h, 1d)`);
  console.log(`  - AI: Google Gemini (Price Action specialist)`);

  const bot = new PriceActionBot({
    apiClient,
    config: {
      symbol: argv.symbol,
      marginCoin: argv.margin || 'USDT',
      capital: capital > 0 ? capital : null, // null = dùng toàn bộ equity
      leverage: argv.leverage,
      
      // Technical
      priceTickSize: argv.tick,
      sizeStep: argv.sizeStep,
      
      // Run interval (mặc định, nhưng AI sẽ tự điều chỉnh)
      runIntervalMs: 60 * 60 * 1000,
    },
  });

  await bot.run();
}

main().catch((err) => {
  console.error('[FATAL] ❌ Lỗi nghiêm trọng:', err.message);
  if (err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});



