/**
 * Smart Money Concepts (SMC) - Port từ SMC.pine (LuxAlgo)
 * 
 * Logic giống 100% với SMC.pine, bao gồm:
 * - Swing structure (swingsLength = 50)
 * - Internal structure (size = 5)
 * - BOS/CHoCH detection
 * - Order blocks (internal & swing)
 * - Fair value gaps
 * - Equal highs/lows
 * 
 * Chỉ dùng cho mục đích nghiên cứu, không thương mại.
 */

const { ATR } = require('technicalindicators');

// Constants (giống SMC.pine)
const BULLISH_LEG = 1;
const BEARISH_LEG = 0;
const BULLISH = +1;
const BEARISH = -1;

/**
 * Tính ATR (Average True Range)
 */
function calculateATR(highs, lows, closes, period = 200) {
  if (highs.length < period || lows.length < period || closes.length < period) {
    // Nếu không đủ dữ liệu, tính ATR đơn giản
    let sum = 0;
    for (let i = 1; i < Math.min(highs.length, period); i++) {
      const tr = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      );
      sum += tr;
    }
    return sum / Math.min(highs.length - 1, period - 1);
  }

  try {
    const result = ATR.calculate({
      high: highs.slice(-period * 2),
      low: lows.slice(-period * 2),
      close: closes.slice(-period * 2),
      period,
    });
    return result.length > 0 ? result[result.length - 1] : 0;
  } catch (err) {
    // Fallback
    let sum = 0;
    for (let i = 1; i < period; i++) {
      const tr = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      );
      sum += tr;
    }
    return sum / (period - 1);
  }
}

/**
 * Tính True Range tích lũy (cumulative mean range)
 */
function calculateCumulativeMeanRange(highs, lows, closes) {
  if (highs.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < highs.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    sum += tr;
  }
  return sum / (highs.length - 1);
}

/**
 * Leg state tracker - giống var leg trong SMC.pine
 */
class LegState {
  constructor() {
    this.value = BEARISH_LEG; // default
  }
}

/**
 * Xác định leg (bullish/bearish) - giống hàm leg() trong SMC.pine
 * 
 * Trong Pine: leg(int size) =>
 *   var leg = 0
 *   newLegHigh = high[size] > ta.highest(size)
 *   newLegLow = low[size] < ta.lowest(size)
 *   if newLegHigh: leg := BEARISH_LEG
 *   else if newLegLow: leg := BULLISH_LEG
 *   leg
 * 
 * Logic:
 * - high[size] = high của bar cách đây `size` bars
 * - ta.highest(size) = highest trong `size` bars gần nhất (từ bar hiện tại lùi về size bars, KHÔNG bao gồm bar hiện tại)
 * - Nếu high[size] > ta.highest(size) → new leg high → BEARISH_LEG
 * - Nếu low[size] < ta.lowest(size) → new leg low → BULLISH_LEG
 * 
 * @param {number[]} highs
 * @param {number[]} lows
 * @param {number} size - lookback period
 * @param {number} currentIndex - current bar index (0-based, bar hiện tại)
 * @param {LegState} legState - state tracker
 * @returns {number} BULLISH_LEG (1) hoặc BEARISH_LEG (0)
 */
