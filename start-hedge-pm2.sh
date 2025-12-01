#!/bin/bash

# PM2 script để chạy Hedge Trading Bot
# Usage: ./start-hedge-pm2.sh

# Load environment variables
if [ -f .env ]; then
  export $(cat .env | grep -v '^#' | xargs)
fi

# Kiểm tra các biến môi trường bắt buộc
if [ -z "$BITGET_API_KEY" ] || [ -z "$BITGET_API_SECRET" ]; then
  echo "❌ Lỗi: Thiếu BITGET_API_KEY hoặc BITGET_API_SECRET trong file .env"
  exit 1
fi

# Mặc định
SYMBOL="${HEDGE_BOT_SYMBOL:-BTCUSDT_UMCBL}"
MARGIN_COIN="${HEDGE_BOT_MARGIN_COIN:-USDT}"
CAPITAL="${HEDGE_BOT_CAPITAL:-0}"
LEVERAGE="${HEDGE_BOT_LEVERAGE:-10}"
INTERVAL="${HEDGE_BOT_INTERVAL:-5}"

echo "🚀 Khởi động Hedge Trading Bot với PM2..."
echo "  - Symbol: $SYMBOL"
echo "  - Margin Coin: $MARGIN_COIN"
echo "  - Capital: $CAPITAL (chia đôi cho 2 lệnh)"
echo "  - Leverage: ${LEVERAGE}x"
echo "  - Check Interval: ${INTERVAL} phút"

pm2 start startHedgeBot.js \
  --name "hedge-bot-${SYMBOL}" \
  --time \
  --no-autorestart \
  -- \
  --key="$BITGET_API_KEY" \
  --secret="$BITGET_API_SECRET" \
  --passphrase="$BITGET_PASSPHRASE" \
  --symbol="$SYMBOL" \
  --margin="$MARGIN_COIN" \
  --capital="$CAPITAL" \
  --leverage="$LEVERAGE" \
  --interval="$INTERVAL"

echo ""
echo "✅ Bot đã được khởi động!"
echo ""
echo "📊 Xem logs:"
echo "  pm2 logs hedge-bot-${SYMBOL}"
echo ""
echo "🛑 Dừng bot:"
echo "  pm2 stop hedge-bot-${SYMBOL}"
echo ""
echo "🔄 Restart bot:"
echo "  pm2 restart hedge-bot-${SYMBOL}"
echo ""

