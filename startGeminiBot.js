#!/usr/bin/env node

/**
 * Entry point cho Gemini AI Trading Bot
 * 
 * Bot tự động phân tích giá bằng Gemini AI và vào lệnh
 * - Lấy dữ liệu 5 phút trong 1 ngày gần nhất từ Binance
 * - Gửi tới Gemini AI để phân tích
 * - Tự động vào lệnh theo khuyến nghị của AI
 * - Chạy mỗi 1 giờ một lần
 * 
 * Usage:
 *   node startGeminiBot.js --key=... --secret=... --passphrase=... --symbol=BTCUSDT_UMCBL
 */

const { hideBin } = require('yargs/helpers');
const yargs = require('yargs/yargs');
require('dotenv').config();

const { GeminiBot } = require('./geminiBot');
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
      default: process.env.GEMINI_BOT_SYMBOL || 'BTCUSDT_UMCBL',
      describe: 'Perpetual contract symbol',
    })
    .option('margin', {
      type: 'string',
      default: process.env.GEMINI_BOT_MARGIN_COIN || 'USDT',
      describe: 'Margin coin (USDT)',
    })
    .option('capital', {
      type: 'number',
      default: Number(process.env.GEMINI_BOT_CAPITAL) || 0,
      describe: 'Capital (vốn) để trade. Nếu 0 sẽ dùng toàn bộ equity hiện có',
    })
    .option('leverage', {
      type: 'number',
      default: Number(process.env.GEMINI_BOT_LEVERAGE) || 10,
      describe: 'Leverage - Mặc định: 10x',
    })
    // Technical
    .option('tick', {
      type: 'number',
      default: Number(process.env.GEMINI_BOT_PRICE_TICK) || 0,
      describe: 'Price tick size (set 0 to auto detect)',
    })
    .option('sizeStep', {
      type: 'number',
      default: Number(process.env.GEMINI_BOT_SIZE_STEP) || 0,
      describe: 'Quantity step size (set 0 to auto detect)',
    })
    .help()
    .alias('help', 'h').argv;

  const apiClient = new BitgetApi({
    apiKey: argv.key,
    apiSecret: argv.secret,
    passphrase: argv.passphrase || process.env.BITGET_PASSPHRASE || '',
  });

  // Parse capital - đảm bảo xử lý đúng number
  let capital = argv.capital;
  
  // Convert sang number nếu chưa phải number
  if (typeof capital !== 'number') {
    capital = capital ? Number(capital) : 0;
  }
  
  // Nếu capital là NaN, set về 0
  if (isNaN(capital)) {
    capital = 0;
  }

  console.log(`[CONFIG] Cấu hình Gemini AI Bot:`);
  console.log(`  - Symbol: ${argv.symbol}`);
  console.log(`  - Margin Coin: ${argv.margin}`);
  console.log(`  - Capital: ${capital > 0 ? `${capital} ${argv.margin} (số tiền vào lệnh)` : 'Tự động (dùng toàn bộ equity)'}`);
  console.log(`  - Leverage: ${argv.leverage}x`);
  console.log(`  - Thời gian chạy: AI tự điều chỉnh (15 phút - 24 giờ)`);
  console.log(`  - Nguồn dữ liệu: Binance 5m (1 ngày = 288 candles)`);
  console.log(`  - AI: Google Gemini`);

  const bot = new GeminiBot({
    apiClient,
    config: {
      symbol: argv.symbol,
      marginCoin: argv.margin || 'USDT',
      capital: capital > 0 ? capital : null, // null = dùng toàn bộ equity
      leverage: argv.leverage,
      
      // Technical
      priceTickSize: argv.tick,
      sizeStep: argv.sizeStep,
      
      // Run interval (1 giờ)
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


