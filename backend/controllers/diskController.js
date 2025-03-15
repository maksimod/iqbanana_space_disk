const diskusage = require('diskusage');
const config = require('../config/config');
const logger = require('../utils/logger');

/**
 * Получение списка дисков с информацией о пространстве
 */
const getDisks = async (req, res, next) => {
  const disksInfo = [];
  
  try {
    logger.info('Запрос на получение списка дисков');
    
    // Для каждого диска получаем информацию о пространстве
    const promises = Object.entries(config.disks).map(([name, mountPoint]) => {
      return new Promise((resolve) => {
        try {
          diskusage.check(mountPoint, (err, info) => {
            if (err) {
              logger.error(`Ошибка при получении информации о диске ${name}`, err);
              resolve({
                name,
                mountPoint,
                error: 'Не удалось получить информацию о диске'
              });
            } else {
              resolve({
                name,
                mountPoint,
                total: info.total,
                free: info.free,
                used: info.total - info.free
              });
            }
          });
        } catch (error) {
          logger.error(`Ошибка при проверке диска ${name}`, error);
          resolve({
            name,
            mountPoint,
            error: 'Не удалось получить информацию о диске'
          });
        }
      });
    });
    
    const results = await Promise.all(promises);
    logger.info(`Получена информация о ${results.length} дисках`);
    res.json(results);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getDisks
};