#!/usr/bin/env node

/**
 * Entry point cho EMA Trend Trading Bot (4 EMA: 25, 50, 100, 200)
 * 
 * Usage:
 *   node startEmaTrend.js --key=... --secret=... --passphrase=... --symbol=BTCUSDT_UMCBL
 */

const { hideBin } = require('yargs/helpers');
const yargs = require('yargs/yargs');
require('dotenv').config();

const { EmaTrendBot } = require('./emaTrendBot');
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
      default: process.env.EMA_TREND_SYMBOL || 'BTCUSDT_UMCBL',
      describe: 'Perpetual contract symbol',
    })
    .option('margin', {
      type: 'string',
      default: process.env.EMA_TREND_MARGIN_COIN || 'USDT',
      describe: 'Margin coin (USDT)',
    })
    .option('capital', {
      type: 'number',
      default: Number(process.env.EMA_TREND_CAPITAL) || 0,
      describe: 'Capital (vốn) để trade. Nếu 0 sẽ dùng toàn bộ equity hiện có',
    })
    .option('leverage', {
      type: 'number',
      default: Number(process.env.EMA_TREND_LEVERAGE) || 10,
      describe: 'Leverage - Mặc định: 10x',
    })
    // Timeframe
    .option('timeFrame', {
      type: 'string',
      default: process.env.EMA_TREND_TIME_FRAME || '5m',
      describe: 'Time frame cho tất cả chỉ báo (1m, 5m, 15m, etc.)',
    })
    // EMA Parameters
    .option('ema25', {
      type: 'number',
      default: Number(process.env.EMA_TREND_EMA25) || 25,
      describe: 'EMA 25 period - Mặc định: 25',
    })
    .option('ema50', {
      type: 'number',
      default: Number(process.env.EMA_TREND_EMA50) || 50,
      describe: 'EMA 50 period - Mặc định: 50',
    })
    .option('ema100', {
      type: 'number',
      default: Number(process.env.EMA_TREND_EMA100) || 100,
      describe: 'EMA 100 period - Mặc định: 100',
    })
    .option('ema200', {
      type: 'number',
      default: Number(process.env.EMA_TREND_EMA200) || 200,
      describe: 'EMA 200 period - Mặc định: 200',
    })
    // ATR Parameters
    .option('atrPeriod', {
      type: 'number',
      default: Number(process.env.EMA_TREND_ATR_PERIOD) || 14,
      describe: 'ATR period - Mặc định: 14',
    })
    .option('atrMultiplier', {
      type: 'number',
      default: Number(process.env.EMA_TREND_ATR_MULTIPLIER) || 2,
      describe: 'ATR multiplier cho TP/SL - Mặc định: 2',
    })
    // Technical
    .option('tick', {
      type: 'number',
      default: Number(process.env.EMA_TREND_PRICE_TICK) || 0,
      describe: 'Price tick size (set 0 to auto detect)',
    })
    .option('sizeStep', {
      type: 'number',
      default: Number(process.env.EMA_TREND_SIZE_STEP) || 0,
      describe: 'Quantity step size (set 0 to auto detect)',
    })
    .option('poll', {
      type: 'number',
      default: Number(process.env.EMA_TREND_POLL_SECONDS) || 300,
      describe: 'Seconds between checks (mặc định: 300s = 5 phút)',
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

  console.log(`[CONFIG] Cấu hình bot:`);
  console.log(`  - Symbol: ${argv.symbol}`);
  console.log(`  - Margin Coin: ${argv.margin}`);
  console.log(`  - Capital: ${capital > 0 ? `${capital} ${argv.margin} (số tiền vào lệnh)` : 'Tự động (dùng toàn bộ equity)'}`);
  console.log(`  - Leverage: ${argv.leverage}x`);
  console.log(`  - Timeframe: ${argv.timeFrame}`);
  console.log(`  - EMA Periods: ${argv.ema25}, ${argv.ema50}, ${argv.ema100}, ${argv.ema200}`);
  console.log(`  - ATR Period: ${argv.atrPeriod}, Multiplier: ${argv.atrMultiplier}`);

  const bot = new EmaTrendBot({
    apiClient,
    config: {
      symbol: argv.symbol,
      marginCoin: argv.margin || 'USDT',
      capital: capital > 0 ? capital : null, // null = dùng toàn bộ equity
      leverage: argv.leverage,
      
      // Timeframe
      timeFrame: argv.timeFrame,
      
      // EMA
      ema25: argv.ema25,
      ema50: argv.ema50,
      ema100: argv.ema100,
      ema200: argv.ema200,
      
      // ATR
      atrPeriod: argv.atrPeriod,
      atrMultiplier: argv.atrMultiplier,
      
      // Technical
      priceTickSize: argv.tick,
      sizeStep: argv.sizeStep,
      pollIntervalMs: argv.poll * 1000,
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

