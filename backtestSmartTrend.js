#!/usr/bin/env node

const axios = require('axios');
const { EMA, ADX } = require('technicalindicators');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const {
  sleep,
  formatNumber,
  roundToTick,
  roundToStep,
  getDecimalsFromStep,
} = require('./utils');

const argv = yargs(hideBin(process.argv))
  .option('symbol', {
    type: 'string',
    describe: 'Perpetual contract symbol (follow Bitget format)',
    default: 'BTCUSDT_UMCBL',
  })
  .option('timeFrame', {
    type: 'string',
    describe: 'Time frame for candles (e.g., 5m, 1h)',
    default: '5m',
  })
  .option('lookbackDays', {
    type: 'number',
    describe: 'How many days back to fetch candles',
    default: 30,
  })
  .option('start', {
    type: 'string',
    describe: 'ISO date or timestamp for the backtest window start (optional)',
  })
  .option('end', {
    type: 'string',
    describe: 'ISO date or timestamp for the backtest window end (defaults to now)',
  })
  .option('capital', {
    type: 'number',
    describe: 'Capital per trade. If 0, uses entire equity.',
    default: 1,
  })
  .option('initialEquity', {
    type: 'number',
    describe: 'Starting equity for the backtest (used when capital=0)',
    default: 100,
  })
  .option('leverage', {
    type: 'number',
    describe: 'Leverage used for sizing',
    default: 10,
  })
  .option('emaFast', {
    type: 'number',
    describe: 'Fast EMA period',
    default: 12,
  })
  .option('emaSlow', {
    type: 'number',
    describe: 'Slow EMA period',
    default: 26,
  })
  .option('adxPeriod', {
    type: 'number',
    describe: 'ADX period',
    default: 14,
  })
  .option('adxThreshold', {
    type: 'number',
    describe: 'ADX threshold to detect strength',
    default: 25,
  })
  .option('slLookback', {
    type: 'number',
    describe: 'Candles to scan when deriving SL/TP',
    default: 50,
  })
  .option('rRatio', {
    type: 'number',
    describe: 'Risk:Reward ratio',
    default: 2,
  })
  .option('timezoneOffset', {
    type: 'number',
    describe: 'Minutes offset from UTC for displaying timestamps (e.g., 420 for UTC+7)',
    default: 0,
  })
  .option('fee', {
    type: 'boolean',
    describe: 'True để tính thêm phí giao dịch theo đòn bẩy (x10=1.2%, x5=0.5%)',
    default: false,
  })
  .option('feeBasis', {
    type: 'string',
    describe: 'Cơ sở tính phí: "notional" (đòn bẩy × vốn) hoặc "capital" (chỉ vốn)',
    choices: ['notional', 'capital'],
    default: 'notional',
  })
  .option('priceTick', {
    type: 'number',
    describe: 'Price tick size (0 = no rounding)',
    default: 0,
  })
  .option('sizeStep', {
    type: 'number',
    describe: 'Quantity step size (0 = no rounding)',
    default: 0,
  })
  .option('minLotSize', {
    type: 'number',
    describe: 'Force a minimum lot size for the simulated contract',
    default: 0.001,
  })
  .option('verbose', {
    type: 'boolean',
    describe: 'Log every trade detail',
    default: false,
  })
  .help()
  .alias('help', 'h').argv;

const config = {
  symbol: argv.symbol,
  timeFrame: argv.timeFrame,
  lookbackDays: argv.lookbackDays,
  start: argv.start,
  end: argv.end,
  capital: argv.capital > 0 ? argv.capital : null,
  initialEquity: argv.initialEquity,
  leverage: argv.leverage,
  emaFast: argv.emaFast,
  emaSlow: argv.emaSlow,
  adxPeriod: argv.adxPeriod,
  adxThreshold: argv.adxThreshold,
  slLookback: argv.slLookback,
  rRatio: argv.rRatio,
  priceTick: argv.priceTick,
  sizeStep: argv.sizeStep,
  minLotSize: argv.minLotSize,
  priceDecimals: argv.priceTick > 0 ? getDecimalsFromStep(argv.priceTick) : 4,
  verbose: argv.verbose,
  timezoneOffset: Number(argv.timezoneOffset) || 0,
  fee: argv.fee,
  feeBasis: argv.feeBasis || 'notional',
};

const LOOKBACK_MS = config.lookbackDays * 24 * 60 * 60 * 1000;

