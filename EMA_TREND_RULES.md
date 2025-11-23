# 📋 Quy Tắc Vào Lệnh & Setup Lệnh - EMA Crossover + RSI Filter Bot

## 🎯 Tổng Quan Chiến Lược

Bot sử dụng **EMA Crossover + RSI Filter** để giao dịch theo xu hướng:
- **EMA 12** (nhanh) và **EMA 26** (chậm) để xác định xu hướng
- **RSI 14** với ngưỡng **50** để lọc tín hiệu giả
- **ATR** để tính Stop Loss động
- **R:R Ratio 1:2** cho Take Profit

---

## 📊 QUY TẮC VÀO LỆNH (Entry Rules)

### ✅ 1. LỆNH LONG (Mua)

**Điều kiện BẮT BUỘC phải thỏa mãn CẢ 2:**

#### Điều kiện 1: EMA Crossover (Xu hướng tăng)
```
EMA 12 (nến trước) ≤ EMA 26 (nến trước)
    VÀ
EMA 12 (nến hiện tại) > EMA 26 (nến hiện tại)
```
➡️ **Ý nghĩa**: EMA 12 vừa cắt lên trên EMA 26, báo hiệu xu hướng tăng mới bắt đầu

#### Điều kiện 2: RSI Filter (Lọc tín hiệu giả)
```
RSI 14 (nến hiện tại) > 50
```
➡️ **Ý nghĩa**: RSI > 50 xác nhận động lượng tăng, loại bỏ tín hiệu giả khi thị trường đi ngang

---

### ✅ 2. LỆNH SHORT (Bán)

**Điều kiện BẮT BUỘC phải thỏa mãn CẢ 2:**

#### Điều kiện 1: EMA Crossover (Xu hướng giảm)
```
EMA 12 (nến trước) ≥ EMA 26 (nến trước)
    VÀ
EMA 12 (nến hiện tại) < EMA 26 (nến hiện tại)
```
➡️ **Ý nghĩa**: EMA 12 vừa cắt xuống dưới EMA 26, báo hiệu xu hướng giảm mới bắt đầu

#### Điều kiện 2: RSI Filter (Lọc tín hiệu giả)
```
RSI 14 (nến hiện tại) < 50
```
➡️ **Ý nghĩa**: RSI < 50 xác nhận động lượng giảm, loại bỏ tín hiệu giả khi thị trường đi ngang

---

### 🔄 3. QUY TẮC ĐÓNG LỆNH CŨ

**Khi có tín hiệu vào lệnh mới KHÁC CHIỀU:**
- Nếu đang có lệnh **LONG** và có tín hiệu **SHORT** → Đóng LONG trước, sau đó mở SHORT
- Nếu đang có lệnh **SHORT** và có tín hiệu **LONG** → Đóng SHORT trước, sau đó mở LONG
- Bot sẽ đợi 1 giây sau khi đóng lệnh cũ để đảm bảo hoàn tất

---

## ⚙️ SETUP LỆNH (Position Setup)

### 1. 📍 Entry Price (Giá vào lệnh)
```
Entry Price = Giá hiện tại (currentPrice) từ Binance API
```
- Bot sử dụng giá thị trường hiện tại để vào lệnh
- Lệnh được đặt dạng **Market Order** để đảm bảo khớp ngay

---

### 2. 🛑 Stop Loss (SL) - Tính dựa trên ATR

**Công thức:**
```
ATR Distance = ATR × ATR Multiplier (mặc định: 2.0)

LONG:  SL = Entry Price - ATR Distance
SHORT: SL = Entry Price + ATR Distance
```

**Ví dụ:**
- Entry Price: $50,000
- ATR (14): $500
- ATR Multiplier: 2.0
- ATR Distance = $500 × 2.0 = $1,000

**LONG:**
- SL = $50,000 - $1,000 = **$49,000**

**SHORT:**
- SL = $50,000 + $1,000 = **$51,000**

➡️ **Lợi ích**: SL tự động điều chỉnh theo độ biến động của thị trường (ATR)

---

### 3. 🎯 Take Profit (TP) - Tính dựa trên R:R Ratio

**Công thức:**
```
SL Distance = |Entry Price - Stop Loss|
TP Distance = SL Distance × R:R Ratio (mặc định: 2.0)

LONG:  TP = Entry Price + TP Distance
SHORT: TP = Entry Price - TP Distance
```

**Ví dụ (tiếp theo):**
- Entry Price: $50,000
- SL: $49,000 (LONG)
- SL Distance = |$50,000 - $49,000| = $1,000
- R:R Ratio = 1:2
- TP Distance = $1,000 × 2 = $2,000

**LONG:**
- TP = $50,000 + $2,000 = **$52,000**

**Kết quả:**
- Risk: $1,000 (từ Entry đến SL)
- Reward: $2,000 (từ Entry đến TP)
- **R:R = 1:2** ✅

---

### 4. 💰 Lot Size (Khối lượng lệnh)

**Công thức:**
```
Capital = (config.capital > 0) ? config.capital : equity (toàn bộ vốn)
Notional Value = Capital × Leverage
Lot Size = Notional Value / Entry Price
```

**Ví dụ:**
- Capital: $100 USDT
- Leverage: 10x
- Entry Price: $50,000
- Notional Value = $100 × 10 = $1,000
- Lot Size = $1,000 / $50,000 = **0.02 BTC**

**Lưu ý:**
- Lot Size sẽ được làm tròn theo `sizeStep` của contract
- Bot sẽ kiểm tra `minLotSize` và cảnh báo nếu capital quá thấp
- Nếu `capital = 0` hoặc không chỉ định, bot sẽ dùng toàn bộ equity

