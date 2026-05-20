module.exports = {
  apps: [{
    name: 'kanban-api',
    script: 'src/index.js',
    cwd: __dirname,
    env: {
      NODE_ENV: 'production',
      PORT: 3002,
    },
    instances: 1,
    autorestart: true,
    max_memory_restart: '256M',
  }],
};
