#!/usr/bin/env node

/**
 * Backtest SMC: hiển thị các vị trí CHoCH trên dữ liệu 5m / 30 ngày từ Binance.
 *
 * Tham khảo cách lấy dữ liệu giá từ backtestSmartTrend.js.
 */

const axios = require('axios');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const { calculateSMC } = require('./smc');
const { sleep, formatNumber } = require('./utils');

const argv = yargs(hideBin(process.argv))
  .option('symbol', {
    type: 'string',
    describe: 'Perpetual contract symbol (Bitget format, ví dụ: XRPUSDT_UMCBL)',
    default: 'BTCUSDT_UMCBL',
  })
  .option('timeFrame', {
    type: 'string',
    describe: 'Time frame cho nến (ví dụ: 5m, 15m)',
    default: '5m',
  })
  .option('lookbackDays', {
    type: 'number',
    describe: 'Số ngày lịch sử để lấy nến',
    default: 30,
  })
  .option('swingLookback', {
    type: 'number',
    describe: 'Số nến trái/phải để xác định swing high/low (độ nhạy CHoCH)',
    default: 2,
  })
  .option('timezoneOffset', {
    type: 'number',
    describe: 'Minutes offset from UTC khi in timestamp (vd 420 = UTC+7)',
    default: 0,
  })
  .option('limit', {
    type: 'number',
    describe: 'Giới hạn số CHoCH in ra (0 = in hết)',
    default: 100,
  })
  .help()
  .alias('help', 'h').argv;

const config = {
  symbol: argv.symbol,
  timeFrame: argv.timeFrame,
  lookbackDays: argv.lookbackDays,
  swingLookback: argv.swingLookback,
  timezoneOffset: Number(argv.timezoneOffset) || 0,
  limit: Number(argv.limit) || 0,
};

const LOOKBACK_MS = config.lookbackDays * 24 * 60 * 60 * 1000;

async function main() {
  const endTime = Date.now();
  const startTime = endTime - LOOKBACK_MS;

  const timeFrameMs = resolveTimeFrameMs(config.timeFrame);
  const binanceSymbol = normalizeSymbol(config.symbol);

  const rawCandles = await fetchHistoricalCandles(
    binanceSymbol,
    config.timeFrame,
    timeFrameMs,
    startTime,
    endTime,
  );

  if (!rawCandles.length) {
    throw new Error('Không đủ dữ liệu nến để chạy backtest SMC');
  }

  // Bỏ nến cuối cùng (có thể chưa đóng)
  rawCandles.pop();

  const candles = rawCandles.map((row) => ({
    time: row[0],
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
  }));

  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const closes = candles.map((c) => c.close);
  const times = candles.map((c) => c.time);

  const smc = calculateSMC({
    highs,
    lows,
    closes,
    opens: candles.map((c) => c.open),
    times,
    swingsLength: 50,
    internalSize: 5,
    showStructure: false, // Tắt swing structure
    showInternals: true, // Chỉ hiển thị internal structure
    showSwingOrderBlocks: false,
    showInternalOrderBlocks: false,
    showFairValueGaps: false,
    showEqualHighsLows: false,
  });

  // Lấy tất cả internal signals (cả CHoCH và BOS)
  const chochSignals = smc.chochSignals.filter((s) => s.internal);
  const bosSignals = smc.bosSignals.filter((s) => s.internal);
  const allSignals = [...chochSignals, ...bosSignals].sort((a, b) => a.index - b.index);
  
  if (!allSignals.length) {
    console.log('[SMC-BACKTEST] Không phát hiện internal signals nào trong khoảng dữ liệu.');
    return;
  }

  const bullishChoch = chochSignals.filter((s) => s.direction === 'bullish').length;
  const bearishChoch = chochSignals.filter((s) => s.direction === 'bearish').length;
  const bullishBos = bosSignals.filter((s) => s.direction === 'bullish').length;
  const bearishBos = bosSignals.filter((s) => s.direction === 'bearish').length;

  console.log(`\n[SMC-BACKTEST] Internal Signals:`);
  console.log(`  - CHoCH: ${chochSignals.length} (Bullish: ${bullishChoch}, Bearish: ${bearishChoch})`);
  console.log(`  - BOS: ${bosSignals.length} (Bullish: ${bullishBos}, Bearish: ${bearishBos})`);

  const toShow =
    config.limit > 0 ? allSignals.slice(-config.limit) : allSignals;

  console.log(`\n[SMC-BACKTEST] Danh sách Internal Signals (GMT+7):`);
  toShow.forEach((sig, idx) => {
    const candle = candles[sig.index] || null;
    const timeLocal = formatTimestampWithOffset(
      sig.time || (candle ? candle.time : null),
      config.timezoneOffset,
    );
    const trendLabel = sig.trendBiasBefore === 1 ? 'BULLISH' : sig.trendBiasBefore === -1 ? 'BEARISH' : 'NEUTRAL';
    const passedFilter = sig.passedExtraCondition !== undefined ? (sig.passedExtraCondition ? '✓' : '✗') : '';
    console.log(`  ${idx + 1}. ${sig.direction.toUpperCase()} ${sig.type} | ${timeLocal} | Trend before: ${trendLabel} ${passedFilter}`);
  });
}

