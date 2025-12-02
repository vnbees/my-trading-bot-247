# Ví dụ Dữ liệu AI Nhận Được

Đây là ví dụ về dữ liệu đầy đủ mà Gemini AI nhận được mỗi chu kỳ phân tích (5 phút).

## 📊 Format Data Gửi Cho AI

```
=== PHÂN TÍCH THỊ TRƯỜNG - XRPUSDT ===

Giá hiện tại: 2.0150 USDT
Thời gian: 2024-01-15 10:35:00

============================================================
THÔNG TIN TÀI KHOẢN & POSITIONS
============================================================
💰 Tổng vốn (Equity): 2.15 USDT
💵 Khả dụng (Available): 0.35 USDT
📊 Margin đã dùng: 1.80 USDT
🆓 Margin tự do: 0.35 USDT
📈 Margin Level: 119.44%
💹 Unrealized PnL: +0.15 USDT
🎚️ Leverage: 10x
⚙️ Config capital: 2.00 USDT

📍 VỊ THẾ ĐANG MỞ:

  🟢 LONG Position:
     Entry: 2.0000 USDT
     Current: 2.0150 USDT
     Size: 5.0000 contracts
     Notional: 10.00 USDT
     Margin: 1.00 USDT
     Price Δ: +0.75%
     ROI: +7.50%
     Unrealized PnL: +0.075 USDT

  🔴 SHORT Position:
     Entry: 2.0000 USDT
     Current: 2.0150 USDT
     Size: 5.0000 contracts
     Notional: 10.00 USDT
     Margin: 1.00 USDT
     Price Δ: -0.75%
     ROI: -7.50%
     Unrealized PnL: -0.075 USDT

============================================================
KHUNG 5M
============================================================

🕯️ MÔ HÌNH NẾN:
  - Bullish Engulfing: BULLISH (strong)
  - Hammer: BULLISH (medium)

📊 CẤU TRÚC THỊ TRƯỜNG:
  - Trend: BULLISH
  - Structure: Higher Highs forming

📈 CHỈ BÁO:
  - EMA(20): 2.0020
  - EMA(50): 1.9950
  - RSI: 62.50

============================================================
KHUNG 15M
============================================================

🕯️ MÔ HÌNH NẾN:
  - Morning Star: BULLISH (strong)

📊 CẤU TRÚC THỊ TRƯỜNG:
  - Trend: BULLISH
  - Structure: Breakout resistance

📈 CHỈ BÁO:
  - EMA(20): 2.0000
  - EMA(50): 1.9900
  - RSI: 58.20

============================================================
KHUNG 1H
============================================================

🕯️ MÔ HÌNH NẾN:
  - Không có mô hình đặc biệt

📊 CẤU TRÚC THỊ TRƯỜNG:
  - Trend: BULLISH
  - Structure: Higher Lows confirmed

📈 CHỈ BÁO:
  - EMA(20): 1.9950
  - EMA(50): 1.9800
  - RSI: 61.80

============================================================
KHUNG 4H
============================================================

🕯️ MÔ HÌNH NẾN:
  - Không có mô hình đặc biệt

📊 CẤU TRÚC THỊ TRƯỜNG:
  - Trend: BULLISH
  - Structure: Strong uptrend

📈 CHỈ BÁO:
  - EMA(20): 1.9800
  - EMA(50): 1.9500
  - RSI: 65.40

============================================================
KHUNG 1D
============================================================

🕯️ MÔ HÌNH NẾN:
  - Three White Soldiers: BULLISH (strong)

📊 CẤU TRÚC THỊ TRƯỜNG:
  - Trend: BULLISH
  - Structure: Major uptrend

📈 CHỈ BÁO:
  - EMA(20): 1.9200
  - EMA(50): 1.8500
  - RSI: 72.30

============================================================
10 CANDLES GẦN NHẤT (5m)
============================================================
1. [BULL] O:2.00 H:2.01 L:1.99 C:2.01
2. [BULL] O:2.01 H:2.02 L:2.00 C:2.01
3. [BEAR] O:2.01 H:2.01 L:2.00 C:2.00
4. [BULL] O:2.00 H:2.01 L:2.00 C:2.01
5. [BULL] O:2.01 H:2.02 L:2.01 C:2.02
6. [BEAR] O:2.02 H:2.02 L:2.01 C:2.01
7. [BULL] O:2.01 H:2.02 L:2.01 C:2.02
8. [BULL] O:2.02 H:2.02 L:2.01 C:2.02
9. [BEAR] O:2.02 H:2.02 L:2.01 C:2.01
10. [BULL] O:2.01 H:2.02 L:2.01 C:2.02
```

