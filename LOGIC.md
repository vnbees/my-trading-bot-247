# Logic Bot Trading 2 Chiều Bitget

## Tổng quan

Bot này thực hiện chiến lược trading 2 chiều (Long + Short) trên Bitget Futures với các tính năng:
- Đặt lệnh Long và Short đồng thời
- Tự động monitor và đóng lệnh khi đạt TP/SL
- Quản lý rủi ro với cooldown và timeout
- Xử lý lỗi và retry tự động

---

## Flow chính khi bot bắt đầu

### 1. Khởi tạo (start.js)

```
1. Parse CLI arguments:
   - API credentials (key, secret, passphrase)
   - Trading config (symbol, margin, capital, leverage, TP/SL, ...)

2. Tính toán TP/SL theo đòn bẩy:
   - Base TP/SL: 0.6% / 0.3% (cho đòn bẩy 5x)
   - TP/SL thực tế = Base (giữ nguyên)
   - Lợi nhuận thực tế = Base × Leverage
   - Ví dụ: Leverage 10x → Lợi nhuận = 0.6% × 10 = 6%

3. Khởi tạo BitgetApi và BotLogic

4. Gọi bot.run()
```

### 2. Bot.run() - Vòng lặp chính

```
WHILE bot đang chạy:
  1. enforceCooldown() - Đợi cooldown giữa các chu kỳ
  2. executeCycle() - Thực hiện một chu kỳ trading
  3. Nếu có lỗi:
     - Log lỗi
     - Đợi 60 giây
     - Thử lại (trừ khi là lỗi nghiêm trọng → dừng bot)
```

---

## Chi tiết từng bước

### Bước 1: prepareMarketMeta()

**Mục đích**: Lấy thông tin contract (tick size, size step) từ API

```
1. Gọi API getContract() để lấy thông tin contract
2. Lấy priceTick và quantityTick từ contract
3. Validate tick size:
   - Nếu tick size > giá/10 → có thể sai, ước tính lại
   - Ước tính dựa trên giá:
     * Giá < 0.1 → tick = 0.0001
     * Giá < 1 → tick = 0.001
     * Giá < 10 → tick = 0.01
     * Giá < 100 → tick = 0.1
     * Giá >= 100 → tick = 1
4. Lưu tick size và size step để dùng sau
```

### Bước 2: enforceCooldown()

**Mục đích**: Đảm bảo có khoảng cách thời gian giữa các chu kỳ

```
IF đây là chu kỳ đầu tiên:
  → Bỏ qua, tiếp tục

ELSE:
  Tính thời gian đã trôi qua từ chu kỳ trước
  IF thời gian < cooldown (mặc định 5 phút):
    → Đợi cho đủ cooldown
  ELSE:
    → Tiếp tục ngay
```

### Bước 3: executeCycle() - Chu kỳ trading

#### 3.1. Kiểm tra số dư

```
1. Gọi API getAccount() để lấy số dư
2. Tính số dư cần thiết = capital × 2 (cho cả Long và Short)
3. IF số dư < số dư cần thiết:
   → Cảnh báo và gợi ý giảm capital hoặc nạp thêm
4. Tiếp tục (không throw error để có thể retry)
```

#### 3.2. Lấy giá hiện tại

```
1. Gọi API getTicker() với retry logic:
   - Retry tối đa 3 lần
   - Exponential backoff: 1s, 2s, 4s
   
2. Lấy giá từ:
   - ticker.last (ưu tiên)
   - ticker.markPrice (fallback)
   - ticker.bestAsk (fallback cuối)

3. Validate giá:
   - Phải là số hợp lệ > 0
   - Không phải NaN
   
4. Lưu raw string để giữ full precision
```

#### 3.3. Tính toán kích thước lệnh

```
1. Tính notional = capital × leverage
2. Tính size = notional / entryPrice
3. Round theo sizeStep
4. Validate:
   - Size > 0
   - Size >= sizeStep (cảnh báo nếu nhỏ hơn)
```

#### 3.4. Thiết lập đòn bẩy

```
1. Gọi API setLeverage() cho cả Long và Short
2. Retry nếu lỗi
3. Validate thành công
```

#### 3.5. Mở lệnh Long

```
1. Tính TP/SL:
   - Raw TP = entryPrice × (1 + takeProfitPercent)
   - Raw SL = entryPrice × (1 - stopLossPercent)
   - Detect actual tick size từ entry price
   - Round TP/SL theo actual tick
   
2. Validate TP/SL:
   - TP > entryPrice (Long)
   - SL < entryPrice (Long)
   - Cả 2 > 0
   - Không quá xa entry (>10% cảnh báo)

3. Đặt lệnh với retry:
   - Retry tối đa 3 lần
   - Exponential backoff
   - Xử lý lỗi cụ thể:
     * 40762 (số dư không đủ) → throw error
     * 45001 (preset error) → bỏ qua

4. Đợi 1 giây để order fill

5. Kiểm tra position thực tế (optional):
   - Gọi API getPosition()
   - Validate size và side
   - Cảnh báo nếu không khớp

6. Lưu state: { direction, size, entryPrice, tp, sl, isActive: true }
```

