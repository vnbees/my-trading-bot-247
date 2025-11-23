#!/usr/bin/env node

/**
 * Entry point cho Grid Trading Bot
 * 
 * Usage:
 *   node startGrid.js --key=... --secret=... --passphrase=... --symbol=XRPUSDT_UMCBL
 */

const { hideBin } = require('yargs/helpers');
const yargs = require('yargs/yargs');
require('dotenv').config();

const { GridBot } = require('./gridBot');
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
      default: process.env.GRID_SYMBOL || 'BTCUSDT_UMCBL',
      describe: 'Perpetual contract symbol',
    })
    .option('margin', {
      type: 'string',
      default: process.env.GRID_MARGIN_COIN || 'USDT',
      describe: 'Margin coin (USDT)',
    })
    .option('capital', {
      type: 'number',
      default: Number(process.env.GRID_CAPITAL_USDT) || 6,
      describe: 'Margin per side (USDT)',
    })
    .option('leverage', {
      type: 'number',
      default: Number(process.env.GRID_LEVERAGE) || 10,
      describe: 'Leverage (BẮT BUỘC: 10x)',
    })
    // ADX Filter
    .option('adxTimeFrame', {
      type: 'string',
      default: process.env.GRID_ADX_TIME_FRAME || '1m',
      describe: 'ADX time frame (1m)',
    })
    .option('adxPeriod', {
      type: 'number',
      default: Number(process.env.GRID_ADX_PERIOD) || 14,
      describe: 'ADX period',
    })
    .option('adxThreshold', {
      type: 'number',
      default: Number(process.env.GRID_ADX_THRESHOLD_MAX) || 25,
      describe: 'ADX threshold max (Grid ON khi ADX < threshold)',
    })
    // Grid Parameters
    .option('gridStep', {
      type: 'number',
      default: Number(process.env.GRID_STEP_PERCENT) || 0.5,
      describe: 'Grid step percent (0.5%)',
    })
    .option('tp', {
      type: 'number',
      default: Number(process.env.GRID_TP_PERCENT) || 0.5,
      describe: 'Take profit percent cho đòn bẩy 10x (e.g. 0.5 = 0.5%). Sẽ tự động điều chỉnh theo leverage',
    })
    .option('cooldown', {
      type: 'number',
      default: Number(process.env.GRID_COOLDOWN_MINUTES) || 5,
      describe: 'Minutes between order pairs',
    })
    .option('timeout', {
      type: 'number',
      default: Number(process.env.GRID_MAX_POSITION_MINUTES) || 15,
      describe: 'Minutes before force-closing both sides',
    })
    // Technical
    .option('tick', {
      type: 'number',
      default: Number(process.env.GRID_PRICE_TICK) || 0,
      describe: 'Price tick size (set 0 to auto detect)',
    })
    .option('sizeStep', {
      type: 'number',
      default: Number(process.env.GRID_SIZE_STEP) || 0,
      describe: 'Quantity step size (set 0 to auto detect)',
    })
    .option('poll', {
      type: 'number',
      default: Number(process.env.GRID_POLL_SECONDS) || 5,
      describe: 'Seconds between position checks',
    })
    .help()
    .alias('help', 'h').argv;

  const apiClient = new BitgetApi({
    apiKey: argv.key,
    apiSecret: argv.secret,
    passphrase: argv.passphrase || process.env.BITGET_PASSPHRASE || '',
  });

  // Điều chỉnh TP theo đòn bẩy
  // TP base = 0.5% (giữ nguyên cho mọi leverage)
  // Lợi nhuận thực tế = TP base × leverage
  // Ví dụ: 10x → 0.5% × 10 = 5%, 20x → 0.5% × 20 = 10%
  const adjustedTp = argv.tp; // Giữ nguyên 0.5% cho mọi leverage
  
  console.log(`[CONFIG] Điều chỉnh TP theo đòn bẩy:`);
  console.log(`  - TP base: ${adjustedTp.toFixed(2)}% (giữ nguyên cho mọi leverage)`);
  console.log(`  - TP giá (${argv.leverage}x): ${adjustedTp.toFixed(2)}%`);
  console.log(`  - Lợi nhuận thực tế khi chạm TP: ${adjustedTp.toFixed(2)}% × ${argv.leverage}x = ${(adjustedTp * argv.leverage).toFixed(2)}%`);
  console.log(`  - takeProfitPercent (decimal): ${(adjustedTp / 100).toFixed(4)}`);

  const bot = new GridBot({
    apiClient,
    config: {
      symbol: argv.symbol,
      marginCoin: argv.margin || 'USDT',
      capitalPerSide: argv.capital,
      leverage: argv.leverage,
      takeProfitPercent: adjustedTp / 100,
      
      // ADX Filter
      adxTimeFrame: argv.adxTimeFrame,
      adxPeriod: argv.adxPeriod,
      adxThresholdMax: argv.adxThreshold,
      
      // Technical
      priceTickSize: argv.tick,
      sizeStep: argv.sizeStep,
      cooldownMs: argv.cooldown * 60 * 1000,
      maxPositionDurationMs: argv.timeout * 60 * 1000,
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

