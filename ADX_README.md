# Hướng dẫn sử dụng Script ADX

## Tổng quan

Có 3 script để tính ADX (Average Directional Index):

1. **`adx.js`** - Sử dụng Bitget REST API (có vấn đề với endpoint candles)
2. **`adx-websocket.js`** - Sử dụng Bitget WebSocket (có vấn đề với format channel)
3. **`adx-binance.js`** - Sử dụng Binance REST API ✅ **KHUYẾN NGHỊ**

## Script khuyến nghị: adx-binance.js

Script này sử dụng Binance API, ổn định và dễ sử dụng.

### Cài đặt

```bash
# Đảm bảo đã cài đặt dependencies
npm install axios technicalindicators yargs
```

### Sử dụng

```bash
# Chạy với symbol mặc định (BTCUSDT)
node adx-binance.js

# Chạy với symbol khác
node adx-binance.js --symbol=XRPUSDT

# Thay đổi interval
node adx-binance.js --symbol=XRPUSDT --interval=15m

# Thay đổi ADX period
node adx-binance.js --symbol=XRPUSDT --period=21

# Thay đổi số nến
node adx-binance.js --symbol=XRPUSDT --limit=500
```

### Ví dụ output

```
[ADX-Binance] 🚀 Khởi động script ADX với Binance API
[ADX-Binance] Symbol: XRPUSDT
[ADX-Binance] Interval: 5m
[ADX-Binance] ADX Period: 14
[ADX-Binance] Limit: 200 nến

[ADX] Đang lấy dữ liệu nến 5m cho XRPUSDT từ Binance...
[ADX] Đã nhận 200 nến từ Binance
[ADX] Đã parse 200 nến hợp lệ
[ADX] Đang tính ADX với period 14...

═══════════════════════════════════════
📊 KẾT QUẢ ADX
═══════════════════════════════════════
Symbol: XRPUSDT
Interval: 5m
Số nến: 200
ADX Period: 14

Latest ADX: 30.28
+DI: 21.09
-DI: 18.98

✅ ADX > 25: Xu hướng MẠNH - Có thể trade
📈 +DI > -DI: Xu hướng TĂNG
═══════════════════════════════════════
```

### Tham số

- `--symbol`: Symbol cần tính ADX (ví dụ: BTCUSDT, XRPUSDT) - **Lưu ý: Không có _UMCBL suffix**
- `--interval`: Interval cho nến (1m, 3m, 5m, 15m, 30m, 1h, 4h, 1d) - Mặc định: 5m
- `--period`: Period cho ADX - Mặc định: 14
- `--limit`: Số nến cần lấy - Mặc định: 200

## Cách đọc kết quả ADX

### ADX Value

- **ADX > 25**: Xu hướng MẠNH - Có thể trade
- **ADX 20-25**: Xu hướng TRUNG BÌNH
- **ADX < 20**: Xu hướng YẾU - Nên tránh trade

### +DI và -DI

- **+DI > -DI**: Xu hướng TĂNG (bullish)
- **-DI > +DI**: Xu hướng GIẢM (bearish)
- **+DI ≈ -DI**: Không có xu hướng rõ ràng

### Kết hợp ADX với +DI/-DI

- **ADX > 25 và +DI > -DI**: Xu hướng tăng mạnh → Có thể Long
- **ADX > 25 và -DI > +DI**: Xu hướng giảm mạnh → Có thể Short
- **ADX < 20**: Thị trường đi ngang → Tránh trade

## Script khác (có vấn đề)

### adx.js (Bitget REST API)

**Vấn đề**: Endpoint candles của Bitget không hoạt động với futures contracts.

**Lỗi**: `Parameter verification failed`

**Giải pháp**: Sử dụng `adx-binance.js` thay thế.

### adx-websocket.js (Bitget WebSocket)

**Vấn đề**: Format WebSocket channel không đúng, Bitget trả về lỗi `channel doesn't exist`.

**Lỗi**: `mc/candle5m:XRPUSDT_UMCBL doesn't exist`

**Giải pháp**: Sử dụng `adx-binance.js` thay thế.

## Tích hợp ADX vào bot trading

Bạn có thể tích hợp ADX vào bot trading để:

1. **Kiểm tra xu hướng trước khi mở lệnh**:
   - Chỉ mở lệnh khi ADX > 25 (xu hướng mạnh)
   - Tránh trade khi ADX < 20 (thị trường đi ngang)

2. **Xác định hướng trade**:
   - ADX > 25 và +DI > -DI → Ưu tiên Long
   - ADX > 25 và -DI > +DI → Ưu tiên Short

3. **Ví dụ code**:

```javascript
// Trong botLogic.js
const { ADX } = require('technicalindicators');
const axios = require('axios');

async function getADXFromBinance(symbol) {
  // Lấy dữ liệu từ Binance
  const response = await axios.get('https://api.binance.com/api/v3/klines', {
    params: {
      symbol: symbol.replace('_UMCBL', ''), // Bỏ suffix
      interval: '5m',
      limit: 200,
    },
  });
  
  const candles = response.data;
  const highs = candles.map(c => parseFloat(c[2]));
  const lows = candles.map(c => parseFloat(c[3]));
  const closes = candles.map(c => parseFloat(c[4]));
  
  const adxResult = ADX.calculate({ high: highs, low: lows, close: closes, period: 14 });
  return adxResult[adxResult.length - 1];
}

// Sử dụng trong executeCycle
async executeCycle() {
  const adx = await getADXFromBinance(this.config.symbol);
  
  if (adx.adx < 25) {
    console.log(`[BOT] ⚠️ ADX = ${adx.adx.toFixed(2)} < 25, xu hướng yếu - bỏ qua chu kỳ này`);
    return; // Không mở lệnh
  }
  
  console.log(`[BOT] ✅ ADX = ${adx.adx.toFixed(2)} > 25, xu hướng mạnh - tiếp tục...`);
  // Tiếp tục logic mở lệnh...
}
```

## Lưu ý

- Binance API không cần authentication cho public endpoints
- Symbol trên Binance không có suffix `_UMCBL` (ví dụ: `XRPUSDT` thay vì `XRPUSDT_UMCBL`)
- Binance API có rate limit, nhưng với 1 request mỗi lần chạy thì không vấn đề
- Dữ liệu từ Binance có thể hơi khác so với Bitget, nhưng xu hướng tổng thể thường tương đồng

## Tài liệu tham khảo

- Binance API: https://binance-docs.github.io/apidocs/spot/en/#kline-candlestick-data
- Technical Indicators: https://www.npmjs.com/package/technicalindicators
- ADX Indicator: https://www.investopedia.com/terms/a/adx.asp

