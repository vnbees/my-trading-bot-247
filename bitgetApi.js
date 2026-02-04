const axios = require('axios');
const crypto = require('crypto');

/**
 * Minimal Bitget REST API client for Mix (USDT-M) contracts.
 * Reference: https://bitgetlimited.github.io/apidoc/en/mix/#rest-api
 */
class BitgetApi {
  constructor({ apiKey, apiSecret, passphrase = '', timeout = 10_000 }) {
    if (!apiKey || !apiSecret) {
      throw new Error('Bitget API key & secret are required');
    }
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.passphrase = passphrase;
    this.baseURL = 'https://api.bitget.com';
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout,
    });
    console.log(`[API] Khởi tạo Bitget API client (URL: ${this.baseURL})`);

    if (!passphrase) {
      console.warn('[API] ⚠️  Cảnh báo: Passphrase trống. Nếu API key của bạn yêu cầu passphrase, vui lòng thêm --passphrase=YOUR_PASSPHRASE');
    }
  }

  /**
   * Generates Bitget signature.
   */
  sign({ timestamp, method, requestPath, body }) {
    const payload = `${timestamp}${method.toUpperCase()}${requestPath}${body}`;
    return crypto.createHmac('sha256', this.apiSecret).update(payload).digest('base64');
  }

  /**
   * Helper để convert productType sang v2 format
   */
  convertProductTypeToV2(productType) {
    if (!productType) return 'USDT-FUTURES';
    const pt = productType.toLowerCase();
    if (pt === 'umcbl') return 'USDT-FUTURES';
    if (pt === 'cmcbl') return 'COIN-FUTURES';
    if (pt === 'dmcbl') return 'USDC-FUTURES';
    return 'USDT-FUTURES'; // fallback
  }

  /**
   * Helper để convert camelCase sang kebab-case
   * Ví dụ: setLeverage -> set-leverage, singlePosition -> single-position
   */
  camelToKebab(str) {
    return str.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  }

  /**
   * Helper để convert path từ v1 sang v2
   * v2 sử dụng kebab-case cho endpoint names
   * Mapping các endpoint đặc biệt:
   * - setLeverage -> set-leverage
   * - singlePosition -> single-position
   * - allPosition -> all-position
   * - placeOrder -> place-order
   * - closePosition -> close-position
   */
  convertPathToV2(v1Path) {
    // Convert /api/mix/v1/... to /api/v2/mix/...
    let v2Path = v1Path.replace('/api/mix/v1/', '/api/v2/mix/');
    
    // Mapping đặc biệt cho các endpoint đã biết
    const endpointMapping = {
      'setLeverage': 'set-leverage',
      'singlePosition': 'single-position',
      'allPosition': 'all-position',
      'placeOrder': 'place-order',
      'closePosition': 'close-position',
    };
    
    // Convert endpoint names từ camelCase sang kebab-case
    const pathParts = v2Path.split('/');
    const lastPart = pathParts[pathParts.length - 1];
    
    if (lastPart) {
      // Thử mapping đặc biệt trước
      if (endpointMapping[lastPart]) {
        pathParts[pathParts.length - 1] = endpointMapping[lastPart];
      } else if (/[a-z][A-Z]/.test(lastPart)) {
        // Có camelCase trong phần cuối, convert sang kebab-case
        pathParts[pathParts.length - 1] = this.camelToKebab(lastPart);
      }
      v2Path = pathParts.join('/');
    }
    
    return v2Path;
  }

  /**
   * Prepare parameters and body for v2 API requests
   */
  prepareV2Request({ method, path, params = {}, body = {} }) {
    const v2Path = this.convertPathToV2(path);
    const v2Params = { ...params };
    const v2Body = { ...body };
    
    // Convert productType trong params sang v2 format nếu có
    if (v2Params.productType) {
      v2Params.productType = this.convertProductTypeToV2(v2Params.productType);
    }
    
    // Với v2 GET requests, cần thêm productType nếu chưa có
    if (method.toUpperCase() === 'GET' && !v2Params.productType) {
      // Thử extract từ symbol
      if (v2Params.symbol) {
        const symbol = v2Params.symbol;
        if (symbol.includes('_UMCBL')) {
          v2Params.productType = 'USDT-FUTURES';
        } else if (symbol.includes('_CMCBL')) {
          v2Params.productType = 'COIN-FUTURES';
        } else if (symbol.includes('_DMCBL')) {
          v2Params.productType = 'USDC-FUTURES';
        } else {
          v2Params.productType = 'USDT-FUTURES'; // default
        }
      } else {
        v2Params.productType = 'USDT-FUTURES'; // default
      }
    }
    
    // Với v2 GET requests, convert symbol và marginCoin format
    if (method.toUpperCase() === 'GET') {
      // Convert symbol sang lowercase và remove suffix
      if (v2Params.symbol) {
        let cleanSymbol = v2Params.symbol;
        cleanSymbol = cleanSymbol.replace(/_[A-Z]+$/, ''); // Remove suffix
        v2Params.symbol = cleanSymbol.toLowerCase();
      }
      
      // Convert marginCoin sang uppercase
      if (v2Params.marginCoin) {
        v2Params.marginCoin = v2Params.marginCoin.toUpperCase();
      }
    }
    
    // Convert productType trong body sang v2 format nếu có
    if (v2Body.productType) {
      v2Body.productType = this.convertProductTypeToV2(v2Body.productType);
    }
    
    // Với v2 POST requests, thêm productType vào body nếu chưa có
    if (method.toUpperCase() === 'POST' && !v2Body.productType) {
      if (v2Params.productType) {
        v2Body.productType = v2Params.productType;
      } else if (body.symbol || params.symbol) {
        const symbol = body.symbol || params.symbol;
        if (symbol.includes('_UMCBL')) {
          v2Body.productType = 'USDT-FUTURES';
        } else if (symbol.includes('_CMCBL')) {
          v2Body.productType = 'COIN-FUTURES';
        } else if (symbol.includes('_DMCBL')) {
          v2Body.productType = 'USDC-FUTURES';
        } else {
          v2Body.productType = 'USDT-FUTURES';
        }
      } else {
        v2Body.productType = 'USDT-FUTURES';
      }
    }
    
    // Với v2, marginCoin phải được viết hoa
    if (v2Body.marginCoin) {
      v2Body.marginCoin = v2Body.marginCoin.toUpperCase();
    }
    
    // Với v2, symbol phải lowercase
    if (v2Body.symbol) {
      let cleanSymbol = v2Body.symbol;
      cleanSymbol = cleanSymbol.replace(/_[A-Z]+$/, ''); // Remove suffix
      v2Body.symbol = cleanSymbol.toLowerCase();
    }
    
    // Với v2, convert side format từ v1 sang v2
    // v1: open_long, open_short, close_long, close_short
    // v2: side (buy/sell) + tradeSide (open/close)
    if (v2Body.side) {
      const sideV1 = v2Body.side;
      if (sideV1 === 'open_long' || sideV1 === 'close_long') {
        v2Body.side = 'buy';
        v2Body.tradeSide = sideV1.startsWith('open') ? 'open' : 'close';
      } else if (sideV1 === 'open_short' || sideV1 === 'close_short') {
        v2Body.side = 'sell';
        v2Body.tradeSide = sideV1.startsWith('open') ? 'open' : 'close';
      }
    }
    
    // Với v2 place-order, marginMode sẽ được set từ placeOrder() function
    // Không cần set default ở đây nữa
    
    // Convert parameter names
    if (v2Body.presetTakeProfitPrice && !v2Body.presetStopSurplusPrice) {
      v2Body.presetStopSurplusPrice = v2Body.presetTakeProfitPrice;
      delete v2Body.presetTakeProfitPrice;
    }
    
    if (v2Body.timeInForceValue && !v2Body.force) {
      v2Body.force = v2Body.timeInForceValue === 'normal' ? 'gtc' : v2Body.timeInForceValue;
      delete v2Body.timeInForceValue;
    }
    
    return { path: v2Path, params: v2Params, body: v2Body };
  }

  /**
   * Request v2 API only (no v1 fallback)
   */
  async requestV2({ method = 'GET', path, params = {}, body = {} }) {
    const { path: v2Path, params: v2Params, body: v2Body } = this.prepareV2Request({ method, path, params, body });
    return await this.request({ method, path: v2Path, params: v2Params, body: v2Body });
  }

  /**
   * Public/private request helper.
   */
  async request({ method = 'GET', path, params = {}, body = {} }) {
    const isGet = method.toUpperCase() === 'GET';
    const payload = isGet ? '' : JSON.stringify(body);
    const timestamp = (Date.now() / 1000).toFixed(3);
    // Lọc bỏ params rỗng hoặc undefined
    const cleanParams = {};
    if (params) {
      Object.keys(params).forEach(key => {
        if (params[key] !== undefined && params[key] !== null && params[key] !== '') {
          cleanParams[key] = params[key];
        }
      });
    }
    const requestPath = Object.keys(cleanParams).length
      ? `${path}?${new URLSearchParams(cleanParams).toString()}`
      : path;

    const headers = {
      'ACCESS-KEY': this.apiKey,
      'ACCESS-PASSPHRASE': this.passphrase,
      'ACCESS-TIMESTAMP': timestamp,
      'ACCESS-SIGN': this.sign({ timestamp, method, requestPath, body: payload }),
      'Content-Type': 'application/json',
      'X-CHANNEL-API': 'cursor-bot',
    };

    try {
      const response = await this.client.request({
        method,
        url: requestPath,
        data: isGet ? undefined : body,
        headers,
      });
      if (response.data && response.data.code !== '00000') {
        throw new Error(`Bitget error ${response.data.code}: ${response.data.msg || 'Unknown'}`);
      }
      return response.data.data;
    } catch (err) {
      if (err.response) {
        // Lỗi từ API
        const errorMsg = err.response.data?.msg || err.message;
        const errorCode = err.response.data?.code || err.response.status;
        
        // Xử lý lỗi cụ thể về authentication
        if (errorCode === '40012' || errorCode === 40012) {
          const hint = !this.passphrase 
            ? '\n💡 Gợi ý: API key của bạn có thể yêu cầu passphrase. Thử thêm --passphrase=YOUR_PASSPHRASE vào lệnh.'
            : '\n💡 Gợi ý: Kiểm tra lại passphrase, API key và secret key có đúng không.';
          throw new Error(`Bitget API error [${errorCode}]: ${errorMsg}${hint}`);
        }
        
        // V1 API đã bị loại bỏ, chỉ dùng v2
        
        throw new Error(`Bitget API error [${errorCode}]: ${errorMsg}`);
      } else if (err.request) {
        // Không nhận được response (network error)
        throw new Error(`Không thể kết nối đến Bitget API: ${err.message}`);
      } else {
        // Lỗi khác
        throw new Error(`Lỗi request: ${err.message}`);
      }
    }
  }

  async getTicker(symbol) {
    return this.requestV2({
      method: 'GET',
      path: '/api/mix/v1/market/ticker',
      params: { symbol },
    });
  }

  /**
   * Lấy dữ liệu nến spot (candles/kline) từ Bitget Spot API
   * @param {string} symbol - Symbol spot (ví dụ: BTCUSDT, PAXGUSDT)
   * @param {string|number} granularity - Granularity (300 = 5 phút, 900 = 15 phút, 14400 = 4H, ...) hoặc string ("4h", "1min", ...)
   * @param {number} limit - Số nến cần lấy (mặc định 200)
   * @returns {Promise<Array>} - Mảng các nến [timestamp, open, high, low, close, volume]
   */
  async getSpotCandles(symbol, granularity = 300, limit = 200) {
    // Chuyển đổi granularity từ số giây sang format string mà Spot API yêu cầu
    // Format yêu cầu: 1min,3min,5min,15min,30min,1h,4h,6h,12h,1day,1week,1M
    let granularityStr;
    if (typeof granularity === 'string') {
      // Nếu đã là string, giữ nguyên (nhưng validate)
      granularityStr = granularity;
    } else {
      // Convert từ số giây sang string format
      const granularityMap = {
        60: '1min',
        180: '3min',
        300: '5min',
        900: '15min',
        1800: '30min',
        3600: '1h',
        14400: '4h',
        21600: '6h',
        43200: '12h',
        86400: '1day',
        604800: '1week',
        2592000: '1M',
      };
      granularityStr = granularityMap[granularity] || granularity.toString();
    }

    const params = {
      symbol: symbol.toUpperCase(),
      granularity: granularityStr,
      limit: limit.toString(),
    };

    // Spot API v2 là public endpoint, không cần authentication
    // Thử endpoint v2 trước, nếu không được thì thử các endpoint khác
    const endpoints = [
      '/api/v2/spot/market/candles',      // Format v2 chuẩn (giống mix API)
      '/api/v2/spot/public/candles',      // Format v2 với public prefix
      '/api/spot/v2/market/candles',       // Format v2 với spot prefix trước
      '/api/spot/v1/market/candles',       // fallback (sẽ fail nhưng để thử)
    ];

    let lastError = null;
    for (const endpoint of endpoints) {
      try {
        const response = await this.client.request({
          method: 'GET',
          url: endpoint,
          params,
        });

        if (response.data && response.data.code && response.data.code !== '00000') {
          // Nếu là lỗi v1 deprecated, tiếp tục thử endpoint khác
          if (response.data.code === '30032' || response.data.msg?.includes('decommissioned')) {
            lastError = new Error(`Bitget Spot API error ${response.data.code}: ${response.data.msg || 'Unknown'}`);
            continue;
          }
          throw new Error(`Bitget Spot API error ${response.data.code}: ${response.data.msg || 'Unknown'}`);
        }

        // Bitget trả về array hoặc object với data
        if (Array.isArray(response.data)) {
          return response.data;
        } else if (response.data && Array.isArray(response.data.data)) {
          return response.data.data;
        } else if (response.data && response.data.code === '00000' && Array.isArray(response.data.data)) {
          return response.data.data;
        }

        throw new Error(`Spot API trả về dữ liệu không hợp lệ: ${JSON.stringify(response.data)}`);
      } catch (err) {
        if (err.response) {
          const errorMsg = err.response.data?.msg || err.message;
          const errorCode = err.response.data?.code || err.response.status;
          
          // Nếu là lỗi v1 deprecated, tiếp tục thử endpoint khác
          if (errorCode === '30032' || errorMsg?.includes('decommissioned')) {
            lastError = new Error(`Bitget Spot API error [${errorCode}]: ${errorMsg}`);
            continue;
          }
          
          // Nếu không phải lỗi deprecated, throw ngay
          throw new Error(`Bitget Spot API error [${errorCode}]: ${errorMsg}`);
        } else if (err.request) {
          lastError = new Error(`Không thể kết nối đến Bitget Spot API: ${err.message}`);
          continue;
        } else {
          lastError = new Error(`Lỗi request: ${err.message}`);
          continue;
        }
      }
    }
    
    // Nếu tất cả endpoints đều fail, throw lỗi cuối cùng
    if (lastError) {
      throw lastError;
    }
    
    throw new Error('Không thể lấy dữ liệu từ bất kỳ endpoint nào');
  }

  /**
   * Lấy thông tin tài sản spot từ Bitget Spot API
   * @returns {Promise<Array>} - Mảng các asset với thông tin coin, available, frozen, total
   */
  async getSpotAssets() {
    // Spot Assets API là private endpoint, cần authentication
    const endpoints = [
      '/api/spot/v1/account/assets',
      '/api/v2/spot/account/assets',
    ];

    let lastError = null;
    for (const endpoint of endpoints) {
      try {
        const response = await this.request({
          method: 'GET',
          path: endpoint,
          params: {},
          body: {},
        });

        // Bitget trả về array hoặc object với data
        if (Array.isArray(response)) {
          return response;
        } else if (response && Array.isArray(response.data)) {
          return response.data;
        } else if (response && response.code === '00000' && Array.isArray(response.data)) {
          return response.data;
        }

        throw new Error(`Spot Assets API trả về dữ liệu không hợp lệ: ${JSON.stringify(response)}`);
      } catch (err) {
        if (err.response) {
          const errorMsg = err.response.data?.msg || err.message;
          const errorCode = err.response.data?.code || err.response.status;
          
          // Nếu là lỗi v1 deprecated, tiếp tục thử endpoint khác
          if (errorCode === '30032' || errorMsg?.includes('decommissioned')) {
            lastError = new Error(`Bitget Spot Assets API error [${errorCode}]: ${errorMsg}`);
            continue;
          }
          
          // Nếu không phải lỗi deprecated, throw ngay
          throw new Error(`Bitget Spot Assets API error [${errorCode}]: ${errorMsg}`);
        } else if (err.request) {
          lastError = new Error(`Không thể kết nối đến Bitget Spot Assets API: ${err.message}`);
          continue;
        } else {
          lastError = new Error(`Lỗi request: ${err.message}`);
          continue;
        }
      }
    }
    
    // Nếu tất cả endpoints đều fail, throw lỗi cuối cùng
    if (lastError) {
      throw lastError;
    }
    
    throw new Error('Không thể lấy dữ liệu từ bất kỳ endpoint nào');
  }

  /**
   * Lấy giá ticker spot từ Bitget Spot API
   * @param {string} symbol - Symbol spot (ví dụ: BTCUSDT, PAXGUSDT)
   * @returns {Promise<Object>} - Thông tin ticker với giá last, bestAsk, bestBid
   */
  async getSpotTicker(symbol) {
    const params = {
      symbol: symbol.toUpperCase(),
    };

    // Spot Ticker API là public endpoint, không cần authentication
    const endpoints = [
      '/api/v2/spot/market/ticker',      // Format v2 chuẩn (giống candles)
      '/api/spot/v1/market/ticker',      // Format v1
      '/api/v2/spot/public/ticker',      // Format v2 với public prefix
    ];

    let lastError = null;
    for (const endpoint of endpoints) {
      try {
        const response = await this.client.request({
          method: 'GET',
          url: endpoint,
          params,
        });

        if (response.data && response.data.code && response.data.code !== '00000') {
          // Nếu là lỗi deprecated hoặc not found, tiếp tục thử endpoint khác
          if (response.data.code === '30032' || response.data.code === '40404' || 
              response.data.msg?.includes('decommissioned') || response.data.msg?.includes('NOT FOUND')) {
            lastError = new Error(`Bitget Spot Ticker API error ${response.data.code}: ${response.data.msg || 'Unknown'}`);
            continue;
          }
          throw new Error(`Bitget Spot Ticker API error ${response.data.code}: ${response.data.msg || 'Unknown'}`);
        }

        // Bitget trả về object với data
        if (response.data && response.data.data) {
          return response.data.data;
        } else if (response.data && !response.data.code) {
          return response.data;
        }

        throw new Error(`Spot Ticker API trả về dữ liệu không hợp lệ: ${JSON.stringify(response.data)}`);
      } catch (err) {
        if (err.response) {
          const errorMsg = err.response.data?.msg || err.message;
          const errorCode = err.response.data?.code || err.response.status;
          
          // Nếu là lỗi deprecated hoặc not found, tiếp tục thử endpoint khác
          if (errorCode === '30032' || errorCode === '40404' || 
              errorMsg?.includes('decommissioned') || errorMsg?.includes('NOT FOUND')) {
            lastError = new Error(`Bitget Spot Ticker API error [${errorCode}]: ${errorMsg}`);
            continue;
          }
          
          throw new Error(`Bitget Spot Ticker API error [${errorCode}]: ${errorMsg}`);
        } else if (err.request) {
          lastError = new Error(`Không thể kết nối đến Bitget Spot Ticker API: ${err.message}`);
          continue;
        } else {
          lastError = new Error(`Lỗi request: ${err.message}`);
          continue;
        }
      }
    }
    
    if (lastError) {
      throw lastError;
    }
    
    throw new Error('Không thể lấy dữ liệu từ bất kỳ endpoint nào');
  }

  /**
   * Đặt lệnh spot từ Bitget Spot API
   * @param {Object} params - Tham số lệnh
   * @param {string} params.symbol - Symbol spot (ví dụ: BTCUSDT, PAXGUSDT)
   * @param {string} params.side - "buy" hoặc "sell"
   * @param {string} params.orderType - "market" hoặc "limit"
   * @param {string|number} params.size - Số lượng (cho market: coin cho sell, USDT cho buy)
   * @param {string|number} [params.price] - Giá (chỉ cho limit order)
   * @param {string} [params.clientOid] - Optional unique order ID
   * @returns {Promise<Object>} - Kết quả đặt lệnh
   */
  async placeSpotOrder({ symbol, side, orderType = 'market', size, price, clientOid }) {
    if (!symbol || !side || !size) {
      throw new Error('symbol, side và size là bắt buộc');
    }

    const body = {
      symbol: symbol.toUpperCase(),
      side: side.toLowerCase(), // "buy" hoặc "sell"
      orderType: orderType.toLowerCase(), // "market" hoặc "limit"
      size: size.toString(),
    };

    // Thêm price nếu là limit order
    if (orderType.toLowerCase() === 'limit') {
      if (!price || Number(price) <= 0) {
        throw new Error('Price is required for limit orders');
      }
      body.price = price.toString();
    }

    // Thêm clientOid nếu có
    if (clientOid) {
      body.clientOid = clientOid;
    }

    // Spot Order API là private endpoint, cần authentication
    const endpoints = [
      '/api/spot/v1/trade/orders',
      '/api/v2/spot/trade/place-order',
    ];

    let lastError = null;
    for (const endpoint of endpoints) {
      try {
        const response = await this.request({
          method: 'POST',
          path: endpoint,
          params: {},
          body,
        });

        // Bitget trả về object với thông tin lệnh
        if (response && response.orderId) {
          return response;
        } else if (response && response.data && response.data.orderId) {
          return response.data;
        } else if (response && response.code === '00000') {
          return response.data || response;
        }

        throw new Error(`Spot Order API trả về dữ liệu không hợp lệ: ${JSON.stringify(response)}`);
      } catch (err) {
        if (err.response) {
          const errorMsg = err.response.data?.msg || err.message;
          const errorCode = err.response.data?.code || err.response.status;
          
          // Nếu là lỗi deprecated hoặc not found, tiếp tục thử endpoint khác
          if (errorCode === '30032' || errorCode === '40404' || 
              errorMsg?.includes('decommissioned') || errorMsg?.includes('NOT FOUND')) {
            lastError = new Error(`Bitget Spot Order API error [${errorCode}]: ${errorMsg}`);
            continue;
          }
          
          // Nếu không phải lỗi deprecated, throw ngay
          throw new Error(`Bitget Spot Order API error [${errorCode}]: ${errorMsg}`);
        } else if (err.request) {
          lastError = new Error(`Không thể kết nối đến Bitget Spot Order API: ${err.message}`);
          continue;
        } else {
          lastError = new Error(`Lỗi request: ${err.message}`);
          continue;
        }
      }
    }
    
    // Nếu tất cả endpoints đều fail, throw lỗi cuối cùng
    if (lastError) {
      throw lastError;
    }
    
    throw new Error('Không thể đặt lệnh từ bất kỳ endpoint nào');
  }

  /**
   * Lấy lịch sử lệnh spot từ Bitget Spot API
   * @param {string} [symbol] - Symbol spot (ví dụ: BTCUSDT, PAXGUSDT) - optional
   * @param {number} [limit=20] - Số lượng lệnh (mặc định 20, tối đa 100)
   * @param {number} [startTime] - Timestamp bắt đầu (optional)
   * @param {number} [endTime] - Timestamp kết thúc (optional)
   * @returns {Promise<Array>} - Mảng các lệnh
   */
  async getSpotOrderHistory(symbol = null, limit = 20, startTime = null, endTime = null) {
    const params = {
      limit: Math.min(limit || 20, 100).toString(),
    };

    if (symbol) {
      params.symbol = symbol.toUpperCase();
    }

    if (startTime) {
      params.startTime = startTime.toString();
    }

    if (endTime) {
      params.endTime = endTime.toString();
    }

    // Spot Order History API là private endpoint, cần authentication
    const endpoints = [
      '/api/spot/v1/trade/orderHistory',
      '/api/v2/spot/trade/order-history',
    ];

    let lastError = null;
    for (const endpoint of endpoints) {
      try {
        const response = await this.request({
          method: 'GET',
          path: endpoint,
          params,
          body: {},
        });

        // Bitget trả về array hoặc object với data
        if (Array.isArray(response)) {
          return response;
        } else if (response && Array.isArray(response.data)) {
          return response.data;
        } else if (response && response.code === '00000' && Array.isArray(response.data)) {
          return response.data;
        }

        throw new Error(`Spot Order History API trả về dữ liệu không hợp lệ: ${JSON.stringify(response)}`);
      } catch (err) {
        if (err.response) {
          const errorMsg = err.response.data?.msg || err.message;
          const errorCode = err.response.data?.code || err.response.status;
          
          // Nếu là lỗi deprecated hoặc not found, tiếp tục thử endpoint khác
          if (errorCode === '30032' || errorCode === '40404' || 
              errorMsg?.includes('decommissioned') || errorMsg?.includes('NOT FOUND')) {
            lastError = new Error(`Bitget Spot Order History API error [${errorCode}]: ${errorMsg}`);
            continue;
          }
          
          // Nếu không phải lỗi deprecated, throw ngay
          throw new Error(`Bitget Spot Order History API error [${errorCode}]: ${errorMsg}`);
        } else if (err.request) {
          lastError = new Error(`Không thể kết nối đến Bitget Spot Order History API: ${err.message}`);
          continue;
        } else {
          lastError = new Error(`Lỗi request: ${err.message}`);
          continue;
        }
      }
    }
    
    // Nếu tất cả endpoints đều fail, throw lỗi cuối cùng
    if (lastError) {
      throw lastError;
    }
    
    throw new Error('Không thể lấy lịch sử lệnh từ bất kỳ endpoint nào');
  }

  /**
   * Lấy lịch sử lệnh đã fill spot từ Bitget Spot API
   * @param {string} [symbol] - Symbol spot (ví dụ: BTCUSDT, PAXGUSDT) - optional
   * @param {number} [limit=20] - Số lượng lệnh (mặc định 20, tối đa 100)
   * @param {number} [startTime] - Timestamp bắt đầu (optional)
   * @param {number} [endTime] - Timestamp kết thúc (optional)
   * @returns {Promise<Array>} - Mảng các lệnh đã fill
   */
  async getSpotFills(symbol = null, limit = 20, startTime = null, endTime = null) {
    const params = {
      limit: Math.min(limit || 20, 100).toString(),
    };

    if (symbol) {
      params.symbol = symbol.toUpperCase();
    }

    if (startTime) {
      params.startTime = startTime.toString();
    }

    if (endTime) {
      params.endTime = endTime.toString();
    }

    // Spot Fills API là private endpoint, cần authentication
    const endpoints = [
      '/api/spot/v1/trade/fills',
      '/api/v2/spot/trade/fills',
    ];

    let lastError = null;
    for (const endpoint of endpoints) {
      try {
        const response = await this.request({
          method: 'GET',
          path: endpoint,
          params,
          body: {},
        });

        // Bitget trả về array hoặc object với data
        if (Array.isArray(response)) {
          return response;
        } else if (response && Array.isArray(response.data)) {
          return response.data;
        } else if (response && response.code === '00000' && Array.isArray(response.data)) {
          return response.data;
        }

        throw new Error(`Spot Fills API trả về dữ liệu không hợp lệ: ${JSON.stringify(response)}`);
      } catch (err) {
        if (err.response) {
          const errorMsg = err.response.data?.msg || err.message;
          const errorCode = err.response.data?.code || err.response.status;
          
          // Nếu là lỗi deprecated hoặc not found, tiếp tục thử endpoint khác
          if (errorCode === '30032' || errorCode === '40404' || 
              errorMsg?.includes('decommissioned') || errorMsg?.includes('NOT FOUND')) {
            lastError = new Error(`Bitget Spot Fills API error [${errorCode}]: ${errorMsg}`);
            continue;
          }
          
          // Nếu không phải lỗi deprecated, throw ngay
          throw new Error(`Bitget Spot Fills API error [${errorCode}]: ${errorMsg}`);
        } else if (err.request) {
          lastError = new Error(`Không thể kết nối đến Bitget Spot Fills API: ${err.message}`);
          continue;
        } else {
          lastError = new Error(`Lỗi request: ${err.message}`);
          continue;
        }
      }
    }
    
    // Nếu tất cả endpoints đều fail, throw lỗi cuối cùng
    if (lastError) {
      throw lastError;
    }
    
    throw new Error('Không thể lấy lịch sử fills từ bất kỳ endpoint nào');
  }

  /**
   * Lấy dữ liệu nến (candles/kline) từ Bitget
   * @param {string} symbol - Symbol (ví dụ: BTCUSDT_UMCBL)
   * @param {string|number} granularity - Granularity (300 = 5 phút, 900 = 15 phút, ...)
   * @param {number} limit - Số nến cần lấy (mặc định 200)
   * @returns {Promise<Array>} - Mảng các nến
   */
  async getCandles(symbol, granularity = 300, limit = 200) {
    // Chuyển đổi granularity sang interval format (5m, 15m, ...)
    const intervalMap = {
      60: '1m',
      180: '3m',
      300: '5m',
      900: '15m',
      1800: '30m',
      3600: '1H',
      14400: '4H',
      21600: '6H',
      43200: '12H',
      86400: '1D',
    };
    const interval = intervalMap[granularity] || '5m';
    
    // V2 API only
    const params = {
      symbol,
      granularity: granularity.toString(),
      limit: limit.toString(),
    };
    
    const result = await this.requestV2({
      method: 'GET',
      path: '/api/mix/v1/market/candles',
      params,
    });
    
    // Bitget trả về array hoặc object với data
    if (Array.isArray(result)) {
      return result;
    } else if (result && Array.isArray(result.data)) {
      return result.data;
    } else if (result && result.code === '00000' && Array.isArray(result.data)) {
      return result.data;
    }
    
    throw new Error(`V2 endpoint trả về dữ liệu không hợp lệ: ${JSON.stringify(result)}`);
  }

  async getAccount(productType = 'umcbl', marginCoin = null, symbol = null) {
    // V2 API only
    const v2ProductType = this.convertProductTypeToV2(productType);
    
    // Build params for v2
    const params = { productType: v2ProductType };
    if (marginCoin) {
      params.marginCoin = marginCoin.toUpperCase();
    }
    
    // Use v2 endpoint
    let result = await this.requestV2({
      method: 'GET',
      path: '/api/mix/v1/account/accounts', // Will be converted to v2
      params,
    });
    
    // Nếu trả về array, tìm account với marginCoin phù hợp
    if (Array.isArray(result)) {
      if (marginCoin && result.length > 0) {
        const found = result.find((acc) => acc.marginCoin === marginCoin.toUpperCase());
        if (found) return found;
      }
      return result[0] || {};
    }
    
    // Nếu trả về object trực tiếp
    return result || {};
  }

  async setLeverage({ symbol, marginCoin, leverage, holdSide = 'long', positionMode = 'fixed' }) {
    return this.requestV2({
      method: 'POST',
      path: '/api/mix/v1/account/setLeverage',
      body: {
        symbol,
        marginCoin,
        leverage: leverage.toString(),
        holdSide,
        positionMode,
      },
    });
  }

  async setMarginMode({ symbol, marginCoin, marginMode = 'crossed' }) {
    return this.requestV2({
      method: 'POST',
      path: '/api/mix/v1/account/setMarginMode',
      body: {
        symbol,
        marginCoin,
        marginMode, // "crossed" hoặc "isolated"
      },
    });
  }

  async placeOrder({
    symbol,
    marginCoin,
    size,
    side,
    orderType = 'market',
    price,
    presetTakeProfitPrice,
    presetStopLossPrice,
    marginMode = 'crossed', // Sử dụng "crossed" đúng theo API Bitget
  }) {
    // Xây dựng body, chỉ thêm TP/SL nếu có giá trị
    const body = {
      symbol,
      marginCoin,
      size: size.toString(),
      side,
      orderType,
      timeInForceValue: 'normal',
      marginMode: marginMode, // Set margin mode từ param
    };
    
    // Thêm price nếu là limit order
    if (orderType === 'limit') {
      if (!price || Number(price) <= 0) {
        throw new Error('Price is required for limit orders');
      }
      body.price = price.toString();
    }
    
    // Chỉ thêm TP/SL nếu có giá trị hợp lệ
    if (presetTakeProfitPrice && Number(presetTakeProfitPrice) > 0) {
      body.presetTakeProfitPrice = presetTakeProfitPrice.toString();
    }
    if (presetStopLossPrice && Number(presetStopLossPrice) > 0) {
      body.presetStopLossPrice = presetStopLossPrice.toString();
    }
    
    console.log(`[API] Đặt lệnh: ${side} | Type: ${orderType} | Size: ${size} | Margin: ${marginMode.toUpperCase()} | Price: ${price || 'N/A'} | TP: ${presetTakeProfitPrice || 'N/A'} | SL: ${presetStopLossPrice || 'N/A'}`);
    
    return await this.requestV2({
      method: 'POST',
      path: '/api/mix/v1/order/placeOrder',
      body,
    });
  }

  async getPosition(symbol, marginCoin) {
    return this.requestV2({
      method: 'GET',
      path: '/api/mix/v1/position/singlePosition',
      params: { symbol, marginCoin },
    });
  }

  /**
   * Lấy tất cả positions cho symbol
   */
  async getAllPositions(productType = 'umcbl', marginCoin = null) {
    const params = { productType: productType.toLowerCase() };
    if (marginCoin) {
      params.marginCoin = marginCoin;
    }
    return this.requestV2({
      method: 'GET',
      path: '/api/mix/v1/position/allPosition',
      params,
    });
  }

  /**
   * Lấy lịch sử lệnh đã fill (filled orders) cho symbol
   */
  async getFills(symbol, productType = 'umcbl', startTime = null, endTime = null, limit = 100) {
    const params = {
      symbol,
      productType: productType.toLowerCase(),
      limit,
    };
    if (startTime) {
      params.startTime = startTime;
    }
    if (endTime) {
      params.endTime = endTime;
    }
    return this.requestV2({
      method: 'GET',
      path: '/api/mix/v1/order/fills',
      params,
    });
  }

  /**
   * Lấy lịch sử lệnh (order history) cho symbol (Futures/Mix)
   *
   * Lưu ý:
   * - Một số cụm Bitget đã bỏ /api/v2/mix/order/history (trả về 40404)
   * - Để ổn định hơn, ưu tiên dùng unified endpoint /api/v3/trade/history-orders
   *   với category=USDT-FUTURES/COIN-FUTURES/USDC-FUTURES.
   */
  async getOrderHistory(symbol, productType = 'umcbl', startTime = null, endTime = null, limit = 100) {
    // Ưu tiên unified futures history: /api/v3/trade/history-orders
    // Tham khảo: Bitget UTA Trade → Get Order History
    const category = this.convertProductTypeToV2(productType); // USDT-FUTURES, COIN-FUTURES, ...

    const params = {
      category,          // bắt buộc
      limit: Math.min(limit || 100, 100),
    };

    // unified endpoint không luôn yêu cầu symbol, nhưng nếu có thì truyền dạng không suffix
    if (symbol) {
      let cleanSymbol = symbol.replace(/_[A-Z]+$/, '');
      params.symbol = cleanSymbol.toUpperCase();
    }

    if (startTime) {
      params.startTime = startTime;
    }
    if (endTime) {
      params.endTime = endTime;
    }

    return this.request({
      method: 'GET',
      path: '/api/v3/trade/history-orders',
      params,
      body: {},
    });
  }

  async getContracts(productType = 'umcbl') {
    return this.requestV2({
      method: 'GET',
      path: '/api/mix/v1/market/contracts',
      params: { productType },
    });
  }

  async getContract(symbol, productType = 'umcbl') {
    // Thử nhiều productType nếu không tìm thấy
    const productTypes = [productType, 'umcbl', 'cmcbl', 'dmcbl'];
    for (const pt of productTypes) {
      try {
        const contracts = await this.getContracts(pt);
        if (Array.isArray(contracts)) {
          const found = contracts.find((item) => item.symbol === symbol);
          if (found) return found;
        }
      } catch (err) {
        // Tiếp tục thử productType khác
        continue;
      }
    }
    return null;
  }

  async listAvailableContracts(productType = 'umcbl', filter = '') {
    try {
      const contracts = await this.getContracts(productType);
      if (!Array.isArray(contracts)) return [];
      if (filter) {
        return contracts.filter((c) => 
          c.symbol?.toLowerCase().includes(filter.toLowerCase())
        );
      }
      return contracts;
    } catch (err) {
      console.warn(`[API] Không thể list contracts: ${err.message}`);
      return [];
    }
  }

  async closePosition({ symbol, marginCoin, holdSide, size }) {
    // Thử dùng endpoint closePosition trước
    try {
      return await this.requestV2({
        method: 'POST',
        path: '/api/mix/v1/order/closePosition',
        body: {
          symbol,
          marginCoin,
          holdSide,
          size: size ? size.toString() : undefined,
        },
      });
    } catch (err) {
      // Nếu lỗi 40404, thử dùng placeOrder với side close
      if (err.message.includes('40404') || err.message.includes('NOT FOUND')) {
        const closeSide = holdSide === 'long' ? 'close_long' : 'close_short';
        return await this.placeOrder({
          symbol,
          marginCoin,
          size,
          side: closeSide,
          orderType: 'market',
        });
      }
      throw err;
    }
  }
}

module.exports = { BitgetApi };