#### 3.6. Mở lệnh Short

```
Tương tự như Long, nhưng:
- TP < entryPrice
- SL > entryPrice
- Raw TP = entryPrice × (1 - takeProfitPercent)
- Raw SL = entryPrice × (1 + stopLossPercent)
```

#### 3.7. Xử lý khi một lệnh fail

```
IF Long thành công nhưng Short fail:
  1. Cảnh báo
  2. Đóng Long ngay để tránh rủi ro
  3. Throw error → dừng chu kỳ

IF Short thành công nhưng Long fail:
  1. Cảnh báo
  2. Đóng Short ngay để tránh rủi ro
  3. Throw error → dừng chu kỳ

IF cả 2 đều fail:
  → Throw error → dừng chu kỳ
```

#### 3.8. monitorPositions() - Monitor và đóng lệnh

```
WHILE thời gian < maxDuration (15 phút):
  1. Đợi pollInterval (5 giây)
  
  2. Lấy giá hiện tại với retry:
     - Retry tối đa 3 lần
     - Exponential backoff
     - Validate giá hợp lệ
     - Validate giá không quá khác biệt so với entry
  
  3. Kiểm tra nếu cả 2 lệnh đã đóng:
     → Dừng monitor ngay
  
  4. Check cả 2 bên cùng lúc:
     - longCheck = checkSideShouldClose(longState, price)
     - shortCheck = checkSideShouldClose(shortState, price)
  
  5. Ưu tiên SL (rủi ro cao hơn):
     IF Long chạm SL:
       → Đóng Long ngay
       → Tiếp tục monitor Short
       → Kiểm tra nếu cả 2 đã đóng → dừng
     
     IF Short chạm SL:
       → Đóng Short ngay
       → Tiếp tục monitor Long
       → Kiểm tra nếu cả 2 đã đóng → dừng
  
  6. Sau đó check TP:
     IF Long chạm TP:
       → Đóng cả 2 lệnh
       → Dừng monitor
     
     IF Short chạm TP:
       → Đóng cả 2 lệnh
       → Dừng monitor
  
  7. Edge cases:
     IF cả 2 cùng chạm SL:
       → Đóng cả 2 ngay
       → Dừng monitor
     
     IF cả 2 cùng chạm TP:
       → Đóng cả 2 ngay
       → Dừng monitor

8. Timeout (sau maxDuration):
   → Đóng các lệnh còn active
   → Dừng monitor
```

### Bước 4: checkSideShouldClose()

**Mục đích**: Kiểm tra xem một lệnh có nên đóng không

```
IF state không active:
  → return { shouldClose: false }

IF direction === 'long':
  IF price >= TP:
    → return { shouldClose: true, reason: 'tp' }
  IF price <= SL:
    → return { shouldClose: true, reason: 'sl' }

IF direction === 'short':
  IF price <= TP:
    → return { shouldClose: true, reason: 'tp' }
  IF price >= SL:
    → return { shouldClose: true, reason: 'sl' }

→ return { shouldClose: false }
```

### Bước 5: closePosition()

**Mục đích**: Đóng một lệnh với retry logic

```
1. Kiểm tra state.isActive:
   IF không active:
     → Bỏ qua (đã đóng rồi)

2. Đánh dấu inactive trước (tránh đóng 2 lần)

3. Retry tối đa 3 lần:
   - Gọi API closePosition()
   - Exponential backoff: 1s, 2s, 4s
   
4. Xử lý lỗi:
   - 40404 (NOT FOUND) → coi như thành công (đã đóng rồi)
   - 40778 (no position) → coi như thành công
   - Lỗi khác → retry
   
5. Nếu sau 3 lần vẫn fail:
   → Log cảnh báo (không throw để không block lệnh kia)
```

### Bước 6: closeBoth()

**Mục đích**: Đóng cả 2 lệnh cùng lúc

```
1. Kiểm tra số lệnh còn active

2. IF không còn lệnh nào active:
   → Bỏ qua (đã đóng rồi)

3. Đóng cả 2 song song (Promise.all):
   - Mỗi lệnh có error handling riêng
   - Không throw error để đảm bảo lệnh kia vẫn được đóng

4. Kiểm tra lại sau khi đóng:
   IF vẫn còn lệnh active:
     → Cảnh báo yêu cầu kiểm tra thủ công
   ELSE:
     → Log thành công
```

---

## Các trường hợp đặc biệt được xử lý

### 1. Network errors
- **Xử lý**: Retry với exponential backoff
- **Số lần retry**: 3 lần
- **Backoff**: 1s, 2s, 4s (max 5s)

### 2. API rate limits
- **Xử lý**: Retry với backoff
- **Log**: Cảnh báo khi retry

