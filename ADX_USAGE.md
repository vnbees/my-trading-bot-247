# Hướng dẫn sử dụng ADX Script

## Vấn đề hiện tại

File `adx.js` đang gặp lỗi với endpoint candles của Bitget API. Endpoint `/api/mix/v1/market/candles` trả về lỗi "Parameter verification failed".

## Cách sử dụng (khi endpoint hoạt động)

### 1. Chạy với API key của bạn:

```bash
node adx.js \
  --symbol=XRPUSDT_UMCBL \
  --key=bg_341563e7ffde3387dd8d85b38d039671 \
  --secret=e3b3e24d8d80de7739b0fd5553a9a908ab1894a39710491bb0b0807c332991fe \
  --passphrase=123abcABCD
```

### 2. Chạy với symbol khác:

```bash
node adx.js \
  --symbol=BTCUSDT_UMCBL \
  --key=YOUR_KEY \
  --secret=YOUR_SECRET \
  --passphrase=YOUR_PASSPHRASE
```

### 3. Thay đổi số nến:

```bash
node adx.js \
  --symbol=XRPUSDT_UMCBL \
  --limit=500 \
  --key=... --secret=... --passphrase=...
```

## Giải pháp thay thế

Vì endpoint candles có vấn đề, bạn có thể:

### Option 1: Sử dụng WebSocket để lấy dữ liệu nến

Bitget hỗ trợ WebSocket để lấy dữ liệu nến real-time. Bạn có thể:
1. Kết nối WebSocket
2. Subscribe vào channel candles
3. Lưu dữ liệu nến
4. Tính ADX từ dữ liệu đã lưu

### Option 2: Tích hợp ADX vào bot trading hiện tại

Thay vì chạy riêng file `adx.js`, bạn có thể tích hợp ADX vào bot trading:

1. **Thêm ADX vào botLogic.js**:
   - Tính ADX trước khi mở lệnh
   - Chỉ mở lệnh khi ADX > 25 (xu hướng mạnh)
   - Hoặc sử dụng ADX để quyết định Long/Short

2. **Ví dụ tích hợp**:

```javascript
// Trong botLogic.js
const { ADX } = require('technicalindicators');

async function getADX(symbol) {
  // Lấy dữ liệu nến từ API hoặc WebSocket
  const candles = await fetchCandles(symbol);
  const { highs, lows, closes } = parseCandles(candles);
  
  const adxResult = ADX.calculate({
    high: highs,
    low: lows,
    close: closes,
    period: 14,
  });
  
  return adxResult[adxResult.length - 1].adx;
}

// Sử dụng trong executeCycle
async executeCycle() {
  const adx = await getADX(this.config.symbol);
  console.log(`[BOT] ADX hiện tại: ${adx.toFixed(2)}`);
  
  if (adx < 25) {
    console.log('[BOT] ⚠️ ADX < 25, xu hướng yếu - bỏ qua chu kỳ này');
    return; // Không mở lệnh
  }
  
  // Tiếp tục logic mở lệnh...
}
```

### Option 3: Sử dụng API của exchange khác

Nếu Bitget API không hỗ trợ tốt endpoint candles, bạn có thể:
1. Lấy dữ liệu nến từ exchange khác (Binance, OKX, ...)
2. Tính ADX từ dữ liệu đó
3. Áp dụng vào trading trên Bitget

## Cách kiểm tra endpoint Bitget

Để kiểm tra endpoint candles có hoạt động không:

```bash
# Thử với curl
curl "https://api.bitget.com/api/mix/v1/market/candles?symbol=BTCUSDT_UMCBL&granularity=300"
```

Nếu trả về lỗi, có thể:
- Endpoint không tồn tại cho mix contracts
- Cần format khác
- Cần authentication đặc biệt
- Cần dùng WebSocket thay vì REST API

## Tài liệu tham khảo

- Bitget API Documentation: https://bitgetlimited.github.io/apidoc/en/mix/
- Technical Indicators: https://www.npmjs.com/package/technicalindicators

## Lưu ý

- ADX > 25: Xu hướng mạnh, có thể trade
- ADX < 25: Xu hướng yếu, nên tránh trade
- ADX kết hợp với +DI và -DI để xác định hướng xu hướng
- ADX không chỉ ra hướng giá, chỉ cho biết sức mạnh xu hướng

