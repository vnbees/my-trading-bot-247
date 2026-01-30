#!/usr/bin/env node

/**
 * Entry point cho SMC Trading Bot (Smart Money Concepts)
 *
 * Bot này sử dụng Google Gemini AI để phân tích Price Action và phát hiện
 * tín hiệu "Liquidity Sweep/Fakeout" (SMC Strategy):
 * - SHORT: High > Range_High nhưng Close < Range_High (Upthrust)
 * - LONG: Low < Range_Low nhưng Close > Range_Low (Spring)
 *
 * Usage (ví dụ):
 *   # Mock mode (chỉ log, không đặt lệnh thật):
 *   node startSMCBot.js --gemini-key=... --symbol=BTCUSDT --interval=15m
 *
 *   # Real mode (đặt lệnh thật qua Bitget):
 *   node startSMCBot.js --gemini-key=... --key=... --secret=... --symbol=BTCUSDT_UMCBL --interval=15m
 */

const { hideBin } = require('yargs/helpers');
const yargs = require('yargs/yargs');
require('dotenv').config();

const { SMCTradingBot } = require('./smcTradingBot');
const { BitgetApi } = require('./bitgetApi');

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option('gemini-key', {
      type: 'string',
      describe: 'Google Gemini API key',
      default: process.env.GOOGLE_API_KEY,
      demandOption: true,
    })
    .option('key', {
      type: 'string',
      describe: 'Bitget API key (optional, nếu không có sẽ chạy mock mode)',
      demandOption: false,
    })
    .option('secret', {
      type: 'string',
      describe: 'Bitget API secret (optional)',
      demandOption: false,
    })
    .option('passphrase', {
      type: 'string',
      describe: 'Bitget API passphrase (optional)',
      demandOption: false,
    })
    .option('symbol', {
      type: 'string',
      default: process.env.SMC_BOT_SYMBOL || 'BTCUSDT',
      describe: 'Symbol (ví dụ: BTCUSDT cho Binance, BTCUSDT_UMCBL cho Bitget)',
    })
    .option('interval', {
      type: 'string',
      default: process.env.SMC_BOT_INTERVAL || '15m',
      choices: ['5m', '15m', '30m', '1h'],
      describe: 'Timeframe (5m, 15m, 30m, 1h)',
    })
    .option('margin', {
      type: 'string',
      default: process.env.SMC_BOT_MARGIN_COIN || 'USDT',
      describe: 'Margin coin (USDT)',
    })
    .option('capital', {
      type: 'number',
      default: Number(process.env.SMC_BOT_CAPITAL) || 100,
      describe: 'Capital cho mỗi lệnh (USDT)',
    })
    .option('leverage', {
      type: 'number',
      default: Number(process.env.SMC_BOT_LEVERAGE) || 10,
      describe: 'Leverage mặc định (x)',
    })
    .option('risk', {
      type: 'number',
      default: Number(process.env.SMC_BOT_RISK_PERCENT) || 1,
      describe: 'Risk percentage per trade (1 = 1% equity)',
    })
    .option('tick', {
      type: 'number',
      default: Number(process.env.SMC_BOT_PRICE_TICK) || 0,
      describe: 'Price tick size (0 = auto detect từ Bitget)',
    })
    .option('sizeStep', {
      type: 'number',
      default: Number(process.env.SMC_BOT_SIZE_STEP) || 0,
      describe: 'Quantity step size (0 = auto detect từ Bitget)',
    })
    .option('mock-balance', {
      type: 'number',
      default: Number(process.env.SMC_BOT_MOCK_BALANCE) || 1000,
      describe: 'Mock balance cho mock mode (USDT)',
    })
    .help()
    .alias('help', 'h').argv;

  // Kiểm tra mode
  const isRealMode = !!(argv.key && argv.secret);
  let apiClient = null;

  if (isRealMode) {
    apiClient = new BitgetApi({
      apiKey: argv.key,
      apiSecret: argv.secret,
      passphrase: argv.passphrase || process.env.BITGET_PASSPHRASE || '',
    });
    console.log('[CONFIG] ✅ Real Mode: Sẽ đặt lệnh thật qua Bitget API');
  } else {
    console.log('[CONFIG] ⚠️  Mock Mode: Chỉ log trade details, không đặt lệnh thật');
    console.log('[CONFIG] 💡 Để chạy real mode, thêm --key và --secret');
  }

  console.log('[CONFIG] Cấu hình SMC Trading Bot:');
  console.log(`  - Symbol: ${argv.symbol}`);
  console.log(`  - Interval: ${argv.interval}`);
  console.log(`  - Margin Coin: ${argv.margin}`);
  console.log(`  - Capital: ${argv.capital} ${argv.margin}`);
  console.log(`  - Leverage: ${argv.leverage}x`);
  console.log(`  - Risk: ${argv.risk}% per trade`);
  if (!isRealMode) {
    console.log(`  - Mock Balance: ${argv['mock-balance']} USDT`);
  }
  console.log(`  - Strategy: Liquidity Sweep/Fakeout (SMC)`);
  console.log(`  - AI: Google Gemini`);

  const bot = new SMCTradingBot({
    apiClient,
    geminiApiKey: argv['gemini-key'],
    config: {
      symbol: argv.symbol,
      interval: argv.interval,
      marginCoin: argv.margin || 'USDT',
      capital: argv.capital,
      leverage: argv.leverage,
      riskPercent: argv.risk,
      mockBalance: argv['mock-balance'],
      priceTickSize: argv.tick,
      sizeStep: argv.sizeStep,
    },
  });

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n[BOT] 🛑 Nhận tín hiệu SIGINT, đang dừng bot...');
    bot.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n[BOT] 🛑 Nhận tín hiệu SIGTERM, đang dừng bot...');
    bot.stop();
    process.exit(0);
  });

  await bot.run();
}

main().catch((err) => {
  console.error('[FATAL] ❌ Lỗi nghiêm trọng trong SMC Bot:', err.message);
  if (err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});