### 3. Số dư không đủ
- **Xử lý**: Throw error, dừng bot
- **Gợi ý**: Giảm capital hoặc nạp thêm

### 4. Một lệnh fail, một lệnh thành công
- **Xử lý**: Đóng lệnh thành công ngay, throw error
- **Lý do**: Tránh rủi ro khi chỉ có một lệnh

### 5. Position không tồn tại khi đóng
- **Xử lý**: Coi như đã đóng thành công
- **Lỗi**: 40404, 40778

### 6. Giá không hợp lệ từ API
- **Xử lý**: Retry hoặc skip check
- **Validate**: Không quá khác biệt so với entry (>50% hoặc <10%)

### 7. Cả 2 cùng chạm SL/TP cùng lúc
- **Xử lý**: Đóng cả 2 ngay lập tức
- **Log**: Cảnh báo đặc biệt

### 8. Timeout
- **Xử lý**: Đóng các lệnh còn active
- **Log**: Thông báo timeout

---

## Ví dụ flow hoàn chỉnh

### Ví dụ 1: Long chạm TP

```
1. Bot khởi động → prepareMarketMeta()
2. enforceCooldown() → bỏ qua (chu kỳ đầu)
3. executeCycle():
   - Kiểm tra số dư ✅
   - Lấy giá: 2.1048 ✅
   - Tính size: 19 contracts ✅
   - Set leverage 10x ✅
   - Mở Long: Entry 2.1048, TP 2.1174, SL 2.0985 ✅
   - Mở Short: Entry 2.1048, TP 2.0922, SL 2.1111 ✅
   
4. monitorPositions():
   - Check #1: Giá 2.1045 → Chưa chạm ✅
   - Check #2: Giá 2.1066 → Chưa chạm ✅
   - ...
   - Check #39: Giá 2.1113 → Short chạm SL (2.1111) ✅
     → Đóng Short ngay
     → Tiếp tục monitor Long
   - Check #40-158: Monitor Long
   - Check #159: Giá 2.0971 → Long chạm SL (2.0985) ✅
     → Đóng Long
     → Cả 2 đã đóng → Dừng monitor ✅
```

### Ví dụ 2: Long chạm TP (đóng cả 2)

```
1-3. Tương tự ví dụ 1

4. monitorPositions():
   - Check #1-56: Chưa chạm
   - Check #57: Giá 2.1316 → Long chạm TP (2.1174) ✅
     → Đóng cả 2 lệnh ngay
     → Dừng monitor ✅
```

### Ví dụ 3: Timeout

```
1-3. Tương tự ví dụ 1

4. monitorPositions():
   - Check #1-180: Chưa chạm TP/SL
   - Sau 15 phút (900 giây):
     → Timeout
     → Đóng cả 2 lệnh
     → Dừng monitor ✅
```

---

## Công thức tính toán

### TP/SL theo đòn bẩy

```
Base TP = 0.6% (cho đòn bẩy 5x)
Base SL = 0.3% (cho đòn bẩy 5x)

Với leverage = 10x:
  TP giá = entryPrice × (1 + 0.6%) = entryPrice × 1.006
  SL giá = entryPrice × (1 - 0.3%) = entryPrice × 0.997
  
  Lợi nhuận khi chạm TP = 0.6% × 10 = 6%
  Thua lỗ khi chạm SL = 0.3% × 10 = 3%
```

### Order Size

```
notional = capital × leverage
size = notional / entryPrice
size_rounded = round(size, sizeStep)
```

### Tick Size Detection

```
Từ entry price string (ví dụ: "2.1048"):
  - 4 chữ số thập phân → tick = 0.0001
  - 3 chữ số thập phân → tick = 0.001
  - 2 chữ số thập phân → tick = 0.01
  - 1 chữ số thập phân → tick = 0.1
```

---

## Error Handling

### Fatal Errors (dừng bot)
- Số dư không đủ
- Không thể mở cả 2 lệnh
- Không thể lấy giá ticker
- Entry price không hợp lệ
- Order size không hợp lệ

### Non-Fatal Errors (retry)
- Network errors
- API rate limits
- Timeout
- Position không tồn tại (khi đóng)

---

## Lưu ý quan trọng

1. **Bot tự monitor và đóng lệnh** - Không set TP/SL trên sàn
2. **Bot phải chạy liên tục** - Nếu bot tắt, lệnh không tự đóng
3. **Ưu tiên SL trước TP** - Rủi ro cao hơn
4. **Retry tự động** - Với exponential backoff
5. **Validation toàn diện** - Mọi giá trị đều được kiểm tra
6. **An toàn khi một lệnh fail** - Đóng lệnh thành công ngay

---

## Kết thúc

Bot sẽ tiếp tục chạy vòng lặp cho đến khi:
- Có lỗi nghiêm trọng (fatal error)
- User dừng bot thủ công (Ctrl+C)
- Process bị kill

Sau mỗi chu kỳ, bot sẽ đợi cooldown (5 phút) trước khi bắt đầu chu kỳ mới.

