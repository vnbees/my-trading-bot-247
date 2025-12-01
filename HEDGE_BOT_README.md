# Hedge Trading Bot

Bot tự động hedge trading với Gemini AI phân tích xu hướng thị trường.

## 🎯 Chiến lược

### 1. Khi xu hướng KHÔNG RÕ RÀNG (unclear):
- **Luôn có 2 lệnh Long và Short** chạy song parallel (hedge)
- **Đóng lệnh khi lãi 5%** (với leverage 10x) và mở lại 2 lệnh mới
- Bảo toàn vốn và kiếm lợi nhuận từ biến động
- Take profit nhanh, không chờ trend

### 2. Khi xu hướng RÕ RÀNG (uptrend/downtrend):
- **Giữ lệnh cùng xu hướng** để tối đa hóa lợi nhuận:
  - KHÔNG đóng dù lãi 5%, 10%, 15%...
  - Follow trend đến khi xu hướng đảo chiều hoặc unclear
  - Trailing để maximize profit
- **Đóng lệnh ngược xu hướng** khi lỗ quá 5%:
  - Cut loss nhanh để bảo vệ vốn
  - Tránh lỗ lớn trong trend mạnh

### 3. Vai trò của Gemini AI:
- **Phân tích xu hướng thị trường** (uptrend, downtrend, unclear)
- **Cung cấp lý do chi tiết** về xu hướng
- **KHÔNG quyết định vào lệnh** (bot tự động quản lý hedge)

## 📊 Dữ liệu phân tích

Bot sử dụng đầy đủ dữ liệu giống `PriceActionBot`:

### Đa khung thời gian từ Binance:
- **5m**: 288 candles (24 giờ)
- **15m**: 288 candles (3 ngày)
- **1h**: 168 candles (1 tuần)
- **4h**: 90 candles (15 ngày)
- **1d**: 60 candles (2 tháng)

### Price Action Analysis:
- **Candlestick Patterns**: Hammer, Shooting Star, Engulfing, Doji, Pin Bar
- **Market Structure**: Higher Highs/Lows, Lower Highs/Lows, Consolidation
- **Swing Points**: Swing Highs/Lows
- **Support/Resistance**: Các vùng giá quan trọng được test nhiều lần

### Technical Indicators (hỗ trợ):
- **Trend**: EMA 20, 50, 200
- **Momentum**: RSI
- **Volatility**: ATR, Bollinger Bands
- **Volume**: OBV

## 🚀 Cách sử dụng

### 1. Cài đặt dependencies:
```bash
npm install
```

### 2. Cấu hình file `.env`:
```env
# Bitget API
BITGET_API_KEY=your_api_key
BITGET_API_SECRET=your_api_secret
BITGET_PASSPHRASE=your_passphrase

# Google Gemini API
GOOGLE_API_KEY=your_gemini_api_key

# Hedge Bot Config
HEDGE_BOT_SYMBOL=BTCUSDT_UMCBL
HEDGE_BOT_MARGIN_COIN=USDT
HEDGE_BOT_CAPITAL=100          # 0 = dùng toàn bộ equity (chia đôi)
HEDGE_BOT_LEVERAGE=10
HEDGE_BOT_INTERVAL=5           # Check mỗi 5 phút
```

### 3. Chạy trực tiếp:
```bash
node startHedgeBot.js \
  --key=YOUR_API_KEY \
  --secret=YOUR_API_SECRET \
  --passphrase=YOUR_PASSPHRASE \
  --symbol=BTCUSDT_UMCBL \
  --capital=100 \
  --leverage=10 \
  --interval=5
```

### 4. Chạy với PM2 (khuyến nghị):
```bash
chmod +x start-hedge-pm2.sh
./start-hedge-pm2.sh
```

Xem logs:
```bash
pm2 logs hedge-bot-BTCUSDT_UMCBL
```

## ⚙️ Tham số

| Tham số | Mô tả | Mặc định |
|---------|-------|----------|
| `--symbol` | Cặp giao dịch | BTCUSDT_UMCBL |
| `--margin` | Margin coin | USDT |
| `--capital` | Vốn (0 = auto, chia đôi cho 2 lệnh) | 0 |
| `--leverage` | Đòn bẩy | 10 |
| `--interval` | Thời gian check (phút) | 5 |
| `--tick` | Price tick size (0 = auto) | 0 |
| `--sizeStep` | Quantity step (0 = auto) | 0 |

## 📈 Ví dụ hoạt động

