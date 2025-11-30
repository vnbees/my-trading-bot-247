# Gemini AI Trading Bot

Bot tự động phân tích giá cryptocurrency bằng Google Gemini AI và vào lệnh tự động trên Bitget.

## Tính năng

- 🤖 **Phân tích bằng AI**: Sử dụng Google Gemini AI để phân tích giá và đưa ra tín hiệu giao dịch
- 📊 **Nguồn dữ liệu**: Lấy dữ liệu giá 5 phút trong 1 ngày gần nhất từ Binance
- ⏰ **Tự động điều chỉnh thời gian**: AI tự ước tính thời gian chạy tiếp theo dựa trên phân tích thị trường (15 phút - 24 giờ)
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

1. **Lấy dữ liệu đa khung thời gian**: Bot lấy dữ liệu từ Binance:
   - 5m: 288 candles (1 ngày)
   - 1h: 168 candles (1 tuần)
   - 4h: 90 candles (15 ngày)
   - 1d: 30 candles (30 ngày)

2. **Tính toán chỉ báo kỹ thuật**: Bot tính toán đầy đủ các chỉ báo từ 4 nhóm:
   - **Trend**: EMA, SMA, MACD, ADX
   - **Momentum**: RSI, Stochastic, ROC
   - **Volatility**: Bollinger Bands, ATR
   - **Volume**: Volume, OBV

3. **Phân tích AI**: Gửi dữ liệu và chỉ báo tới Google Gemini AI để phân tích

4. **Parse kết quả**: AI trả về JSON với các thông tin:
   - `action`: "long", "short", hoặc "none"
   - `entry`: Giá vào lệnh
   - `takeProfit`: Mức chốt lời
   - `stopLoss`: Mức cắt lỗ
   - `reason`: Lý do chi tiết
   - `confidence`: Độ tin cậy (high/medium/low)
   - `nextCheckMinutes`: Số phút nên đợi trước khi phân tích lại (15-1440 phút)

5. **Vào lệnh**: Nếu có tín hiệu (action không phải "none"), bot sẽ tự động:
   - Tính lot size dựa trên capital và leverage
   - Đặt lệnh market với TP/SL preset
   - Lưu thông tin position

6. **Tự động điều chỉnh thời gian**: Bot sử dụng `nextCheckMinutes` do AI đề xuất để xác định thời gian chạy tiếp theo, dựa trên:
   - Biến động thị trường (ATR)
   - Độ tin cậy tín hiệu
   - Xu hướng thị trường
   - Tín hiệu sắp xuất hiện

## Lưu ý

- Bot chỉ mở 1 position tại một thời điểm
- Nếu đang có position, bot sẽ bỏ qua phân tích mới
- **AI tự điều chỉnh thời gian chạy**: Thời gian chờ giữa các lần phân tích do AI ước tính (15 phút - 24 giờ) dựa trên điều kiện thị trường
- API key của Gemini được đọc từ file `.env` (biến môi trường `GOOGLE_API_KEY`)
- Nếu không tìm thấy API key trong `.env`, code sẽ báo lỗi và dừng

## Thời gian chạy do AI đề xuất

Bot sử dụng AI để tự động điều chỉnh thời gian chờ giữa các lần phân tích:

- **15-30 phút**: Thị trường biến động mạnh + tín hiệu sắp xuất hiện
- **60-120 phút**: Tín hiệu rõ ràng + độ tin cậy cao
- **180-360 phút**: Thị trường đi ngang + không có tín hiệu rõ ràng
- **480-720 phút**: Xu hướng ổn định + độ tin cậy cao

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


