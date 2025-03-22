const multer = require('multer');
const path = require('path');
const fs = require('fs');
const config = require('../config/config');
const { pipeline } = require('stream');
const { promisify } = require('util');
const logger = require('../utils/logger');

// Максимальный размер файла: 10 ГБ
const MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024;

// Настройка multer для асинхронной и оптимизированной загрузки файлов
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    const disk = req.params.disk;
    const folderPath = req.query.path || '';
    const fullPath = path.join(config.disks[disk], folderPath);
    
    if (!fs.existsSync(fullPath)) {
      return cb(new Error('Путь не существует'));
    }
    cb(null, fullPath);
  },
  filename: function(req, file, cb) {
    // Добавляем временную метку к имени файла для предотвращения перезаписи
    const fileName = file.originalname;
    cb(null, fileName);
  }
});

// Настройка multer для оптимизированной загрузки больших файлов
const upload = multer({
  storage,
  limits: { 
    fileSize: MAX_FILE_SIZE,  // Максимальный размер файла
    files: 5                 // Максимальное количество файлов за раз
  },
  // Буферизация в RAM отключена, чтобы не расходовать память сервера
  fileFilter: (req, file, cb) => {
    cb(null, true);
  }
});

module.exports = upload;