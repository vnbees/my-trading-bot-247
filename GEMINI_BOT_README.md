# Gemini AI Trading Bot

Bot tự động phân tích giá cryptocurrency bằng Google Gemini AI và vào lệnh tự động trên Bitget.

## Tính năng

- 🤖 **Phân tích bằng AI**: Sử dụng Google Gemini AI để phân tích giá và đưa ra tín hiệu giao dịch
- 📊 **Nguồn dữ liệu**: Lấy dữ liệu giá 5 phút trong 1 ngày gần nhất từ Binance
- ⏰ **Tự động chạy**: Chạy mỗi 1 giờ một lần để phân tích và vào lệnh
- 🎯 **Tự động vào lệnh**: Tự động đặt lệnh Long/Short theo khuyến nghị của AI với TP/SL
- 💰 **Quản lý vốn**: Hỗ trợ chỉ định capital hoặc dùng toàn bộ equity

## Cách sử dụng

### Cài đặt

Dependencies đã có sẵn trong `package.json`. Nếu chưa cài, chạy:

```bash
npm install
```

### Cấu hình

Tạo file `.env` trong thư mục dự án và thêm Google API Key:

```bash
# Copy file mẫu
cp .env.example .env

# Hoặc tạo file .env và thêm:
GOOGLE_API_KEY=your_google_api_key_here
```

**Lưu ý**: File `.env` đã được thêm vào `.gitignore` để không commit lên git.

### Chạy bot

```bash
node startGeminiBot.js \
  --key=YOUR_BITGET_API_KEY \
  --secret=YOUR_BITGET_API_SECRET \
  --passphrase=YOUR_PASSPHRASE \
  --symbol=BTCUSDT_UMCBL \
  --capital=10 \
  --leverage=10
```

### Các tham số

- `--key`: Bitget API key (bắt buộc)
- `--secret`: Bitget API secret (bắt buộc)
- `--passphrase`: Bitget API passphrase (tùy chọn)
- `--symbol`: Symbol contract (mặc định: `BTCUSDT_UMCBL`)
- `--margin`: Margin coin (mặc định: `USDT`)
- `--capital`: Số tiền muốn vào lệnh (USDT). Nếu 0 hoặc không chỉ định, sẽ dùng toàn bộ equity
- `--leverage`: Leverage (mặc định: `10`)
- `--tick`: Price tick size (để 0 để tự động detect)
- `--sizeStep`: Quantity step size (để 0 để tự động detect)

### Ví dụ

```bash
# Với BTCUSDT, capital 10 USDT, leverage 10x
node startGeminiBot.js \
  --key=bg_xxx \
  --secret=xxx \
  --passphrase=xxx \
  --symbol=BTCUSDT_UMCBL \
  --capital=10 \
  --leverage=10

# Với XRPUSDT, dùng toàn bộ equity, leverage 5x
node startGeminiBot.js \
  --key=bg_xxx \
  --secret=xxx \
  --passphrase=xxx \
  --symbol=XRPUSDT_UMCBL \
  --capital=0 \
  --leverage=5
```

## Cách hoạt động

1. **Lấy dữ liệu**: Bot lấy 288 candles (1 ngày) khung 5 phút từ Binance
2. **Phân tích AI**: Gửi dữ liệu tới Google Gemini AI để phân tích
3. **Parse kết quả**: AI trả về JSON với các thông tin:
   - `action`: "long", "short", hoặc "none"
   - `entry`: Giá vào lệnh
   - `takeProfit`: Mức chốt lời
   - `stopLoss`: Mức cắt lỗ
   - `reason`: Lý do
   - `confidence`: Độ tin cậy (high/medium/low)
4. **Vào lệnh**: Nếu có tín hiệu (action không phải "none"), bot sẽ tự động:
   - Tính lot size dựa trên capital và leverage
   - Đặt lệnh market với TP/SL preset
   - Lưu thông tin position

## Lưu ý

- Bot chỉ mở 1 position tại một thời điểm
- Nếu đang có position, bot sẽ bỏ qua phân tích mới
- Bot chạy mỗi 1 giờ một lần
- API key của Gemini được đọc từ file `.env` (biến môi trường `GOOGLE_API_KEY`)
- Nếu không tìm thấy API key trong `.env`, code sẽ báo lỗi và dừng

## Bảo mật

- **KHÔNG** chia sẻ API keys của bạn
- Sử dụng environment variables nếu có thể
- Kiểm tra lại các tham số trước khi chạy bot

## Khác biệt với Smart Trend Bot

| Tính năng | Smart Trend Bot | Gemini AI Bot |
|-----------|----------------|---------------|
| Phân tích | EMA + ADX chỉ báo | Gemini AI |
| Nguồn dữ liệu | Bitget | Binance |
| Tần suất | Theo nến (5 phút) | Mỗi 1 giờ |
| Tín hiệu | ADX crossover + EMA | AI phân tích |


