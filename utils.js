/**
 * Generic helpers.
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const calcTargets = ({ entryPrice, takeProfitPercent, stopLossPercent, side }) => {
  const multiplierTp = takeProfitPercent || 0;
  const multiplierSl = stopLossPercent || 0;
  if (side === 'long') {
    return {
      tp: entryPrice * (1 + multiplierTp),
      sl: entryPrice * (1 - multiplierSl),
    };
  }
  return {
    tp: entryPrice * (1 - multiplierTp),
    sl: entryPrice * (1 + multiplierSl),
  };
};

const formatNumber = (value, decimals = 4) => Number(value).toFixed(decimals);

const percentFormat = (value) => `${(value * 100).toFixed(2)}%`;

const roundToTick = (value, tickSize = 0.1) => {
  if (!tickSize) return value;
  return Math.round(value / tickSize) * tickSize;
};

const roundToStep = (value, step = 0.0001) => {
  if (!step) return value;
  return Math.floor(value / step) * step;
};

const getDecimalsFromStep = (step) => {
  if (!step) return 4;
  const str = step.toString();
  if (str.includes('e-')) {
    const [, exp] = str.split('e-');
    return Number(exp) || 4;
  }
  const decimalPart = str.split('.')[1];
  return decimalPart ? decimalPart.length : 0;
};

module.exports = {
  sleep,
  calcTargets,
  formatNumber,
  percentFormat,
  roundToTick,
  roundToStep,
  getDecimalsFromStep,
};

