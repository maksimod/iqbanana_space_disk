const { exec } = require('child_process');
const util = require('util');
const config = require('../config/config');
const logger = require('../utils/logger');

const execPromise = util.promisify(exec);

/**
 * Получение списка дисков с информацией о пространстве
 */
const getDisks = async (req, res, next) => {
  try {
    logger.info('Запрос на получение списка дисков');
    
    const diskPromises = Object.entries(config.disks).map(async ([name, mountPoint]) => {
      try {
        // Проверяем, смонтирован ли диск
        const isMounted = await checkIfMounted(mountPoint);
        
        if (!isMounted) {
          logger.warn(`Диск ${name} (${mountPoint}) не смонтирован или недоступен`);
          return {
            name,
            mountPoint,
            error: 'Диск не смонтирован или недоступен',
            total: 0,
            free: 0,
            used: 0
          };
        }
        
        // Используем df -h для получения человекочитаемых размеров
        const { stdout } = await execPromise(`df -h "${mountPoint}" | tail -n 1`);
        
        // Парсим вывод команды df
        const parts = stdout.trim().split(/\s+/);
        
        if (parts.length < 4) {
          logger.error(`Неправильный формат вывода df для ${mountPoint}: ${stdout}`);
          return {
            name,
            mountPoint,
            error: 'Не удалось получить информацию о диске',
            total: 0,
            free: 0,
            used: 0
          };
        }
        
        // Преобразуем значения размеров в байты для единообразия
        const total = convertToBytes(parts[1]);
        const used = convertToBytes(parts[2]);
        const free = convertToBytes(parts[3]);
        
        logger.info(`Диск ${name} (${mountPoint}): total=${parts[1]}, used=${parts[2]}, free=${parts[3]}`);
        
        return {
          name,
          mountPoint,
          total,
          free,
          used
        };
      } catch (error) {
        logger.error(`Ошибка при получении информации о диске ${name} (${mountPoint})`, error);
        return {
          name,
          mountPoint,
          error: 'Не удалось получить информацию о диске',
          total: 0,
          free: 0,
          used: 0
        };
      }
    });
    
    const results = await Promise.all(diskPromises);
    logger.info(`Получена информация о ${results.length} дисках`);
    res.json(results);
  } catch (error) {
    logger.error('Ошибка при получении информации о дисках', error);
    next(error);
  }
};

/**
 * Проверка монтирования диска
 */
async function checkIfMounted(mountPoint) {
  try {
    const { stdout } = await execPromise(`df "${mountPoint}" | grep "${mountPoint}"`);
    return !!stdout.trim();
  } catch (error) {
    return false;
  }
}

/**
 * Преобразование человекочитаемого размера в байты
 */
function convertToBytes(sizeStr) {
  if (!sizeStr || typeof sizeStr !== 'string') return 0;
  
  // Находим число и единицу измерения (K, M, G, T)
  const match = sizeStr.match(/^(\d+(?:\.\d+)?)([KMGT])?/i);
  if (!match) return 0;
  
  const [, size, unit] = match;
  const numSize = parseFloat(size);
  
  switch (unit && unit.toUpperCase()) {
    case 'T': return numSize * 1024 * 1024 * 1024 * 1024;
    case 'G': return numSize * 1024 * 1024 * 1024;
    case 'M': return numSize * 1024 * 1024;
    case 'K': return numSize * 1024;
    default: return numSize;
  }
}

module.exports = {
  getDisks
};