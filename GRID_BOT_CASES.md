# Grid Bot - Các Case Có Thể Xảy Ra và Logic Xử Lý

## Tổng Quan Logic

Bot trading 2 chiều (Long + Short) với ADX Filter:
- **ADX Filter**: Chỉ mở lệnh khi ADX < 25 (thị trường sideways)
- **Mở lệnh**: 2 lệnh market (Long + Short) cùng lúc tại giá hiện tại
- **Đóng lệnh**: Chỉ đóng khi chạm TP, không có SL
- **Rollover**: Khi một lệnh chạm TP → đóng lệnh đó và mở lại 2 lệnh mới (nếu ADX cho phép)

---

## Case 1: Khởi động bot - ADX < 25

**Tình huống:**
- Bot khởi động
- ADX = 20 (< 25)
- Giá hiện tại: 1.90

**Logic xử lý:**
1. ✅ Check ADX → ADX = 20 < 25 → Cho phép mở lệnh
2. ✅ Mở Long tại 1.90
3. ✅ Mở Short tại 1.90
4. ✅ Bắt đầu monitor cả 2 lệnh

**Kết quả:** 2 lệnh đang mở (Long + Short tại 1.90)

---

## Case 2: Khởi động bot - ADX >= 25

**Tình huống:**
- Bot khởi động
- ADX = 28 (>= 25)
- Giá hiện tại: 1.90

**Logic xử lý:**
1. ❌ Check ADX → ADX = 28 >= 25 → Không mở lệnh
2. ⏳ Đợi 60 giây
3. 🔄 Check lại ADX
4. Lặp lại cho đến khi ADX < 25

**Kết quả:** Không có lệnh nào được mở, bot chờ ADX giảm

---

## Case 3: Long chạm TP - ADX < 25

**Tình huống:**
- Long entry: 1.90, TP: 1.91
- Short entry: 1.90, TP: 1.89
- Giá hiện tại: 1.91 (Long chạm TP)
- ADX = 22 (< 25)

**Logic xử lý:**
1. ✅ Monitor phát hiện Long chạm TP (1.91 >= 1.91)
2. ✅ Đóng Long
3. ✅ Check ADX → ADX = 22 < 25 → Cho phép mở lệnh mới
4. ✅ Mở Long mới tại 1.91
5. ✅ Mở Short mới tại 1.91
6. ✅ Short cũ (1.90) vẫn tiếp tục chạy
7. ✅ Monitor: Long mới (1.91) + Short mới (1.91) + Short cũ (1.90)

**Kết quả:** 
- Long cũ: ✅ Đã đóng (chạm TP)
- Short cũ: ⏳ Vẫn đang chạy
- Long mới: ✅ Đã mở tại 1.91
- Short mới: ✅ Đã mở tại 1.91

---

## Case 4: Long chạm TP - ADX >= 25

**Tình huống:**
- Long entry: 1.90, TP: 1.91
- Short entry: 1.90, TP: 1.89
- Giá hiện tại: 1.91 (Long chạm TP)
- ADX = 27 (>= 25)

**Logic xử lý:**
1. ✅ Monitor phát hiện Long chạm TP (1.91 >= 1.91)
2. ✅ Đóng Long
3. ❌ Check ADX → ADX = 27 >= 25 → Không mở lệnh mới
4. ⏳ Short cũ (1.90) vẫn tiếp tục chạy
5. ✅ Monitor: Chỉ còn Short cũ (1.90)

**Kết quả:**
- Long cũ: ✅ Đã đóng (chạm TP)
- Short cũ: ⏳ Vẫn đang chạy (không bị đóng)
- Long mới: ❌ Không mở (ADX >= 25)
- Short mới: ❌ Không mở (ADX >= 25)

**Lưu ý:** Khi Short cũ chạm TP, bot sẽ check ADX lại để quyết định có mở lệnh mới không.

---

## Case 5: Short chạm TP - ADX < 25

**Tình huống:**
- Long entry: 1.90, TP: 1.91
- Short entry: 1.90, TP: 1.89
- Giá hiện tại: 1.89 (Short chạm TP)
- ADX = 23 (< 25)

**Logic xử lý:**
1. ✅ Monitor phát hiện Short chạm TP (1.89 <= 1.89)
2. ✅ Đóng Short
3. ✅ Check ADX → ADX = 23 < 25 → Cho phép mở lệnh mới
4. ✅ Mở Long mới tại 1.89
5. ✅ Mở Short mới tại 1.89
6. ✅ Long cũ (1.90) vẫn tiếp tục chạy
7. ✅ Monitor: Long mới (1.89) + Short mới (1.89) + Long cũ (1.90)