## 🤖 AI Response Example

### Scenario 1: Strong Uptrend Detected

```json
{
  "trend": "uptrend",
  "reason": "Cấu trúc uptrend mạnh trên tất cả timeframes. 5m, 15m, 1h, 4h, 1d đều cho tín hiệu tăng rõ ràng với Higher Highs/Higher Lows. Giá đang trên EMA 20/50 trên tất cả khung. Bullish patterns (Engulfing, Morning Star, Three White Soldiers) xuất hiện liên tiếp. RSI 4h (65.4) và 1d (72.3) cho thấy momentum mạnh.",
  "confidence": "high",
  "risk_assessment": {
    "margin_health": "warning",
    "position_balance": "balanced",
    "overall_risk": "medium"
  },
  "suggestions": [
    {
      "action": "close_short",
      "reason": "SHORT đang lỗ -7.5% ROI và đi ngược xu hướng tăng mạnh. Nên đóng ngay để tránh lỗ lớn hơn khi trend tiếp tục",
      "priority": "critical"
    },
    {
      "action": "hold",
      "reason": "LONG đã lãi +7.5% ROI và đang cùng xu hướng tăng mạnh. Nên giữ để tối đa hóa lợi nhuận khi trend còn tăng",
      "priority": "high"
    },
    {
      "action": "increase_caution",
      "reason": "Margin level chỉ 119%, thấp hơn mức an toàn 150%. Nếu market đảo chiều đột ngột có thể gặp rủi ro liquidation",
      "priority": "medium"
    }
  ]
}
```

### Scenario 2: Sideways Market

```json
{
  "trend": "unclear",
  "reason": "Thị trường đang consolidate trong range 1.99-2.02. Khung 5m và 15m cho tín hiệu trái ngược nhau. RSI dao động quanh 50 cho thấy không có momentum rõ ràng. Không có breakout hay breakdown quan trọng nào.",
  "confidence": "medium",
  "risk_assessment": {
    "margin_health": "healthy",
    "position_balance": "balanced",
    "overall_risk": "low"
  },
  "suggestions": [
    {
      "action": "hold",
      "reason": "Cả 2 positions đều có size cân bằng (1 USDT margin mỗi bên). LONG lãi +2.5%, SHORT lỗ -2.5%, tổng unrealized PnL gần 0. Đây là hedge hoàn hảo trong sideways. Chờ 1 trong 2 đạt +5% ROI để take profit",
      "priority": "low"
    }
  ]
}
```

### Scenario 3: High Risk Situation

```json
{
  "trend": "downtrend",
  "reason": "Breakdown khỏi support 2.00. Lower Highs và Lower Lows xuất hiện trên 5m, 15m, 1h. Bearish patterns (Shooting Star, Evening Star) trên nhiều timeframes. Giá đã cross dưới EMA 50. RSI giảm xuống dưới 40 cho thấy momentum giảm.",
  "confidence": "high",
  "risk_assessment": {
    "margin_health": "critical",
    "position_balance": "balanced",
    "overall_risk": "high"
  },
  "suggestions": [
    {
      "action": "close_long",
      "reason": "LONG đang lỗ -12% ROI và đi ngược xu hướng giảm mạnh. Margin level chỉ còn 108%, rất gần mức liquidation 100%. Phải đóng NGAY để bảo toàn vốn!",
      "priority": "critical"
    },
    {
      "action": "reduce_margin",
      "reason": "Tổng margin used là 1.80 USDT trên equity 1.85 USDT (97% equity!). Free margin chỉ 0.05 USDT, không đủ chịu biến động. Cần giảm exposure xuống để tránh liquidation",
      "priority": "critical"
    }
  ]
}
```