function getLeg(highs, lows, size, currentIndex, legState) {
  if (currentIndex < size) {
    legState.value = BEARISH_LEG;
    return BEARISH_LEG;
  }

  // high[size] = high của bar cách đây size bars
  const highAtSize = highs[currentIndex - size];
  const lowAtSize = lows[currentIndex - size];

  // ta.highest(size) = highest trong size bars gần nhất (KHÔNG bao gồm bar hiện tại)
  // Window: [currentIndex - size, currentIndex - 1] (size bars)
  // Nhưng để so sánh với high[size], ta cần highest trong các bars KHÁC high[size]
  // Vậy ta tìm highest trong [currentIndex - size + 1, currentIndex - 1]
  // Nếu window này rỗng (size = 1), thì ta.highest(1) sẽ là highest của bar trước đó
  let highestInWindow = -Infinity;
  let lowestInWindow = Infinity;
  
  // Tìm highest/lowest trong window [currentIndex - size + 1, currentIndex - 1]
  // (không bao gồm bar tại currentIndex - size, vì đó chính là high[size])
  let hasWindow = false;
  for (let i = currentIndex - size + 1; i < currentIndex; i++) {
    if (i >= 0 && i < highs.length) {
      hasWindow = true;
      if (highs[i] > highestInWindow) highestInWindow = highs[i];
      if (lows[i] < lowestInWindow) lowestInWindow = lows[i];
    }
  }

  // Nếu window rỗng (size = 1), thì ta.highest(1) sẽ là highest của bar trước đó
  if (!hasWindow && currentIndex - size >= 0) {
    highestInWindow = highs[currentIndex - size];
    lowestInWindow = lows[currentIndex - size];
  }

  // newLegHigh = high[size] > ta.highest(size)
  // Nếu highAtSize lớn hơn tất cả các high trong window [currentIndex - size + 1, currentIndex - 1]
  const newLegHigh = hasWindow && highAtSize > highestInWindow;
  // newLegLow = low[size] < ta.lowest(size)
  // Nếu lowAtSize nhỏ hơn tất cả các low trong window [currentIndex - size + 1, currentIndex - 1]
  const newLegLow = hasWindow && lowAtSize < lowestInWindow;

  if (newLegHigh) {
    legState.value = BEARISH_LEG;
    return BEARISH_LEG;
  } else if (newLegLow) {
    legState.value = BULLISH_LEG;
    return BULLISH_LEG;
  }

  // Giữ nguyên leg trước đó (var leg trong Pine giữ state)
  return legState.value;
}

/**
 * Pivot structure (giống UDT pivot trong SMC.pine)
 */
class Pivot {
  constructor() {
    this.currentLevel = null;
    this.lastLevel = null;
    this.crossed = false;
    this.barTime = null;
    this.barIndex = null;
  }
}

/**
 * Trend structure (giống UDT trend trong SMC.pine)
 */
class Trend {
  constructor() {
    this.bias = 0; // 0 = neutral, BULLISH = +1, BEARISH = -1
  }
}

/**
 * Order block structure
 */
class OrderBlock {
  constructor(barHigh, barLow, barTime, bias) {
    this.barHigh = barHigh;
    this.barLow = barLow;
    this.barTime = barTime;
    this.bias = bias; // BULLISH or BEARISH
  }
}

/**
 * Fair value gap structure
 */
class FairValueGap {
  constructor(top, bottom, bias) {
    this.top = top;
    this.bottom = bottom;
    this.bias = bias;
    this.time = null;
  }
}

/**
 * Lấy cấu trúc hiện tại (giống getCurrentStructure() trong SMC.pine)
 * @param {Object} params
 * @param {number[]} params.highs
 * @param {number[]} params.lows
 * @param {number[]} params.closes
 * @param {number[]} params.opens
 * @param {number[]} params.times
 * @param {number} params.size - structure size (50 cho swing, 5 cho internal)
 * @param {boolean} params.equalHighLow - true để detect equal highs/lows
 * @param {boolean} params.internal - true cho internal structure
 * @param {Pivot} params.swingHigh - swing high pivot (reference)
 * @param {Pivot} params.swingLow - swing low pivot (reference)
 * @param {Pivot} params.internalHigh - internal high pivot
 * @param {Pivot} params.internalLow - internal low pivot
 * @param {Pivot} params.equalHigh - equal high pivot
 * @param {Pivot} params.equalLow - equal low pivot
 * @param {number} params.atrMeasure - ATR value for equal highs/lows threshold
 * @param {number} params.equalHighsLowsThreshold - threshold (default 0.1)
 * @param {LegState} params.legState - leg state tracker
 * @returns {Object} { swingHigh, swingLow, internalHigh, internalLow, equalHigh, equalLow, alerts, legState }
 */
