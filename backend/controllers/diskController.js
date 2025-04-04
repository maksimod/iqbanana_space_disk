const { exec } = require('child_process');
const util = require('util');
const fs = require('fs');
const path = require('path');
const config = require('../config/config');
const logger = require('../utils/logger');
const { Disk } = require('../models');

const execPromise = util.promisify(exec);
const fsPromises = fs.promises;

/**
 * Создает промис, который отклоняется после указанного таймаута
 * @param {number} ms - Время в миллисекундах
 * @param {string} message - Сообщение об ошибке
 * @returns {Promise} - Промис с таймаутом
 */
function timeoutPromise(ms, message) {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(message || `Операция прервана по таймауту (${ms}ms)`));
    }, ms);
  });
}

/**
 * Выполняет Promise с ограничением по времени
 * @param {Promise} promise - Промис для выполнения
 * @param {number} ms - Таймаут в миллисекундах
 * @param {string} message - Сообщение об ошибке
 * @returns {Promise} - Результат промиса или ошибка по таймауту
 */
function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    timeoutPromise(ms, message)
  ]);
}

/**
 * Получение списка дисков с информацией о пространстве
 */
const getDisks = async (req, res, next) => {
  try {
    logger.info('Запрос на получение списка дисков');
    
    const diskPromises = Object.entries(config.disks).map(async ([name, mountPoint]) => {
      try {
        // Используем глобальное состояние смонтированности дисков
        const isMounted = global.mountedDisks[name] === true;
        
        let diskData = {
          name,
          mountPoint,
          total: 0,
          free: 0,
          used: 0,
          userFilesSize: 0,
          status: isMounted ? 'online' : 'offline'
        };
        
        if (!isMounted) {
          logger.warn(`Диск ${name} (${mountPoint}) не смонтирован или недоступен`);
          diskData.error = 'Не удалось получить информацию о диске';
        } else {
          // Получаем общий размер и доступное пространство из df с таймаутом
          const dfPromise = execPromise(`df -k "${mountPoint}" | tail -n 1`);
          const { stdout: dfOutput } = await withTimeout(
            dfPromise, 
            2000, 
            `Таймаут получения информации о диске ${name}`
          );
          
          const dfParts = dfOutput.trim().split(/\s+/);
          
          if (dfParts.length < 4) {
            logger.error(`Неправильный формат вывода df для ${mountPoint}: ${dfOutput}`);
            diskData.error = 'Не удалось получить информацию о диске';
            diskData.status = 'error';
          } else {
            // Получаем общее пространство и доступное из df
            const totalKB = parseInt(dfParts[1], 10);
            const freeKB = parseInt(dfParts[3], 10);
            
            // Используем более простую и быструю оценку используемого пространства 
            // вместо выполнения длительной операции du
            const usedKB = totalKB - freeKB;
            
            // Конвертируем в байты и обрабатываем NaN значения
            diskData.total = isNaN(totalKB) ? 0 : totalKB * 1024;
            diskData.free = isNaN(freeKB) ? 0 : freeKB * 1024;
            diskData.used = isNaN(usedKB) ? 0 : usedKB * 1024;
            
            // Вычисляем размер пользовательских файлов, исключая системные
            try {
              // Используем du с исключением системных файлов
              const { stdout: duOutput } = await withTimeout(
                execPromise(`find "${mountPoint}" -type f -not -path "*/\\.*" -not -path "*/.tmp_chunks*" -not -name ".disk_uuid" -exec du -sk {} \\; | awk '{sum += $1} END {print sum}'`),
                5000, // Увеличиваем таймаут для этой операции
                `Таймаут при подсчете пользовательских файлов на диске ${name}`
              );
              
              // Обрабатываем возможные NaN значения
              const parsedSize = parseInt(duOutput.trim(), 10);
              diskData.userFilesSize = isNaN(parsedSize) ? 0 : parsedSize * 1024; // Конвертируем KB в байты
              logger.info(`Размер пользовательских файлов на диске ${name}: ${formatBytes(diskData.userFilesSize)}`);
            } catch (error) {
              logger.warn(`Не удалось получить размер пользовательских файлов для ${name}`, error);
              // Если не удалось получить размер пользовательских файлов, используем 0
              diskData.userFilesSize = 0;
            }
            
            logger.info(`Диск ${name} - данные из df: total=${formatBytes(diskData.total)}, free=${formatBytes(diskData.free)}, used=${formatBytes(diskData.used)}, userFiles=${formatBytes(diskData.userFilesSize)}`);
          }
        }
        
        // Обновляем или создаем запись в базе данных
        try {
          // Ищем диск в базе данных
          let disk = await Disk.findOne({ name });
          
          if (disk) {
            // Обновляем существующую запись
            disk.mountPoint = diskData.mountPoint;
            disk.total = diskData.total;
            disk.free = diskData.free;
            disk.used = diskData.used;
            disk.userFilesSize = diskData.userFilesSize;
            disk.status = diskData.status;
            disk.error = diskData.error || null;
            await disk.save();
          } else {
            // Создаем новую запись
            disk = new Disk(diskData);
            await disk.save();
          }
          
          // Возвращаем данные из базы со статусом бэкапа
          return {
            name: disk.name,
            mountPoint: disk.mountPoint,
            total: disk.total,
            free: disk.free,
            used: disk.used,
            userFilesSize: disk.userFilesSize,
            status: disk.status,
            error: disk.error,
            backupStatus: disk.backupStatus,
            backupMessage: disk.backupMessage,
            backupUpdatedAt: disk.backupUpdatedAt
          };
        } catch (dbError) {
          logger.error(`Ошибка при обновлении/создании диска ${name} в базе данных`, dbError);
          // Возвращаем данные без сохранения в базу при ошибке
          return diskData;
        }
      } catch (error) {
        logger.error(`Ошибка при получении информации о диске ${name} (${mountPoint})`, error);
        
        // Отмечаем диск как недоступный при ошибке
        global.mountedDisks[name] = false;
        
        // Обновляем статус в базе данных
        try {
          let disk = await Disk.findOne({ name });
          if (disk) {
            disk.status = 'error';
            disk.error = 'Не удалось получить информацию о диске';
            await disk.save();
          } else {
            disk = new Disk({
              name,
              mountPoint,
              status: 'error',
              error: 'Не удалось получить информацию о диске'
            });
            await disk.save();
          }
        } catch (dbError) {
          logger.error(`Ошибка при обновлении статуса диска ${name} в базе данных`, dbError);
        }
        
        return {
          name,
          mountPoint,
          error: 'Не удалось получить информацию о диске',
          total: 0,
          free: 0,
          used: 0,
          userFilesSize: 0,
          status: 'error'
        };
      }
    });
    
    // Устанавливаем общий таймаут для всех операций
    const results = await Promise.all(diskPromises);
    logger.info(`Получена информация о ${results.length} дисках`);
    res.json(results);
  } catch (error) {
    logger.error('Ошибка при получении информации о дисках', error);
    next(error);
  }
};

