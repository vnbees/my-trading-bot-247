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
   * Helper để tự động migrate endpoint từ v1 sang v2 khi cần
   */
  async requestWithV2Fallback({ method = 'GET', path, params = {}, body = {} }) {
    try {
      // Thử v1 trước
      return await this.request({ method, path, params, body });
    } catch (err) {
      // Nếu v1 bị decommissioned, thử v2
      if (err.isDecommissioned || (err.message && (err.message.includes('decommissioned') || err.message.includes('30032')))) {
        console.warn(`[API] ⚠️ V1 endpoint ${path} decommissioned, migrating to v2...`);
        
        // Convert path sang v2
        const v2Path = this.convertPathToV2(path);
        
        // Convert productType trong params sang v2 format nếu có
        const v2Params = { ...params };
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
        
        // Convert productType trong body sang v2 format nếu có (một số endpoint v2 dùng body)
        const v2Body = { ...body };
        if (v2Body.productType) {
          v2Body.productType = this.convertProductTypeToV2(v2Body.productType);
        }
        
        // Với v2, một số endpoint cần productType trong body thay vì params
        // Thêm productType vào body nếu method là POST và chưa có trong body
        if (method.toUpperCase() === 'POST' && v2Params.productType && !v2Body.productType) {
          v2Body.productType = v2Params.productType;
        }
        
        // Một số endpoint v2 (như setLeverage, placeOrder) yêu cầu productType trong body
        // Nếu chưa có productType, thử extract từ symbol hoặc default
        if (method.toUpperCase() === 'POST' && !v2Body.productType && body.symbol) {
          // Extract productType từ symbol format: SYMBOL_UMCBL, SYMBOL_CMCBL, SYMBOL_DMCBL
          const symbol = body.symbol;
          if (symbol.includes('_UMCBL')) {
            v2Body.productType = 'USDT-FUTURES';
          } else if (symbol.includes('_CMCBL')) {
            v2Body.productType = 'COIN-FUTURES';
          } else if (symbol.includes('_DMCBL')) {
            v2Body.productType = 'USDC-FUTURES';
          } else {
            // Default to USDT-FUTURES nếu không detect được
            v2Body.productType = 'USDT-FUTURES';
          }
        }
        
        // Với v2, marginCoin phải được viết hoa
        if (v2Body.marginCoin) {
          v2Body.marginCoin = v2Body.marginCoin.toUpperCase();
        }
        
        // Với v2, symbol phải lowercase
        if (v2Body.symbol) {
          // Remove suffix như _UMCBL, _CMCBL, _DMCBL để lấy symbol gốc
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
          // Nếu đã là format v2 (buy/sell), giữ nguyên
        }
        
        // Với v2 place-order, cần thêm marginMode nếu chưa có
        if (v2Path.includes('/order/place-order') && !v2Body.marginMode) {
          // Default to isolated margin mode
          v2Body.marginMode = 'isolated';
        }
        
        // Với v2, một số parameter names khác:
        // presetTakeProfitPrice -> presetStopSurplusPrice
        if (v2Body.presetTakeProfitPrice && !v2Body.presetStopSurplusPrice) {
          v2Body.presetStopSurplusPrice = v2Body.presetTakeProfitPrice;
          delete v2Body.presetTakeProfitPrice;
        }
        
        // presetStopLossPrice giữ nguyên trong v2
        // timeInForceValue -> force (với giá trị khác: normal -> gtc)
        if (v2Body.timeInForceValue && !v2Body.force) {
          if (v2Body.timeInForceValue === 'normal') {
            v2Body.force = 'gtc';
          } else {
            v2Body.force = v2Body.timeInForceValue;
          }
          delete v2Body.timeInForceValue;
        }
        
        // Thử v2
        try {
          return await this.request({ method, path: v2Path, params: v2Params, body: v2Body });
        } catch (v2Err) {
          console.error(`[API] ❌ V2 endpoint ${v2Path} also failed: ${v2Err.message}`);
          throw v2Err;
        }
      }
      throw err;
    }
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
        
        // Xử lý lỗi V1 API decommissioned (30032)
        // Note: Error này sẽ được catch bởi requestWithV2Fallback nếu có
        if (errorCode === '30032' || errorCode === 30032 || (errorMsg && errorMsg.includes('decommissioned'))) {
          const error = new Error(`Bitget API v1 has been decommissioned for endpoint: ${path}. Error: ${errorMsg}`);
          error.isDecommissioned = true; // Flag để requestWithV2Fallback biết
          error.v1Path = path;
          throw error;
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

  async getAccount(productType = 'umcbl', marginCoin = null, symbol = null) {
    // API V2 format:
    // - Path: /api/v2/mix/account/accounts (instead of /api/mix/v1/account/accounts)
    // - productType must be uppercase: USDT-FUTURES, COIN-FUTURES, USDC-FUTURES
    // - umcbl maps to USDT-FUTURES
    
    // Convert productType to v2 format
    let v2ProductType = 'USDT-FUTURES'; // default
    if (productType) {
      const pt = productType.toLowerCase();
      if (pt === 'umcbl') {
        v2ProductType = 'USDT-FUTURES';
      } else if (pt === 'cmcbl') {
        v2ProductType = 'COIN-FUTURES';
      } else if (pt === 'dmcbl') {
        v2ProductType = 'USDC-FUTURES';
      } else {
        v2ProductType = 'USDT-FUTURES'; // fallback
      }
    }
    
    // Try v1 first (for backward compatibility), then v2 if decommissioned
    let result;
    try {
      // Try v1 single account endpoint first if symbol provided
      if (symbol && marginCoin) {
        try {
          result = await this.request({
            method: 'GET',
            path: '/api/mix/v1/account/account',
            params: { symbol, marginCoin },
          });
          return result || {};
        } catch (v1Err) {
          // If v1 decommissioned, will fall through to v2
          if (!v1Err.message || !v1Err.message.includes('decommissioned')) {
            throw v1Err;
          }
        }
      }
      
      // Try v1 accounts list
      const v1Params = { 
        productType: (productType || 'umcbl').toLowerCase()
      };
      if (marginCoin) {
        v1Params.marginCoin = marginCoin;
      }
      
      result = await this.request({
        method: 'GET',
        path: '/api/mix/v1/account/accounts',
        params: v1Params,
      });
    } catch (v1Err) {
      // If v1 fails with decommissioned, try v2
      if (v1Err.message && (v1Err.message.includes('decommissioned') || v1Err.message.includes('30032'))) {
        console.warn('[API] ⚠️ V1 API decommissioned, migrating to v2...');
        
        // Use v2 endpoint with uppercase productType
        const v2Params = { 
          productType: v2ProductType
        };
        if (marginCoin) {
          v2Params.marginCoin = marginCoin;
        }
        
        result = await this.request({
          method: 'GET',
          path: '/api/v2/mix/account/accounts',
          params: v2Params,
        });
      } else {
        throw v1Err;
      }
    }
    
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
    return this.requestWithV2Fallback({
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
    
    return this.requestWithV2Fallback({
      method: 'POST',
      path: '/api/mix/v1/order/placeOrder',
      body,
    });
  }

  async getPosition(symbol, marginCoin) {
    return this.requestWithV2Fallback({
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
    return this.requestWithV2Fallback({
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
    return this.requestWithV2Fallback({
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
    return this.requestWithV2Fallback({
      method: 'GET',
      path: '/api/mix/v1/order/history',
      params,
    });
  }

  async getContracts(productType = 'umcbl') {
    return this.requestWithV2Fallback({
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
      return await this.requestWithV2Fallback({
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