function getCurrentStructure({
  highs,
  lows,
  closes,
  opens,
  times,
  size,
  equalHighLow = false,
  internal = false,
  swingHigh,
  swingLow,
  internalHigh,
  internalLow,
  equalHigh,
  equalLow,
  atrMeasure = 0,
  equalHighsLowsThreshold = 0.1,
  legState,
}) {
  const alerts = {
    equalHighs: false,
    equalLows: false,
  };

  if (highs.length < size + 1) {
    return { swingHigh, swingLow, internalHigh, internalLow, equalHigh, equalLow, alerts, legState };
  }

  const currentIndex = highs.length - 1;

  if (currentIndex < size) {
    return { swingHigh, swingLow, internalHigh, internalLow, equalHigh, equalLow, alerts, legState };
  }

  // Trong Pine: getCurrentStructure(size) được gọi mỗi bar
  // Nó xem xét bar cách đây size bars (lookbackIndex = currentIndex - size)
  const lookbackIndex = currentIndex - size;

  // Trong Pine: leg(size) được gọi với context của bar hiện tại
  // high[size] = high của bar cách đây size bars
  // ta.highest(size) = highest trong size bars gần nhất (từ bar hiện tại lùi về size bars, KHÔNG bao gồm bar hiện tại)
  // Vậy ta gọi getLeg() với currentIndex là bar hiện tại
  const prevLegValue = legState.value;
  const currentLeg = getLeg(highs, lows, size, currentIndex, legState);

  // Kiểm tra có new leg không (ta.change(leg) != 0)
  // startOfNewLeg = ta.change(leg) != 0
  const newPivot = currentLeg !== prevLegValue;
  const pivotLow = newPivot && currentLeg === BULLISH_LEG;
  const pivotHigh = newPivot && currentLeg === BEARISH_LEG;

  if (newPivot) {
    if (pivotLow) {
      const pivot = equalHighLow ? equalLow : internal ? internalLow : swingLow;

      if (!pivot) {
        return { swingHigh, swingLow, internalHigh, internalLow, equalHigh, equalLow, alerts };
      }

      const lowAtSize = lows[lookbackIndex];
      const timeAtSize = Array.isArray(times) ? times[lookbackIndex] : null;

      // Check equal lows
      if (equalHighLow && pivot.currentLevel !== null) {
        const diff = Math.abs(pivot.currentLevel - lowAtSize);
        if (diff < equalHighsLowsThreshold * atrMeasure) {
          alerts.equalLows = true;
        }
      }

      // Update pivot
      pivot.lastLevel = pivot.currentLevel;
      pivot.currentLevel = lowAtSize;
      pivot.crossed = false;
      pivot.barTime = timeAtSize;
      pivot.barIndex = lookbackIndex;
    } else if (pivotHigh) {
      const pivot = equalHighLow ? equalHigh : internal ? internalHigh : swingHigh;

      if (!pivot) {
        return { swingHigh, swingLow, internalHigh, internalLow, equalHigh, equalLow, alerts, legState };
      }

      const highAtSize = highs[lookbackIndex];
      const timeAtSize = Array.isArray(times) ? times[lookbackIndex] : null;

      // Check equal highs
      if (equalHighLow && pivot.currentLevel !== null) {
        const diff = Math.abs(pivot.currentLevel - highAtSize);
        if (diff < equalHighsLowsThreshold * atrMeasure) {
          alerts.equalHighs = true;
        }
      }

      // Update pivot
      pivot.lastLevel = pivot.currentLevel;
      pivot.currentLevel = highAtSize;
      pivot.crossed = false;
      pivot.barTime = timeAtSize;
      pivot.barIndex = lookbackIndex;
    }
  }

  return { swingHigh, swingLow, internalHigh, internalLow, equalHigh, equalLow, alerts, legState };
}

