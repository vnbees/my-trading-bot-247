module.exports = {
  apps: [
    {
      name: 'rebalance-spot-bot',
      script: 'startRebalanceSpotBot.js',
      args: [
        '--key=bg_341563e7ffde3387dd8d85b38d039671',
        '--secret=e3b3e24d8d80de7739b0fd5553a9a908ab1894a39710491bb0b0807c332991fe',
        '--passphrase=123abcABCD',
        '--interval=4'
      ],
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      error_file: './logs/rebalance-error.log',
      out_file: './logs/rebalance-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
