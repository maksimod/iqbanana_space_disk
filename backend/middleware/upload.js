const multer = require('multer');
const path = require('path');
const fs = require('fs');
const config = require('../config/config');
const { pipeline } = require('stream');
const { promisify } = require('util');
const logger = require('../utils/logger');
const { execSync } = require('child_process');

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
    // Создаем временный файл для загрузки
    const tempFileName = `temp_${Date.now()}_${fileName}`;
    req.tempFileName = tempFileName;
    req.finalFileName = fileName;
    cb(null, tempFileName);
  }
});

// Конфигурация для прямой записи без буферов
const fileUploadFilter = (req, file, cb) => {
  // Проверяем размер файла в mime-типе, если возможно
  // Это проверка на стороне клиента, не надежная
  if (file.size && file.size > MAX_FILE_SIZE) {
    return cb(new Error(`Файл слишком большой (макс. ${MAX_FILE_SIZE / (1024 * 1024 * 1024)} ГБ)`));
  }
  cb(null, true);
};

// Настройка multer для оптимизированной загрузки больших файлов
const upload = multer({
  storage,
  limits: { 
    fileSize: MAX_FILE_SIZE,  // Максимальный размер файла
    files: 5                 // Максимальное количество файлов за раз
  },
  fileFilter: fileUploadFilter
});

// Промежуточное ПО для обработки загрузки файла
const handleFileUpload = (req, res, next) => {
  // Используем стандартный middleware multer
  upload.single('file')(req, res, async (err) => {
    if (err) {
      logger.error('Ошибка при загрузке файла:', err);
      return res.status(400).json({ error: err.message });
    }
    
    if (!req.file) {
      return next();
    }
    
    try {
      const disk = req.params.disk;
      const folderPath = req.query.path || '';
      const fullPath = path.join(config.disks[disk], folderPath);
      
      // Путь к временному и финальному файлам
      const tempFilePath = req.file.path;
      const finalFilePath = path.join(fullPath, req.finalFileName);
      
      // Убедимся, что данные точно синхронизированы с диском
      logger.info(`Синхронизация данных для файла ${req.file.originalname}...`);
      
      // Используем fsync для гарантии записи на диск
      try {
        const fd = fs.openSync(tempFilePath, 'r');
        fs.fsyncSync(fd);
        fs.closeSync(fd);
      } catch (syncError) {
        logger.warn(`Не удалось синхронизировать файл: ${syncError.message}`);
      }
      
      // Используем dd для копирования файла с лучшим контролем буфера
      try {
        logger.info(`Копирование файла ${req.file.originalname} с использованием dd...`);
        execSync(`dd if=${tempFilePath} of=${finalFilePath} bs=1M conv=fsync status=none`);
        
        // Удаляем временный файл
        fs.unlinkSync(tempFilePath);
        
        // Обновляем путь к файлу в объекте запроса
        req.file.path = finalFilePath;
        req.file.filename = req.finalFileName;
        req.file.originalname = req.finalFileName;
        
        // Получаем реальный размер файла
        const stats = fs.statSync(finalFilePath);
        req.file.size = stats.size;
        
        logger.info(`Файл ${req.file.originalname} успешно загружен (${req.file.size} байтов)`);
      } catch (ddError) {
        logger.error(`Ошибка при копировании файла с dd: ${ddError.message}`);
        // Если dd не сработал, используем стандартное переименование
        fs.renameSync(tempFilePath, finalFilePath);
        req.file.path = finalFilePath;
        req.file.filename = req.finalFileName;
      }
      
      next();
    } catch (error) {
      logger.error('Ошибка при обработке загруженного файла:', error);
      return res.status(500).json({ error: 'Ошибка при обработке загруженного файла' });
    }
  });
};

module.exports = {
  upload,
  handleFileUpload
};