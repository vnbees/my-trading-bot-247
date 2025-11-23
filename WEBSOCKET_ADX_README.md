# Hướng dẫn sử dụng ADX WebSocket Script

## Tình trạng hiện tại

Script `adx-websocket.js` đang gặp vấn đề với format WebSocket channel của Bitget. Bitget trả về lỗi `channel doesn't exist` cho tất cả các format đã thử.

## Vấn đề

Bitget WebSocket API có thể:
1. Không hỗ trợ candles channel cho futures contracts qua WebSocket
2. Cần format channel khác hoàn toàn
3. Cần authentication hoặc subscription đặc biệt

## Giải pháp thay thế

### Option 1: Sử dụng Binance WebSocket (Khuyến nghị)

Binance có WebSocket API ổn định và dễ sử dụng:

```bash
# Cài đặt thêm package nếu cần
npm install ws

# Chạy script với Binance
node adx-binance-ws.js --symbol=XRPUSDT --interval=5m
```

### Option 2: Lấy dữ liệu từ Binance REST API

Binance REST API hỗ trợ tốt cho việc lấy candles:

```bash
# Sử dụng script adx-binance.js
node adx-binance.js --symbol=XRPUSDT --interval=5m
```

### Option 3: Tích hợp ADX vào bot trading

Thay vì chạy script riêng, tích hợp ADX vào bot trading để:
- Tính ADX từ dữ liệu ticker có sẵn
- Sử dụng ADX để quyết định có mở lệnh hay không
- Lấy dữ liệu từ exchange khác (Binance) để tính ADX

## Cách sử dụng script hiện tại

Nếu Bitget WebSocket hoạt động trong tương lai:

```bash
# Chạy với symbol mặc định (BTCUSDT_UMCBL)
node adx-websocket.js

# Chạy với symbol khác
node adx-websocket.js --symbol=XRPUSDT_UMCBL

# Thay đổi interval
node adx-websocket.js --symbol=XRPUSDT_UMCBL --interval=15m

# Thay đổi ADX period
node adx-websocket.js --symbol=XRPUSDT_UMCBL --period=21
```

## Format WebSocket đã thử

Script đã thử các format sau (tất cả đều fail):
1. `mc/candle5m:XRPUSDT_UMCBL`
2. `candle5m_XRPUSDT_UMCBL`
3. `candle5m-XRPUSDT_UMCBL`
4. `candle5m.XRPUSDT_UMCBL`
5. Object format: `{instType: 'mc', channel: 'candle5m', instId: 'XRPUSDT_UMCBL'}`
6. `mix/candle5m:XRPUSDT_UMCBL`
7. `umcbl/candle5m:XRPUSDT_UMCBL`

## Lưu ý

- Script sẽ tự động thử tất cả các format
- Nếu tất cả format đều fail, script sẽ log lỗi và tiếp tục chạy
- Script có cơ chế auto-reconnect nếu WebSocket bị đóng
- Nhấn Ctrl+C để dừng script

## Tài liệu tham khảo

- Bitget WebSocket API: https://bitgetlimited.github.io/apidoc/en/mix/#websocket-api
- Binance WebSocket API: https://binance-docs.github.io/apidocs/spot/en/#websocket-market-streams

