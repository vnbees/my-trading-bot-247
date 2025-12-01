# Price Action Trading Bot với Gemini AI

Bot tự động phân tích và giao dịch dựa trên **Price Action thuần túy** với sự hỗ trợ của Gemini AI.

## 🎯 Đặc điểm chính

### Phương pháp giao dịch
Bot này tập trung vào **Price Action** - phương pháp giao dịch dựa trên hành động giá thực tế, không phụ thuộc vào chỉ báo:

1. **Candlestick Patterns (Mô hình nến)**
   - Hammer & Shooting Star (đảo chiều)
   - Bullish/Bearish Engulfing (nuốt chửng)
   - Pin Bar (rejection)
   - Doji (phân vân thị trường)
   - Inside Bar & Outside Bar

2. **Chart Patterns (Mô hình biểu đồ)**
   - Head & Shoulders / Inverse H&S
   - Double Top / Double Bottom
   - Triple Top / Triple Bottom
   - Triangles (Ascending, Descending, Symmetrical)
   - Wedges (Rising, Falling)
   - Flags & Pennants
   - Cup & Handle

3. **Market Structure (Cấu trúc thị trường)**
   - Higher Highs & Higher Lows (Uptrend)
   - Lower Highs & Lower Lows (Downtrend)
   - Break of Structure (BOS)
   - Change of Character (ChoCh)
   - Swing High/Low analysis

4. **Support/Resistance & Key Levels**
   - Horizontal Support/Resistance
   - Supply & Demand zones
   - Retest sau breakout
   - Liquidity levels

5. **Confluences (Điểm hội tụ)**
   - Nhiều yếu tố Price Action hội tụ tại 1 điểm
   - Tăng xác suất thành công của setup

### Chỉ báo kỹ thuật (Chỉ để hỗ trợ)
Bot vẫn tính toán các chỉ báo kỹ thuật, nhưng CHỈ dùng để **xác nhận** setup Price Action:
- EMA (20, 50, 200) - Xác định trend tổng quan
- RSI - Xác nhận overbought/oversold
- ATR - Tính toán Stop Loss hợp lý
- Bollinger Bands - Xác định biến động
- OBV - Xác nhận volume

**⚠️ Lưu ý:** Chỉ báo KHÔNG PHẢI tín hiệu chính. Tín hiệu chính là Price Action!

## 🚀 Cách sử dụng

### 1. Cài đặt dependencies
```bash
npm install
```

### 2. Thiết lập môi trường

Tạo file `.env` hoặc export biến môi trường:
```bash
GOOGLE_API_KEY=your_gemini_api_key

# Optional - Cấu hình mặc định cho bot
PRICE_ACTION_BOT_SYMBOL=BTCUSDT_UMCBL
PRICE_ACTION_BOT_MARGIN_COIN=USDT
PRICE_ACTION_BOT_CAPITAL=100
PRICE_ACTION_BOT_LEVERAGE=10
PRICE_ACTION_BOT_PRICE_TICK=0
PRICE_ACTION_BOT_SIZE_STEP=0
```

### 3. Chạy bot

#### Cách 1: Với command line arguments
```bash
node startPriceActionBot.js \
  --key=YOUR_BITGET_API_KEY \
  --secret=YOUR_BITGET_SECRET \
  --passphrase=YOUR_PASSPHRASE \
  --symbol=BTCUSDT_UMCBL \
  --capital=100 \
  --leverage=10
```

#### Cách 2: Với file .env
```bash
node startPriceActionBot.js \
  --key=YOUR_BITGET_API_KEY \
  --secret=YOUR_BITGET_SECRET \
  --passphrase=YOUR_PASSPHRASE
```

### 4. Tham số

| Tham số | Mô tả | Mặc định |
|---------|-------|----------|
| `--key` | Bitget API Key | Bắt buộc |
| `--secret` | Bitget API Secret | Bắt buộc |
| `--passphrase` | Bitget API Passphrase | Từ .env |
| `--symbol` | Cặp giao dịch | BTCUSDT_UMCBL |
| `--margin` | Margin coin | USDT |
| `--capital` | Vốn vào lệnh (0 = dùng toàn bộ equity) | 0 |
| `--leverage` | Đòn bẩy | 10 |
| `--tick` | Price tick size (0 = auto) | 0 |
| `--sizeStep` | Quantity step size (0 = auto) | 0 |

