#!/usr/bin/env node

/**
 * Entry point cho Trend Trading Bot (EMA Crossover + RSI Filter)
 * 
 * Usage:
 *   node startTrend.js --key=... --secret=... --passphrase=... --symbol=BTCUSDT_UMCBL
 */

const { hideBin } = require('yargs/helpers');
const yargs = require('yargs/yargs');
require('dotenv').config();

const { TrendBot } = require('./trendBot');
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
      default: process.env.TREND_SYMBOL || 'BTCUSDT_UMCBL',
      describe: 'Perpetual contract symbol',
    })
    .option('margin', {
      type: 'string',
      default: process.env.TREND_MARGIN_COIN || 'USDT',
      describe: 'Margin coin (USDT)',
    })
    .option('capital', {
      type: 'number',
      default: Number(process.env.TREND_CAPITAL) || 0,
      describe: 'Capital (vốn) để trade. Nếu 0 sẽ dùng toàn bộ equity hiện có',
    })
    .option('leverage', {
      type: 'number',
      default: Number(process.env.TREND_LEVERAGE) || 10,
      describe: 'Leverage - Mặc định: 10x',
    })
    // Timeframe
    .option('timeFrame', {
      type: 'string',
      default: process.env.TREND_TIME_FRAME || '5m',
      describe: 'Time frame cho tất cả chỉ báo (1m, 5m, 15m, etc.)',
    })
    // EMA Parameters
    .option('emaFast', {
      type: 'number',
      default: Number(process.env.TREND_EMA_FAST) || 12,
      describe: 'EMA Fast period - Mặc định: 12',
    })
    .option('emaSlow', {
      type: 'number',
      default: Number(process.env.TREND_EMA_SLOW) || 26,
      describe: 'EMA Slow period - Mặc định: 26',
    })
    // RSI Parameters
    .option('rsiPeriod', {
      type: 'number',
      default: Number(process.env.TREND_RSI_PERIOD) || 14,
      describe: 'RSI period - Mặc định: 14',
    })
    .option('rsiThreshold', {
      type: 'number',
      default: Number(process.env.TREND_RSI_THRESHOLD) || 50,
      describe: 'RSI threshold để lọc tín hiệu - Mặc định: 50',
    })
    // SL/TP Parameters
    .option('slLookback', {
      type: 'number',
      default: Number(process.env.TREND_SL_LOOKBACK) || 20,
      describe: 'Số nến để tìm đáy/đỉnh gần nhất cho SL - Mặc định: 20',
    })
    .option('rRatio', {
      type: 'number',
      default: Number(process.env.TREND_R_RATIO) || 2,
      describe: 'Risk:Reward ratio - Mặc định: 1:2',
    })
    // Technical
    .option('tick', {
      type: 'number',
      default: Number(process.env.TREND_PRICE_TICK) || 0,
      describe: 'Price tick size (set 0 to auto detect)',
    })
    .option('sizeStep', {
      type: 'number',
      default: Number(process.env.TREND_SIZE_STEP) || 0,
      describe: 'Quantity step size (set 0 to auto detect)',
    })
    .option('poll', {
      type: 'number',
      default: Number(process.env.TREND_POLL_SECONDS) || 300,
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
  console.log(`  - EMA Fast: ${argv.emaFast}, EMA Slow: ${argv.emaSlow}`);
  console.log(`  - RSI Period: ${argv.rsiPeriod}, Threshold: ${argv.rsiThreshold}`);
  console.log(`  - SL Lookback: ${argv.slLookback} nến (tìm đáy/đỉnh gần nhất)`);
  console.log(`  - Risk:Reward Ratio: 1:${argv.rRatio}`);

  const bot = new TrendBot({
    apiClient,
    config: {
      symbol: argv.symbol,
      marginCoin: argv.margin || 'USDT',
      capital: capital > 0 ? capital : null, // null = dùng toàn bộ equity
      leverage: argv.leverage,
      
      // Timeframe
      timeFrame: argv.timeFrame,
      
      // EMA
      emaFast: argv.emaFast,
      emaSlow: argv.emaSlow,
      
      // RSI
      rsiPeriod: argv.rsiPeriod,
      rsiThreshold: argv.rsiThreshold,
      
      // SL/TP
      slLookbackPeriod: argv.slLookback,
      rRatio: argv.rRatio,
      
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

