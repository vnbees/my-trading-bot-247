#!/usr/bin/env node

/**
 * compareSMC.js
 *
 * Dùng để so sánh kết quả CHoCH/BOS của smc.js với kết quả export từ SMC.pine.
 *
 * Quy trình sử dụng:
 *  1. Chuẩn bị file OHLC CSV (ví dụ: data.csv) với header:
 *       time,open,high,low,close
 *     - time: timestamp dạng ms (Unix ms). Nếu bạn export từ nơi khác, có thể cần convert sang ms.
 *
 *  2. Chuẩn bị file signals CSV export từ TradingView (bạn tự ghi tay hoặc export alert log), ví dụ: pine_signals.csv
 *       time,type,direction,level
 *     - time: cùng format timestamp với OHLC (ms).
 *     - type: "BOS" hoặc "CHoCH" (case-insensitive).
 *     - direction: "bullish" hoặc "bearish".
 *     - level: giá level mà Pine dùng cho signal đó.
 *
 *  3. Chạy:
 *       node compareSMC.js --ohlc=data.csv --pine=pine_signals.csv --swingLookback=2 --type=CHoCH
 *
 *  Script sẽ:
 *   - Load OHLC → chạy calculateSMC()
 *   - Lọc signals theo type (=CHoCH/BOS/ALL) & direction (nếu cần)
 *   - So sánh theo timestamp & direction & type, in ra:
 *       + Match: trùng time/type/direction
 *       + MissedByJS: Pine có, JS không có
 *       + ExtraInJS: JS có, Pine không có
 */

const fs = require('fs');
const path = require('path');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const { calculateSMC } = require('./smc');

const argv = yargs(hideBin(process.argv))
  .option('ohlc', {
    type: 'string',
    describe: 'Đường dẫn file CSV chứa OHLC (time,open,high,low,close)',
    demandOption: true,
  })
  .option('pine', {
    type: 'string',
    describe: 'Đường dẫn file CSV chứa signals export từ TradingView (time,type,direction,level)',
    demandOption: true,
  })
  .option('swingLookback', {
    type: 'number',
    describe: 'swingLookback truyền vào calculateSMC()',
    default: 2,
  })
  .option('type', {
    type: 'string',
    describe: 'Loại signal để so sánh: CHoCH, BOS, hoặc ALL',
    choices: ['CHoCH', 'BOS', 'ALL'],
    default: 'CHoCH',
  })
  .option('direction', {
    type: 'string',
    describe: 'Lọc theo hướng: bullish, bearish, hoặc ALL',
    choices: ['bullish', 'bearish', 'ALL'],
    default: 'ALL',
  })
  .option('timeToleranceMs', {
    type: 'number',
    describe: 'Sai số thời gian cho phép (ms) khi match signals',
    default: 0,
  })
  .help()
  .alias('help', 'h').argv;

function parseCsv(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    throw new Error(`File CSV "${filePath}" không đủ dữ liệu`);
  }

  const header = lines[0].split(',').map((h) => h.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split(',').map((c) => c.trim());
    const row = {};
    header.forEach((key, idx) => {
      row[key] = cols[idx];
    });
    rows.push(row);
  }

  return { header, rows };
}

function loadOhlc(filePath) {
  const { header, rows } = parseCsv(filePath);
  const requiredCols = ['time', 'open', 'high', 'low', 'close'];
  requiredCols.forEach((col) => {
    if (!header.includes(col)) {
      throw new Error(`File OHLC thiếu cột bắt buộc: ${col}`);
    }
  });

  const times = [];
  const opens = [];
  const highs = [];
  const lows = [];
  const closes = [];

  rows.forEach((r) => {
    const t = Number(r.time);
    const o = Number(r.open);
    const h = Number(r.high);
    const l = Number(r.low);
    const c = Number(r.close);
    if (
      Number.isFinite(t)
      && Number.isFinite(o)
      && Number.isFinite(h)
      && Number.isFinite(l)
      && Number.isFinite(c)
    ) {
      times.push(t);
      opens.push(o);
      highs.push(h);
      lows.push(l);
      closes.push(c);
    }
  });

  if (!times.length) {
    throw new Error('Không parse được OHLC hợp lệ từ file');
  }

  return {
    times, opens, highs, lows, closes,
  };
}

function loadPineSignals(filePath) {
  const { header, rows } = parseCsv(filePath);
  const requiredCols = ['time', 'type', 'direction', 'level'];
  requiredCols.forEach((col) => {
    if (!header.includes(col)) {
      throw new Error(`File Pine signals thiếu cột bắt buộc: ${col}`);
    }
  });

  return rows
    .map((r) => ({
      time: Number(r.time),
      type: String(r.type || '').trim(),
      direction: String(r.direction || '').trim().toLowerCase(),
      level: Number(r.level),
    }))
    .filter(
      (s) => Number.isFinite(s.time)
        && (s.type === 'CHoCH' || s.type === 'BOS' || s.type.toUpperCase() === s.type),
    )
    .map((s) => ({
      ...s,
      type: s.type.toUpperCase(),
    }));
}