### Trường hợp 1: Xu hướng không rõ (Consolidation)
```
Cycle 1:
  - Gemini AI: "unclear" (sideways)
  - Bot mở: LONG @ 50,000 + SHORT @ 50,000
  
Cycle 2 (giá 52,500):
  - AI: "unclear"
  - LONG: +5% → ✅ Đóng LONG (take profit trong hedge mode)
  - Bot mở lại: LONG @ 52,500 + SHORT @ 52,500
```

### Trường hợp 2: Xu hướng tăng rõ ràng (MAXIMIZE PROFIT)
```
Cycle 1:
  - Bot có: LONG @ 50,000 + SHORT @ 50,000
  
Cycle 2 (giá 52,500):
  - AI: "uptrend" ✅ (breakout resistance)
  - LONG: +5% → ✅ GIỮ NGUYÊN (follow trend, không đóng!)
  - SHORT: -5% → ❌ Đóng SHORT (cut loss)
  - Bot chỉ giữ LONG
  
Cycle 3 (giá 55,000):
  - AI: "uptrend" (tiếp tục mạnh)
  - LONG: +10% → ✅ TIẾP TỤC GIỮ (maximize profit!)
  
Cycle 4 (giá 57,500):
  - AI: "uptrend" (vẫn còn mạnh)
  - LONG: +15% → ✅ TIẾP TỤC GIỮ
  
Cycle 5 (giá 58,000):
  - AI: "unclear" ⚠️ (trend yếu đi, consolidation)
  - LONG: +16% → ✅ Bây giờ mới đóng!
  - Bot mở lại hedge: LONG @ 58,000 + SHORT @ 58,000
  
💰 Kết quả: Lãi 16% thay vì chỉ 5% nếu đóng sớm!
```

### Trường hợp 3: Xu hướng đảo chiều
```
Cycle 1:
  - Bot có: LONG @ 50,000 (đang hold từ uptrend)
  - LONG: +10%
  
Cycle 2 (giá 52,000):
  - AI: "downtrend" ❌ (đảo chiều, breakdown support)
  - LONG: +4% nhưng ngược trend → ❌ Đóng ngay (cut để tránh lỗ lớn)
  - Bot mở SHORT @ 52,000
  
Cycle 3 (giá 49,000):
  - AI: "downtrend" (tiếp tục giảm)
  - SHORT: +5.77% → ✅ GIỮ (follow downtrend)
```

## 🎓 Ưu điểm

### 1. Quản lý rủi ro tốt:
- Hedge 2 chiều khi thị trường không rõ
- Cắt lỗ nhanh khi xu hướng đảo chiều
- Lợi nhuận ổn định từ biến động

### 2. Tận dụng xu hướng:
- Follow trend khi thị trường có xu hướng rõ
- Tối đa hóa lợi nhuận trong trending market

### 3. AI phân tích chính xác:
- Gemini AI phân tích đa khung thời gian
- Price Action + Indicators kết hợp
- Đưa ra lý do rõ ràng cho mỗi quyết định

## ⚠️ Lưu ý

1. **Capital Management**:
   - Nếu set capital = 100 USDT → mỗi lệnh hedge sẽ dùng 50 USDT
   - Nếu capital = 0 → dùng toàn bộ equity / 2

2. **Leverage**:
   - Mặc định 10x
   - Lãi 5% = 50% ROI (với leverage 10x)
   - Rủi ro cao hơn, cần quản lý cẩn thận

3. **Check Interval**:
   - Mặc định 5 phút (check positions thường xuyên)
   - Có thể tăng lên 10-15 phút nếu muốn ít tích cực hơn

4. **API Rate Limit**:
   - Bot gọi API thường xuyên (check positions, analysis)
   - Đảm bảo API key có đủ rate limit

## 🔧 Troubleshooting

### Bot không mở lệnh:
- Kiểm tra balance/equity đủ không
- Kiểm tra API key có quyền trade không
- Xem logs để biết lỗi cụ thể

### Bot đóng lệnh liên tục:
- Kiểm tra threshold (5% có quá thấp không?)
- Xem phân tích xu hướng của AI có chính xác không

### AI luôn trả về "unclear":
- Thị trường đang sideways/consolidation
- AI ưu tiên an toàn, chỉ xác định trend khi RÕ RÀNG

## 📝 Changelog

### v1.0.0 (Initial Release)
- Hedge trading tự động
- Gemini AI phân tích xu hướng
- Đa khung thời gian từ Binance
- Price Action + Indicators
- PM2 support

## 📞 Support

Nếu gặp vấn đề, hãy kiểm tra:
1. Logs của PM2: `pm2 logs hedge-bot-BTCUSDT_UMCBL`
2. API key và secret có đúng không
3. Balance có đủ không
4. Google API key có hoạt động không

---

**Happy Trading! 🚀**