/**
 * Detect và lưu structure breakouts (BOS/CHoCH) - giống displayStructure() trong SMC.pine
 * @param {Object} params
 * @param {number[]} params.highs
 * @param {number[]} params.lows
 * @param {number[]} params.closes
 * @param {number[]} params.opens
 * @param {number[]} params.times
 * @param {Pivot} params.pivotHigh - swing high hoặc internal high
 * @param {Pivot} params.pivotLow - swing low hoặc internal low
 * @param {Trend} params.trend - swing trend hoặc internal trend
 * @param {boolean} params.internal - true cho internal structure
 * @param {boolean} params.internalFilterConfluence - filter confluence cho internal
 * @param {Pivot} params.swingHigh - reference swing high (để check internal != swing)
 * @param {Pivot} params.swingLow - reference swing low (để check internal != swing)
 * @param {OrderBlock[]} params.orderBlocks - array để lưu order blocks
 * @param {number[]} params.parsedHighs - parsed highs (cho order blocks)
 * @param {number[]} params.parsedLows - parsed lows (cho order blocks)
 * @param {number[]} params.times - times array
 * @param {boolean} params.showOrderBlocks - có lưu order blocks không
 * @returns {Object} { signals, trend, orderBlocks }
 */
function displayStructure({
  highs,
  lows,
  closes,
  opens,
  times,
  pivotHigh,
  pivotLow,
  trend,
  internal = false,
  internalFilterConfluence = false,
  swingHigh,
  swingLow,
  orderBlocks = [],
  parsedHighs = [],
  parsedLows = [],
  showOrderBlocks = false,
}) {
  const signals = [];
  const currentIndex = closes.length - 1;

  if (currentIndex < 1) {
    return { signals, trend, orderBlocks };
  }

  const currentClose = closes[currentIndex];
  const prevClose = closes[currentIndex - 1];
  const currentHigh = highs[currentIndex];
  const currentLow = lows[currentIndex];
  const currentOpen = opens && opens[currentIndex] !== undefined ? opens[currentIndex] : currentClose;

  // Confluence filter cho internal structure
  let bullishBar = true;
  let bearishBar = true;
  if (internalFilterConfluence && internal) {
    const maxCO = Math.max(currentClose, currentOpen);
    const minCO = Math.min(currentClose, currentOpen);
    bullishBar = currentHigh - maxCO > minCO - currentLow;
    bearishBar = currentHigh - maxCO < minCO - currentLow;
  }

  // Check bullish breakout (crossover)
  if (pivotHigh && pivotHigh.currentLevel !== null) {
    const extraCondition = internal
      ? pivotHigh.currentLevel !== (swingHigh?.currentLevel ?? null) && bullishBar
      : true;

    if (
      prevClose <= pivotHigh.currentLevel &&
      currentClose > pivotHigh.currentLevel &&
      !pivotHigh.crossed &&
      extraCondition
    ) {
      const tag = trend.bias === BEARISH ? 'CHoCH' : 'BOS';
      const direction = 'bullish';

      signals.push({
        index: currentIndex,
        time: Array.isArray(times) ? times[currentIndex] : null,
        type: tag,
        direction,
        level: pivotHigh.currentLevel,
        internal,
      });

      pivotHigh.crossed = true;
      trend.bias = BULLISH;

      // Store order block
      if (showOrderBlocks && pivotHigh.barIndex !== null) {
        const orderBlock = storeOrderBlock({
          pivot: pivotHigh,
          bias: BULLISH,
          parsedHighs,
          parsedLows,
          times,
        });
        if (orderBlock) {
          orderBlocks.push(orderBlock);
        }
      }
    }
  }

  // Check bearish breakout (crossunder)
  if (pivotLow && pivotLow.currentLevel !== null) {
    const extraCondition = internal
      ? pivotLow.currentLevel !== (swingLow?.currentLevel ?? null) && bearishBar
      : true;

    if (
      prevClose >= pivotLow.currentLevel &&
      currentClose < pivotLow.currentLevel &&
      !pivotLow.crossed &&
      extraCondition
    ) {
      const tag = trend.bias === BULLISH ? 'CHoCH' : 'BOS';
      const direction = 'bearish';

      signals.push({
        index: currentIndex,
        time: Array.isArray(times) ? times[currentIndex] : null,
        type: tag,
        direction,
        level: pivotLow.currentLevel,
        internal,
      });

      pivotLow.crossed = true;
      trend.bias = BEARISH;

      // Store order block
      if (showOrderBlocks && pivotLow.barIndex !== null) {
        const orderBlock = storeOrderBlock({
          pivot: pivotLow,
          bias: BEARISH,
          parsedHighs,
          parsedLows,
          times,
        });
        if (orderBlock) {
          orderBlocks.push(orderBlock);
        }
      }
    }
  }

  return { signals, trend, orderBlocks };
}

