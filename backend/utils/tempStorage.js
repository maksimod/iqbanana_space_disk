const fs = require('fs');
const path = require('path');
const os = require('os');
const { promisify } = require('util');
const logger = require('./logger');

// Промисифицированные fs функции
const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);
const unlink = promisify(fs.unlink);
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

// Директория для временных файлов на сервере
const TEMP_DIR = path.join(os.tmpdir(), 'disk-manager-temp');

// Настройки хранения
const MAX_TEMP_AGE = 7 * 24 * 60 * 60 * 1000; // 7 дней в миллисекундах
const CLEANUP_INTERVAL = 6 * 60 * 60 * 1000; // Очистка каждые 6 часов

/**
 * Инициализация временного хранилища
 */
async function initTempStorage() {
  try {
    // Создаем директорию для временных файлов, если она не существует
    if (!fs.existsSync(TEMP_DIR)) {
      await mkdir(TEMP_DIR, { recursive: true });
      logger.info(`Создана директория для временных файлов: ${TEMP_DIR}`);
    }
    
    // Запускаем периодическую очистку старых временных файлов
    scheduleCleanup();
    
    return TEMP_DIR;
  } catch (error) {
    logger.error('Ошибка при инициализации временного хранилища:', error);
    throw error;
  }
}

/**
 * Сохранение временного файла
 * @param {string} fileId - идентификатор файла
 * @param {Buffer} data - данные файла
 * @param {Object} metadata - метаданные файла
 * @returns {Promise<string>} - путь к сохраненному файлу
 */
async function saveTempFile(fileId, data, metadata = {}) {
  try {
    const filePath = path.join(TEMP_DIR, fileId);
    const metadataPath = path.join(TEMP_DIR, `${fileId}.meta`);
    
    // Сохраняем файл
    await writeFile(filePath, data);
    
    // Сохраняем метаданные
    const metaData = {
      ...metadata,
      timestamp: Date.now(),
      size: data.length,
      status: 'temp'
    };
    
    await writeFile(metadataPath, JSON.stringify(metaData));
    
    logger.info(`Временный файл сохранен: ${fileId} (${data.length} байт)`);
    return filePath;
  } catch (error) {
    logger.error(`Ошибка при сохранении временного файла ${fileId}:`, error);
    throw error;
  }
}

/**
 * Получение временного файла
 * @param {string} fileId - идентификатор файла
 * @returns {Promise<{data: Buffer, metadata: Object}>} - данные и метаданные файла
 */
async function getTempFile(fileId) {
  try {
    const filePath = path.join(TEMP_DIR, fileId);
    const metadataPath = path.join(TEMP_DIR, `${fileId}.meta`);
    
    // Проверяем существование файла
    if (!fs.existsSync(filePath)) {
      throw new Error(`Временный файл не найден: ${fileId}`);
    }
    
    // Читаем файл и метаданные
    const data = await readFile(filePath);
    let metadata = {};
    
    if (fs.existsSync(metadataPath)) {
      const metaContent = await readFile(metadataPath, 'utf8');
      metadata = JSON.parse(metaContent);
    }
    
    return { data, metadata };
  } catch (error) {
    logger.error(`Ошибка при получении временного файла ${fileId}:`, error);
    throw error;
  }
}

/**
 * Удаление временного файла
 * @param {string} fileId - идентификатор файла
 * @returns {Promise<boolean>} - успешность удаления
 */
async function removeTempFile(fileId) {
  try {
    const filePath = path.join(TEMP_DIR, fileId);
    const metadataPath = path.join(TEMP_DIR, `${fileId}.meta`);
    
    // Удаляем файл и метаданные
    if (fs.existsSync(filePath)) {
      await unlink(filePath);
    }
    
    if (fs.existsSync(metadataPath)) {
      await unlink(metadataPath);
    }
    
    logger.info(`Временный файл удален: ${fileId}`);
    return true;
  } catch (error) {
    logger.error(`Ошибка при удалении временного файла ${fileId}:`, error);
    return false;
  }
}

