#!/usr/bin/env node

/**
 * Backtest cho Range-Based Trading Bot
 * 
 * Logic:
 * - Theo dõi chart 1h
 * - Tính trung bình biên độ (range) của 720 cây nến 1h gần nhất (1 tháng)
 * - TP = entryPrice ± (averageRangePercent / 100)
 * - Vào lệnh dựa trên trend và màu nến:
 *   + LONG: khi UPTREND + nến đỏ
 *   + SHORT: khi DOWNTREND + nến xanh
 * - Không có SL
 */

const axios = require('axios');
const { BollingerBands } = require('technicalindicators');
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
    describe: 'Capital per trade (USDT)',
    default: 1,
  })
  .option('initialEquity', {
    type: 'number',
    describe: 'Starting equity (USDT)',
    default: 100,
  })
  .option('leverage', {
    type: 'number',
    describe: 'Leverage used for sizing',
    default: 10,
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
  .option('timezoneOffset', {
    type: 'number',
    describe: 'Minutes offset from UTC for displaying timestamps (e.g., 420 for UTC+7)',
    default: 0,
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
  lookbackDays: argv.lookbackDays,
  start: argv.start,
  end: argv.end,
  capital: argv.capital,
  initialEquity: argv.initialEquity,
  leverage: argv.leverage,
  priceTick: argv.priceTick,
  sizeStep: argv.sizeStep,
  minLotSize: argv.minLotSize,
  priceDecimals: argv.priceTick > 0 ? getDecimalsFromStep(argv.priceTick) : 4,
  verbose: argv.verbose,
  timezoneOffset: Number(argv.timezoneOffset) || 0,
};

const LOOKBACK_MS = config.lookbackDays * 24 * 60 * 60 * 1000;
const BB_PERIOD = 20;
const BB_STDDEV = 2;
const RANGE_LOOKBACK = 720; // 1 month of 1h candles

async function main() {
  const endTime = parseDateOption(config.end, Date.now());
  const startTime = parseDateOption(config.start, endTime - LOOKBACK_MS);
  if (startTime >= endTime) {
    throw new Error('Start time must be before end time');
  }

  const binanceSymbol = normalizeSymbol(config.symbol);

  console.log(`[BACKTEST] Ký hiệu: ${config.symbol} (Binance ${binanceSymbol})`);
  console.log(`[BACKTEST] Khung thời gian: 1h, khoảng: ${new Date(startTime).toISOString()} → ${new Date(endTime).toISOString()}`);
  console.log(`[BACKTEST] Hiển thị thời gian theo UTC${formatOffset(config.timezoneOffset)}`);
  console.log(`[BACKTEST] Vốn ban đầu: ${config.initialEquity} USDT`);
  console.log(`[BACKTEST] Vốn mỗi lệnh: ${config.capital} USDT`);
  console.log(`[BACKTEST] Leverage: ${config.leverage}x`);

  // Fetch historical candles (need extra for range calculation)
  const extendedStartTime = startTime - (RANGE_LOOKBACK * 60 * 60 * 1000); // Extra 720 hours before
  const rawCandles = await fetchHistoricalCandles(binanceSymbol, '1h', 60 * 60 * 1000, extendedStartTime, endTime);
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

  // Find the start index (after we have enough candles for BB and range calculation)
  const startIndex = Math.max(
    RANGE_LOOKBACK + BB_PERIOD, // Need 720 for range + 20 for BB
    candles.findIndex(c => c.time >= startTime)
  );

  if (startIndex < 0 || startIndex >= candles.length) {
    throw new Error('Không tìm thấy điểm bắt đầu hợp lệ');
  }

  const { trades, endingEquity, maxConcurrentTrades, openTrades } = runSimulation(
    candles,
    startIndex,
    config
  );

  renderSummary(trades, endingEquity, config, maxConcurrentTrades, openTrades, candles);
}

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

/**
 * Calculate Bollinger Bands
 */
function calculateBollingerBands(klines, period = 20, stdDev = 2) {
  if (!klines || klines.length < period) {
    return [];
  }

  const closes = klines.map(k => k.close);
  const bbResults = BollingerBands.calculate({
    values: closes,
    period: period,
    stdDev: stdDev,
  });

  const bands = [];
  for (let i = 0; i < bbResults.length; i++) {
    const klineIndex = i + period - 1;
    if (klineIndex < klines.length) {
      bands.push({
        index: klineIndex,
        upperBand: bbResults[i].upper,
        middleBand: bbResults[i].middle,
        lowerBand: bbResults[i].lower,
        candle: klines[klineIndex],
      });
    }
  }

  return bands;
}

/**
 * Determine trend based on BB direction
 */
function determineTrend(currentBands, previousBands) {
  if (!currentBands || !previousBands) {
    return 'unknown';
  }

  const upperBandDirection = currentBands.upperBand > previousBands.upperBand ? 'up' :
                             currentBands.upperBand < previousBands.upperBand ? 'down' : 'flat';
  const lowerBandDirection = currentBands.lowerBand > previousBands.lowerBand ? 'up' :
                             currentBands.lowerBand < previousBands.lowerBand ? 'down' : 'flat';

  if (upperBandDirection === 'up' && lowerBandDirection === 'up') {
    return 'uptrend';
  }

  if (upperBandDirection === 'down' && lowerBandDirection === 'down') {
    return 'downtrend';
  }

  return 'sideway';
}

/**
 * Calculate average range (percentage)
 */
function calculateAverageRange(klines) {
  if (!klines || klines.length === 0) {
    throw new Error('Không có dữ liệu nến để tính toán');
  }

  const ranges = klines.map((k) => {
    return ((k.high - k.low) / k.close) * 100;
  });

  const sum = ranges.reduce((acc, val) => acc + val, 0);
  const average = sum / ranges.length;

  return {
    averageRangePercent: average,
    ranges: ranges,
    minRange: Math.min(...ranges),
    maxRange: Math.max(...ranges),
    candleCount: klines.length,
  };
}

/**
 * Analyze candle color
 */
function analyzeCandle(candle) {
  const isGreen = candle.close > candle.open;
  const isRed = candle.close < candle.open;
  const isDoji = candle.close === candle.open;

  let direction = null;
  if (isGreen) {
    direction = 'short'; // Nến xanh → vào SHORT
  } else if (isRed) {
    direction = 'long'; // Nến đỏ → vào LONG
  }

  return {
    isGreen,
    isRed,
    isDoji,
    direction,
    candle,
  };
}

/**
 * Calculate take profit price based on average range
 */
function calculateTakeProfitPrice(entryPrice, direction, averageRangePercent) {
  const rangeDecimal = averageRangePercent / 100;

  if (direction === 'long') {
    return entryPrice * (1 + rangeDecimal);
  } else {
    return entryPrice * (1 - rangeDecimal);
  }
}

/**
 * Calculate lot size
 */
function calculateLotSize(entryPrice, capital, config) {
  if (entryPrice <= 0 || capital <= 0) {
    return null;
  }

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

  if (capitalUsed > capital) {
    return null;
  }

  return {
    size,
    capitalUsed,
  };
}

function runSimulation(candles, startIndex, config) {
  const trades = [];
  const activeTrades = [];
  let equity = config.initialEquity;
  let maxConcurrentTrades = 0;
  const logTrade = config.verbose
    ? (trade) => console.log('[LỆNH]', formatTradeForLog(trade, config))
    : () => {};

  // Process each candle from startIndex
  for (let i = startIndex; i < candles.length - 1; i++) {
    // Process active trades (check TP)
    processActiveTrades(i, candles, activeTrades, trades, config, (pnl) => {
      equity += pnl;
    }, logTrade);

    // Need at least BB_PERIOD candles before this one to calculate BB
    if (i < BB_PERIOD) {
      continue;
    }

    // Get 720 candles before current for range calculation
    const rangeStartIndex = Math.max(0, i - RANGE_LOOKBACK);
    const rangeCandles = candles.slice(rangeStartIndex, i + 1);
    
    if (rangeCandles.length < 100) {
      // Not enough data for reliable range calculation
      continue;
    }

    // Calculate average range
    const rangeData = calculateAverageRange(rangeCandles);

    // Calculate Bollinger Bands for recent candles
    const bbCandles = candles.slice(Math.max(0, i - BB_PERIOD * 2), i + 1);
    const bands = calculateBollingerBands(bbCandles, BB_PERIOD, BB_STDDEV);

    if (bands.length < 2) {
      continue;
    }

    // Get current and previous bands
    const currentBands = bands[bands.length - 1];
    const previousBands = bands[bands.length - 2];

    // Determine trend
    const trend = determineTrend(currentBands, previousBands);

    // Get previous closed candle (the one we analyze)
    const previousCandle = candles[i];
    const previousCandleTime = new Date(previousCandle.time);
    const previousCandleHour = previousCandleTime.getHours();

    // Analyze candle
    const analysis = analyzeCandle(previousCandle);

    if (analysis.isDoji) {
      continue;
    }

    // Logic vào lệnh mới:
    // - LONG: khi UPTREND + nến đỏ
    // - SHORT: khi DOWNTREND + nến xanh
    let direction = null;
    if (trend === 'uptrend' && analysis.isRed) {
      direction = 'long';
    } else if (trend === 'downtrend' && analysis.isGreen) {
      direction = 'short';
    }

    if (!direction) {
      continue;
    }

    // Check if we have enough equity
    if (equity < config.capital) {
      if (config.verbose) {
        console.warn(`[BACKTEST] ⚠️ Không đủ vốn để mở lệnh mới. Equity: ${formatNumber(equity)}`);
      }
      continue;
    }

    // Entry at next candle open
    const entryIndex = i + 1;
    if (entryIndex >= candles.length) {
      continue;
    }

    const entryCandle = candles[entryIndex];
    const entryPrice = entryCandle.open;

    // Calculate lot size
    const lotSizing = calculateLotSize(entryPrice, config.capital, config);
    if (!lotSizing) {
      if (config.verbose) {
        console.warn(`[BACKTEST] ⚠️ Không thể tính lot size cho entryPrice=${entryPrice}`);
      }
      continue;
    }

    // Calculate TP
    const tpPrice = calculateTakeProfitPrice(
      entryPrice,
      direction,
      rangeData.averageRangePercent
    );
    const roundedTpPrice = config.priceTick > 0
      ? roundToTick(tpPrice, config.priceTick)
      : tpPrice;

    // Open trade
    activeTrades.push({
      direction: direction,
      entryIndex,
      entryTime: new Date(candles[entryIndex].time).toISOString(),
      entryPrice,
      takeProfit: Number(roundedTpPrice.toFixed(config.priceDecimals)),
      size: lotSizing.size,
      capitalUsed: lotSizing.capitalUsed,
      averageRangePercent: rangeData.averageRangePercent,
      trend: trend,
    });

    maxConcurrentTrades = Math.max(maxConcurrentTrades, activeTrades.length);
    equity -= lotSizing.capitalUsed;
  }

  // Không đóng các lệnh còn mở khi hết dữ liệu
  // Giữ nguyên để kiểm tra, không tính PnL
  // Vốn đã bị lock trong các lệnh này sẽ không được tính vào endingEquity

  return { trades, endingEquity: equity, maxConcurrentTrades, openTrades: activeTrades };
}

function processActiveTrades(index, candles, activeTrades, trades, config, onPnl, onTradeLog) {
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

    const closedTrade = finalizeTrade(trade, exitInfo, index, candles, config);
    activeTrades.splice(j, 1);
    trades.push(closedTrade);
    // When closing, we get back the capital used + PnL
    onPnl(trade.capitalUsed + closedTrade.pnl);
    onTradeLog(closedTrade);
  }
}

// Function này không còn được sử dụng nữa vì chúng ta không đóng lệnh khi hết dữ liệu
// Giữ lại để tránh lỗi nếu có code khác gọi
function closeTradeAtEnd(trade, candles, lastCandle, lastIndex, trades, config, onPnl, onTradeLog) {
  // Không làm gì - lệnh sẽ được giữ lại trong openTrades
}

function evaluateExit(trade, candle) {
  if (trade.direction === 'long') {
    if (candle.high >= trade.takeProfit) {
      return { exitPrice: trade.takeProfit, exitReason: 'take-profit' };
    }
    return null;
  }

  if (candle.low <= trade.takeProfit) {
    return { exitPrice: trade.takeProfit, exitReason: 'take-profit' };
  }

  return null;
}

function finalizeTrade(trade, exitInfo, exitIndex, candles, config) {
  const exitPrice = exitInfo.exitPrice;
  // Calculate PnL: (price change) * size gives profit on notional
  // With leverage, this is already the profit on capital
  const grossPnl = trade.direction === 'long'
    ? (exitPrice - trade.entryPrice) * trade.size
    : (trade.entryPrice - exitPrice) * trade.size;
  const netPnl = grossPnl; // No fees in this backtest
  const pnlPercent = trade.capitalUsed > 0 ? (netPnl / trade.capitalUsed) * 100 : 0;

  return {
    ...trade,
    exitIndex,
    exitTime: new Date(candles[exitIndex].time).toISOString(),
    exitPrice,
    exitReason: exitInfo.exitReason,
    pnl: netPnl,
    pnlGross: grossPnl,
    pnlPercent,
    durationCandles: exitIndex - trade.entryIndex + 1,
  };
}

function formatNumberOrDash(value) {
  if (value === null || value === undefined) return '-';
  return formatNumber(value, 4);
}

function renderSummary(trades, endingEquity, config, maxConcurrentTrades, openTrades, candles) {
  const totalClosedTrades = trades.length;
  const totalOpenTrades = openTrades ? openTrades.length : 0;
  const lockedCapital = openTrades ? openTrades.reduce((sum, t) => sum + t.capitalUsed, 0) : 0;
  const availableEquity = endingEquity; // Vốn còn lại (đã trừ vốn lock)
  const totalEquity = availableEquity + lockedCapital; // Vốn tổng (bao gồm cả vốn lock)

  if (totalClosedTrades === 0 && totalOpenTrades === 0) {
    console.log('[BACKTEST] Không có giao dịch nào được kích hoạt trong khung thời gian.');
    return;
  }

  // Hiển thị thông tin tổng quan
  console.log('\n[BACKTEST] Tổng kết chiến lược:');
  console.log(`  - Tổng lệnh đã đóng: ${totalClosedTrades}`);
  console.log(`  - Lệnh còn mở: ${totalOpenTrades}`);
  console.log(`  - Vốn ban đầu: ${formatNumber(config.initialEquity)} USDT`);
  console.log(`  - Vốn còn lại (available): ${formatNumber(availableEquity)} USDT`);
  console.log(`  - Vốn đang lock (trong lệnh mở): ${formatNumber(lockedCapital)} USDT`);
  console.log(`  - Tổng vốn (available + locked): ${formatNumber(totalEquity)} USDT`);

  if (totalClosedTrades > 0) {
    const wins = trades.filter((t) => t.pnl > 0).length;
    const losses = trades.length - wins;
    const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
    const averagePnl = totalPnl / trades.length;
    const totalDuration = trades.reduce((sum, t) => sum + t.durationCandles, 0);
    const totalPnlPercent = ((endingEquity - config.initialEquity) / config.initialEquity) * 100;
    const avgPnlPercent = config.capital ? (averagePnl / config.capital) * 100 : null;

    console.log(`  - Win rate (lệnh đã đóng): ${((wins / totalClosedTrades) * 100).toFixed(1)}% (${wins} thắng / ${losses} thua)`);
    console.log(`  - Tổng PnL (lệnh đã đóng): ${formatNumber(totalPnl)} USDT`);
    console.log(`  - Avg PnL/trade: ${formatNumber(averagePnl)} USDT${avgPnlPercent !== null ? ` (${avgPnlPercent.toFixed(2)}% of capital)` : ''}`);
    console.log(`  - Trung bình đóng sau ${Math.round(totalDuration / totalClosedTrades)} nến (${(totalDuration / totalClosedTrades).toFixed(1)} giờ)`);
    console.log(`  - Số lệnh mở cùng lúc tối đa: ${maxConcurrentTrades}`);
    console.log(`  - Lợi nhuận (chỉ tính lệnh đã đóng): ${formatNumber(endingEquity - config.initialEquity)} USDT (${totalPnlPercent.toFixed(2)}%)`);

    console.log('\n[BACKTEST] Các lệnh đã đóng gần nhất:');
    trades.slice(-10).forEach((trade) => {
      const entryLocal = formatTimestampWithOffset(trade.entryTime, config.timezoneOffset);
      const exitLocal = formatTimestampWithOffset(trade.exitTime, config.timezoneOffset);
      const trendEmoji = trade.trend === 'uptrend' ? '📈' : trade.trend === 'downtrend' ? '📉' : '➡️';
      console.log(
        `  • ${trade.direction.toUpperCase()} | ${trendEmoji} ${trade.trend} | ${trade.exitReason} | Entry=${formatNumberOrDash(trade.entryPrice)} @ ${entryLocal} → Exit=${formatNumberOrDash(trade.exitPrice)} @ ${exitLocal} | TP=${formatNumberOrDash(trade.takeProfit)} | Range=${trade.averageRangePercent.toFixed(4)}% | PnL=${formatNumber(trade.pnl)} (${trade.pnlPercent.toFixed(2)}%) | Duration=${trade.durationCandles}h`
      );
    });
  }

  if (totalOpenTrades > 0) {
    const lastCandle = candles[candles.length - 1];
    const lastPrice = lastCandle.close;
    
    // Thống kê lệnh còn mở theo hướng
    const longTrades = openTrades.filter(t => t.direction === 'long');
    const shortTrades = openTrades.filter(t => t.direction === 'short');
    const longCount = longTrades.length;
    const shortCount = shortTrades.length;
    const longLockedCapital = longTrades.reduce((sum, t) => sum + t.capitalUsed, 0);
    const shortLockedCapital = shortTrades.reduce((sum, t) => sum + t.capitalUsed, 0);
    
    // Tính tổng PnL hiện tại cho LONG và SHORT
    const longCurrentPnL = longTrades.reduce((sum, trade) => {
      const pnl = (lastPrice - trade.entryPrice) * trade.size;
      return sum + pnl;
    }, 0);
    const shortCurrentPnL = shortTrades.reduce((sum, trade) => {
      const pnl = (trade.entryPrice - lastPrice) * trade.size;
      return sum + pnl;
    }, 0);
    const totalCurrentPnL = longCurrentPnL + shortCurrentPnL;
    
    console.log('\n[BACKTEST] Thống kê lệnh còn mở:');
    console.log(`  - LONG: ${longCount} lệnh | Vốn lock: ${formatNumber(longLockedCapital)} USDT | PnL hiện tại: ${formatNumber(longCurrentPnL)} USDT`);
    console.log(`  - SHORT: ${shortCount} lệnh | Vốn lock: ${formatNumber(shortLockedCapital)} USDT | PnL hiện tại: ${formatNumber(shortCurrentPnL)} USDT`);
    console.log(`  - Tổng: ${totalOpenTrades} lệnh | Vốn lock: ${formatNumber(lockedCapital)} USDT | PnL hiện tại: ${formatNumber(totalCurrentPnL)} USDT`);
    
    console.log('\n[BACKTEST] Chi tiết các lệnh còn mở (chưa tính PnL):');
    openTrades.forEach((trade) => {
      const entryLocal = formatTimestampWithOffset(trade.entryTime, config.timezoneOffset);
      const trendEmoji = trade.trend === 'uptrend' ? '📈' : trade.trend === 'downtrend' ? '📉' : '➡️';
      
      // Tính PnL hiện tại (chỉ để hiển thị, không tính vào equity)
      const currentPnL = trade.direction === 'long'
        ? (lastPrice - trade.entryPrice) * trade.size
        : (trade.entryPrice - lastPrice) * trade.size;
      const currentPnLPercent = trade.capitalUsed > 0 ? (currentPnL / trade.capitalUsed) * 100 : 0;
      const durationHours = Math.floor((lastCandle.time - new Date(trade.entryTime).getTime()) / (60 * 60 * 1000));
      
      console.log(
        `  • ${trade.direction.toUpperCase()} | ${trendEmoji} ${trade.trend} | Entry=${formatNumberOrDash(trade.entryPrice)} @ ${entryLocal} | TP=${formatNumberOrDash(trade.takeProfit)} | Current=${formatNumberOrDash(lastPrice)} | Range=${trade.averageRangePercent.toFixed(4)}% | PnL hiện tại=${formatNumber(currentPnL)} (${currentPnLPercent.toFixed(2)}%) | Capital=${formatNumber(trade.capitalUsed)} | Duration=${durationHours}h`
      );
    });
    console.log(`\n[BACKTEST] ⚠️  Lưu ý: ${totalOpenTrades} lệnh còn mở chưa được tính vào kết quả cuối cùng.`);
    console.log(`[BACKTEST]    Vốn đang lock: ${formatNumber(lockedCapital)} USDT`);
  }
}

function formatTradeForLog(trade, config) {
  return {
    ...trade,
    entryTimeLocal: formatTimestampWithOffset(trade.entryTime, config.timezoneOffset),
    exitTimeLocal: formatTimestampWithOffset(trade.exitTime, config.timezoneOffset),
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

main().catch((err) => {
  console.error('[BACKTEST] ❌', err.message);
  if (err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
