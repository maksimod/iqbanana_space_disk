// Базовая структура данных для диска
const DiskSchema = {
  // Основная информация о диске
  name: String,
  path: String,
  mountPoint: String,
  total: Number,
  used: Number,
  free: Number,
  userFilesSize: Number,
  
  // Информация о статусе
  status: {
    type: String,
    enum: ['online', 'offline', 'error'],
    default: 'offline'
  },
  error: String,
  
  // Информация о бэкапе
  backupStatus: {
    type: String,
    enum: ['PROCESSING', 'SUCCESS', 'ERROR', null],
    default: null
  },
  backupMessage: String,
  backupUpdatedAt: Date,
  
  // Временные метки
  createdAt: Date,
  updatedAt: Date
};

module.exports = DiskSchema; 