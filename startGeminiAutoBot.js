#!/usr/bin/env node

/**
 * Entry point cho Gemini Auto Trading Bot
 *
 * Bot này giao toàn quyền quyết định cho Gemini AI:
 * - AI được cấp dữ liệu giá đa khung thời gian (Binance), chỉ báo, số dư, vị thế,
 *   lịch sử lệnh, nhật ký quyết định trước đó...
 * - AI trả về các actions (open/close/add/partial/rebalance/hold...) ở dạng JSON.
 * - Bot chỉ kiểm tra ràng buộc kỹ thuật (min 1 USDT, size tối thiểu, free margin...)
 *   rồi thực thi đúng theo AI.
 *
 * Usage (ví dụ):
 *   node startGeminiAutoBot.js --key=... --secret=... --passphrase=... --symbol=BTCUSDT_UMCBL --capital=50 --leverage=10
 */

const { hideBin } = require('yargs/helpers');
const yargs = require('yargs/yargs');
require('dotenv').config();

const { GeminiAutoBot } = require('./geminiAutoBot');
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
      default: process.env.GEMINI_AUTO_SYMBOL || 'BTCUSDT_UMCBL',
      describe: 'Perpetual contract symbol (ví dụ: XRPUSDT_UMCBL)',
    })
    .option('margin', {
      type: 'string',
      default: process.env.GEMINI_AUTO_MARGIN_COIN || 'USDT',
      describe: 'Margin coin (USDT)',
    })
    .option('capital', {
      type: 'number',
      default: Number(process.env.GEMINI_AUTO_CAPITAL) || 0,
      describe:
        'Capital tối đa (USDT) bot được phép dùng. Nếu 0 sẽ dùng tối đa toàn bộ equity.',
    })
    .option('leverage', {
      type: 'number',
      default: Number(process.env.GEMINI_AUTO_LEVERAGE) || 10,
      describe: 'Leverage mặc định (x)',
    })
    .option('tick', {
      type: 'number',
      default: Number(process.env.GEMINI_AUTO_PRICE_TICK) || 0,
      describe: 'Price tick size (0 = auto detect từ Bitget)',
    })
    .option('sizeStep', {
      type: 'number',
      default: Number(process.env.GEMINI_AUTO_SIZE_STEP) || 0,
      describe: 'Quantity step size (0 = auto detect từ Bitget)',
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
  if (isNaN(capital)) capital = 0;

  console.log('[CONFIG] Cấu hình Gemini Auto Trading Bot:');
  console.log(`  - Symbol: ${argv.symbol}`);
  console.log(`  - Margin Coin: ${argv.margin}`);
  console.log(
    `  - Capital tối đa: ${
      capital > 0 ? `${capital} ${argv.margin}` : 'Tự động (dùng tối đa equity)'
    }`
  );
  console.log(`  - Leverage: ${argv.leverage}x`);
  console.log(
    `  - AI: Gemini toàn quyền (full auto), dùng lịch sử lệnh + trạng thái tài khoản để tối ưu`
  );

  const bot = new GeminiAutoBot({
    apiClient,
    config: {
      symbol: argv.symbol,
      marginCoin: argv.margin || 'USDT',
      capital: capital > 0 ? capital : null,
      leverage: argv.leverage,
      priceTickSize: argv.tick,
      sizeStep: argv.sizeStep,
      // runIntervalMs sẽ được override bởi nextCheckMinutes từ AI
      runIntervalMs: 30 * 60 * 1000,
    },
  });

  await bot.run();
}

main().catch((err) => {
  console.error('[FATAL] ❌ Lỗi nghiêm trọng trong Gemini Auto Bot:', err.message);
  if (err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});


