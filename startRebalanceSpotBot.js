const { BitgetApi } = require('./bitgetApi');
const { RebalanceSpotBot } = require('./rebalanceSpotBot');

/**
 * Script khởi động Rebalance Spot Bot
 * Usage:
 *   node startRebalanceSpotBot.js --key=YOUR_KEY --secret=YOUR_SECRET --passphrase=YOUR_PASSPHRASE
 *   node startRebalanceSpotBot.js --key=YOUR_KEY --secret=YOUR_SECRET --passphrase=YOUR_PASSPHRASE --interval=4
 *   node startRebalanceSpotBot.js --key=YOUR_KEY --secret=YOUR_SECRET --passphrase=YOUR_PASSPHRASE --interval=6
 */
async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  let apiKey = null;
  let apiSecret = null;
  let passphrase = '';
  let intervalHours = null; // null = chạy ngay

  for (const arg of args) {
    if (arg.startsWith('--key=')) {
      apiKey = arg.split('=')[1];
    } else if (arg.startsWith('--secret=')) {
      apiSecret = arg.split('=')[1];
    } else if (arg.startsWith('--passphrase=')) {
      passphrase = arg.split('=')[1];
    } else if (arg.startsWith('--interval=')) {
      const interval = parseInt(arg.split('=')[1]);
      if (!isNaN(interval) && interval > 0) {
        intervalHours = interval;
      }
    }
  }

  // Validate API credentials
  if (!apiKey || !apiSecret) {
    console.error('❌ Lỗi: Cần API key và secret để chạy bot');
    console.error('\nUsage:');
    console.error('  node startRebalanceSpotBot.js --key=YOUR_KEY --secret=YOUR_SECRET --passphrase=YOUR_PASSPHRASE [--interval=4]');
    console.error('\nVí dụ:');
    console.error('  # Chạy ngay lập tức');
    console.error('  node startRebalanceSpotBot.js --key=xxx --secret=yyy --passphrase=zzz');
    console.error('\n  # Chạy với interval 4 giờ (mặc định)');
    console.error('  node startRebalanceSpotBot.js --key=xxx --secret=yyy --passphrase=zzz --interval=4');
    console.error('\n  # Chạy với interval tùy chỉnh (ví dụ 6 giờ)');
    console.error('  node startRebalanceSpotBot.js --key=xxx --secret=yyy --passphrase=zzz --interval=6');
    process.exit(1);
  }

  // Khởi tạo API client
  const api = new BitgetApi({
    apiKey,
    apiSecret,
    passphrase,
  });

  // Khởi tạo bot
  const bot = new RebalanceSpotBot({
    apiClient: api,
    config: {
      intervalHours: intervalHours || undefined, // undefined = chạy ngay
      bgbMinPercent: 2,
      bgbMaxPercent: 5,
      minChangePercent: 0.5,
      minOrderValue: 1,
    },
  });

  // Chạy bot
  try {
    await bot.run();
  } catch (err) {
    console.error(`\n❌ Lỗi không mong đợi: ${err.message}`);
    console.error(`   Chi tiết: ${err.stack}`);
    process.exit(1);
  }
}

// Chạy script
if (require.main === module) {
  main().catch((err) => {
    console.error('❌ Lỗi không mong đợi:', err);
    process.exit(1);
  });
}

module.exports = { main };
