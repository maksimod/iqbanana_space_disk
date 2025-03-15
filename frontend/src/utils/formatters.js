/**
 * Форматирует размер файла из байтов в человекочитаемый формат
 * @param {number} bytes - размер в байтах
 * @return {string} форматированный размер
 */
export const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    
    return parseFloat((bytes / Math.pow(1024, i)).toFixed(2)) + ' ' + sizes[i];
  };
  
  /**
   * Вычисляет процент использования диска
   * @param {number} used - использованное пространство
   * @param {number} total - общее пространство
   * @return {number} процент использования
   */
  export const calculateUsagePercent = (used, total) => {
    if (!total) return 0;
    return (used / total) * 100;
  };