---

### 5. 🔧 Các Tham Số Setup

| Tham số | Mặc định | Mô tả |
|---------|----------|-------|
| `emaFast` | 12 | Period EMA nhanh |
| `emaSlow` | 26 | Period EMA chậm |
| `rsiPeriod` | 14 | Period RSI |
| `rsiThreshold` | 50 | Ngưỡng RSI để lọc tín hiệu |
| `atrPeriod` | 14 | Period ATR |
| `atrMultiplier` | 2.0 | Hệ số nhân ATR để tính SL |
| `rRatio` | 2 | Risk:Reward ratio (1:2) |
| `leverage` | 10 | Đòn bẩy |
| `timeFrame` | 1m | Khung thời gian (1 phút) |
| `pollIntervalMs` | 60000 | Thời gian check (60s = 1 phút) |

---

## 🚪 QUY TẮC THOÁT LỆNH (Exit Rules)

### 1. ✅ Take Profit (TP)
- Lệnh tự động đóng khi giá chạm TP
- **LONG**: Giá ≥ TP
- **SHORT**: Giá ≤ TP

### 2. 🛑 Stop Loss (SL)
- Lệnh tự động đóng khi giá chạm SL
- **LONG**: Giá ≤ SL
- **SHORT**: Giá ≥ SL

### 3. 🔄 EMA Crossover Ngược
- **LONG**: Đóng khi EMA 12 cắt xuống dưới EMA 26
- **SHORT**: Đóng khi EMA 12 cắt lên trên EMA 26
- Đây là tín hiệu xu hướng đã đảo chiều

---

## 📝 VÍ DỤ THỰC TẾ

### Scenario 1: Vào lệnh LONG

**Tình huống:**
- EMA 12 (trước): $49,800
- EMA 26 (trước): $49,900
- EMA 12 (hiện tại): $50,100
- EMA 26 (hiện tại): $50,000
- RSI: 52
- Current Price: $50,200
- ATR: $500
- Capital: $100 USDT
- Leverage: 10x

**Kiểm tra điều kiện:**
1. ✅ EMA Crossover: $49,800 ≤ $49,900 VÀ $50,100 > $50,000 → **ĐÚNG**
2. ✅ RSI Filter: 52 > 50 → **ĐÚNG**

**Setup lệnh:**
- Entry: $50,200
- SL = $50,200 - ($500 × 2) = **$49,200**
- SL Distance = $1,000
- TP = $50,200 + ($1,000 × 2) = **$52,200**
- Notional = $100 × 10 = $1,000
- Lot Size = $1,000 / $50,200 = **0.0199 BTC**

**Kết quả:**
- Risk: $1,000 (1% với $100 capital)
- Reward: $2,000 (2% với $100 capital)
- R:R = 1:2 ✅

---

### Scenario 2: Vào lệnh SHORT

**Tình huống:**
- EMA 12 (trước): $50,200
- EMA 26 (trước): $50,100
- EMA 12 (hiện tại): $49,900
- EMA 26 (hiện tại): $50,000
- RSI: 48
- Current Price: $49,800
- ATR: $500
- Capital: $100 USDT
- Leverage: 10x

**Kiểm tra điều kiện:**
1. ✅ EMA Crossover: $50,200 ≥ $50,100 VÀ $49,900 < $50,000 → **ĐÚNG**
2. ✅ RSI Filter: 48 < 50 → **ĐÚNG**

**Setup lệnh:**
- Entry: $49,800
- SL = $49,800 + ($500 × 2) = **$50,800**
- SL Distance = $1,000
- TP = $49,800 - ($1,000 × 2) = **$47,800**
- Notional = $100 × 10 = $1,000
- Lot Size = $1,000 / $49,800 = **0.0201 BTC**

---

## ⚠️ LƯU Ý QUAN TRỌNG

1. **Chỉ mở 1 lệnh tại một thời điểm**: Bot chỉ giữ 1 position (LONG hoặc SHORT)

2. **Tự động đóng lệnh cũ**: Khi có tín hiệu mới khác chiều, bot sẽ tự động đóng lệnh cũ

3. **Check mỗi phút**: Bot kiểm tra điều kiện mỗi 60 giây (1 phút) theo khung 1m

4. **Market Order**: Bot sử dụng lệnh thị trường để đảm bảo khớp ngay, không chờ giá

5. **SL/TP tự động**: Bot set SL và TP ngay khi mở lệnh, không cần theo dõi thủ công

6. **Capital tối thiểu**: Bot sẽ cảnh báo nếu capital quá thấp không đủ mở lệnh với minLotSize

---

## 🎮 CÁCH SỬ DỤNG

```bash
node startTrend.js \
  --key=YOUR_API_KEY \
  --secret=YOUR_API_SECRET \
  --passphrase=YOUR_PASSPHRASE \
  --symbol=BTCUSDT_UMCBL \
  --capital=100 \
  --leverage=10 \
  --emaFast=12 \
  --emaSlow=26 \
  --rsiThreshold=50 \
  --atrMultiplier=2.0 \
  --rRatio=2 \
  --poll=60
```

---

## 📈 KẾT LUẬN

Chiến lược **EMA Crossover + RSI Filter** đơn giản nhưng hiệu quả:
- ✅ Vào lệnh sớm khi xu hướng mới hình thành (EMA crossover)
- ✅ Lọc bỏ tín hiệu giả (RSI filter)
- ✅ Quản lý rủi ro tốt (ATR-based SL, R:R 1:2)
- ✅ Thoát lệnh thông minh (EMA crossover ngược)

Bot tự động thực hiện tất cả các bước trên, bạn chỉ cần cấu hình và theo dõi!

