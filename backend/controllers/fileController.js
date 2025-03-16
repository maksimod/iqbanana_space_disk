const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const archiver = require('archiver');
const config = require('../config/config');
const logger = require('../utils/logger');

/**
 * Получение списка файлов в директории
 */
const getFiles = (req, res, next) => {
  const { disk } = req.params;
  const folderPath = req.query.path || '';
  
  if (!config.disks[disk]) {
    logger.warn(`Попытка доступа к несуществующему диску: ${disk}`);
    return res.status(404).json({ error: 'Диск не найден' });
  }
  
  const fullPath = path.join(config.disks[disk], folderPath);
  logger.info(`Запрос списка файлов: ${disk}:${folderPath} (полный путь: ${fullPath})`);
  
  // Проверяем существование и доступность директории
  fs.access(fullPath, fs.constants.F_OK | fs.constants.R_OK, (err) => {
    if (err) {
      logger.error(`Ошибка доступа к директории: ${fullPath}`, err);
      return res.status(404).json({ error: 'Директория не найдена или нет прав на чтение' });
    }
    
    // Получаем список файлов
    fs.readdir(fullPath, { withFileTypes: true }, (err, files) => {
      if (err) {
        logger.error(`Ошибка при чтении директории: ${fullPath}`, err);
        return res.status(500).json({ error: 'Не удалось прочитать директорию' });
      }
      
      try {
        // Для лучшей отладки логируем содержимое директории
        logger.info(`Найдено ${files.length} файлов в директории ${fullPath}`);
        
        const filesList = files.map(file => {
          const isDirectory = file.isDirectory();
          const filePath = path.join(fullPath, file.name);
          let fileSize = 0;
          
          try {
            const stats = fs.statSync(filePath);
            fileSize = stats.size;
          } catch (error) {
            logger.warn(`Ошибка при получении размера для ${filePath}`, error);
          }
          
          return {
            name: file.name,
            isDirectory,
            size: fileSize,
            path: path.join(folderPath, file.name)
          };
        });
        
        logger.info(`Отправка списка из ${filesList.length} файлов и папок`);
        res.json(filesList);
      } catch (error) {
        logger.error(`Ошибка при обработке списка файлов: ${fullPath}`, error);
        next(error);
      }
    });
  });
};

/**
 * Загрузка файла
 */
const uploadFile = (req, res) => {
  if (!req.file) {
    logger.warn('Попытка загрузки без файла');
    return res.status(400).json({ error: 'Файл не был загружен' });
  }
  
  const { disk } = req.params;
  const folderPath = req.query.path || '';
  logger.info(`Файл загружен: ${disk}:${path.join(folderPath, req.file.filename)} (${req.file.size} байт)`);
  
  res.json({ 
    success: true, 
    message: 'Файл успешно загружен',
    filename: req.file.filename 
  });
};

/**
 * Удаление файла или директории
 */
const deleteFile = (req, res, next) => {
  const { disk } = req.params;
  const { filePath } = req.body;
  
  if (!config.disks[disk]) {
    logger.warn(`Попытка удаления файла на несуществующем диске: ${disk}`);
    return res.status(404).json({ error: 'Диск не найден' });
  }
  
  const fullPath = path.join(config.disks[disk], filePath);
  logger.info(`Запрос на удаление: ${disk}:${filePath}`);
  
  fs.stat(fullPath, (err, stats) => {
    if (err) {
      logger.warn(`Попытка удаления несуществующего файла: ${fullPath}`, err);
      return res.status(404).json({ error: 'Файл не найден' });
    }
    
    try {
      if (stats.isDirectory()) {
        fs.rmdir(fullPath, { recursive: true }, (err) => {
          if (err) {
            logger.error(`Ошибка при удалении директории: ${fullPath}`, err);
            return res.status(500).json({ error: 'Не удалось удалить директорию' });
          }
          logger.info(`Директория удалена: ${disk}:${filePath}`);
          res.json({ success: true, message: 'Директория успешно удалена' });
        });
      } else {
        fs.unlink(fullPath, (err) => {
          if (err) {
            logger.error(`Ошибка при удалении файла: ${fullPath}`, err);
            return res.status(500).json({ error: 'Не удалось удалить файл' });
          }
          logger.info(`Файл удален: ${disk}:${filePath}`);
          res.json({ success: true, message: 'Файл успешно удален' });
        });
      }
    } catch (error) {
      next(error);
    }
  });
};

