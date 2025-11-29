/**
 * Script phân tích giá Binance bằng Gemini AI
 * Lấy dữ liệu giá 5 phút trong 1 ngày gần nhất
 * Gửi tới Gemini AI để nhận định Long/Short, Entry, TP, SL
 */

const axios = require('axios');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Google Gemini API Configuration
const GOOGLE_API_KEY = 'AIzaSyBjtsO8MYNq8PMZH8dW_QkeAxL98Jexic0';

// Binance API
const BINANCE_API_URL = 'https://api.binance.com/api/v3/klines';

/**
 * Lấy dữ liệu kline từ Binance
 */
async function getBinanceKlines(symbol = 'BTCUSDT', interval = '5m', limit = 288) {
  try {
    const response = await axios.get(BINANCE_API_URL, {
      params: {
        symbol: symbol,
        interval: interval,
        limit: limit, // 288 candles = 1 ngày (5 phút * 288 = 1440 phút = 24 giờ)
      },
    });

    // Parse dữ liệu từ Binance
    const klines = response.data.map((k) => ({
      time: new Date(k[0]).toISOString(),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      closeTime: new Date(k[6]).toISOString(),
    }));

    return klines;
  } catch (error) {
    console.error('❌ Lỗi khi lấy dữ liệu từ Binance:', error.message);
    throw error;
  }
}

/**
 * Format dữ liệu giá để gửi tới Gemini
 */
function formatPriceDataForGemini(klines, symbol = 'BTCUSDT') {
  if (!klines || klines.length === 0) {
    return 'Không có dữ liệu giá.';
  }

  const latest = klines[klines.length - 1];
  const oldest = klines[0];
  
  // Tính toán một số chỉ số cơ bản
  const prices = klines.map(k => k.close);
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);
  
  const highest = Math.max(...highs);
  const lowest = Math.min(...lows);
  const currentPrice = latest.close;
  const priceChange = currentPrice - oldest.close;
  const priceChangePercent = ((priceChange / oldest.close) * 100).toFixed(2);
  
  // Tính volume trung bình
  const avgVolume = klines.reduce((sum, k) => sum + k.volume, 0) / klines.length;
  
  // Lấy 10 candles gần nhất để phân tích chi tiết
  const recent10 = klines.slice(-10);
  
  let dataText = `=== DỮ LIỆU GIÁ BINANCE (Khung 5 phút - 1 ngày gần nhất) ===\n\n`;
  dataText += `Symbol: ${symbol}\n`;
  dataText += `Thời gian: ${oldest.time} đến ${latest.time}\n`;
  dataText += `Số lượng candles: ${klines.length}\n\n`;
  
  dataText += `=== THỐNG KÊ TỔNG QUAN ===\n`;
  dataText += `Giá cao nhất: ${highest.toFixed(2)} USDT\n`;
  dataText += `Giá thấp nhất: ${lowest.toFixed(2)} USDT\n`;
  dataText += `Giá hiện tại: ${currentPrice.toFixed(2)} USDT\n`;
  dataText += `Biến động: ${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)} USDT (${priceChangePercent >= 0 ? '+' : ''}${priceChangePercent}%)\n`;
  dataText += `Volume trung bình: ${avgVolume.toFixed(2)}\n\n`;
  
  dataText += `=== 10 CANDLES GẦN NHẤT (Chi tiết) ===\n`;
  recent10.forEach((candle, idx) => {
    const change = candle.close - candle.open;
    const changePercent = ((change / candle.open) * 100).toFixed(2);
    const isBullish = change >= 0;
    dataText += `\n${idx + 1}. ${candle.time}\n`;
    dataText += `   O: ${candle.open.toFixed(2)} | H: ${candle.high.toFixed(2)} | L: ${candle.low.toFixed(2)} | C: ${candle.close.toFixed(2)}\n`;
    dataText += `   Change: ${change >= 0 ? '+' : ''}${change.toFixed(2)} (${changePercent >= 0 ? '+' : ''}${changePercent}%) | Volume: ${candle.volume.toFixed(2)} | ${isBullish ? '🟢 Bullish' : '🔴 Bearish'}\n`;
  });
  
  dataText += `\n=== TOÀN BỘ DỮ LIỆU (OHLCV) ===\n`;
  dataText += `Format: Time | Open | High | Low | Close | Volume\n`;
  klines.forEach((candle, idx) => {
    dataText += `${idx + 1}. ${candle.time} | ${candle.open.toFixed(2)} | ${candle.high.toFixed(2)} | ${candle.low.toFixed(2)} | ${candle.close.toFixed(2)} | ${candle.volume.toFixed(2)}\n`;
  });

  return dataText;
}

