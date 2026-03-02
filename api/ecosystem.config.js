module.exports = {
  apps: [{
    name:        'menu-cogs-api',
    script:      './src/index.js',
    cwd:         '/var/www/menu-cogs/api',
    user:        'mcogs',
    instances:   1,
    autorestart: true,
    watch:       false,
    max_memory_restart: '512M',
    env: { NODE_ENV: 'development', PORT: '3001' },
    error_file:  '/var/log/pm2/menu-cogs-api-error.log',
    out_file:    '/var/log/pm2/menu-cogs-api-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }],
};
