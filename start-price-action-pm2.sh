#!/bin/bash

# Script để chạy Price Action Bot với PM2 (production mode)
# 
# Usage:
#   chmod +x start-price-action-pm2.sh
#   ./start-price-action-pm2.sh

# Cấu hình - Thay đổi các giá trị này
API_KEY="your_bitget_api_key"
API_SECRET="your_bitget_api_secret"
API_PASSPHRASE="your_bitget_passphrase"

SYMBOL="BTCUSDT_UMCBL"
CAPITAL="100"              # Số USDT vào mỗi lệnh (0 = dùng toàn bộ equity)
LEVERAGE="10"              # Đòn bẩy
MARGIN_COIN="USDT"

# Kiểm tra PM2 đã cài chưa
if ! command -v pm2 &> /dev/null; then
    echo "❌ PM2 chưa được cài đặt. Cài đặt bằng: npm install -g pm2"
    exit 1
fi

# Kiểm tra GOOGLE_API_KEY
if [ -z "$GOOGLE_API_KEY" ]; then
    echo "⚠️ GOOGLE_API_KEY chưa được set. Kiểm tra file .env hoặc export biến môi trường."
    exit 1
fi

# Dừng bot cũ nếu đang chạy
pm2 delete price-action-bot 2>/dev/null || true

# Khởi động bot với PM2
echo "🚀 Đang khởi động Price Action Bot với PM2..."
pm2 start startPriceActionBot.js \
  --name "price-action-bot" \
  --time \
  --restart-delay=30000 \
  --max-restarts=10 \
  -- \
  --key="$API_KEY" \
  --secret="$API_SECRET" \
  --passphrase="$API_PASSPHRASE" \
  --symbol="$SYMBOL" \
  --capital="$CAPITAL" \
  --leverage="$LEVERAGE" \
  --margin="$MARGIN_COIN"

# Lưu cấu hình PM2
pm2 save

echo ""
echo "✅ Price Action Bot đã được khởi động!"
echo ""
echo "📊 Xem status:"
echo "   pm2 status"
echo ""
echo "📜 Xem logs:"
echo "   pm2 logs price-action-bot"
echo ""
echo "🔄 Restart bot:"
echo "   pm2 restart price-action-bot"
echo ""
echo "🛑 Dừng bot:"
echo "   pm2 stop price-action-bot"
echo ""
echo "🗑️ Xóa bot:"
echo "   pm2 delete price-action-bot"
echo ""