/**
 * Liệt kê các model có sẵn từ Gemini API
 */
async function listAvailableModels() {
  try {
    console.log('🔍 Đang lấy danh sách các model có sẵn...');
    const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);
    
    // SDK không có method listModels trực tiếp, thử gọi API trực tiếp
    const response = await axios.get(
      `https://generativelanguage.googleapis.com/v1/models?key=${GOOGLE_API_KEY}`
    );
    
    if (response.data && response.data.models) {
      const availableModels = response.data.models
        .filter(m => 
          m.supportedGenerationMethods && 
          m.supportedGenerationMethods.includes('generateContent') &&
          m.name && !m.name.includes('embed')
        )
        .map(m => m.name.replace('models/', ''))
        .sort();
      
      console.log(`✅ Tìm thấy ${availableModels.length} model(s) có sẵn:\n`);
      availableModels.forEach((m, i) => console.log(`   ${i + 1}. ${m}`));
      console.log('');
      
      return availableModels;
    }
    return [];
  } catch (error) {
    console.warn('⚠️  Không thể lấy danh sách models:', error.message);
    console.warn('   Sẽ thử với danh sách mặc định...\n');
    return [];
  }
}

/**
 * Gửi dữ liệu tới Gemini AI và nhận phân tích (sử dụng SDK)
 */
async function analyzeWithGemini(priceData) {
  const prompt = `
Bạn là một chuyên gia phân tích kỹ thuật cryptocurrency chuyên nghiệp. 

Hãy phân tích dữ liệu giá sau đây từ Binance và đưa ra nhận định giao dịch:

${priceData}

Hãy đưa ra phân tích chi tiết bao gồm:
1. **Xu hướng thị trường** (Trend): Xác định xu hướng hiện tại (Bullish/Bearish/Sideways)
2. **Tín hiệu giao dịch**:
   - **Long** (Mua) hoặc **Short** (Bán)
   - **Entry price** (Giá vào lệnh): Giá cụ thể
   - **Take Profit (TP)**: Mức chốt lời (có thể nhiều mức)
   - **Stop Loss (SL)**: Mức cắt lỗ
   - **Risk/Reward Ratio**: Tỷ lệ rủi ro/lợi nhuận
3. **Phân tích kỹ thuật**: 
   - Các mức hỗ trợ (Support) và kháng cự (Resistance)
   - Momentum và volume
   - Các tín hiệu đảo chiều hoặc tiếp diễn
4. **Khuyến nghị**: Mức độ tin cậy của tín hiệu (High/Medium/Low)

Hãy trình bày kết quả bằng tiếng Việt, rõ ràng và dễ hiểu. Định dạng output:
- Sử dụng emoji để làm rõ (📈 cho Long, 📉 cho Short)
- Đưa ra các mức giá cụ thể
- Giải thích lý do tại sao đưa ra nhận định đó
`;

  // Danh sách các model mặc định để thử (theo thứ tự ưu tiên)
  // Sử dụng các model mới nhất
  let modelsToTry = [
    'gemini-2.5-flash',
    'gemini-2.5-pro',
    'gemini-2.0-flash',
    'gemini-1.5-flash',
    'gemini-1.5-pro',
  ];

  // Thử lấy danh sách model có sẵn
  const availableModels = await listAvailableModels();
  if (availableModels.length > 0) {
    // Ưu tiên sử dụng các model có sẵn
    modelsToTry = [...availableModels, ...modelsToTry.filter(m => !availableModels.includes(m))];
    console.log(`📝 Sẽ thử các model theo thứ tự: ${modelsToTry.slice(0, 5).join(', ')}...\n`);
  }

  let lastError = null;

  // Sử dụng SDK Google Generative AI
  const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);

  for (const modelName of modelsToTry) {
    try {
      console.log(`🤖 Đang gửi dữ liệu tới Gemini AI (model: ${modelName})...\n`);
      
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const analysis = response.text();

      console.log(`✅ Sử dụng model: ${modelName}\n`);
      return analysis;
      
    } catch (error) {
      lastError = error;
      
      // Kiểm tra xem có phải lỗi model không khả dụng không
      if (error.message && (error.message.includes('404') || error.message.includes('not found'))) {
        console.log(`⚠️  Model ${modelName} không khả dụng, thử model khác...\n`);
        continue;
      } else if (error.message && error.message.includes('403')) {
        console.error(`❌ Lỗi quyền truy cập với model ${modelName}`);
        console.error('💡 Có thể API key không có quyền hoặc chưa được kích hoạt đúng cách.');
        continue;
      } else {
        // Lỗi khác, có thể là lỗi network hoặc format
        console.warn(`⚠️  Lỗi với model ${modelName}: ${error.message}\n`);
        console.warn('   Đang thử model khác...\n');
        continue;
      }
    }
  }

  // Nếu tất cả models đều thất bại
  if (lastError) {
    console.error('\n❌ Không thể kết nối tới Gemini AI với bất kỳ model nào!\n');
    console.error('Lỗi cuối cùng:', lastError.message);
    
    if (lastError.message && (lastError.message.includes('404') || lastError.message.includes('not found'))) {
      console.error('\n💡 Có vẻ như API key không có quyền truy cập các model Gemini.');
      console.error('   Vui lòng kiểm tra:');
      console.error('   1. API key có đúng không?');
      console.error('   2. API key đã được kích hoạt cho Gemini API chưa?');
      console.error('   3. Tạo API key mới tại: https://aistudio.google.com/app/apikey');
      console.error('   4. Hoặc: https://makersuite.google.com/app/apikey');
      console.error('\n   Sau khi có API key mới, cập nhật GOOGLE_API_KEY trong file gemini-analyze.js');
    } else if (lastError.message && lastError.message.includes('API key')) {
      console.error('\n💡 Có vấn đề với API key:');
      console.error('   1. API key có đúng không?');
      console.error('   2. API key đã được kích hoạt cho Gemini API chưa?');
      console.error('   3. Truy cập: https://aistudio.google.com/app/apikey để kiểm tra');
    } else if (lastError.message && lastError.message.includes('403')) {
      console.error('\n💡 API key không có quyền truy cập. Vui lòng kiểm tra lại quyền của API key.');
      console.error('   Tạo API key mới tại: https://aistudio.google.com/app/apikey');
    }
    
    throw new Error('Không thể kết nối tới Gemini AI');
  }
}

