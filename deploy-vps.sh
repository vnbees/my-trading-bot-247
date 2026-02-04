#!/bin/bash

# Script tự động deploy bot lên VPS
# Usage: ./deploy-vps.sh

echo "🚀 Deploy Rebalance Spot Bot lên VPS"
echo "===================================="

# Kiểm tra Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js chưa được cài đặt"
    echo "Đang cài Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
fi

# Kiểm tra PM2
if ! command -v pm2 &> /dev/null; then
    echo "❌ PM2 chưa được cài đặt"
    echo "Đang cài PM2..."
    sudo npm install -g pm2
fi

# Cài đặt dependencies
echo "📦 Đang cài đặt dependencies..."
npm install --only=production

# Tạo thư mục logs nếu chưa có
mkdir -p logs

# Dừng bot cũ nếu đang chạy
echo "🛑 Dừng bot cũ (nếu có)..."
pm2 stop rebalance-spot-bot 2>/dev/null || true
pm2 delete rebalance-spot-bot 2>/dev/null || true

# Khởi động bot mới
echo "▶️  Khởi động bot..."
pm2 start ecosystem.config.js

# Lưu cấu hình PM2
pm2 save

# Hiển thị status
echo ""
echo "✅ Deploy thành công!"
echo ""
echo "📊 Trạng thái bot:"
pm2 status

echo ""
echo "📝 Các lệnh hữu ích:"
echo "  - Xem logs: pm2 logs rebalance-spot-bot"
echo "  - Xem status: pm2 status"
echo "  - Restart: pm2 restart rebalance-spot-bot"
echo "  - Stop: pm2 stop rebalance-spot-bot"
echo "  - Monitor: pm2 monit"
echo ""
