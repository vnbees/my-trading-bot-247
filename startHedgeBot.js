#!/usr/bin/env node

/**
 * Entry point cho Hedge Trading Bot
 * 
 * Bot tự động hedge trading với Gemini AI:
 * 
 * CHIẾN LƯỢC:
 * 1. Khi xu hướng không rõ ràng:
 *    - Luôn có 2 lệnh Long và Short chạy song song (hedge)
 *    - Nếu lệnh nào lãi 5% (với leverage 10x) thì đóng và mở lại 2 lệnh mới
 * 
 * 2. Khi xu hướng rõ ràng:
 *    - Đóng lệnh ngược xu hướng
 *    - Giữ lệnh cùng xu hướng cho đến khi xu hướng đảo chiều hoặc không rõ
 * 
 * 3. Vai trò của Gemini AI:
 *    - Phân tích và nhận định xu hướng thị trường
 *    - KHÔNG quyết định vào lệnh (bot tự động quản lý hedge)
 * 
 * 4. Dữ liệu phân tích:
 *    - Đa khung thời gian từ Binance (5m, 15m, 1h, 4h, 1d)
 *    - Price Action (candlestick patterns, support/resistance, market structure)
 *    - Indicators (EMA, RSI, ATR, Bollinger Bands, etc.)
 * 
 * Usage:
 *   node startHedgeBot.js --key=... --secret=... --passphrase=... --symbol=BTCUSDT_UMCBL
 */

const { hideBin } = require('yargs/helpers');
const yargs = require('yargs/yargs');
require('dotenv').config();

const { HedgeBot } = require('./hedgeBot');
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
      default: process.env.HEDGE_BOT_SYMBOL || 'BTCUSDT_UMCBL',
      describe: 'Perpetual contract symbol',
    })
    .option('margin', {
      type: 'string',
      default: process.env.HEDGE_BOT_MARGIN_COIN || 'USDT',
      describe: 'Margin coin (USDT)',
    })
    .option('capital', {
      type: 'number',
      default: Number(process.env.HEDGE_BOT_CAPITAL) || 0,
      describe: 'Capital (vốn) để trade. Nếu 0 sẽ dùng toàn bộ equity. Sẽ chia đôi cho 2 lệnh hedge.',
    })
    .option('leverage', {
      type: 'number',
      default: Number(process.env.HEDGE_BOT_LEVERAGE) || 10,
      describe: 'Leverage - Mặc định: 10x',
    })
    .option('interval', {
      type: 'number',
      default: Number(process.env.HEDGE_BOT_INTERVAL) || 5,
      describe: 'Thời gian check (phút) - Mặc định: 5 phút',
    })
    // Technical
    .option('tick', {
      type: 'number',
      default: Number(process.env.HEDGE_BOT_PRICE_TICK) || 0,
      describe: 'Price tick size (set 0 to auto detect)',
    })
    .option('sizeStep', {
      type: 'number',
      default: Number(process.env.HEDGE_BOT_SIZE_STEP) || 0,
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

  console.log(`[CONFIG] Cấu hình Hedge Trading Bot:`);
  console.log(`  - Symbol: ${argv.symbol}`);
  console.log(`  - Margin Coin: ${argv.margin}`);
  console.log(`  - Capital: ${capital > 0 ? `${capital} ${argv.margin} (${capital/2} cho mỗi lệnh)` : 'Tự động (chia đôi equity)'}`);
  console.log(`  - Leverage: ${argv.leverage}x`);
  console.log(`  - Check Interval: ${argv.interval} phút`);
  console.log(`  - Chiến lược: Hedge Trading (Long + Short)`);
  console.log(`  - Lợi nhuận mục tiêu: 5% (đóng lệnh và mở lại)`);
  console.log(`  - Nguồn dữ liệu: Binance đa khung thời gian`);
  console.log(`  - AI: Google Gemini (Phân tích xu hướng)`);

  const bot = new HedgeBot({
    apiClient,
    config: {
      symbol: argv.symbol,
      marginCoin: argv.margin || 'USDT',
      capital: capital > 0 ? capital : null, // null = dùng toàn bộ equity (chia đôi)
      leverage: argv.leverage,
      
      // Technical
      priceTickSize: argv.tick,
      sizeStep: argv.sizeStep,
      
      // Run interval
      runIntervalMs: argv.interval * 60 * 1000,
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

