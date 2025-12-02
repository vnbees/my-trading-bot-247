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
- **Đánh giá rủi ro tài chính** dựa trên thông tin tài khoản
- **Đưa ra suggestions** về quản lý vốn và positions
- **KHÔNG tự động thực hiện lệnh** (chỉ suggest, bot theo logic định sẵn)

## 🤖 AI-Powered Risk Management

### Thông tin gửi cho AI:

Bot tự động gửi **thông tin tài chính real-time** cho Gemini AI mỗi chu kỳ phân tích:

#### 💰 Account Status:
- **Total Equity**: Tổng vốn hiện tại (USDT)
- **Available Balance**: Số dư khả dụng
- **Total Margin Used**: Tổng margin đã sử dụng
- **Free Margin**: Margin còn trống
- **Margin Level**: Tỷ lệ margin (%)
- **Unrealized PnL**: Lãi/lỗ chưa thực hiện
- **Leverage**: Đòn bẩy đang dùng
- **Config Capital**: Capital cấu hình (nếu có)

#### 📍 Position Details:
Cho mỗi position (Long/Short):
- **Entry Price**: Giá vào lệnh
- **Current Price**: Giá hiện tại
- **Size**: Số lượng contracts
- **Notional Value**: Giá trị danh nghĩa
- **Margin Used**: Margin sử dụng
- **Price Change %**: % thay đổi giá
- **ROI %**: Return on Investment (đã tính leverage)
- **Unrealized PnL**: Lãi/lỗ chưa thực hiện (USDT)

#### 📜 Analysis History (Lịch sử nhận định):
Bot tự động lưu trữ **5 nhận định gần nhất** và gửi cho AI:
- **Timestamp**: Thời gian phân tích
- **Trend**: Xu hướng đã nhận định (uptrend/downtrend/unclear)
- **Confidence**: Độ tin cậy (high/medium/low)
- **Reason**: Lý do phân tích
- **Risk Assessment**: Đánh giá rủi ro trước đó
- **Suggestions**: Các suggestions đã đưa ra

**Lợi ích:**
- ✅ AI biết **context** và **tiến triển** của thị trường
- ✅ Phát hiện **trend reversal** sớm hơn
- ✅ Theo dõi **risk progression** (low → medium → high)
- ✅ Tránh **suggestions lặp lại** không cần thiết
- ✅ **Context-aware decisions** dựa trên lịch sử

### AI Analysis Output:

Gemini AI trả về phân tích toàn diện:

```json
{
  "trend": "uptrend/downtrend/unclear",
  "reason": "Giải thích chi tiết...",
  "confidence": "high/medium/low",
  "risk_assessment": {
    "margin_health": "healthy/warning/critical",
    "position_balance": "balanced/unbalanced",
    "overall_risk": "low/medium/high"
  },
  "suggestions": [
    {
      "action": "close_long" | "close_short" | "partial_close_long" | "partial_close_short" | "add_to_long" | "add_to_short" | "rebalance_long" | "rebalance_short" | "reduce_margin" | "increase_caution" | "hold",
      "reason": "Lý do cụ thể",
      "priority": "low" | "medium" | "high" | "critical",
      "capital": <số USDT> (cho add_to_long/add_to_short, tối thiểu 1 USDT),
      "percentage": <phần trăm> (cho partial_close, ví dụ: 50 = đóng 50%),
      "target_size": <target USDT> (cho rebalance, tối thiểu 1 USDT)
    }
  ]
}
```

### Lợi ích:

✅ **Giám sát risk real-time**: AI biết chính xác tình trạng tài chính  
✅ **Suggestions thông minh**: Dựa trên cả technical và financial data  
✅ **Early warning**: Phát hiện rủi ro trước khi liquidation  
✅ **Context-aware decisions**: AI hiểu full picture, không chỉ chart  

### Ví dụ AI Suggestions:

#### Basic Actions:
```
💡 AI Suggestions:
   - close_short: Xu hướng tăng rõ ràng, SHORT đang lỗ -8% ROI, nên đóng ngay
     ⚠️ PRIORITY: CRITICAL - Cân nhắc xử lý ngay!
   
   - reduce_margin: Margin level chỉ 145%, rủi ro liquidation cao
     ⚠️ PRIORITY: HIGH
   
   - hold: LONG position lãi +12%, xu hướng còn tăng, tiếp tục giữ
     PRIORITY: LOW
```

#### Advanced Position Management (MỚI):
```
💡 AI Suggestions:
   - add_to_long: Trend mạnh, LONG đang lãi +8% ROI, free margin 1.5 USDT
     Capital: 0.5 USDT
     ⚠️ PRIORITY: MEDIUM
   
   - partial_close_long: LONG lãi +15% ROI, trend chậm lại, take 50% profit
     Percentage: 50
     ⚠️ PRIORITY: HIGH
   
   - rebalance_short: LONG 1.5 USDT, SHORT 0.5 USDT → Unbalanced
     Target size: 1.0 USDT
     ⚠️ PRIORITY: MEDIUM
```

### 🤖 AI-Powered Position Optimization

Bot giờ đây có thể **tự động tối ưu vị thế** dựa trên AI suggestions:

#### ✅ Tính năng mới:

1. **Add to Position (Pyramiding/Scaling In)**
   - AI có thể suggest thêm vào position khi trend mạnh
   - Tự động tính **average entry price**
   - Yêu cầu: Capital thêm >= 1 USDT, position hiện tại >= 1 USDT

2. **Partial Close (Take Partial Profit)**
   - AI có thể suggest đóng một phần để lock profit
   - Giữ lại phần còn lại để ride trend
   - Yêu cầu: Position sau khi đóng vẫn >= 1 USDT

3. **Rebalance Positions**
   - AI có thể suggest điều chỉnh size để cân bằng LONG/SHORT
   - Tự động add hoặc partial close để đạt target
   - Yêu cầu: Target size >= 1 USDT

#### 📋 Rules & Constraints:

- ✅ **Mỗi lệnh tối thiểu 1 USDT** (enforced trong code)
- ✅ **Free margin check** trước khi add
- ✅ **Average entry price** tự động tính khi add
- ✅ **Validation** đầy đủ để tránh errors

#### 🎯 Use Cases:

**Scenario 1: Pyramiding khi trend mạnh**
```
AI Analysis:
  - Trend: UPTREND, confidence: HIGH
  - LONG: +8% ROI, margin: 1.0 USDT
  - Free margin: 1.5 USDT
  
AI Suggestion:
  {
    "action": "add_to_long",
    "capital": 0.5,
    "reason": "Trend mạnh, nên scale in để maximize profit"
  }
  
Bot Action:
  ✅ Thêm 0.5 USDT vào LONG
  ✅ Tính average entry price
  ✅ Total LONG: 1.5 USDT
```

**Scenario 2: Take Partial Profit**
```
AI Analysis:
  - LONG: +15% ROI, margin: 1.0 USDT
  - Trend: UPTREND nhưng chậm lại
  
AI Suggestion:
  {
    "action": "partial_close_long",
    "percentage": 50,
    "reason": "Lock 50% profit, giữ 50% để ride trend"
  }
  
Bot Action:
  ✅ Đóng 50% LONG (0.5 USDT)
  ✅ Còn lại 0.5 USDT (vẫn >= 1 USDT? → Cần check!)
  ⚠️ Nếu < 1 USDT → Bot sẽ reject và suggest đóng ít hơn
```

**Scenario 3: Rebalance khi Unbalanced**
```
AI Analysis:
  - LONG: 1.5 USDT margin
  - SHORT: 0.5 USDT margin
  - Unbalanced → Risk cao
  
AI Suggestion:
  {
    "action": "rebalance_long",
    "target_size": 1.0,
    "reason": "Cân bằng LONG/SHORT để giảm risk"
  }
  
Bot Action:
  ✅ Partial close LONG 33% (1.5 → 1.0 USDT)
  ✅ LONG = SHORT = 1.0 USDT → Balanced!
```

**Lưu ý**: Bot **TỰ ĐỘNG EXECUTE** các suggestions này (không chỉ log). Nếu muốn chỉ log, có thể comment phần execute trong `handleAISuggestions()`.

### Ví dụ AI sử dụng Previous Analyses:

#### Scenario 1: Phát hiện Trend Reversal

```
Lịch sử:
  5 phút trước: trend="uptrend", confidence="high"
  10 phút trước: trend="uptrend", confidence="medium"
  15 phút trước: trend="unclear", confidence="low"

Hiện tại:
  - Technical signals: Bearish patterns, breakdown support
  - Previous trend: uptrend (2 lần liên tiếp)
  
AI Analysis:
  "Trend đã thay đổi từ uptrend → downtrend. 
   Đây là reversal quan trọng vì 2 nhận định trước đều là uptrend.
   Cần đóng LONG ngay và mở SHORT."
```

#### Scenario 2: Risk Progression

```
Lịch sử:
  5 phút trước: risk="low", margin_level=250%
  10 phút trước: risk="medium", margin_level=180%
  15 phút trước: risk="low", margin_level=220%

Hiện tại:
  - Margin level: 145%
  - Risk: high
  
AI Analysis:
  "Risk đã tăng từ low → medium → high trong 15 phút.
   Margin level giảm nhanh (250% → 145%).
   Đây là tín hiệu CRITICAL, cần giảm exposure ngay!"
```

#### Scenario 3: Confidence Building

```
Lịch sử:
  5 phút trước: trend="unclear", confidence="low"
  10 phút trước: trend="unclear", confidence="low"
  15 phút trước: trend="unclear", confidence="low"

Hiện tại:
  - Technical: Bullish breakout, strong momentum
  - Previous: 3 lần unclear liên tiếp
  
AI Analysis:
  "Sau 3 lần unclear, market đã breakout rõ ràng.
   Đây là tín hiệu mạnh vì đã consolidate lâu.
   Confidence: HIGH, trend: UPTREND"
```

#### Scenario 4: Suggestion Follow-up

```
Lịch sử:
  5 phút trước: suggestion="close_short", priority="high"
  10 phút trước: suggestion="close_short", priority="medium"
  
Hiện tại:
  - SHORT vẫn còn mở
  - SHORT lỗ -10% ROI
  
AI Analysis:
  "Suggestion 'close_short' đã được đưa ra 2 lần nhưng chưa thực hiện.
   SHORT lỗ tăng từ -5% → -10%.
   Priority nâng lên CRITICAL, cần action ngay!"
```

---

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

