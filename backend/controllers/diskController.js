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
        
        // Получаем данные в мегабайтах для большей точности
        const { stdout } = await execPromise(`df --block-size=1M "${mountPoint}" | tail -n 1`);
        
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
        
        // Получаем значения в мегабайтах и убираем 'M' суффикс
        const totalMB = parseInt(parts[1].replace('M', ''), 10);
        const usedMB = parseInt(parts[2].replace('M', ''), 10);
        const freeMB = parseInt(parts[3].replace('M', ''), 10);
        
        // Конвертируем в байты для единообразия и сохранения точности
        const total = totalMB * 1024 * 1024;
        const used = usedMB * 1024 * 1024;
        const free = freeMB * 1024 * 1024;
        
        logger.info(`Диск ${name} размеры (мегабайты): total=${totalMB}MB, used=${usedMB}MB, free=${freeMB}MB`);
        logger.info(`Диск ${name} размеры (в байтах): total=${total}, used=${used}, free=${free}`);
        
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
  const match = sizeStr.match(/^([\d.]+)([KMGT])?/i);
  if (!match) return 0;
  
  const [, size, unit] = match;
  const numSize = parseFloat(size); // Используем parseFloat вместо parseInt
  
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