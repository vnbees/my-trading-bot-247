# my-trading-bot-247

<!-- ema1226 + rsi -->
node startTrend.js --key=bg_341563e7ffde3387dd8d85b38d039671 --secret=e3b3e24d8d80de7739b0fd5553a9a908ab1894a39710491bb0b0807c332991fe --passphrase=123abcABCD --symbol=XRPUSDT_UMCBL --capital=1 --leverage=10

<!-- ema12:26 + adx -->
node startSmartTrend.js --key=bg_341563e7ffde3387dd8d85b38d039671 --secret=e3b3e24d8d80de7739b0fd5553a9a908ab1894a39710491bb0b0807c332991fe --passphrase=123abcABCD --symbol=XRPUSDT_UMCBL --capital=1 --leverage=10

<!-- backtest ema12:26 + adx -->
node backtestSmartTrend.js --symbol=XRPUSDT_UMCBL --timeFrame=5m --lookbackDays=3 --capital=1 --leverage=10 --verbose --timezoneOffset=420 --fee=true --feeBasis=capital
 <!--kết quả chạy backtest có vẻ ~9-10% / tháng. tính theo tổng vốn chia 10 và mỗi lệnh là 10% tổng vốn  -->

## Backtesting the Smart Trend Strategy

If you only want to replay the EMA/ADX logic on historical candles rather than hitting Bitget, run the new `backtestSmartTrend.js` helper. It pulls Binance 5m candles, derives EMA12/EMA26/ADX, then simulates SL/TP exits with the same sizing rules.

```bash
node backtestSmartTrend.js \
  --symbol=XRPUSDT_UMCBL \
  --timeFrame=5m \
  --lookbackDays=30 \
  --capital=1 \
  --leverage=10 \
  --verbose
```

Add `--timezoneOffset=420` (minutes) if you want timestamps shown in UTC+7 (the script prints `Entry`/`Exit` times in a local-friendly format). Use `--fee=true --feeBasis=capital` if you want the fee deducted directly from your capital (e.g. 10x → 1.2% of the capital per trade). Other options are the same as Live Smart Trend.

Add `--fee` to include trading fee (1.2% per trade for 10x, 0.5% for 5x) so the summary reflects net PnL after fees.

Adjust `--lookbackDays`, `--timeFrame`, `--capital`, or `--initialEquity` to experiment. The script prints a short summary plus optional trade logs (`--verbose`). You still need network access so you can run it locally; the current environment blocks outbound HTTP, which is why results aren’t already provided here.
All console output from the backtest (headers, trades, summary) is shown in Vietnamese for easier reading.

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