/**
 * Обновление метаданных временного файла
 * @param {string} fileId - идентификатор файла
 * @param {Object} updates - обновления для метаданных
 * @returns {Promise<Object>} - обновленные метаданные
 */
async function updateTempFileMetadata(fileId, updates) {
  try {
    const metadataPath = path.join(TEMP_DIR, `${fileId}.meta`);
    
    // Проверяем существование метаданных
    if (!fs.existsSync(metadataPath)) {
      throw new Error(`Метаданные для файла не найдены: ${fileId}`);
    }
    
    // Читаем текущие метаданные
    const metaContent = await readFile(metadataPath, 'utf8');
    const metadata = JSON.parse(metaContent);
    
    // Обновляем метаданные
    const updatedMetadata = {
      ...metadata,
      ...updates,
      lastUpdated: Date.now()
    };
    
    // Сохраняем обновленные метаданные
    await writeFile(metadataPath, JSON.stringify(updatedMetadata));
    
    logger.debug(`Обновлены метаданные временного файла: ${fileId}`, updates);
    return updatedMetadata;
  } catch (error) {
    logger.error(`Ошибка при обновлении метаданных файла ${fileId}:`, error);
    throw error;
  }
}

/**
 * Перемещение временного файла в постоянное хранилище
 * @param {string} fileId - идентификатор файла
 * @param {string} destination - путь назначения
 * @returns {Promise<boolean>} - успешность операции
 */
async function moveTempFile(fileId, destination) {
  try {
    const { data, metadata } = await getTempFile(fileId);
    
    // Создаем директории по пути назначения, если они не существуют
    const destDir = path.dirname(destination);
    if (!fs.existsSync(destDir)) {
      await mkdir(destDir, { recursive: true });
    }
    
    // Записываем файл в постоянное хранилище
    await writeFile(destination, data);
    
    // Обновляем метаданные и удаляем временный файл
    await updateTempFileMetadata(fileId, { 
      status: 'moved',
      destination,
      movedAt: Date.now() 
    });
    
    logger.info(`Временный файл ${fileId} перемещен в ${destination}`);
    return true;
  } catch (error) {
    logger.error(`Ошибка при перемещении временного файла ${fileId}:`, error);
    return false;
  }
}

/**
 * Очистка старых временных файлов
 */
async function cleanupOldTempFiles() {
  try {
    logger.info('Запуск очистки старых временных файлов');
    
    const now = Date.now();
    const files = await readdir(TEMP_DIR);
    let cleanedCount = 0;
    let cleanedSize = 0;
    
    for (const file of files) {
      try {
        const filePath = path.join(TEMP_DIR, file);
        const fileStat = await stat(filePath);
        
        // Если это метаданные, пропускаем - они будут удалены вместе с файлом
        if (file.endsWith('.meta')) continue;
        
        // Проверяем время создания файла
        const fileAge = now - fileStat.mtime.getTime();
        
        // Если файл старше установленного срока, удаляем его
        if (fileAge > MAX_TEMP_AGE) {
          await removeTempFile(file);
          cleanedCount++;
          cleanedSize += fileStat.size;
        }
      } catch (fileError) {
        logger.warn(`Ошибка при проверке временного файла ${file}:`, fileError);
      }
    }
    
    logger.info(`Очистка завершена: удалено ${cleanedCount} файлов (${formatBytes(cleanedSize)})`);
  } catch (error) {
    logger.error('Ошибка при очистке временных файлов:', error);
  }
}

/**
 * Планирование регулярной очистки
 */
function scheduleCleanup() {
  // Запускаем первую очистку
  cleanupOldTempFiles();
  
  // Устанавливаем интервал для регулярных очисток
  setInterval(cleanupOldTempFiles, CLEANUP_INTERVAL);
  logger.info(`Установлен интервал очистки временных файлов: ${CLEANUP_INTERVAL / (60 * 60 * 1000)} часов`);
}

/**
 * Форматирование размера в читаемый вид
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

module.exports = {
  initTempStorage,
  saveTempFile,
  getTempFile,
  removeTempFile,
  updateTempFileMetadata,
  moveTempFile,
  cleanupOldTempFiles,
  TEMP_DIR
};