function filterSignals(signals, typeFilter, directionFilter) {
  return signals.filter((s) => {
    if (typeFilter !== 'ALL' && s.type !== typeFilter) return false;
    if (directionFilter !== 'ALL' && s.direction !== directionFilter) return false;
    return true;
  });
}

function compareSignals(pineSignals, jsSignals, toleranceMs) {
  const result = {
    matches: [],
    missedByJS: [],
    extraInJS: [],
  };

  const jsUsed = new Array(jsSignals.length).fill(false);

  pineSignals.forEach((pine) => {
    let bestIdx = -1;
    let bestDelta = Infinity;

    for (let i = 0; i < jsSignals.length; i += 1) {
      if (jsUsed[i]) continue;
      const js = jsSignals[i];
      if (js.type !== pine.type || js.direction !== pine.direction) continue;
      const delta = Math.abs((js.time || 0) - pine.time);
      if (delta <= toleranceMs && delta < bestDelta) {
        bestDelta = delta;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      jsUsed[bestIdx] = true;
      result.matches.push({
        pine,
        js: jsSignals[bestIdx],
        deltaMs: bestDelta,
      });
    } else {
      result.missedByJS.push(pine);
    }
  });

  jsSignals.forEach((js, idx) => {
    if (!jsUsed[idx]) {
      result.extraInJS.push(js);
    }
  });

  return result;
}

async function main() {
  const ohlcPath = path.resolve(argv.ohlc);
  const pinePath = path.resolve(argv.pine);

  console.log('[COMPARE-SMC] Đọc OHLC từ:', ohlcPath);
  console.log('[COMPARE-SMC] Đọc Pine signals từ:', pinePath);

  const {
    times, highs, lows, closes,
  } = loadOhlc(ohlcPath);
  const pineSignalsRaw = loadPineSignals(pinePath);

  const typeFilter = argv.type === 'ALL' ? 'ALL' : argv.type.toUpperCase();
  const directionFilter = argv.direction.toLowerCase();

  const pineSignals = filterSignals(
    pineSignalsRaw,
    typeFilter,
    directionFilter === 'all' ? 'ALL' : directionFilter,
  );

  console.log(
    `[COMPARE-SMC] Pine signals tổng: ${pineSignalsRaw.length}, sau khi filter (${typeFilter}/${directionFilter}) còn: ${pineSignals.length}`,
  );

  const smc = calculateSMC({
    highs,
    lows,
    closes,
    times,
    swingLookback: argv.swingLookback,
  });

  const jsSignalsRaw = smc.signals.map((s) => ({
    time: s.time,
    type: s.type,
    direction: s.direction,
    level: s.level,
    index: s.index,
  }));

  const jsSignals = filterSignals(
    jsSignalsRaw,
    typeFilter,
    directionFilter === 'all' ? 'ALL' : directionFilter,
  );

  console.log(
    `[COMPARE-SMC] JS signals tổng: ${jsSignalsRaw.length}, sau khi filter (${typeFilter}/${directionFilter}) còn: ${jsSignals.length}`,
  );

  const comparison = compareSignals(pineSignals, jsSignals, argv.timeToleranceMs);

  console.log('\n[COMPARE-SMC] Kết quả so sánh:');
  console.log(`  - Match:       ${comparison.matches.length}`);
  console.log(`  - MissedByJS:  ${comparison.missedByJS.length}`);
  console.log(`  - ExtraInJS:   ${comparison.extraInJS.length}`);

  if (comparison.missedByJS.length) {
    console.log('\n[COMPARE-SMC] Một số Pine signals mà JS không có (MissedByJS):');
    comparison.missedByJS.slice(0, 10).forEach((s) => {
      console.log(
        `  • time=${s.time}, type=${s.type}, dir=${s.direction}, level=${s.level}`,
      );
    });
  }

  if (comparison.extraInJS.length) {
    console.log('\n[COMPARE-SMC] Một số JS signals mà Pine không có (ExtraInJS):');
    comparison.extraInJS.slice(0, 10).forEach((s) => {
      console.log(
        `  • time=${s.time}, type=${s.type}, dir=${s.direction}, level=${s.level}, index=${s.index}`,
      );
    });
  }

  console.log('\n[COMPARE-SMC] Bạn có thể dùng thống kê trên để chỉnh lại smc.js (logic, swingLookback, v.v.) cho gần với SMC.pine nhất.');
}

main().catch((err) => {
  console.error('[COMPARE-SMC] ❌', err.message);
  if (err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});


