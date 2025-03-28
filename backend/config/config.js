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
    'disk_sdb': '/mnt/storage/sdb',
    'disk_sdc': '/mnt/storage/sdc',
  },
  
  // Настройки производительности для файловых операций
  performance: {
    chunkSize: 8 * 1024 * 1024, // 8 MB для чтения файлов по частям
    concurrentUploads: 4, // Макс. количество одновременных загрузок
    maxFileSize: 20 * 1024 * 1024 * 1024, // 20 GB максимальный размер файла
    uploadTimeout: 3600000, // 1 час таймаут для загрузки
    readBufferSize: 4096 * 1024, // 4 MB буфер для чтения файлов
    writeBufferSize: 8192 * 1024 // 8 MB буфер для записи файлов
  }
};

module.exports = config;
