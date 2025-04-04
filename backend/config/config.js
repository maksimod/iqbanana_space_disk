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
    "C": "/mnt/data_storage/65135f15-6654-47b0-8e70-6f1a2485e8c2"
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
  },
  
  // API ключ для системы резервного копирования
  backupApiKey: process.env.BACKUP_API_KEY || 'backup_system_api_key_secure',
  
  // Настройки для резервного копирования
  backup: {
    path: process.env.BACKUP_PATH || '/mnt/backups',
    maxBackups: 5, // Максимальное количество сохраняемых бэкапов для каждого диска
    retentionDays: 30 // Сколько дней хранить резервные копии
  }
};

module.exports = config;
