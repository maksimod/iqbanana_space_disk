const { exec } = require('child_process');
const util = require('util');
const fs = require('fs');
const path = require('path');
const config = require('../config/config');
const logger = require('../utils/logger');

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
        
        if (!isMounted) {
          logger.warn(`Диск ${name} (${mountPoint}) не смонтирован или недоступен`);
          return {
            name,
            mountPoint,
            error: 'Не удалось получить информацию о диске',
            total: 0,
            free: 0,
            used: 0,
            status: 'offline'
          };
        }

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
          return {
            name,
            mountPoint,
            error: 'Не удалось получить информацию о диске',
            total: 0,
            free: 0,
            used: 0,
            status: 'error'
          };
        }

        // Получаем общее пространство и доступное из df
        const totalKB = parseInt(dfParts[1], 10);
        const freeKB = parseInt(dfParts[3], 10);
        
        // Используем более простую и быструю оценку используемого пространства 
        // вместо выполнения длительной операции du
        const usedKB = totalKB - freeKB;
        
        // Конвертируем в байты
        const total = totalKB * 1024;
        const free = freeKB * 1024;
        const used = usedKB * 1024;
        
        logger.info(`Диск ${name} - данные из df: total=${formatBytes(total)}, free=${formatBytes(free)}, used=${formatBytes(used)}`);
        
        return {
          name,
          mountPoint,
          total,
          free,
          used,
          status: 'online'
        };
      } catch (error) {
        logger.error(`Ошибка при получении информации о диске ${name} (${mountPoint})`, error);
        
        // Отмечаем диск как недоступный при ошибке
        global.mountedDisks[name] = false;
        
        return {
          name,
          mountPoint,
          error: 'Не удалось получить информацию о диске',
          total: 0,
          free: 0,
          used: 0,
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