// Вспомогательная функция для форматирования байтов
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Проверка доступности диска - новый метод для внешнего API
 */
const checkDiskStatus = async (req, res, next) => {
  try {
    const { disk } = req.params;
    
    if (!config.disks[disk]) {
      return res.status(404).json({ error: 'Диск не найден' });
    }
    
    const mountPoint = config.disks[disk];
    const isMounted = global.mountedDisks[disk] === true;
    
    if (!isMounted) {
      return res.json({
        name: disk,
        status: 'offline',
        message: 'Диск не смонтирован или недоступен'
      });
    }
    
    // Быстрая проверка доступности с таймаутом
    try {
      // Используем df с таймаутом для проверки доступности
      const dfPromise = execPromise(`df -k "${mountPoint}" | grep "${mountPoint}"`);
      await withTimeout(dfPromise, 1500, `Таймаут проверки доступности диска ${disk}`);
      
      return res.json({
        name: disk,
        status: 'online',
        message: 'Диск доступен и работает корректно'
      });
    } catch (error) {
      logger.error(`Ошибка или таймаут при проверке диска ${disk}`, error);
      
      // Отмечаем диск как недоступный
      global.mountedDisks[disk] = false;
      
      return res.json({
        name: disk,
        status: 'error',
        message: 'Ошибка при проверке доступности диска'
      });
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Принудительное обновление статуса всех дисков
 */
const refreshDisksStatus = async (req, res, next) => {
  try {
    logger.info('Запрос на обновление статуса всех дисков');
    
    const results = {};
    
    for (const [name, mountPoint] of Object.entries(config.disks)) {
      try {
        // Проверка через df с таймаутом
        const dfPromise = execPromise(`df "${mountPoint}" | grep "${mountPoint}"`);
        const dfCheck = await withTimeout(dfPromise, 1500, `Таймаут df для диска ${name}`)
          .then(() => true)
          .catch(() => {
            logger.warn(`Диск ${name} недоступен по df (таймаут или ошибка)`);
            return false;
          });
        
        if (!dfCheck) {
          // Если df проверка не прошла, сразу помечаем диск как недоступный
          global.mountedDisks[name] = false;
          results[name] = {
            status: 'offline',
            message: 'Диск не обнаружен'
          };
          continue;
        }
        
        // Если первая проверка прошла успешно, помечаем диск как доступный
        global.mountedDisks[name] = true;
        results[name] = {
          status: 'online',
          message: 'Диск доступен'
        };
      } catch (error) {
        logger.error(`Ошибка при обновлении статуса диска ${name}`, error);
        global.mountedDisks[name] = false;
        results[name] = {
          status: 'error',
          message: 'Ошибка при проверке диска'
        };
      }
    }
    
    res.json({
      success: true,
      message: 'Статус дисков обновлен',
      results
    });
  } catch (error) {
    logger.error('Ошибка при обновлении статуса дисков', error);
    next(error);
  }
};

module.exports = {
  getDisks,
  checkDiskStatus,
  refreshDisksStatus
};