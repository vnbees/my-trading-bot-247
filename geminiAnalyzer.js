/**
 * Gemini AI Analyzer cho Smart Money Concepts (SMC) Strategy
 * 
 * Phân tích 50 candles để phát hiện Liquidity Sweep/Fakeout:
 * - SHORT: High > Range_High nhưng Close < Range_High (Upthrust)
 * - LONG: Low < Range_Low nhưng Close > Range_Low (Spring)
 */

require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

class GeminiAnalyzer {
  constructor({ apiKey }) {
    if (!apiKey) {
      throw new Error('Google Gemini API key is required');
    }
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = null; // Sẽ được khởi tạo trong initializeModel()
    this.modelInitialized = false;
    console.log('[GEMINI] ✅ Đã khởi tạo Gemini AI Analyzer');
  }

  /**
   * Khởi tạo Gemini model (thử nhiều model để tìm model khả dụng)
   */
  async initializeModel() {
    if (this.modelInitialized && this.model) {
      return; // Đã khởi tạo rồi
    }

    try {
      console.log('[GEMINI] 🤖 Đang khởi tạo Gemini AI model...');
      
      // Thử các model theo thứ tự ưu tiên (giống các bot khác)
      const modelsToTry = ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-pro'];
      
      for (const modelName of modelsToTry) {
        try {
          this.model = this.genAI.getGenerativeModel({ model: modelName });
          // Test với một prompt đơn giản
          const testResult = await this.model.generateContent('Test');
          console.log(`[GEMINI] ✅ Đã khởi tạo model: ${modelName}`);
          this.modelInitialized = true;
          return;
        } catch (err) {
          console.log(`[GEMINI] ⚠️ Model ${modelName} không khả dụng, thử model khác...`);
          continue;
        }
      }
      
      throw new Error('Không tìm thấy model Gemini nào khả dụng');
    } catch (err) {
      console.error(`[GEMINI] ❌ Lỗi khi khởi tạo Gemini: ${err.message}`);
      throw err;
    }
  }

  /**
   * Format dữ liệu candles để gửi cho Gemini
   */
  formatCandlesForAI(candles) {
    if (!candles || candles.length === 0) {
      return 'Không có dữ liệu candles.';
    }

    let text = `=== DỮ LIỆU GIÁ (${candles.length} CANDLES) ===\n\n`;
    text += `Format: [Time, Open, High, Low, Close]\n\n`;

    candles.forEach((candle, idx) => {
      const num = idx + 1;
      text += `Candle ${num}: [${candle.time}, ${candle.open}, ${candle.high}, ${candle.low}, ${candle.close}]\n`;
    });

    return text;
  }

  /**
   * Tạo system prompt cho Gemini
   */
  createSystemPrompt() {
    return `Bạn là một chuyên gia phân tích Price Action và Smart Money Concepts (SMC).

NHIỆM VỤ:
Phân tích 50 candles để phát hiện tín hiệu "Liquidity Sweep/Fakeout" (SMC Strategy).

QUY TẮC PHÂN TÍCH:

1. XÁC ĐỊNH RANGE (Từ 49 candles đầu tiên):
   - Range_High = Giá cao nhất (High) trong 49 candles đầu tiên
   - Range_Low = Giá thấp nhất (Low) trong 49 candles đầu tiên

2. PHÂN TÍCH CANDLE THỨ 50 (Candle cuối cùng):
   - Kiểm tra xem có phá vỡ range nhưng đóng lại bên trong range không

3. TÍN HIỆU SHORT (Upthrust/Fakeout lên trên):
   - Điều kiện: High của candle 50 > Range_High VÀ Close của candle 50 < Range_High
   - Đây là tín hiệu fakeout: giá phá vỡ lên trên nhưng đóng lại bên dưới → Dự kiến giá sẽ giảm

4. TÍN HIỆU LONG (Spring/Fakeout xuống dưới):
   - Điều kiện: Low của candle 50 < Range_Low VÀ Close của candle 50 > Range_Low
   - Đây là tín hiệu fakeout: giá phá vỡ xuống dưới nhưng đóng lại bên trên → Dự kiến giá sẽ tăng

5. TÍNH TOÁN SL/TP:
   - SHORT:
     * Entry = Close của candle 50
     * StopLoss = High của candle 50 + buffer (0.1% để tránh bị stop sớm)
     * TakeProfit = Range_Low (mục tiêu quay về đáy range)
   
   - LONG:
     * Entry = Close của candle 50
     * StopLoss = Low của candle 50 - buffer (0.1% để tránh bị stop sớm)
     * TakeProfit = Range_High (mục tiêu quay về đỉnh range)

6. NẾU KHÔNG CÓ TÍN HIỆU:
   - Trả về action: "WAIT"

ĐỊNH DẠNG TRẢ VỀ:
Bạn PHẢI trả về một JSON object với format chính xác sau (KHÔNG có markdown, KHÔNG có code block, chỉ JSON thuần):

{
  "action": "LONG" | "SHORT" | "WAIT",
  "entry": <số thực>,
  "stopLoss": <số thực>,
  "takeProfit": <số thực>,
  "reason": "<giải thích ngắn gọn>"
}

LƯU Ý QUAN TRỌNG:
- Chỉ trả về JSON, không có text thêm
- Nếu action là "WAIT", vẫn phải có entry, stopLoss, takeProfit (có thể = 0 hoặc = entry)
- stopLoss và takeProfit phải là số thực hợp lệ
- reason phải ngắn gọn, rõ ràng`;
  }