**Kết quả:**
- Short cũ: ✅ Đã đóng (chạm TP)
- Long cũ: ⏳ Vẫn đang chạy
- Long mới: ✅ Đã mở tại 1.89
- Short mới: ✅ Đã mở tại 1.89

---

## Case 6: Cả 2 lệnh cùng chạm TP (hiếm xảy ra)

**Tình huống:**
- Long entry: 1.90, TP: 1.91
- Short entry: 1.90, TP: 1.89
- Giá hiện tại: 1.90 (giữa TP Long và TP Short)
- Giá tăng lên 1.91 → Long chạm TP
- Giá giảm xuống 1.89 → Short chạm TP
- ADX = 21 (< 25)

**Logic xử lý:**

**Bước 1: Long chạm TP trước**
1. ✅ Monitor phát hiện Long chạm TP (1.91 >= 1.91)
2. ✅ Đóng Long
3. ✅ Check ADX → ADX = 21 < 25 → Cho phép mở lệnh mới
4. ✅ Mở Long mới + Short mới tại 1.91
5. ⏳ Short cũ (1.90) vẫn chạy

**Bước 2: Short cũ chạm TP sau**
6. ✅ Monitor phát hiện Short cũ chạm TP (1.89 <= 1.89)
7. ✅ Đóng Short cũ
8. ✅ Check ADX → ADX = 21 < 25 → Cho phép mở lệnh mới
9. ✅ Mở Long mới + Short mới tại 1.89

**Kết quả:**
- Long cũ: ✅ Đã đóng (chạm TP)
- Short cũ: ✅ Đã đóng (chạm TP)
- Long mới (từ Long TP): ✅ Đã mở tại 1.91
- Short mới (từ Long TP): ✅ Đã mở tại 1.91
- Long mới (từ Short TP): ✅ Đã mở tại 1.89
- Short mới (từ Short TP): ✅ Đã mở tại 1.89

**Lưu ý:** Bot có thể có nhiều cặp Long+Short đang chạy cùng lúc nếu cả 2 lệnh đều chạm TP.

---

## Case 7: Mở lệnh mới - chỉ 1 lệnh thành công

**Tình huống:**
- Long chạm TP tại 1.91
- ADX = 20 (< 25)
- Mở Long mới: ✅ Thành công
- Mở Short mới: ❌ Fail (lỗi API hoặc số dư)

**Logic xử lý:**
1. ✅ Đóng Long cũ
2. ✅ Check ADX → Cho phép mở lệnh mới
3. ✅ Mở Long mới thành công
4. ❌ Mở Short mới fail
5. ⚠️ Đóng Long mới ngay (để tránh rủi ro)
6. ⏳ Short cũ vẫn tiếp tục chạy
7. ❌ Throw error: "Short position không thể mở - đã đóng Long để tránh rủi ro"

**Kết quả:**
- Long cũ: ✅ Đã đóng (chạm TP)
- Long mới: ✅ Đã mở → ❌ Đã đóng (vì Short fail)
- Short mới: ❌ Không mở được
- Short cũ: ⏳ Vẫn đang chạy
- Bot: ⚠️ Quay lại vòng lặp chính, chờ ADX và thử lại

---

## Case 8: Mở lệnh mới - cả 2 lệnh đều fail

**Tình huống:**
- Long chạm TP tại 1.91
- ADX = 20 (< 25)
- Mở Long mới: ❌ Fail
- Mở Short mới: ❌ Fail

**Logic xử lý:**
1. ✅ Đóng Long cũ
2. ✅ Check ADX → Cho phép mở lệnh mới
3. ❌ Mở Long mới fail
4. ❌ Mở Short mới fail
5. ❌ Throw error: "Không thể mở cả 2 lệnh Long và Short mới"

**Kết quả:**
- Long cũ: ✅ Đã đóng (chạm TP)
- Long mới: ❌ Không mở được
- Short mới: ❌ Không mở được
- Short cũ: ⏳ Vẫn đang chạy
- Bot: ⚠️ Quay lại vòng lặp chính, đợi 60s và thử lại

---

## Case 9: ADX tăng lên >= 25 khi đang có lệnh

**Tình huống:**
- Long entry: 1.90, TP: 1.91
- Short entry: 1.90, TP: 1.89
- Giá hiện tại: 1.905 (chưa chạm TP)
- ADX tăng từ 20 → 28 (>= 25)

**Logic xử lý:**
1. ⏳ Long (1.90) vẫn đang chạy
2. ⏳ Short (1.90) vẫn đang chạy
3. ✅ Bot KHÔNG đóng lệnh (chỉ đóng khi chạm TP)
4. ⏳ Tiếp tục monitor cho đến khi chạm TP