async function main() {
  const endTime = parseDateOption(config.end, Date.now());
  const startTime = parseDateOption(config.start, endTime - LOOKBACK_MS);
  if (startTime >= endTime) {
    throw new Error('Start time must be before end time');
  }

  const timeFrameMs = resolveTimeFrameMs(config.timeFrame);
  const binanceSymbol = normalizeSymbol(config.symbol);

  console.log(`[BACKTEST] Ký hiệu: ${config.symbol} (Binance ${binanceSymbol})`);
  console.log(`[BACKTEST] Khung thời gian: ${config.timeFrame}, khoảng: ${new Date(startTime).toISOString()} → ${new Date(endTime).toISOString()}`);
  console.log(`[BACKTEST] Hiển thị thời gian theo UTC${formatOffset(config.timezoneOffset)}`);

  const rawCandles = await fetchHistoricalCandles(binanceSymbol, config.timeFrame, timeFrameMs, startTime, endTime);
  if (rawCandles.length === 0) {
    throw new Error('Không đủ dữ liệu nến để chạy backtest');
  }

  // Drop the latest candle assuming it might still be forming
  rawCandles.pop();

  console.log(`[BACKTEST] Đã tải ${rawCandles.length} nến đóng`);

  const candles = rawCandles.map((item) => ({
    time: item[0],
    open: Number(item[1]),
    high: Number(item[2]),
    low: Number(item[3]),
    close: Number(item[4]),
    volume: Number(item[5]),
  }));

  const indicators = buildIndicatorData(candles, config);
  const { trades, endingEquity, maxConcurrentTrades } = runSimulation(candles, indicators, config);

  renderSummary(trades, endingEquity, config, maxConcurrentTrades);
}

