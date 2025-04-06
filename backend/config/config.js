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
  get backupApiKey() {
    const apiKey = process.env.BACKUP_API_KEY;
    if (!apiKey) {
      console.error('КРИТИЧЕСКАЯ ОШИБКА: Не задан BACKUP_API_KEY в .env файле!');
      console.error('Пожалуйста, добавьте переменную BACKUP_API_KEY в .env файл.');
      console.error('Например: BACKUP_API_KEY=mySecureKey');
      
      // Можно также использовать process.exit(1) для аварийного завершения приложения
      // process.exit(1);
      
      // Возвращаем null, чтобы приложение могло проверить наличие ключа
      return null;
    }
    return apiKey;
  },
  
  // Настройки для резервного копирования
  backup: {
    path: process.env.BACKUP_PATH || '/mnt/backup_',
    maxBackups: 5, // Максимальное количество сохраняемых бэкапов для каждого диска
    retentionDays: 30 // Сколько дней хранить резервные копии
  },

  // Соответствие имен дисков и UUID для бэкапов
  backup_disks: {
  "C": "ae3ff395-3049-4ec8-8524-3ed631eb4a46"
}
};

module.exports = config;
