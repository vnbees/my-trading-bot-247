#!/usr/bin/env node

/**
 * Entry point - parse CLI args and kick off bot runtime.
 */

const { hideBin } = require('yargs/helpers');
const yargs = require('yargs/yargs');
require('dotenv').config();

const { BotLogic } = require('./botLogic');
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
      default: process.env.BOT_SYMBOL || 'BTCUSDT_UMCBL',
      describe: 'Perpetual contract symbol',
    })
    .option('margin', {
      type: 'string',
      default: process.env.BOT_MARGIN_COIN || 'USDT',
      describe: 'Margin coin (USDT)',
    })
    .option('capital', {
      type: 'number',
      default: Number(process.env.BOT_CAPITAL_USDT) || 6,
      describe: 'Margin per side (USDT)',
    })
    .option('tp', {
      type: 'number',
      default: Number(process.env.BOT_TP_PERCENT) || 0.6,
      describe: 'Take profit percent cho đòn bẩy 5x (e.g. 0.6 = 0.6%). Sẽ tự động điều chỉnh theo leverage',
    })
    .option('sl', {
      type: 'number',
      default: Number(process.env.BOT_SL_PERCENT) || 0.3,
      describe: 'Stop loss percent cho đòn bẩy 5x (e.g. 0.3 = 0.3%). Sẽ tự động điều chỉnh theo leverage',
    })
    .option('leverage', {
      type: 'number',
      default: Number(process.env.BOT_LEVERAGE) || 5,
      describe: 'Position leverage',
    })
    .option('cooldown', {
      type: 'number',
      default: Number(process.env.BOT_COOLDOWN_MINUTES) || 5,
      describe: 'Minutes between order pairs',
    })
    .option('timeout', {
      type: 'number',
      default: Number(process.env.BOT_MAX_POSITION_MINUTES) || 15,
      describe: 'Minutes before force-closing both sides',
    })
    .option('poll', {
      type: 'number',
      default: Number(process.env.BOT_POLL_SECONDS) || 5,
      describe: 'Seconds between position checks',
    })
    .option('tick', {
      type: 'number',
      default: Number(process.env.BOT_PRICE_TICK) || 0,
      describe: 'Price tick size (set 0 to auto detect)',
    })
    .option('sizeStep', {
      type: 'number',
      default: Number(process.env.BOT_SIZE_STEP) || 0,
      describe: 'Quantity step size (set 0 to auto detect)',
    })
    .help()
    .alias('help', 'h').argv;

  const apiClient = new BitgetApi({
    apiKey: argv.key,
    apiSecret: argv.secret,
    passphrase: argv.passphrase || process.env.BITGET_PASSPHRASE || '',
  });

  // Điều chỉnh TP/SL theo đòn bẩy
  // QUAN TRỌNG: TP/SL base (0.6% và 0.3%) được định nghĩa cho đòn bẩy 5x
  // TP giá giữ nguyên base (0.6%), nhưng lợi nhuận tăng theo leverage
  // 
  // Ví dụ: base 0.6% với leverage 10x
  //   - TP giá = entryPrice × (1 + 0.6%) = giữ nguyên
  //   - Lợi nhuận = 0.6% × 10 = 6% ✅
  // 
  // Công thức: TP/SL giá = TP/SL base (giữ nguyên), lợi nhuận = TP/SL base × leverage
  const adjustedTp = argv.tp; // Giữ nguyên base
  const adjustedSl = argv.sl; // Giữ nguyên base
  
  console.log(`[CONFIG] Điều chỉnh TP/SL theo đòn bẩy:`);
  console.log(`  - Base (5x): TP=${argv.tp}%, SL=${argv.sl}%`);
  console.log(`  - TP/SL giá (${argv.leverage}x): TP=${adjustedTp.toFixed(2)}%, SL=${adjustedSl.toFixed(2)}% (giữ nguyên)`);
  console.log(`  - Lợi nhuận thực tế khi chạm TP: ${adjustedTp.toFixed(2)}% × ${argv.leverage}x = ${(adjustedTp * argv.leverage).toFixed(2)}%`);
  console.log(`  - takeProfitPercent (decimal): ${(adjustedTp / 100).toFixed(4)}, stopLossPercent: ${(adjustedSl / 100).toFixed(4)}`);

  const bot = new BotLogic({
    apiClient,
    config: {
      symbol: argv.symbol,
      marginCoin: argv.margin || 'USDT',
      capitalPerSide: argv.capital,
      leverage: argv.leverage,
      takeProfitPercent: adjustedTp / 100,
      stopLossPercent: adjustedSl / 100,
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