/**
 * Hàm chính
 */
async function main() {
  try {
    // Parse command line arguments
    const argv = yargs(hideBin(process.argv))
      .option('symbol', {
        alias: 's',
        type: 'string',
        default: 'BTCUSDT',
        description: 'Trading symbol (ví dụ: BTCUSDT, ETHUSDT)',
      })
      .help()
      .alias('help', 'h')
      .argv;

    const symbol = argv.symbol.toUpperCase();

    console.log('='.repeat(60));
    console.log('📊 PHÂN TÍCH GIÁ BINANCE BẰNG GEMINI AI');
    console.log('='.repeat(60));
    console.log('');

    // Lấy dữ liệu từ Binance
    console.log(`📥 Đang lấy dữ liệu từ Binance (${symbol}, 5m, 1 ngày)...`);
    const klines = await getBinanceKlines(symbol, '5m', 288);
    console.log(`✅ Đã lấy được ${klines.length} candles\n`);

    // Format dữ liệu
    console.log('📝 Đang format dữ liệu...');
    const priceData = formatPriceDataForGemini(klines, symbol);
    console.log('✅ Đã format xong dữ liệu\n');

    // Hiển thị thông tin tổng quan
    const latest = klines[klines.length - 1];
    const oldest = klines[0];
    console.log('📊 THÔNG TIN TỔNG QUAN:');
    console.log(`   Giá hiện tại: ${latest.close.toFixed(2)} USDT`);
    console.log(`   Biến động 24h: ${((latest.close - oldest.close) / oldest.close * 100).toFixed(2)}%`);
    console.log('');

    // Gửi tới Gemini và nhận phân tích
    const analysis = await analyzeWithGemini(priceData);

    // Hiển thị kết quả
    console.log('='.repeat(60));
    console.log('🤖 PHÂN TÍCH TỪ GEMINI AI:');
    console.log('='.repeat(60));
    console.log('');
    console.log(analysis);
    console.log('');
    console.log('='.repeat(60));
    console.log('✅ Hoàn thành!');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('\n❌ Có lỗi xảy ra:', error.message);
    process.exit(1);
  }
}

// Chạy script
if (require.main === module) {
  main();
}

module.exports = { getBinanceKlines, analyzeWithGemini };