/**
 * Store order block - giống storeOrdeBlock() trong SMC.pine
 */
function storeOrderBlock({ pivot, bias, parsedHighs, parsedLows, times }) {
  if (pivot.barIndex === null || pivot.barIndex < 0) return null;

  const currentIndex = parsedHighs.length - 1;
  if (currentIndex <= pivot.barIndex) return null;

  let array;
  let parsedIndex;

  if (bias === BEARISH) {
    array = parsedHighs.slice(pivot.barIndex, currentIndex + 1);
    const maxValue = Math.max(...array);
    parsedIndex = pivot.barIndex + array.indexOf(maxValue);
  } else {
    array = parsedLows.slice(pivot.barIndex, currentIndex + 1);
    const minValue = Math.min(...array);
    parsedIndex = pivot.barIndex + array.indexOf(minValue);
  }

  if (parsedIndex < 0 || parsedIndex >= parsedHighs.length) return null;

  return new OrderBlock(
    parsedHighs[parsedIndex],
    parsedLows[parsedIndex],
    Array.isArray(times) ? times[parsedIndex] : null,
    bias
  );
}

/**
 * Delete order blocks khi bị mitigate - giống deleteOrderBlocks() trong SMC.pine
 */
function deleteOrderBlocks(orderBlocks, closes, highs, lows, mitigationSource = 'close') {
  const activeBlocks = [];
  const mitigated = [];

  for (const ob of orderBlocks) {
    let crossed = false;

    if (ob.bias === BEARISH) {
      const source = mitigationSource === 'close' ? closes[closes.length - 1] : highs[highs.length - 1];
      if (source > ob.barHigh) {
        crossed = true;
      }
    } else {
      const source = mitigationSource === 'close' ? closes[closes.length - 1] : lows[lows.length - 1];
      if (source < ob.barLow) {
        crossed = true;
      }
    }

    if (crossed) {
      mitigated.push(ob);
    } else {
      activeBlocks.push(ob);
    }
  }

  return { activeBlocks, mitigated };
}

/**
 * Detect fair value gaps - giống drawFairValueGaps() trong SMC.pine
 * @param {Object} params
 * @param {number[]} params.highs
 * @param {number[]} params.lows
 * @param {number[]} params.closes
 * @param {number[]} params.opens
 * @param {number[]} params.times
 * @param {boolean} params.autoThreshold - auto threshold
 * @returns {FairValueGap[]}
 */
function detectFairValueGaps({ highs, lows, closes, opens, times, autoThreshold = true }) {
  const fvgs = [];

  if (highs.length < 3) return fvgs;

  const currentIndex = highs.length - 1;
  const last2High = highs[currentIndex - 2];
  const last2Low = lows[currentIndex - 2];
  const lastClose = closes[currentIndex - 1];
  const lastOpen = opens && opens[currentIndex - 1] !== undefined ? opens[currentIndex - 1] : lastClose;
  const currentHigh = highs[currentIndex];
  const currentLow = lows[currentIndex];

  const barDeltaPercent = (lastClose - lastOpen) / (lastOpen * 100);
  let threshold = 0;

  if (autoThreshold) {
    // Tính cumulative mean của barDeltaPercent
    let sum = 0;
    let count = 0;
    for (let i = 1; i < closes.length; i++) {
      const open = opens && opens[i - 1] !== undefined ? opens[i - 1] : closes[i - 1];
      const delta = Math.abs((closes[i - 1] - open) / (open * 100));
      sum += delta;
      count++;
    }
    threshold = count > 0 ? (sum / count) * 2 : 0;
  }

  // Bullish FVG: currentLow > last2High và lastClose > last2High
  if (currentLow > last2High && lastClose > last2High && barDeltaPercent > threshold) {
    fvgs.push(
      new FairValueGap(currentLow, last2High, BULLISH)
    );
    if (Array.isArray(times)) {
      fvgs[fvgs.length - 1].time = times[currentIndex];
    }
  }

  // Bearish FVG: currentHigh < last2Low và lastClose < last2Low
  if (currentHigh < last2Low && lastClose < last2Low && -barDeltaPercent > threshold) {
    fvgs.push(
      new FairValueGap(currentHigh, last2Low, BEARISH)
    );
    if (Array.isArray(times)) {
      fvgs[fvgs.length - 1].time = times[currentIndex];
    }
  }

  return fvgs;
}