/**
 * Создание новой папки
 */
const createFolder = (req, res, next) => {
  const { disk } = req.params;
  const { folderPath, folderName } = req.body;
  
  if (!config.disks[disk]) {
    logger.warn(`Попытка создания папки на несуществующем диске: ${disk}`);
    return res.status(404).json({ error: 'Диск не найден' });
  }
  
  const fullPath = path.join(config.disks[disk], folderPath, folderName);
  logger.info(`Запрос на создание папки: ${disk}:${path.join(folderPath, folderName)}`);
  
  // Используем наш специальный скрипт через sudo
  exec(`sudo /usr/local/bin/create-folder.sh "${fullPath}"`, (err, stdout, stderr) => {
    if (err) {
      logger.error(`Ошибка при создании директории: ${fullPath}`, { error: err, stderr });
      return res.status(500).json({ error: 'Не удалось создать директорию' });
    }
    
    logger.info(`Папка создана: ${disk}:${path.join(folderPath, folderName)}`);
    res.json({ success: true, message: 'Директория успешно создана' });
  });
};

/**
 * Скачивание файла или папки
 */
const downloadFile = (req, res, next) => {
  const { disk } = req.params;
  const filePath = req.query.path || '';
  
  if (!config.disks[disk]) {
    logger.warn(`Попытка скачивания с несуществующего диска: ${disk}`);
    return res.status(404).json({ error: 'Диск не найден' });
  }
  
  const fullPath = path.join(config.disks[disk], filePath);
  logger.info(`Запрос на скачивание: ${disk}:${filePath}`);
  
  fs.stat(fullPath, (err, stats) => {
    if (err) {
      logger.error(`Ошибка при доступе к файлу: ${fullPath}`, err);
      return res.status(404).json({ error: 'Файл не найден' });
    }
    
    try {
      if (stats.isDirectory()) {
        // Если это директория, создаем zip-архив
        const archiveName = path.basename(filePath) || 'archive';
        const zipFilePath = path.join('/tmp', `${archiveName}-${Date.now()}.zip`);
        
        logger.info(`Архивирование директории: ${fullPath} -> ${zipFilePath}`);
        
        const output = fs.createWriteStream(zipFilePath);
        const archive = archiver('zip', {
          zlib: { level: 9 } // Максимальный уровень сжатия
        });
        
        output.on('close', () => {
          logger.info(`Архив создан: ${zipFilePath} (${archive.pointer()} байт)`);
          
          res.download(zipFilePath, `${archiveName}.zip`, (err) => {
            if (err) {
              logger.error(`Ошибка при отправке архива: ${zipFilePath}`, err);
            }
            
            // Удаляем временный архив после отправки
            fs.unlink(zipFilePath, (err) => {
              if (err) logger.warn(`Ошибка при удалении временного архива: ${zipFilePath}`, err);
            });
          });
        });
        
        archive.on('error', (err) => {
          logger.error(`Ошибка при создании архива: ${fullPath}`, err);
          res.status(500).json({ error: 'Ошибка при создании архива' });
        });
        
        archive.pipe(output);
        archive.directory(fullPath, false);
        archive.finalize();
      } else {
        // Если это файл, отправляем его напрямую
        logger.info(`Отправка файла: ${fullPath} (${stats.size} байт)`);
        
        res.download(fullPath, path.basename(filePath), (err) => {
          if (err) {
            logger.error(`Ошибка при скачивании файла: ${fullPath}`, err);
            if (!res.headersSent) {
              res.status(500).json({ error: 'Ошибка при скачивании файла' });
            }
          }
        });
      }
    } catch (error) {
      next(error);
    }
  });
};

module.exports = {
  getFiles,
  uploadFile,
  deleteFile,
  createFolder,
  downloadFile
};