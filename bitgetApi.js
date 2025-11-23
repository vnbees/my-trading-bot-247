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
    return this.request({
      method: 'GET',
      path: '/api/mix/v1/market/ticker',
      params: { symbol },
    });
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
    
    // Bitget API có vấn đề với endpoint candles cho futures
    // Thử endpoint mix/v1 trực tiếp với format đúng
    // Format: symbol, granularity (số giây), limit
    try {
      const params = {
        symbol,
        granularity: granularity.toString(),
        limit: limit.toString(),
      };
      
      // Không thêm productType vào params, có thể gây lỗi
      // Bitget API có thể tự detect từ symbol
      
      const result = await this.request({
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
      
      throw new Error(`Mix/v1 endpoint trả về dữ liệu không hợp lệ: ${JSON.stringify(result)}`);
    } catch (err) {
      // Nếu endpoint mix/v1 không hoạt động, thử endpoint public không cần auth
      console.warn(`[API] ⚠️ Endpoint mix/v1/candles thất bại với auth, thử endpoint public...`);
      
      const axios = require('axios');
      try {
        // Thử endpoint public không cần authentication
        const response = await axios.get(`${this.baseURL}/api/mix/v1/market/candles`, {
          params: {
            symbol,
            granularity: granularity.toString(),
            limit: limit.toString(),
          },
          timeout: 10000,
        });
        
        if (response.data && response.data.code === '00000' && Array.isArray(response.data.data)) {
          return response.data.data;
        } else if (Array.isArray(response.data)) {
          return response.data;
        } else if (response.data && response.data.data && Array.isArray(response.data.data)) {
          return response.data.data;
        }
        
        throw new Error(`Public endpoint trả về: ${JSON.stringify(response.data)}`);
      } catch (publicErr) {
        // Nếu cả 2 đều thất bại, có thể endpoint candles không tồn tại hoặc không hỗ trợ
        throw new Error(`Không thể lấy dữ liệu nến từ Bitget API. Endpoint mix/v1 (auth) lỗi: ${err.message}. Public endpoint lỗi: ${publicErr.response?.data?.msg || publicErr.message}. Có thể endpoint candles không hỗ trợ cho futures contracts hoặc cần format khác.`);
      }
    }
  }

  async getAccount(productType = 'umcbl', marginCoin = null) {
    const params = { productType: productType.toLowerCase() };
    if (marginCoin) {
      params.marginCoin = marginCoin;
    }
    const result = await this.request({
      method: 'GET',
      path: '/api/mix/v1/account/accounts',
      params,
    });
    
    // Nếu trả về array, tìm account với marginCoin phù hợp
    if (Array.isArray(result)) {
      if (marginCoin && result.length > 0) {
        const found = result.find((acc) => acc.marginCoin === marginCoin);
        if (found) return found;
      }
      return result[0] || {};
    }
    
    // Nếu trả về object trực tiếp
    return result || {};
  }

  async setLeverage({ symbol, marginCoin, leverage, holdSide = 'long', positionMode = 'fixed' }) {
    return this.request({
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

  async placeOrder({
    symbol,
    marginCoin,
    size,
    side,
    orderType = 'market',
    price,
    presetTakeProfitPrice,
    presetStopLossPrice,
  }) {
    // Xây dựng body, chỉ thêm TP/SL nếu có giá trị
    const body = {
      symbol,
      marginCoin,
      size: size.toString(),
      side,
      orderType,
      timeInForceValue: 'normal',
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
    
    console.log(`[API] Đặt lệnh: ${side} | Type: ${orderType} | Size: ${size} | Price: ${price || 'N/A'} | TP: ${presetTakeProfitPrice || 'N/A'} | SL: ${presetStopLossPrice || 'N/A'}`);
    
    return this.request({
      method: 'POST',
      path: '/api/mix/v1/order/placeOrder',
      body,
    });
  }

  async getPosition(symbol, marginCoin) {
    return this.request({
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
    return this.request({
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
    return this.request({
      method: 'GET',
      path: '/api/mix/v1/order/fills',
      params,
    });
  }

  /**
   * Lấy lịch sử lệnh (order history) cho symbol
   */
  async getOrderHistory(symbol, productType = 'umcbl', startTime = null, endTime = null, limit = 100) {
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
    return this.request({
      method: 'GET',
      path: '/api/mix/v1/order/history',
      params,
    });
  }

  async getContracts(productType = 'umcbl') {
    return this.request({
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
      return await this.request({
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