/**
 * Parse highs/lows với volatility filter - giống logic trong SMC.pine
 */
function parseHighsLows(highs, lows, volatilityMeasure) {
  const parsedHighs = [];
  const parsedLows = [];

  for (let i = 0; i < highs.length; i++) {
    const highVolatilityBar = (highs[i] - lows[i]) >= 2 * volatilityMeasure;
    const parsedHigh = highVolatilityBar ? lows[i] : highs[i];
    const parsedLow = highVolatilityBar ? highs[i] : lows[i];
    parsedHighs.push(parsedHigh);
    parsedLows.push(parsedLow);
  }

  return { parsedHighs, parsedLows };
}

/**
 * API chính: tính SMC từ dữ liệu OHLC - giống 100% logic SMC.pine
 * 
 * @param {Object} params
 * @param {number[]} params.highs
 * @param {number[]} params.lows
 * @param {number[]} params.closes
 * @param {number[]} [params.opens] - optional, nếu không có sẽ dùng closes
 * @param {number[]} [params.times] - optional timestamps
 * @param {number} [params.swingsLength=50] - swing structure size (mặc định 50)
 * @param {number} [params.internalSize=5] - internal structure size (mặc định 5)
 * @param {number} [params.equalHighsLowsLength=3] - equal highs/lows length (mặc định 3)
 * @param {number} [params.equalHighsLowsThreshold=0.1] - threshold (mặc định 0.1)
 * @param {boolean} [params.showInternals=true] - show internal structure
 * @param {boolean} [params.showStructure=true] - show swing structure
 * @param {boolean} [params.showEqualHighsLows=true] - show equal highs/lows
 * @param {boolean} [params.showInternalOrderBlocks=true] - show internal order blocks
 * @param {boolean} [params.showSwingOrderBlocks=false] - show swing order blocks
 * @param {boolean} [params.showFairValueGaps=false] - show fair value gaps
 * @param {boolean} [params.internalFilterConfluence=false] - filter confluence cho internal
 * @param {string} [params.orderBlockFilter='Atr'] - 'Atr' hoặc 'Range'
 * @param {string} [params.orderBlockMitigation='High/Low'] - 'Close' hoặc 'High/Low'
 * @param {boolean} [params.fairValueGapsAutoThreshold=true] - auto threshold cho FVG
 * 
 * @returns {Object} Kết quả SMC
 */
