const express = require('express');
const router = express.Router();
const fileController = require('../controllers/fileController');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const config = require('../config/config');
const logger = require('../utils/logger');

// Используем middleware для проверки доступности диска
// Это предотвратит любые операции с несмонтированными дисками
router.use('/:disk', (req, res, next) => {
  const { disk } = req.params;
  
  if (!config.disks[disk]) {
    logger.warn(`Попытка доступа к несуществующему диску: ${disk}`);
    return res.status(404).json({ error: 'Диск не найден' });
  }
  
  // Проверяем статус монтирования из глобального состояния
  if (!global.mountedDisks[disk]) {
    logger.error(`Попытка доступа к несмонтированному диску: ${disk}`);
    return res.status(503).json({ 
      error: 'Диск не смонтирован или недоступен', 
      status: 'offline'
    });
  }
  
  next();
});

// Маршрут для получения списка файлов
router.get('/:disk/files', fileController.getFiles);

// Прямая и быстрая загрузка файлов
router.post('/:disk/upload', (req, res) => {
  const { disk } = req.params;
  const folderPath = req.query.path || '';
  
  // Дополнительная проверка перед загрузкой - хотя middleware уже проверяет
  if (!global.mountedDisks[disk]) {
    logger.error(`Попытка загрузки на несмонтированный диск: ${disk}`);
    return res.status(503).json({ 
      error: 'Диск не смонтирован или недоступен', 
      status: 'offline'
    });
  }
  
  const fullPath = path.join(config.disks[disk], folderPath);
  
  // Создаем конфигурацию multer с оптимизированными параметрами
  const storage = multer.diskStorage({
    destination: function(req, file, cb) {
      // Проверяем существование директории перед загрузкой
      fs.access(fullPath, fs.constants.F_OK | fs.constants.W_OK, (err) => {
        if (err) {
          logger.error(`Ошибка доступа к директории для загрузки: ${fullPath}`, err);
          return cb(new Error('Директория не существует или нет прав на запись'));
        }
        cb(null, fullPath);
      });
    },
    filename: function(req, file, cb) {
      // Прямая запись без временных файлов
      cb(null, file.originalname);
    }
  });
  
  const upload = multer({ 
    storage,
    limits: { fileSize: 20 * 1024 * 1024 * 1024 } // 20 ГБ
  }).single('file');
  
  // Выполняем загрузку с проверкой успешности записи
  upload(req, res, function(err) {
    if (err) {
      logger.error(`Ошибка при загрузке файла: ${err.message}`);
      return res.status(400).json({ error: err.message });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'Файл не был загружен' });
    }
    
    // Проверка, что файл действительно записался
    const uploadedFilePath = path.join(fullPath, req.file.originalname);
    
    fs.access(uploadedFilePath, fs.constants.F_OK, (accessErr) => {
      if (accessErr) {
        logger.error(`Файл был загружен, но не найден на диске: ${uploadedFilePath}`, accessErr);
        return res.status(500).json({ error: 'Файл был загружен, но не сохранен на диске' });
      }
      
      // Дополнительная проверка размера
      fs.stat(uploadedFilePath, (statErr, stats) => {
        if (statErr) {
          logger.error(`Не удалось проверить размер загруженного файла: ${uploadedFilePath}`, statErr);
          return res.status(500).json({ error: 'Не удалось проверить размер загруженного файла' });
        }
        
        if (stats.size !== req.file.size) {
          logger.error(`Размер загруженного файла не совпадает с ожидаемым: ${stats.size} != ${req.file.size}`);
          return res.status(500).json({ error: 'Размер загруженного файла не совпадает с ожидаемым' });
        }
        
        // Файл успешно проверен, отправляем ответ
        res.json({ 
          success: true, 
          message: 'Файл успешно загружен и проверен',
          file: {
            name: req.file.originalname,
            size: req.file.size,
            path: path.join(folderPath, req.file.originalname),
            mimetype: req.file.mimetype
          }
        });
      });
    });
  });
});

// Остальные маршруты
router.delete('/:disk/files', fileController.deleteFile);
router.post('/:disk/createFolder', fileController.createFolder);
router.get('/:disk/download', fileController.downloadFile);

module.exports = router;