**Kết quả:**
- Long: ⏳ Vẫn đang chạy (không bị đóng)
- Short: ⏳ Vẫn đang chạy (không bị đóng)
- ADX: ⚠️ >= 25 nhưng không ảnh hưởng lệnh đang chạy

**Lưu ý:** Khi Long hoặc Short chạm TP, bot sẽ check ADX để quyết định có mở lệnh mới không.

---

## Case 10: Lệnh chạm TP nhưng ADX không cho phép mở mới

**Tình huống:**
- Long entry: 1.90, TP: 1.91
- Short entry: 1.90, TP: 1.89
- Giá hiện tại: 1.91 (Long chạm TP)
- ADX = 27 (>= 25)

**Logic xử lý:**
1. ✅ Đóng Long (chạm TP)
2. ❌ Check ADX → ADX = 27 >= 25 → Không mở lệnh mới
3. ⏳ Short cũ (1.90) vẫn tiếp tục chạy
4. ⏳ Monitor chỉ còn Short cũ

**Khi Short cũ chạm TP:**
5. ✅ Đóng Short (chạm TP)
6. ❌ Check ADX → ADX = 27 >= 25 → Không mở lệnh mới
7. ⏳ Không còn lệnh nào

**Kết quả:**
- Long: ✅ Đã đóng (chạm TP)
- Short: ✅ Đã đóng (chạm TP)
- Lệnh mới: ❌ Không mở (ADX >= 25)
- Bot: ⏳ Quay lại vòng lặp chính, chờ ADX < 25 để mở lệnh mới

---

## Case 11: Lỗi khi lấy ADX

**Tình huống:**
- Long chạm TP tại 1.91
- Không thể lấy ADX từ Binance API (lỗi network)

**Logic xử lý:**
1. ✅ Đóng Long (chạm TP)
2. ❌ Check ADX → Lỗi, không lấy được ADX
3. ❌ Throw error: "Không thể lấy ADX để mở lệnh mới"
4. ⏳ Short cũ vẫn tiếp tục chạy
5. ⏳ Monitor chỉ còn Short cũ

**Kết quả:**
- Long: ✅ Đã đóng (chạm TP)
- Short: ⏳ Vẫn đang chạy
- Lệnh mới: ❌ Không mở (không lấy được ADX)
- Bot: ⏳ Tiếp tục monitor Short, khi Short chạm TP sẽ thử lại

---

## Case 12: Giá dao động giữa TP Long và TP Short

**Tình huống:**
- Long entry: 1.90, TP: 1.91
- Short entry: 1.90, TP: 1.89
- Giá dao động: 1.89 → 1.91 → 1.89 → 1.91
- ADX = 22 (< 25)

**Logic xử lý:**

**Lần 1: Giá = 1.89**
- Short chạm TP → Đóng Short → Mở Long mới + Short mới tại 1.89

**Lần 2: Giá = 1.91**
- Long cũ (1.90) chạm TP → Đóng Long cũ → Mở Long mới + Short mới tại 1.91
- Long mới (1.89) chạm TP → Đóng Long mới → Mở Long mới + Short mới tại 1.91

**Lần 3: Giá = 1.89**
- Short cũ (1.90) chạm TP → Đóng Short cũ → Mở Long mới + Short mới tại 1.89
- Short mới (1.91) chạm TP → Đóng Short mới → Mở Long mới + Short mới tại 1.89

**Kết quả:** Bot có thể có nhiều cặp Long+Short đang chạy, mỗi cặp có entry price khác nhau.

---

## Tóm Tắt Logic

### ✅ Khi nào mở lệnh:
1. **Khởi động bot**: ADX < 25
2. **Chạm TP và mở lại**: ADX < 25

### ❌ Khi nào KHÔNG mở lệnh:
1. **Khởi động bot**: ADX >= 25 → Chờ ADX giảm
2. **Chạm TP**: ADX >= 25 → Chỉ đóng lệnh, không mở mới

### 🔄 Khi nào đóng lệnh:
1. **Chạm TP**: Đóng lệnh đã chạm TP, mở lại 2 lệnh mới (nếu ADX cho phép)
2. **Không đóng khi**: ADX tăng, timeout (đã bỏ), SL (đã bỏ)

### ⚠️ Lưu ý quan trọng:
- Lệnh đang chạy **KHÔNG bị đóng** khi ADX tăng
- ADX chỉ ảnh hưởng đến việc **mở lệnh mới**
- Bot có thể có **nhiều cặp Long+Short** đang chạy cùng lúc
- Mỗi lệnh có **entry price riêng** và **TP riêng**