## 📊 Cách hoạt động

### Quy trình phân tích

1. **Thu thập dữ liệu đa khung thời gian**
   - 5m: 288 candles (1 ngày)
   - 15m: 288 candles (3 ngày)
   - 1h: 168 candles (1 tuần)
   - 4h: 90 candles (15 ngày)
   - 1d: 60 candles (60 ngày)

2. **Phân tích Price Action**
   - Phát hiện mô hình nến trên các khung thời gian
   - Xác định Swing High/Low
   - Tìm Support/Resistance levels
   - Phân tích Market Structure (trend, BOS, ChoCh)

3. **Tính toán chỉ báo kỹ thuật (hỗ trợ)**
   - EMA, RSI, ATR, Bollinger Bands, OBV

4. **Gemini AI phân tích**
   - AI được huấn luyện để phân tích như một Price Action trader chuyên nghiệp
   - Tìm kiếm setup có xác suất cao
   - Đánh giá confluences (điểm hội tụ)
   - Tính toán Risk:Reward (tối thiểu 1:2)

5. **Quyết định giao dịch**
   - Action: long/short/none
   - Entry: Dựa trên Price Action setup
   - Stop Loss: Dựa trên swing points, ATR, hoặc structure
   - Take Profit: Dựa trên support/resistance, Fibonacci, hoặc measured move
   - Chỉ vào lệnh khi có setup chất lượng cao

6. **Quản lý position**
   - TP/SL được đặt ngay khi vào lệnh
   - Bot sẽ monitor position mỗi 30 phút
   - Position tự động đóng khi đạt TP/SL (do exchange xử lý)

### Các loại setup

Bot có thể giao dịch các loại setup sau:

1. **Reversal (Đảo chiều)**
   - Candlestick reversal patterns tại support/resistance
   - Chart patterns đảo chiều (H&S, Double Top/Bottom)
   - Break of Structure với ChoCh

2. **Breakout (Phá vỡ)**
   - Breakout khỏi chart patterns (Triangle, Flag, Wedge)
   - Breakout support/resistance quan trọng
   - Retest sau breakout

3. **Pullback (Hồi về)**
   - Pullback trong trend mạnh
   - Retest support/resistance đã vỡ
   - Entry tại swing low/high trong trend

4. **Range (Sideway)**
   - Buy support, Sell resistance trong range
   - Mean reversion
   - Anticipating breakout

## 🎓 Nguyên tắc Price Action

Bot tuân thủ các nguyên tắc Price Action chuyên nghiệp:

### 1. Confluences (Điểm hội tụ)
Setup càng có nhiều yếu tố hội tụ, xác suất thành công càng cao:
- Candlestick pattern + Support/Resistance
- Chart pattern + Volume confirmation
- Multiple timeframe alignment
- Fibonacci + Key levels
- Trend structure + Swing points

### 2. Risk Management
- **Risk:Reward tối thiểu 1:2** (tốt nhất >= 1:3)
- Stop Loss hợp lý: dựa trên ATR, swing points, hoặc structure
- Take Profit có logic: support/resistance, Fibonacci, measured move
- Position sizing dựa trên capital và leverage

### 3. Quality over Quantity
- **Ưu tiên chất lượng hơn số lượng**
- Chỉ vào lệnh khi setup thực sự tốt
- Không ép buộc tìm tín hiệu
- `action = "none"` khi không có setup chất lượng cao

### 4. Multiple Timeframe Analysis
- Trend tổng quan: 1d, 4h
- Entry timing: 1h, 15m, 5m
- Tất cả khung thời gian phải align

## 📈 Ví dụ về setup Price Action

### Setup 1: Bullish Engulfing tại Support
```
Khung 1d: Uptrend (HH, HL)
Khung 4h: Pullback về support
Khung 1h: Bullish Engulfing + RSI oversold
Khung 15m: Break of structure (BOS) lên

Action: LONG
Entry: Tại giá đóng của Bullish Engulfing
SL: Dưới swing low
TP: Resistance tiếp theo
R:R: 1:3
```

