// Конфигурация приложения
const config = {
  // Базовые настройки
  server: {
    port: process.env.PORT || 6005,
    allowedOrigins: [
      'http://46.35.241.37:6001', 
      'http://localhost:6001',
      'https://iqbanana.online',
      'http://iqbanana.online'
    ]
  },
  
  // Версия API
  apiVersion: 'v1',
  
  // Пути к смонтированным дискам на веб-сервере
  disks: {
    'disk_sda': '/mnt/storage/sda',
  },
  
  // Настройки производительности для файловых операций
  performance: {
    chunkSize: 8 * 1024 * 1024,
    concurrentUploads: 4,
    maxFileSize: 10 * 1024 * 1024 * 1024
  }
};

module.exports = config;
