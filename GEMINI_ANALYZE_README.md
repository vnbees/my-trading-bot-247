# Gemini Analyze - Phân tích giá Binance bằng AI

Script Node.js để lấy dữ liệu giá từ Binance (khung 5 phút, 1 ngày gần nhất) và gửi tới Gemini AI để phân tích, nhận định tín hiệu giao dịch.

## Cài đặt

Dependencies đã có sẵn trong `package.json`. Nếu chưa cài, chạy:

```bash
npm install
```

## Sử dụng

### Chạy với symbol mặc định (BTCUSDT):

```bash
node gemini-analyze.js
```

### Chạy với symbol khác:

```bash
node gemini-analyze.js --symbol ETHUSDT
```

hoặc

```bash
node gemini-analyze.js -s XRPUSDT
```

### Xem help:

```bash
node gemini-analyze.js --help
```

## Chức năng

1. **Lấy dữ liệu từ Binance**: Lấy 288 candles (1 ngày) khung 5 phút
2. **Format dữ liệu**: Chuẩn bị dữ liệu OHLCV để gửi tới AI
3. **Phân tích bằng Gemini AI**: Gửi dữ liệu tới Gemini và nhận phân tích chi tiết
4. **Hiển thị kết quả**: In ra console các thông tin:
   - Xu hướng thị trường (Trend)
   - Tín hiệu giao dịch (Long/Short)
   - Entry price
   - Take Profit (TP)
   - Stop Loss (SL)
   - Risk/Reward Ratio
   - Phân tích kỹ thuật
   - Mức độ tin cậy

## API Key

Google API Key đã được hardcode trong file. Nếu cần thay đổi, sửa biến `GOOGLE_API_KEY` trong file `gemini-analyze.js`.

## Output

Script sẽ in ra:
- Thông tin tổng quan về giá
- Phân tích chi tiết từ Gemini AI
- Các khuyến nghị giao dịch