### Setup 2: Double Top Breakout
```
Khung 4h: Double Top đang hình thành
Khung 1h: Neckline breakdown + volume tăng
Khung 15m: Retest neckline + rejection

Action: SHORT
Entry: Sau retest failed
SL: Trên neckline
TP: Measured move từ Double Top
R:R: 1:2.5
```

### Setup 3: Flag Pattern trong Uptrend
```
Khung 1d: Strong uptrend
Khung 4h: Bullish Flag forming
Khung 1h: Flag breakout + volume spike
Khung 15m: Pullback và continuation

Action: LONG
Entry: Tại pullback sau breakout
SL: Dưới flag low
TP: Measured move từ flag pole
R:R: 1:4
```

## ⚙️ Cấu hình nâng cao

### Điều chỉnh thời gian chạy
Bot tự động điều chỉnh thời gian check tiếp theo dựa trên:
- Tình hình thị trường
- Loại setup đang chờ
- Position status

Mặc định: 15-60 phút (nếu đang chờ setup), 60-240 phút (nếu chưa có setup)

### Test với capital nhỏ
Để test bot, bạn có thể sử dụng capital nhỏ:
```bash
node startPriceActionBot.js \
  --key=... --secret=... --passphrase=... \
  --capital=10 \
  --leverage=5
```

## 🔒 Bảo mật

- **KHÔNG BAO GIỜ** chia sẻ API key/secret
- Sử dụng file `.env` và thêm vào `.gitignore`
- Chỉ cấp quyền **Trade** cho API key (không cần Withdraw)
- Sử dụng IP whitelist nếu có thể

## 📝 Logs và Monitoring

Bot sẽ log chi tiết:
- Phân tích Price Action trên tất cả khung thời gian
- Setup được phát hiện
- Lý do vào/không vào lệnh
- Position status
- P&L (nếu có)

## ⚠️ Lưu ý quan trọng

1. **Bot không phải Holy Grail**
   - Không có phương pháp nào thắng 100%
   - Price Action tăng xác suất, nhưng vẫn có risk
   - Luôn quản lý rủi ro

2. **Cần vốn đủ lớn**
   - Capital quá nhỏ có thể không đủ để mở lệnh
   - Leverage cao = risk cao
   - Khuyến nghị: capital >= 100 USDT, leverage <= 10x

3. **Market conditions**
   - Price Action hoạt động tốt trong trending market
   - Cần cẩn thận trong choppy/sideways market
   - Bot sẽ chọn `none` nếu không có setup tốt

4. **AI limitations**
   - AI phân tích dựa trên dữ liệu lịch sử
   - Không thể dự đoán black swan events
   - Luôn monitor bot và có thể can thiệp thủ công

## 🆚 So sánh với Gemini Bot thường

| Feature | Gemini Bot | Price Action Bot |
|---------|------------|------------------|
| Phương pháp chính | Tổng hợp (chỉ báo + PA) | Price Action thuần túy |
| Candlestick analysis | Cơ bản | Chuyên sâu (phát hiện patterns) |
| Chart patterns | Không | Có (H&S, Double Top, Triangle, etc.) |
| Market Structure | Cơ bản | Chi tiết (BOS, ChoCh, Swing analysis) |
| Support/Resistance | Cơ bản | Nâng cao (tested levels, zones) |
| Risk:Reward | Không ràng buộc | Tối thiểu 1:2 |
| Setup quality | Flexible | High quality only |
| Phù hợp | Mọi trader | Price Action traders |

## 📚 Tài liệu tham khảo

Nếu bạn muốn hiểu sâu hơn về Price Action:
- "Price Action Trading" - Al Brooks
- "Naked Forex" - Alex Nekritin
- "Technical Analysis Using Multiple Timeframes" - Brian Shannon

## 🤝 Hỗ trợ

Nếu gặp vấn đề, kiểm tra:
1. API key/secret/passphrase đúng chưa?
2. Capital đủ lớn để mở lệnh chưa?
3. GOOGLE_API_KEY đã cấu hình chưa?
4. Mạng internet ổn định không?

## 📄 License

MIT License - Tự do sử dụng và chỉnh sửa

---

**Happy Price Action Trading! 📊🚀**