  /**
   * Parse JSON response từ Gemini (xử lý markdown code blocks nếu có)
   */
  parseGeminiResponse(text) {
    if (!text) {
      throw new Error('Response từ Gemini rỗng');
    }

    // Loại bỏ markdown code blocks nếu có
    let cleaned = text.trim();
    
    // Xử lý ```json ... ```
    if (cleaned.includes('```json')) {
      cleaned = cleaned.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    } else if (cleaned.includes('```')) {
      cleaned = cleaned.replace(/```\s*/g, '').trim();
    }

    // Tìm JSON object trong text
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleaned = jsonMatch[0];
    }

    try {
      const parsed = JSON.parse(cleaned);
      return parsed;
    } catch (err) {
      console.error('[GEMINI] ❌ Lỗi parse JSON:', err.message);
      console.error('[GEMINI] Raw response:', text);
      throw new Error(`Không thể parse JSON từ Gemini: ${err.message}`);
    }
  }

  /**
   * Phân tích candles và trả về trading signal
   * @param {Array} candles - Mảng 50 candles [time, open, high, low, close]
   * @returns {Promise<Object>} { action, entry, stopLoss, takeProfit, reason }
   */
  async analyze(candles) {
    if (!candles || candles.length < 50) {
      throw new Error(`Cần ít nhất 50 candles, nhận được: ${candles?.length || 0}`);
    }

    // Đảm bảo model đã được khởi tạo
    if (!this.modelInitialized) {
      await this.initializeModel();
    }

    console.log('[GEMINI] 🔍 Bắt đầu phân tích với Gemini AI...');
    console.log(`[GEMINI] Số lượng candles: ${candles.length}`);

    try {
      const systemPrompt = this.createSystemPrompt();
      const priceData = this.formatCandlesForAI(candles);

      const fullPrompt = `${systemPrompt}\n\n${priceData}\n\nHãy phân tích và trả về JSON theo format đã yêu cầu.`;

      console.log('[GEMINI] 📤 Gửi request tới Gemini AI...');
      const result = await this.model.generateContent(fullPrompt);
      const response = await result.response;
      const text = response.text();

      console.log('[GEMINI] 📥 Nhận được response từ Gemini:');
      console.log(text);

      const parsed = this.parseGeminiResponse(text);

      // Validate response structure
      if (!parsed.action || !['LONG', 'SHORT', 'WAIT'].includes(parsed.action)) {
        throw new Error(`Action không hợp lệ: ${parsed.action}`);
      }

      // Nếu action là WAIT, không cần validate entry/sl/tp (có thể = 0)
      if (parsed.action === 'WAIT') {
        console.log('[GEMINI] ✅ Phân tích thành công: WAIT (không có signal)');
        console.log(`  - Reason: ${parsed.reason || 'N/A'}`);
        return parsed;
      }

      // Chỉ validate entry/sl/tp khi action là LONG hoặc SHORT
      if (typeof parsed.entry !== 'number' || parsed.entry <= 0) {
        throw new Error(`Entry price không hợp lệ: ${parsed.entry}`);
      }

      if (typeof parsed.stopLoss !== 'number' || parsed.stopLoss <= 0) {
        throw new Error(`StopLoss không hợp lệ: ${parsed.stopLoss}`);
      }

      if (typeof parsed.takeProfit !== 'number' || parsed.takeProfit <= 0) {
        throw new Error(`TakeProfit không hợp lệ: ${parsed.takeProfit}`);
      }

      console.log('[GEMINI] ✅ Phân tích thành công:');
      console.log(`  - Action: ${parsed.action}`);
      console.log(`  - Entry: ${parsed.entry}`);
      console.log(`  - StopLoss: ${parsed.stopLoss}`);
      console.log(`  - TakeProfit: ${parsed.takeProfit}`);
      console.log(`  - Reason: ${parsed.reason}`);

      return parsed;
    } catch (err) {
      console.error('[GEMINI] ❌ Lỗi khi phân tích với Gemini:', err.message);
      if (err.stack) {
        console.error(err.stack);
      }
      throw err;
    }
  }
}

module.exports = { GeminiAnalyzer };

