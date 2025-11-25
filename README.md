# my-trading-bot-247

<!-- ema1226 + rsi -->
node startTrend.js --key=bg_341563e7ffde3387dd8d85b38d039671 --secret=e3b3e24d8d80de7739b0fd5553a9a908ab1894a39710491bb0b0807c332991fe --passphrase=123abcABCD --symbol=XRPUSDT_UMCBL --capital=1 --leverage=10

<!-- ema12:26 + adx -->
node startSmartTrend.js --key=bg_341563e7ffde3387dd8d85b38d039671 --secret=e3b3e24d8d80de7739b0fd5553a9a908ab1894a39710491bb0b0807c332991fe --passphrase=123abcABCD --symbol=XRPUSDT_UMCBL --capital=1 --leverage=10

<!-- terminal gg clound -->
   # Update và cài Node.js 18 + PM2
   sudo apt update && sudo apt upgrade -y
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt install -y nodejs
   sudo npm install -g pm2

   # Tải code bot (ví dụ clone repo, hoặc scp zip lên)
   git clone https://github.com/vnbees/my-trading-bot-247.git ~/bot-bitget   # hoặc upload zip rồi unzip
   cd ~/bot-bitget
   npm install --only=production

   # Chạy bot (lệnh bạn cung cấp)
   pm2 start "node startSmartTrend.js --key=bg_341563e7ffde3387dd8d85b38d039671 --secret=e3b3e24d8d80de7739b0fd5553a9a908ab1894a39710491bb0b0807c332991fe --passphrase=123abcABCD --symbol=XRPUSDT_UMCBL --capital=1 --leverage=10" --name smart-trend

   # Lưu cấu hình PM2 để auto khởi động
   pm2 save
   pm2 startup systemd

    pm2 status
   pm2 logs smart-trend

   Lần tới SSH vào
gcloud compute ssh ubuntu@bitget-bot --zone=us-west1-b rồi dùng pm2 status để xem bot.
Vậy là bot chạy 24/7 trên VM free tier. Nếu bạn cần hướng dẫn upload code qua giao diện hoặc tạo script auto cài đặt, mình có thể soạn cho bạn.