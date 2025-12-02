#!/usr/bin/env node

/**
 * Entry point cho Range-Based Trading Bot
 *
 * Bot này theo dõi chart 1h và giao dịch dựa trên:
 * - Tính trung bình biên độ (range) của 720 cây nến 1h gần nhất (1 tháng)
 * - ROI target = trung bình biên độ * leverage
 * - Quy tắc: nến xanh → SHORT, nến đỏ → LONG
 * - Chạy đúng vào đầu giờ (khi nến mới mở)
 *
 * Usage (ví dụ):
 *   node startRangeBasedBot.js --key=... --secret=... --passphrase=... --symbol=BTCUSDT_UMCBL --capital=50 --leverage=10
 */

const { hideBin } = require('yargs/helpers');
const yargs = require('yargs/yargs');
require('dotenv').config();

const { RangeBasedBot } = require('./rangeBasedBot');
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
      describe: 'Bitget API passphrase (nếu API key yêu cầu)',
      demandOption: false,
    })
    .option('symbol', {
      type: 'string',
      default: process.env.RANGE_BOT_SYMBOL || 'BTCUSDT_UMCBL',
      describe: 'Perpetual contract symbol (ví dụ: XRPUSDT_UMCBL)',
    })
    .option('margin', {
      type: 'string',
      default: process.env.RANGE_BOT_MARGIN_COIN || 'USDT',
      describe: 'Margin coin (USDT)',
    })
    .option('capital', {
      type: 'number',
      default: Number(process.env.RANGE_BOT_CAPITAL) || 10,
      describe: 'Capital cho mỗi lệnh (USDT)',
    })
    .option('leverage', {
      type: 'number',
      default: Number(process.env.RANGE_BOT_LEVERAGE) || 10,
      describe: 'Leverage mặc định (x)',
    })
    .option('tick', {
      type: 'number',
      default: Number(process.env.RANGE_BOT_PRICE_TICK) || 0,
      describe: 'Price tick size (0 = auto detect từ Bitget)',
    })
    .option('sizeStep', {
      type: 'number',
      default: Number(process.env.RANGE_BOT_SIZE_STEP) || 0,
      describe: 'Quantity step size (0 = auto detect từ Bitget)',
    })
    .help()
    .alias('help', 'h').argv;

  const apiClient = new BitgetApi({
    apiKey: argv.key,
    apiSecret: argv.secret,
    passphrase: argv.passphrase || process.env.BITGET_PASSPHRASE || '',
  });

  console.log('[CONFIG] Cấu hình Range-Based Trading Bot:');
  console.log(`  - Symbol: ${argv.symbol}`);
  console.log(`  - Margin Coin: ${argv.margin}`);
  console.log(`  - Capital mỗi lệnh: ${argv.capital} ${argv.margin}`);
  console.log(`  - Leverage: ${argv.leverage}x`);
  console.log(`  - Timeframe: 1h`);
  console.log(`  - Logic: Nến xanh → SHORT, Nến đỏ → LONG`);
  console.log(`  - TP: ROI target (trung bình biên độ × leverage)`);
  console.log(`  - SL: Không có`);

  const bot = new RangeBasedBot({
    apiClient,
    config: {
      symbol: argv.symbol,
      marginCoin: argv.margin || 'USDT',
      capital: argv.capital,
      leverage: argv.leverage,
      priceTickSize: argv.tick,
      sizeStep: argv.sizeStep,
    },
  });

  await bot.run();
}

main().catch((err) => {
  console.error('[FATAL] ❌ Lỗi nghiêm trọng trong Range-Based Bot:', err.message);
  if (err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});

