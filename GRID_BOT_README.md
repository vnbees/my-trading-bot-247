# Grid Trading Bot - Hướng dẫn sử dụng

## Tổng quan

Grid Trading Bot với các tính năng:
- **ADX Filter**: Chỉ mở lưới khi ADX < 20 (tính trên H1)
- **Grid Trading**: 0.6% step, 0.5% TP mỗi lệnh
- **DCA**: Lot tăng theo factor 1.15
- **TSL**: Dừng bot khi drawdown >= 30%

## Cài đặt

```bash
# Đảm bảo đã cài đặt dependencies
npm install axios technicalindicators yargs ws
```

## Sử dụng

### Lệnh cơ bản

```bash
node startGrid.js \
  --key=YOUR_API_KEY \
  --secret=YOUR_SECRET \
  --passphrase=YOUR_PASSPHRASE \
  --symbol=XRPUSDT_UMCBL \
  --capital=100 \
  --leverage=10
```

### Tất cả tham số

```bash
node startGrid.js \
  --key=YOUR_API_KEY \
  --secret=YOUR_SECRET \
  --passphrase=YOUR_PASSPHRASE \
  --symbol=XRPUSDT_UMCBL \
  --margin=USDT \
  --capital=100 \
  --leverage=10 \
  --adxTimeFrame=1h \
  --adxPeriod=14 \
  --adxThreshold=20 \
  --gridStep=0.6 \
  --tp=0.5 \
  --maxOrders=10 \
  --initialLot=0.01 \
  --lotFactor=1.15 \
  --maxDrawdown=30 \
  --poll=60
```

## Tham số chi tiết

### Bắt buộc
- `--key`: Bitget API key
- `--secret`: Bitget API secret
- `--passphrase`: Bitget API passphrase (nếu có)

### Cấu hình cơ bản
- `--symbol`: Symbol contract (ví dụ: XRPUSDT_UMCBL)
- `--margin`: Margin coin (mặc định: USDT)
- `--capital`: Vốn ban đầu (USDT)
- `--leverage`: Đòn bẩy (BẮT BUỘC: 10x)

### ADX Filter
- `--adxTimeFrame`: Khung thời gian ADX (mặc định: 1h)
- `--adxPeriod`: Chu kỳ ADX (mặc định: 14)
- `--adxThreshold`: Ngưỡng ADX tối đa (mặc định: 20)
  - Grid ON khi ADX < threshold
  - Grid OFF khi ADX >= threshold

### Grid Parameters
- `--gridStep`: Khoảng cách lưới % (mặc định: 0.6%)
- `--tp`: Take profit % mỗi lệnh (mặc định: 0.5%)
- `--maxOrders`: Số lệnh tối đa mỗi chiều (mặc định: 10)

### DCA (Dollar Cost Averaging)
- `--initialLot`: Lot đầu tiên (mặc định: 0.01)
- `--lotFactor`: Hệ số tăng lot (mặc định: 1.15)
  - Lot thứ n = initialLot × (lotFactor ^ n)

### Risk Management
- `--maxDrawdown`: Max drawdown % (mặc định: 30%)
  - Khi drawdown >= maxDrawdown, bot sẽ đóng tất cả lệnh và dừng

### Technical
- `--tick`: Price tick size (0 = auto detect)
- `--sizeStep`: Quantity step size (0 = auto detect)
- `--poll`: Poll interval (giây, mặc định: 60 = 1 phút)

## Logic hoạt động

### 1. ADX Filter
- Bot check ADX mỗi 1 giờ từ Binance API (H1)
- Nếu ADX < 20: Grid ON → Bot có thể mở lệnh mới
- Nếu ADX >= 20: Grid OFF → Bot chỉ quản lý lệnh hiện có

### 2. Grid Trading
- Bot đặt lệnh Buy và Sell xung quanh giá hiện tại
- Khoảng cách: 0.6% giữa các lệnh
- Mỗi lệnh có TP: 0.5%
- Tối đa 10 lệnh mỗi chiều

### 3. DCA
- Lot tăng dần: 0.01, 0.0115, 0.0132, ...
- Formula: `lot = initialLot × (1.15 ^ orderIndex)`

### 4. Risk Management (TSL)
- Bot theo dõi equity liên tục
- Tính drawdown: `(highestEquity - currentEquity) / initialEquity × 100`
- Khi drawdown >= 30%: Đóng tất cả lệnh và dừng bot

## Ví dụ output

```
[GRID] 🚀 Khởi động Grid Trading Bot
[GRID] Symbol: XRPUSDT_UMCBL
[GRID] Leverage: 10x
[GRID] Grid Step: 0.6%
[GRID] Take Profit: 0.5%
[GRID] Max Grid Orders: 10 mỗi chiều
[GRID] ADX Filter: < 20 (1h)
[GRID] Max Drawdown: 30%

[GRID] 🔍 Đang kiểm tra ADX (1h)...
[GRID] 📊 ADX hiện tại: 18.45 (ngưỡng: 20)
[GRID] ✅ ADX < 20 → KÍCH HOẠT LƯỚI (Grid ON)

[GRID] 🚀 Khởi tạo grid trading...
[GRID] 💰 Giá hiện tại: 1.9544
[GRID] 📝 Đặt lệnh BUY: Giá=1.9427, Size=0.01, TP=1.9524
[GRID] 📝 Đặt lệnh SELL: Giá=1.9661, Size=0.01, TP=1.9582
...

[GRID] ✅ Position Long chạm TP (Entry: 1.9427, TP: 1.9524, Current: 1.9530)
[GRID] 📝 Đặt lệnh BUY mới: Giá=1.9427, Size=0.01, TP=1.9524

[GRID] 📊 Equity: 98.50 | Drawdown: 1.50% | TSL: 30%
```

## Lưu ý quan trọng

1. **Đòn bẩy 10x**: Rủi ro cao, cần quản lý vốn cẩn thận
2. **TSL 30%**: Bot sẽ tự động dừng khi drawdown >= 30%
3. **ADX Filter**: Chỉ trade khi thị trường đi ngang (ADX < 20)
4. **Grid Step 0.6%**: Khoảng cách cố định giữa các lệnh
5. **TP 0.5%**: Mỗi lệnh chốt lời 0.5% (thấp hơn grid step để đảm bảo profit)

## Troubleshooting

### Bot không mở lệnh
- Kiểm tra ADX: Nếu ADX >= 20, grid sẽ OFF
- Kiểm tra số dư: Đảm bảo có đủ vốn
- Kiểm tra API key: Đảm bảo có quyền trading

### Lỗi khi đặt lệnh
- Kiểm tra tick size và size step
- Kiểm tra số dư khả dụng
- Kiểm tra leverage setting

### TSL triggered
- Bot sẽ tự động đóng tất cả lệnh
- Kiểm tra log để xem drawdown
- Điều chỉnh `--maxDrawdown` nếu cần

## Tài liệu tham khảo

- Bitget API: https://bitgetlimited.github.io/apidoc/en/mix/
- ADX Indicator: https://www.investopedia.com/terms/a/adx.asp
- Grid Trading: https://www.investopedia.com/terms/g/grid-trading.asp