main().catch((err) => {
  console.error('[BACKTEST] ❌', err.message);
  if (err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});

function parseDateOption(value, fallback) {
  if (value === undefined || value === null) {
    return fallback;
  }
  const numeric = Number(value);
  if (!Number.isNaN(numeric)) {
    return numeric;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Không thể parse thời điểm "${value}"`);
  }
  return parsed;
}

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

async function fetchHistoricalCandles(binanceSymbol, interval, intervalMs, startTime, endTime) {
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

    const response = await axios.get('https://api.binance.com/api/v3/klines', {
      params,
      timeout: 10000,
    });

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

  return candles.filter((row) => row[0] >= startTime && row[0] < endTime);
}

function buildIndicatorData(candles, config) {
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);

  const emaFastArray = EMA.calculate({ period: config.emaFast, values: closes });
  const emaSlowArray = EMA.calculate({ period: config.emaSlow, values: closes });
  const adxArray = ADX.calculate({ period: config.adxPeriod, high: highs, low: lows, close: closes });
  const emaFast = Array(candles.length).fill(null);
  const emaSlow = Array(candles.length).fill(null);
  const adx = Array(candles.length).fill(null);

  for (let i = config.emaFast - 1; i < candles.length; i++) {
    emaFast[i] = emaFastArray[i - (config.emaFast - 1)] ?? null;
  }

  for (let i = config.emaSlow - 1; i < candles.length; i++) {
    emaSlow[i] = emaSlowArray[i - (config.emaSlow - 1)] ?? null;
  }

  const adxOffset = config.adxPeriod * 2 - 1;
  for (let i = adxOffset; i < candles.length; i++) {
    adx[i] = adxArray[i - adxOffset]?.adx ?? null;
  }

  return { emaFast, emaSlow, adx, adxOffset };
}

function runSimulation(candles, indicators, config) {
  const adxOffset = indicators.adxOffset;
  const startIndex = Math.max(
    adxOffset + 1,
    Math.max(config.emaFast, config.emaSlow) + 1
  );

  const trades = [];
  const activeTrades = [];
  let equity = config.initialEquity;
  let maxConcurrentTrades = 0;
  const feePercent = config.fee ? getFeePercent(config.leverage) : 0;
  const logTrade = config.verbose
    ? (trade) => console.log('[LỆNH]', formatTradeForLog(trade, config))
    : () => {};

  for (let i = startIndex; i < candles.length - 1; i++) {
    processActiveTrades(i, candles, activeTrades, trades, config, feePercent, (pnl) => {
      equity += pnl;
    }, logTrade);

    const previousADX = indicators.adx[i - 1];
    const currentADX = indicators.adx[i];
    if (previousADX === null || currentADX === null) {
      continue;
    }

    const emaFastCurr = indicators.emaFast[i];
    const emaSlowCurr = indicators.emaSlow[i];
    const emaFastPrev = indicators.emaFast[i - 1];
    const emaFastPrev2 = indicators.emaFast[i - 2];
    const emaSlowPrev = indicators.emaSlow[i - 1];
    const emaSlowPrev2 = indicators.emaSlow[i - 2];

    if (
      [emaFastCurr, emaSlowCurr, emaFastPrev, emaSlowPrev, emaFastPrev2, emaSlowPrev2].some(
        (val) => val === null
      )
    ) {
      continue;
    }

    let direction = null;

    const adxCross = previousADX < config.adxThreshold && currentADX >= config.adxThreshold;

    if (adxCross && emaFastCurr > emaSlowCurr) {
      direction = 'long';
    } else if (adxCross && emaFastCurr < emaSlowCurr) {
      direction = 'short';
    }

    if (direction) {
      const entryIndex = i + 1;
      if (entryIndex < candles.length) {
        const entryCandle = candles[entryIndex];
        const entryPrice = entryCandle.open;

        const lookbackFrom = Math.max(0, i - config.slLookback + 1);
        const lookbackSlice = candles.slice(lookbackFrom, i + 1);
        const stopLoss = calculateStopLoss(entryPrice, lookbackSlice, direction, config);
        const takeProfit = calculateTakeProfit(entryPrice, stopLoss, direction, config);

        const entryAdxPrev = previousADX;
        const entryAdxCurr = currentADX;
        const lotSizing = calculateLotSize(entryPrice, equity, config);
        if (lotSizing) {
          activeTrades.push({
            direction,
            entryIndex,
            entryTime: new Date(candles[entryIndex].time).toISOString(),
            entryPrice,
            stopLoss,
            takeProfit,
            size: lotSizing.size,
            capitalUsed: lotSizing.capitalUsed,
            adxPrev: entryAdxPrev,
            adxCurr: entryAdxCurr,
          });
          maxConcurrentTrades = Math.max(maxConcurrentTrades, activeTrades.length);
        } else if (config.verbose) {
          console.warn('[BACKTEST] ⚠️ Không đủ vốn để mở lệnh mới.');
        }
      }
    }
  }

  // Force close any remaining active trades at last candle
  const lastCandle = candles[candles.length - 1];
  activeTrades.slice().forEach((trade) => {
    closeTradeAtEnd(trade, candles, lastCandle, candles.length - 1, trades, config, feePercent, (pnl) => {
      equity += pnl;
    }, (tradeInfo) => {
      if (config.verbose) {
        console.log('[TRADE]', tradeInfo);
      }
    });
  });
  activeTrades.length = 0;

  return { trades, endingEquity: equity, maxConcurrentTrades };
}

function processActiveTrades(index, candles, activeTrades, trades, config, feePercent, onPnl, onTradeLog) {
  const candle = candles[index];
  for (let j = activeTrades.length - 1; j >= 0; j--) {
    const trade = activeTrades[j];
    if (index < trade.entryIndex) {
      continue;
    }

    const exitInfo = evaluateExit(trade, candle);
    if (!exitInfo) {
      continue;
    }

    const closedTrade = finalizeTrade(trade, exitInfo, index, candles, feePercent, config.leverage, config.feeBasis);
    activeTrades.splice(j, 1);
    trades.push(closedTrade);
    onPnl(closedTrade.pnl);
    onTradeLog(closedTrade);
  }
}

function closeTradeAtEnd(trade, candles, lastCandle, lastIndex, trades, config, feePercent, onPnl, onTradeLog) {
  const exitInfo = {
    exitPrice: lastCandle.close,
    exitReason: 'end-of-data',
  };
  const closedTrade = finalizeTrade(trade, exitInfo, lastIndex, candles, feePercent, config.leverage, config.feeBasis);
  trades.push(closedTrade);
  onPnl(closedTrade.pnl);
  onTradeLog(closedTrade);
}

function evaluateExit(trade, candle) {
  if (trade.direction === 'long') {
    if (candle.low <= trade.stopLoss) {
      return { exitPrice: trade.stopLoss, exitReason: 'stop-loss' };
    }
    if (candle.high >= trade.takeProfit) {
      return { exitPrice: trade.takeProfit, exitReason: 'take-profit' };
    }
    return null;
  }

  if (candle.high >= trade.stopLoss) {
    return { exitPrice: trade.stopLoss, exitReason: 'stop-loss' };
  }
  if (candle.low <= trade.takeProfit) {
    return { exitPrice: trade.takeProfit, exitReason: 'take-profit' };
  }

  return null;
}

function finalizeTrade(trade, exitInfo, exitIndex, candles, feePercent, leverage, feeBasis) {
  const exitPrice = exitInfo.exitPrice;
  const grossPnl = trade.direction === 'long'
    ? (exitPrice - trade.entryPrice) * trade.size
    : (trade.entryPrice - exitPrice) * trade.size;
  const baseAmount = feeBasis === 'capital'
    ? (trade.capitalUsed || 0)
    : (trade.capitalUsed || 0) * (leverage || 1);
  const feeAmount = feePercent && baseAmount > 0
    ? baseAmount * (feePercent / 100)
    : 0;
  const netPnl = grossPnl - feeAmount;
  const pnlPercent = trade.capitalUsed > 0 ? (netPnl / trade.capitalUsed) * 100 : 0;

  return {
    ...trade,
    exitIndex,
    exitTime: new Date(candles[exitIndex].time).toISOString(),
    exitPrice,
    exitReason: exitInfo.exitReason,
    pnl: netPnl,
    pnlGross: grossPnl,
    fee: feeAmount,
    pnlPercent,
    durationCandles: exitIndex - trade.entryIndex + 1,
  };
}

function calculateStopLoss(entryPrice, slice, direction, config) {
  if (!slice.length) {
    throw new Error('Không đủ dữ liệu để tính SL');
  }

  const lows = slice.map((c) => c.low);
  const highs = slice.map((c) => c.high);
  let sl = direction === 'long' ? Math.min(...lows) : Math.max(...highs);

  if (config.priceTick > 0) {
    sl = roundToTick(sl, config.priceTick);
  }

  return Number(sl.toFixed(config.priceDecimals));
}

function calculateTakeProfit(entryPrice, stopLoss, direction, config) {
  const distance = Math.abs(entryPrice - stopLoss);
  const multiplier = distance * config.rRatio;
  const tp = direction === 'long' ? entryPrice + multiplier : entryPrice - multiplier;

  const rounded = config.priceTick > 0 ? roundToTick(tp, config.priceTick) : tp;

  return Number(rounded.toFixed(config.priceDecimals));
}

function calculateLotSize(entryPrice, equity, config) {
  if (entryPrice <= 0 || equity <= 0) {
    return null;
  }

  const capital = config.capital ? Math.min(config.capital, equity) : equity;
  const notional = capital * config.leverage;
  let size = notional / entryPrice;

  if (config.sizeStep > 0) {
    size = roundToStep(size, config.sizeStep);
  }

  const minLot = config.minLotSize;
  if (size < minLot) {
    size = minLot;
  }

  const actualNotional = size * entryPrice;
  const capitalUsed = actualNotional / config.leverage;

  if (capitalUsed > equity) {
    return null;
  }

  return {
    size,
    capitalUsed,
  };
}

function simulateExit(entryIndex, direction, stopLoss, takeProfit, candles) {
  for (let idx = entryIndex; idx < candles.length; idx++) {
    const candle = candles[idx];

    if (direction === 'long') {
      if (candle.low <= stopLoss) {
        return { exitIndex: idx, exitPrice: stopLoss, exitReason: 'stop-loss' };
      }
      if (candle.high >= takeProfit) {
        return { exitIndex: idx, exitPrice: takeProfit, exitReason: 'take-profit' };
      }
    } else {
      if (candle.high >= stopLoss) {
        return { exitIndex: idx, exitPrice: stopLoss, exitReason: 'stop-loss' };
      }
      if (candle.low <= takeProfit) {
        return { exitIndex: idx, exitPrice: takeProfit, exitReason: 'take-profit' };
      }
    }
  }

  const last = candles[candles.length - 1];
  return { exitIndex: candles.length - 1, exitPrice: last.close, exitReason: 'end-of-data' };
}

function formatNumberOrDash(value) {
  if (value === null || value === undefined) return '-';
  return formatNumber(value, 4);
}

function renderSummary(trades, endingEquity, config, maxConcurrentTrades) {
  if (!trades.length) {
    console.log('[BACKTEST] Không có giao dịch nào được kích hoạt trong khung thời gian.');
    return;
  }

  const wins = trades.filter((t) => t.pnl > 0).length;
  const losses = trades.length - wins;
  const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
  const averagePnl = totalPnl / trades.length;
  const totalDuration = trades.reduce((sum, t) => sum + t.durationCandles, 0);
  const referenceCapital = config.capital || config.initialEquity || 1;
  const totalPnlPercent = referenceCapital ? (totalPnl / referenceCapital) * 100 : null;
  const avgPnlPercent = referenceCapital ? (averagePnl / referenceCapital) * 100 : null;
  const totalFees = trades.reduce((sum, t) => sum + (t.fee || 0), 0);
  const feePercent = config.fee ? getFeePercent(config.leverage) : 0;

  console.log('\n[BACKTEST] Tổng kết chiến lược:');
  console.log(`  - Tổng lệnh: ${trades.length}`);
  console.log(`  - Win rate: ${((wins / trades.length) * 100).toFixed(1)}% (${wins} thắng / ${losses} thua)`);
  console.log(
    `  - Tổng PnL: ${formatNumber(totalPnl)}${totalPnlPercent !== null ? ` (${totalPnlPercent.toFixed(2)}% vs reference capital)` : ''}`
  );
  console.log(
    `  - Avg PnL/trade: ${formatNumber(averagePnl)}${avgPnlPercent !== null ? ` (${avgPnlPercent.toFixed(2)}% of reference capital)` : ''}`
  );
  console.log(`  - Trung bình đóng sau ${Math.round(totalDuration / trades.length)} nến`);
  console.log(`  - Số lệnh mở cùng lúc tối đa: ${maxConcurrentTrades}`);
  console.log(`  - Tổng phí (nếu có): ${formatFeeValue(totalFees)}`);
  if (feePercent) {
    console.log(`  - Fee rate: ${feePercent}% trên notional mỗi lệnh`);
  }
  console.log(`  - Ending equity (approx): ${formatNumber(endingEquity)}`);

  console.log('\n[BACKTEST] Các lệnh gần nhất:');
  trades.slice(-5).forEach((trade) => {
    const adxPrevLog = formatAdxValue(trade.adxPrev);
    const adxCurrLog = formatAdxValue(trade.adxCurr);
    const entryLocal = formatTimestampWithOffset(trade.entryTime, config.timezoneOffset);
    const exitLocal = formatTimestampWithOffset(trade.exitTime, config.timezoneOffset);
    const feeLog = formatFeeValue(trade.fee);
    console.log(
      `  • ${trade.direction.toUpperCase()} | ${trade.exitReason} | Entry=${formatNumberOrDash(trade.entryPrice)} @ ${entryLocal} → Exit=${formatNumberOrDash(trade.exitPrice)} @ ${exitLocal} | ADX prev=${adxPrevLog} curr=${adxCurrLog} | PnL=${formatNumber(trade.pnl)} (${trade.pnlPercent.toFixed(2)}%) | Fee=${feeLog}`
    );
  });
}

function formatAdxValue(value) {
  if (value === null || value === undefined) return '-';
  return Number(value).toFixed(2);
}

function formatTradeForLog(trade, config) {
  return {
    ...trade,
    entryTimeLocal: formatTimestampWithOffset(trade.entryTime, config.timezoneOffset),
    exitTimeLocal: formatTimestampWithOffset(trade.exitTime, config.timezoneOffset),
    feeDisplay: formatFeeValue(trade.fee),
    pnlGrossDisplay: formatNumber(trade.pnlGross || 0, 4),
  };
}

function formatTimestampWithOffset(isoString, offsetMinutes) {
  if (!isoString) return '-';
  const timestamp = Date.parse(isoString);
  if (Number.isNaN(timestamp)) return isoString;
  const adjusted = new Date(timestamp + offsetMinutes * 60000);
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absMinutes = Math.abs(offsetMinutes);
  const hours = Math.floor(absMinutes / 60);
  const minutes = absMinutes % 60;
  const offsetLabel = `${sign}${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  return `${adjusted.toISOString().replace('T', ' ').replace('.000Z', '')} (UTC${offsetLabel})`;
}

function formatOffset(offsetMinutes) {
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absMinutes = Math.abs(offsetMinutes);
  const hours = Math.floor(absMinutes / 60);
  const minutes = absMinutes % 60;
  if (minutes === 0) {
    return `${sign}${hours}`;
  }
  return `${sign}${hours}:${minutes.toString().padStart(2, '0')}`;
}

function formatFeeValue(value) {
  if (value === null || value === undefined) return '-';
  return formatNumber(value, 4);
}

function getFeePercent(leverage) {
  const feeMap = {
    10: 1.2,
    5: 0.5,
  };
  return feeMap[leverage] || 0;
}