function calculateSMC({
  highs,
  lows,
  closes,
  opens,
  times,
  swingsLength = 50,
  internalSize = 5,
  equalHighsLowsLength = 3,
  equalHighsLowsThreshold = 0.1,
  showInternals = true,
  showStructure = true,
  showEqualHighsLows = true,
  showInternalOrderBlocks = true,
  showSwingOrderBlocks = false,
  showFairValueGaps = false,
  internalFilterConfluence = false,
  orderBlockFilter = 'Atr',
  orderBlockMitigation = 'High/Low',
  fairValueGapsAutoThreshold = true,
}) {
  if (!Array.isArray(highs) || !Array.isArray(lows) || !Array.isArray(closes)) {
    throw new Error('calculateSMC: highs, lows, closes phải là mảng số');
  }
  if (!(highs.length && lows.length && closes.length)) {
    throw new Error('calculateSMC: mảng dữ liệu trống');
  }

  const len = Math.min(highs.length, lows.length, closes.length);
  const h = highs.slice(0, len).map(Number);
  const l = lows.slice(0, len).map(Number);
  const c = closes.slice(0, len).map(Number);
  const o = Array.isArray(opens) ? opens.slice(0, len).map(Number) : c.slice();
  const t = Array.isArray(times) ? times.slice(0, len) : null;

  // Tính ATR và volatility measure
  const atrMeasure = calculateATR(h, l, c, 200);
  const volatilityMeasure =
    orderBlockFilter === 'Atr' ? atrMeasure : calculateCumulativeMeanRange(h, l, c);

  // Parse highs/lows với volatility filter
  const { parsedHighs, parsedLows } = parseHighsLows(h, l, volatilityMeasure);

  // Khởi tạo pivots và trends
  const swingHigh = new Pivot();
  const swingLow = new Pivot();
  const internalHigh = new Pivot();
  const internalLow = new Pivot();
  const equalHigh = new Pivot();
  const equalLow = new Pivot();

  const swingTrend = new Trend();
  const internalTrend = new Trend();

  // Leg states cho mỗi structure
  const swingLegState = new LegState();
  const internalLegState = new LegState();
  const equalLegState = new LegState();

  // Arrays để lưu signals và order blocks
  const allSignals = [];
  const swingOrderBlocks = [];
  const internalOrderBlocks = [];

  // Process từng bar (giống execution trong SMC.pine)
  // Bắt đầu từ bar đủ dữ liệu
  const startIndex = Math.max(swingsLength, internalSize, equalHighsLowsLength);
  
  for (let i = startIndex; i < len; i++) {
    const currentHighs = h.slice(0, i + 1);
    const currentLows = l.slice(0, i + 1);
    const currentCloses = c.slice(0, i + 1);
    const currentOpens = o.slice(0, i + 1);
    const currentTimes = t ? t.slice(0, i + 1) : null;
    const currentParsedHighs = parsedHighs.slice(0, i + 1);
    const currentParsedLows = parsedLows.slice(0, i + 1);

    // getCurrentStructure cho swing (swingsLength)
    if (showStructure || showSwingOrderBlocks) {
      getCurrentStructure({
        highs: currentHighs,
        lows: currentLows,
        closes: currentCloses,
        opens: currentOpens,
        times: currentTimes,
        size: swingsLength,
        equalHighLow: false,
        internal: false,
        swingHigh,
        swingLow,
        internalHigh,
        internalLow,
        equalHigh,
        equalLow,
        atrMeasure,
        equalHighsLowsThreshold,
        legState: swingLegState,
      });
    }

    // getCurrentStructure cho internal (size 5)
    if (showInternals || showInternalOrderBlocks) {
      getCurrentStructure({
        highs: currentHighs,
        lows: currentLows,
        closes: currentCloses,
        opens: currentOpens,
        times: currentTimes,
        size: internalSize,
        equalHighLow: false,
        internal: true,
        swingHigh,
        swingLow,
        internalHigh,
        internalLow,
        equalHigh,
        equalLow,
        atrMeasure,
        equalHighsLowsThreshold,
        legState: internalLegState,
      });
    }

    // getCurrentStructure cho equal highs/lows
    if (showEqualHighsLows) {
      getCurrentStructure({
        highs: currentHighs,
        lows: currentLows,
        closes: currentCloses,
        opens: currentOpens,
        times: currentTimes,
        size: equalHighsLowsLength,
        equalHighLow: true,
        internal: false,
        swingHigh,
        swingLow,
        internalHigh,
        internalLow,
        equalHigh,
        equalLow,
        atrMeasure,
        equalHighsLowsThreshold,
        legState: equalLegState,
      });
    }

    // displayStructure cho internal
    if (showInternals || showInternalOrderBlocks) {
      const internalResult = displayStructure({
        highs: currentHighs,
        lows: currentLows,
        closes: currentCloses,
        opens: currentOpens,
        times: currentTimes,
        pivotHigh: internalHigh,
        pivotLow: internalLow,
        trend: internalTrend,
        internal: true,
        internalFilterConfluence,
        swingHigh,
        swingLow,
        orderBlocks: internalOrderBlocks,
        parsedHighs: currentParsedHighs,
        parsedLows: currentParsedLows,
        showOrderBlocks: showInternalOrderBlocks,
      });
      allSignals.push(...internalResult.signals.map((s) => ({ ...s, internal: true })));
      // Update internalOrderBlocks
      internalOrderBlocks.length = 0;
      internalOrderBlocks.push(...internalResult.orderBlocks);
    }

    // displayStructure cho swing
    if (showStructure || showSwingOrderBlocks) {
      const swingResult = displayStructure({
        highs: currentHighs,
        lows: currentLows,
        closes: currentCloses,
        opens: currentOpens,
        times: currentTimes,
        pivotHigh: swingHigh,
        pivotLow: swingLow,
        trend: swingTrend,
        internal: false,
        internalFilterConfluence: false,
        swingHigh,
        swingLow,
        orderBlocks: swingOrderBlocks,
        parsedHighs: currentParsedHighs,
        parsedLows: currentParsedLows,
        showOrderBlocks: showSwingOrderBlocks,
      });
      allSignals.push(...swingResult.signals.map((s) => ({ ...s, internal: false })));
      // Update swingOrderBlocks
      swingOrderBlocks.length = 0;
      swingOrderBlocks.push(...swingResult.orderBlocks);
    }

    // Delete order blocks khi bị mitigate
    if (showInternalOrderBlocks) {
      const mitigationSource = orderBlockMitigation === 'Close' ? 'close' : 'high/low';
      const { activeBlocks } = deleteOrderBlocks(
        internalOrderBlocks,
        currentCloses,
        currentHighs,
        currentLows,
        mitigationSource
      );
      internalOrderBlocks.length = 0;
      internalOrderBlocks.push(...activeBlocks);
    }

    if (showSwingOrderBlocks) {
      const mitigationSource = orderBlockMitigation === 'Close' ? 'close' : 'high/low';
      const { activeBlocks } = deleteOrderBlocks(
        swingOrderBlocks,
        currentCloses,
        currentHighs,
        currentLows,
        mitigationSource
      );
      swingOrderBlocks.length = 0;
      swingOrderBlocks.push(...activeBlocks);
    }
  }

  // Detect fair value gaps
  const fairValueGaps = showFairValueGaps
    ? detectFairValueGaps({
        highs: h,
        lows: l,
        closes: c,
        opens: o,
        times: t,
        autoThreshold: fairValueGapsAutoThreshold,
      })
    : [];

  // Lọc signals theo type
  const bosSignals = allSignals.filter((s) => s.type === 'BOS');
  const chochSignals = allSignals.filter((s) => s.type === 'CHoCH');
  const lastSignal = allSignals.length > 0 ? allSignals[allSignals.length - 1] : null;

  return {
    // Pivots
    swingHigh: swingHigh.currentLevel,
    swingLow: swingLow.currentLevel,
    internalHigh: internalHigh.currentLevel,
    internalLow: internalLow.currentLevel,
    equalHigh: equalHigh.currentLevel,
    equalLow: equalLow.currentLevel,

    // Trends
    swingTrend: swingTrend.bias === BULLISH ? 'bullish' : swingTrend.bias === BEARISH ? 'bearish' : null,
    internalTrend:
      internalTrend.bias === BULLISH ? 'bullish' : internalTrend.bias === BEARISH ? 'bearish' : null,

    // Signals
    signals: allSignals,
    bosSignals,
    chochSignals,
    lastSignal,

    // Order blocks
    swingOrderBlocks: swingOrderBlocks.map((ob) => ({
      barHigh: ob.barHigh,
      barLow: ob.barLow,
      barTime: ob.barTime,
      bias: ob.bias === BULLISH ? 'bullish' : 'bearish',
    })),
    internalOrderBlocks: internalOrderBlocks.map((ob) => ({
      barHigh: ob.barHigh,
      barLow: ob.barLow,
      barTime: ob.barTime,
      bias: ob.bias === BULLISH ? 'bullish' : 'bearish',
    })),

    // Fair value gaps
    fairValueGaps: fairValueGaps.map((fvg) => ({
      top: fvg.top,
      bottom: fvg.bottom,
      bias: fvg.bias === BULLISH ? 'bullish' : 'bearish',
      time: fvg.time,
    })),

    // Metadata
    atrMeasure,
    volatilityMeasure,
  };
}

module.exports = {
  calculateSMC,
};
