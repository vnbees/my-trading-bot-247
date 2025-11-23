#!/usr/bin/env node

/**
 * Script helper để list các contract có sẵn trên Bitget
 * Sử dụng: node listContracts.js --key=... --secret=... --passphrase=... [--filter=SUSDT]
 */

const { hideBin } = require('yargs/helpers');
const yargs = require('yargs/yargs');
const { BitgetApi } = require('./bitgetApi');

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option('key', {
      type: 'string',
      describe: 'Bitget API key',
      demandOption: true,
    })
    .option('secret', {
      type: 'string',
      describe: 'Bitget API secret',
      demandOption: true,
    })
    .option('passphrase', {
      type: 'string',
      describe: 'Bitget API passphrase',
      demandOption: false,
      default: '',
    })
    .option('filter', {
      type: 'string',
      describe: 'Lọc theo từ khóa (ví dụ: SUSDT, BTC)',
      demandOption: false,
      default: '',
    })
    .option('productType', {
      type: 'string',
      describe: 'Product type (umcbl, cmcbl, dmcbl)',
      demandOption: false,
      default: 'umcbl',
    })
    .help()
    .alias('help', 'h').argv;

  const api = new BitgetApi({
    apiKey: argv.key,
    apiSecret: argv.secret,
    passphrase: argv.passphrase,
    mode: 'demo',
  });

  try {
    console.log(`[INFO] Đang lấy danh sách contracts (productType: ${argv.productType})...\n`);
    const contracts = await api.listAvailableContracts(argv.productType, argv.filter);
    
    if (contracts.length === 0) {
      console.log('❌ Không tìm thấy contract nào.');
      console.log('💡 Thử các productType khác: umcbl, cmcbl, dmcbl');
      return;
    }

    console.log(`✅ Tìm thấy ${contracts.length} contracts:\n`);
    console.log('Symbol'.padEnd(25), 'Tên'.padEnd(30), 'Margin Coin');
    console.log('-'.repeat(70));
    
    contracts.forEach((c) => {
      const symbol = (c.symbol || 'N/A').padEnd(25);
      const name = (c.symbolName || c.baseCoin || 'N/A').padEnd(30);
      const margin = c.marginCoin || 'N/A';
      console.log(symbol, name, margin);
    });

    if (argv.filter) {
      console.log(`\n💡 Để xem tất cả contracts, bỏ --filter=${argv.filter}`);
    }
  } catch (err) {
    console.error('❌ Lỗi:', err.message);
    if (err.stack) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

main();

