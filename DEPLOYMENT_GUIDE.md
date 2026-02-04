# 🚀 Hướng Dẫn Deploy Bot Rebalance Spot 24/7

Hướng dẫn deploy bot `startRebalanceSpotBot.js` lên các nền tảng cloud để chạy 24/7.

## 📋 Yêu Cầu

- Node.js >= 16.0.0
- API credentials từ Bitget
- Tài khoản trên một trong các nền tảng cloud (miễn phí hoặc trả phí)

---

## 🎯 Các Nền Tảng Deploy (Khuyến Nghị)

### 1. **Railway** ⭐ (Dễ nhất, miễn phí $5/tháng)

**Ưu điểm:**
- Setup cực kỳ đơn giản, chỉ cần connect GitHub
- Miễn phí $5 credit/tháng (đủ cho bot nhỏ)
- Auto deploy từ GitHub
- Logs real-time
- Hỗ trợ Docker

**Cách deploy:**
1. Đăng ký tại [railway.app](https://railway.app) (dùng GitHub login)
2. Tạo project mới → "Deploy from GitHub repo"
3. Chọn repo của bạn
4. Vào Settings → Variables, thêm:
   ```
   BITGET_API_KEY=bg_341563e7ffde3387dd8d85b38d039671
   BITGET_API_SECRET=e3b3e24d8d80de7739b0fd5553a9a908ab1894a39710491bb0b0807c332991fe
   BITGET_PASSPHRASE=123abcABCD
   ```
5. Vào Settings → Deploy → Build Command: `npm install`
6. Vào Settings → Deploy → Start Command: `node startRebalanceSpotBot.js --key=$BITGET_API_KEY --secret=$BITGET_API_SECRET --passphrase=$BITGET_PASSPHRASE --interval=4`
7. Deploy!

**File cần tạo:** `railway.json` (đã có sẵn trong repo)

---

### 2. **Render** ⭐ (Miễn phí tier có giới hạn)

**Ưu điểm:**
- Miễn phí tier (có thể sleep sau 15 phút không hoạt động)
- Dễ setup
- Auto deploy từ GitHub

**Cách deploy:**
1. Đăng ký tại [render.com](https://render.com)
2. New → Web Service → Connect GitHub repo
3. Cấu hình:
   - **Build Command:** `npm install`
   - **Start Command:** `node startRebalanceSpotBot.js --key=$BITGET_API_KEY --secret=$BITGET_API_SECRET --passphrase=$BITGET_PASSPHRASE --interval=4`
4. Vào Environment → Add:
   ```
   BITGET_API_KEY=bg_341563e7ffde3387dd8d85b38d039671
   BITGET_API_SECRET=e3b3e24d8d80de7739b0fd5553a9a908ab1894a39710491bb0b0807c332991fe
   BITGET_PASSPHRASE=123abcABCD
   ```
5. Deploy!

**Lưu ý:** Free tier có thể sleep, nên dùng Background Worker thay vì Web Service.

---

### 3. **DigitalOcean App Platform** (Trả phí từ $5/tháng)

**Ưu điểm:**
- Ổn định, không sleep
- Hỗ trợ Docker tốt
- Auto deploy

**Cách deploy:**
1. Đăng ký tại [digitalocean.com](https://digitalocean.com)
2. App Platform → Create App → GitHub
3. Chọn repo
4. Cấu hình:
   - Build: `npm install`
   - Run: `node startRebalanceSpotBot.js --key=$BITGET_API_KEY --secret=$BITGET_API_SECRET --passphrase=$BITGET_PASSPHRASE --interval=4`
5. Thêm Environment Variables
6. Deploy!

---

### 4. **Google Cloud Run** (Pay-as-you-go, rất rẻ)

**Ưu điểm:**
- Chỉ trả tiền khi chạy (rất rẻ cho bot)
- Không giới hạn thời gian chạy
- Dễ scale

**Cách deploy:**
1. Cài Google Cloud SDK
2. Build Docker image:
   ```bash
   docker build -t gcr.io/YOUR_PROJECT_ID/rebalance-bot -f Dockerfile.rebalance .
   docker push gcr.io/YOUR_PROJECT_ID/rebalance-bot
   ```
3. Deploy:
   ```bash
   gcloud run deploy rebalance-bot \
     --image gcr.io/YOUR_PROJECT_ID/rebalance-bot \
     --platform managed \
     --region asia-southeast1 \
     --set-env-vars BITGET_API_KEY=...,BITGET_API_SECRET=...,BITGET_PASSPHRASE=... \
     --memory 512Mi \
     --timeout 3600 \
     --max-instances 1
   ```

---

### 5. **VPS (DigitalOcean, Linode, Vultr)** ⭐ (Linh hoạt nhất)

**Ưu điểm:**
- Toàn quyền kiểm soát
- Giá rẻ ($5-6/tháng)
- Chạy nhiều bot cùng lúc
- Dùng PM2 để quản lý

**Cách deploy:**

#### Bước 1: Tạo VPS
- DigitalOcean Droplet ($5/tháng, 1GB RAM)
- Ubuntu 22.04

#### Bước 2: SSH vào VPS
```bash
ssh root@YOUR_VPS_IP
```

#### Bước 3: Cài đặt Node.js và PM2
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Cài Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Cài PM2
sudo npm install -g pm2

# Verify
node --version
pm2 --version
```

#### Bước 4: Upload code lên VPS
```bash
# Cách 1: Clone từ GitHub (nếu có repo)
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git ~/bot-bitget
cd ~/bot-bitget
npm install --only=production

# Cách 2: Upload qua SCP (từ máy local)
# scp -r /path/to/bot-bitget root@YOUR_VPS_IP:~/bot-bitget
# ssh root@YOUR_VPS_IP
# cd ~/bot-bitget && npm install --only=production
```

#### Bước 5: Chạy bot với PM2
```bash
cd ~/bot-bitget

# Chạy bot
pm2 start startRebalanceSpotBot.js \
  --name rebalance-bot \
  -- \
  --key=bg_341563e7ffde3387dd8d85b38d039671 \
  --secret=e3b3e24d8d80de7739b0fd5553a9a908ab1894a39710491bb0b0807c332991fe \
  --passphrase=123abcABCD \
  --interval=4

# Lưu cấu hình PM2
pm2 save

# Setup auto restart khi reboot
pm2 startup systemd
# Copy và chạy lệnh mà PM2 hiển thị

# Xem logs
pm2 logs rebalance-bot

# Xem status
pm2 status

# Restart bot
pm2 restart rebalance-bot

# Stop bot
pm2 stop rebalance-bot
```

#### Bước 6: (Tùy chọn) Dùng file ecosystem.config.js
```bash
# Tạo file ecosystem.config.js (đã có sẵn trong repo)
pm2 start ecosystem.config.js
pm2 save
```

---

### 6. **Heroku** (Có free tier nhưng đã ngừng, chỉ trả phí)

**Ưu điểm:**
- Dễ deploy
- Hỗ trợ tốt

**Cách deploy:**
1. Cài Heroku CLI
2. Login: `heroku login`
3. Tạo app: `heroku create your-bot-name`
4. Set env vars:
   ```bash
   heroku config:set BITGET_API_KEY=bg_341563e7ffde3387dd8d85b38d039671
   heroku config:set BITGET_API_SECRET=e3b3e24d8d80de7739b0fd5553a9a908ab1894a39710491bb0b0807c332991fe
   heroku config:set BITGET_PASSPHRASE=123abcABCD
   ```
5. Deploy: `git push heroku main`
6. Scale: `heroku ps:scale worker=1`

---

## 🔧 File Cấu Hình

### ecosystem.config.js (PM2)
File này đã được tạo sẵn trong repo, dùng cho VPS với PM2.

### Dockerfile.rebalance
File Docker cho Rebalance bot, dùng cho Railway, Render, Cloud Run.

### railway.json
Cấu hình cho Railway platform.

---

## 🔐 Bảo Mật

**⚠️ QUAN TRỌNG:** Không commit API keys vào Git!

1. Dùng Environment Variables trên cloud platform
2. Thêm `.env` vào `.gitignore`
3. Không share API keys công khai

---

## 📊 Monitoring

### Với PM2 (VPS):
```bash
# Xem logs real-time
pm2 logs rebalance-bot

# Xem logs với giới hạn dòng
pm2 logs rebalance-bot --lines 100

# Monitor
pm2 monit
```

### Với Railway/Render:
- Xem logs trực tiếp trên dashboard
- Có thể setup alerts

---

## 🐛 Troubleshooting

### Bot không chạy:
1. Kiểm tra logs: `pm2 logs` hoặc dashboard
2. Kiểm tra API keys có đúng không
3. Kiểm tra network connection
4. Kiểm tra Node.js version: `node --version`

### Bot bị crash:
1. PM2 sẽ auto restart (nếu đã setup)
2. Kiểm tra logs để tìm lỗi
3. Kiểm tra memory usage

### Bot không trade:
1. Kiểm tra API permissions trên Bitget
2. Kiểm tra balance
3. Kiểm tra config (interval, minOrderValue, etc.)

---

## 💰 Chi Phí Ước Tính

| Platform | Chi phí/tháng | Ghi chú |
|----------|---------------|---------|
| Railway | $0-5 | Free tier $5 credit |
| Render | $0-7 | Free tier có thể sleep |
| DigitalOcean App | $5+ | Không sleep |
| Google Cloud Run | ~$1-3 | Pay-as-you-go |
| VPS (DO/Linode) | $5-6 | Toàn quyền kiểm soát |
| Heroku | $7+ | Không có free tier |

**Khuyến nghị:** VPS với PM2 ($5/tháng) hoặc Railway (free tier).

---

## 📝 Checklist Deploy

- [ ] Chọn platform
- [ ] Setup environment variables
- [ ] Test bot chạy local trước
- [ ] Deploy lên platform
- [ ] Kiểm tra logs
- [ ] Verify bot đang chạy
- [ ] Setup monitoring/alerts (tùy chọn)

---

## 🆘 Hỗ Trợ

Nếu gặp vấn đề:
1. Kiểm tra logs
2. Xem lại hướng dẫn
3. Kiểm tra API credentials
4. Test local trước khi deploy

---

**Chúc bạn deploy thành công! 🚀**
