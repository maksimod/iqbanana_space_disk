const express = require('express');
const router = express.Router();
const fileController = require('../controllers/fileController');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const config = require('../config/config');
const logger = require('../utils/logger');

// Маршрут для получения списка файлов
router.get('/:disk/files', fileController.getFiles);

// Прямая и быстрая загрузка файлов
router.post('/:disk/upload', (req, res) => {
  const { disk } = req.params;
  const folderPath = req.query.path || '';
  
  if (!config.disks[disk]) {
    return res.status(404).json({ error: 'Диск не найден' });
  }
  
  const fullPath = path.join(config.disks[disk], folderPath);
  
  // Создаем конфигурацию multer с оптимизированными параметрами
  const storage = multer.diskStorage({
    destination: function(req, file, cb) {
      cb(null, fullPath);
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
  
  // Выполняем загрузку с минимальной обработкой
  upload(req, res, function(err) {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'Файл не был загружен' });
    }
    
    // Немедленно отправляем ответ клиенту
    res.json({ 
      success: true, 
      message: 'Файл успешно загружен',
      file: {
        name: req.file.originalname,
        size: req.file.size,
        path: path.join(folderPath, req.file.originalname),
        mimetype: req.file.mimetype
      }
    });
  });
});

// Остальные маршруты
router.delete('/:disk/files', fileController.deleteFile);
router.post('/:disk/createFolder', fileController.createFolder);
router.get('/:disk/download', fileController.downloadFile);

module.exports = router;