main().catch((err) => {
  console.error('[SMC-BACKTEST] ❌', err.message);
  if (err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});

function resolveTimeFrameMs(timeFrame) {
  const match = timeFrame.match(/^(\d+)([mhd])$/i);
  if (!match) {
    throw new Error('Timeframe không hợp lệ (ví dụ: 5m, 1h, 1d)');
  }
  const unit = match[2].toLowerCase();
  const value = Number(match[1]);
  const unitSeconds = unit === 'm' ? 60 : unit === 'h' ? 3600 : 86400;
  return value * unitSeconds * 1000;
}

function normalizeSymbol(symbol) {
  return symbol.replace(/_(UMCBL|CMCBL|DMCBL)$/i, '').toUpperCase();
}

async function fetchHistoricalCandles(
  binanceSymbol,
  interval,
  intervalMs,
  startTime,
  endTime,
) {
  const limit = 1000;
  const candles = [];
  let cursor = startTime;

  while (cursor < endTime) {
    const params = {
      symbol: binanceSymbol,
      interval,
      startTime: cursor,
      endTime,
      limit,
    };

    const response = await axios.get(
      'https://api.binance.com/api/v3/klines',
      {
        params,
        timeout: 10000,
      },
    );

    if (!Array.isArray(response.data) || response.data.length === 0) {
      break;
    }

    candles.push(...response.data);

    const last = response.data[response.data.length - 1];
    cursor = Number(last[0]) + intervalMs;

    if (response.data.length < limit) {
      break;
    }

    await sleep(250);
  }

  return candles.filter(
    (row) => row[0] >= startTime && row[0] < endTime,
  );
}

function formatTimestampWithOffset(timestamp, offsetMinutes) {
  if (!timestamp && timestamp !== 0) return '-';
  const base = Number(timestamp);
  if (Number.isNaN(base)) return String(timestamp);
  const adjusted = new Date(base + offsetMinutes * 60000);
  // Format: YYYY-MM-DD HH:MM:SS (GMT+7)
  const year = adjusted.getUTCFullYear();
  const month = String(adjusted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(adjusted.getUTCDate()).padStart(2, '0');
  const hours = String(adjusted.getUTCHours()).padStart(2, '0');
  const minutes = String(adjusted.getUTCMinutes()).padStart(2, '0');
  const seconds = String(adjusted.getUTCSeconds()).padStart(2, '0');
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absMinutes = Math.abs(offsetMinutes);
  const offsetHours = Math.floor(absMinutes / 60);
  const offsetMins = absMinutes % 60;
  const offsetLabel = offsetMins > 0 
    ? `${sign}${String(offsetHours).padStart(2, '0')}:${String(offsetMins).padStart(2, '0')}`
    : `${sign}${offsetHours}`;
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} (GMT${offsetLabel})`;
}


