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
    'C:': '/mnt/storage/192.168.0.102/sda',
    'D:': '/mnt/storage/192.168.0.102/sdb',
    'E:': '/mnt/storage/192.168.0.106/sda',
    'F:': '/mnt/storage/192.168.0.106/sdb',
  },
  
  // Настройки производительности для файловых операций
  performance: {
    maxFileSize: 20 * 1024 * 1024 * 1024, // 20GB максимальный размер файла
    chunkSize: 5 * 1024 * 1024, // 5MB размер чанка по умолчанию для больших файлов
    maxConcurrentUploads: 5, // Максимальное количество одновременных загрузок
    uploadTimeout: 3600000, // 1 час таймаут для загрузки полного файла
    chunkTimeout: 600000, // 10 минут таймаут для загрузки чанка
    readBufferSize: 4096 * 1024, // 4 MB буфер для чтения файлов
    writeBufferSize: 8192 * 1024 // 8 MB буфер для записи файлов
  }
};

module.exports = config;