## 📝 Giải thích các trường

### Trend:
- **uptrend**: Xu hướng tăng rõ ràng
- **downtrend**: Xu hướng giảm rõ ràng
- **unclear**: Không có xu hướng rõ ràng (sideways/choppy)

### Confidence:
- **high**: Tín hiệu rất rõ, xác nhận từ nhiều timeframes
- **medium**: Có tín hiệu nhưng chưa đủ mạnh
- **low**: Tín hiệu yếu, nhiều uncertainty

### Risk Assessment:

#### margin_health:
- **healthy**: Margin level > 200% (an toàn)
- **warning**: Margin level 150-200% (cần cảnh giác)
- **critical**: Margin level < 150% (rủi ro cao)

#### position_balance:
- **balanced**: Long và Short có size tương đương
- **unbalanced**: Một bên lớn hơn nhiều (rủi ro directional)

#### overall_risk:
- **low**: Mọi thứ ổn định, margin dư dả
- **medium**: Có một số rủi ro nhỏ
- **high**: Rủi ro liquidation hoặc loss lớn

### Suggestions Actions:
- **close_long**: Đóng position LONG
- **close_short**: Đóng position SHORT
- **reduce_margin**: Giảm size hoặc leverage
- **increase_caution**: Tăng cảnh giác, monitor chặt
- **hold**: Giữ nguyên, không cần action

### Priority:
- **critical**: Cần xử lý NGAY LẬP TỨC
- **high**: Cần xử lý sớm
- **medium**: Nên xử lý khi có thời gian
- **low**: Informational only

## 🎯 Lợi ích của AI Context-Aware

### 1. **Hiểu đầy đủ tình huống**
AI không chỉ nhìn chart mà còn biết:
- Bạn có bao nhiêu tiền
- Positions đang lãi/lỗ bao nhiêu
- Margin level còn bao nhiêu
- Risk exposure hiện tại

### 2. **Suggestions thực tế**
Không suggest mở lệnh khi:
- Free margin không đủ
- Đã over-leveraged
- Market quá rủi ro

### 3. **Risk-aware decisions**
AI ưu tiên:
- Bảo toàn vốn trước
- Tối đa hóa lợi nhuận sau
- Tránh liquidation

### 4. **Personalized advice**
Suggestions phụ thuộc vào:
- Capital size của bạn
- Risk tolerance (leverage setting)
- Current exposure

## 🔄 Workflow Integration

```
Bot Cycle (5 phút):
  │
  ├─> Load positions ✅
  ├─> Get price ✅
  │
  ├─> Collect account status 🆕
  │   ├─> Equity, available, margin
  │   └─> Calculate ROI, PnL cho mỗi position
  │
  ├─> Analyze trend with AI 🤖
  │   ├─> Send: Market data + Account status 🆕
  │   └─> Receive: Trend + Risk assessment + Suggestions 🆕
  │
  ├─> Check profit & close (intelligent)
  ├─> Manage positions based on trend
  └─> Ensure hedge positions
```

## 💡 Future Enhancements

Có thể thêm:
1. **Auto-execute critical suggestions** (nếu priority = critical)
2. **Notification/Alert** khi risk = high
3. **Historical suggestions tracking** để improve AI
4. **Custom risk parameters** cho từng user
5. **Portfolio-level analysis** (multi symbols)

