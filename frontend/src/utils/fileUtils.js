/**
 * Получение расширения файла
 * @param {string} filename - имя файла
 * @return {string} расширение файла в нижнем регистре
 */
export const getFileExtension = (filename) => {
    if (!filename) return '';
    return filename.slice((filename.lastIndexOf('.') - 1 >>> 0) + 2).toLowerCase();
  };
  
  /**
   * Типы файлов по группам
   */
  export const fileTypes = {
    // Изображения
    image: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp'],
    
    // Документы
    document: ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf', 'txt', 'rtf'],
    
    // Архивы
    archive: ['zip', 'rar', 'tar', 'gz', '7z'],
    
    // Видео
    video: ['mp4', 'avi', 'mov', 'wmv', 'mkv', 'webm'],
    
    // Аудио
    audio: ['mp3', 'wav', 'ogg', 'flac', 'aac'],
    
    // Код
    code: ['html', 'css', 'js', 'php', 'py', 'java', 'c', 'cpp', 'cs', 'json', 'xml']
  };
  
  /**
   * Определение группы файла по расширению
   * @param {string} filename - имя файла
   * @return {string} группа файла (image, document, archive, video, audio, code, other)
   */
  export const getFileType = (filename) => {
    const extension = getFileExtension(filename);
    
    if (!extension) return 'other';
    
    for (const [type, extensions] of Object.entries(fileTypes)) {
      if (extensions.includes(extension)) {
        return type;
      }
    }
    
    return 'other';
  };
  
  /**
   * Получение цвета для иконки файла в зависимости от типа файла
   * @param {string} filename - имя файла
   * @param {boolean} isDirectory - флаг директории
   * @return {string} цвет в формате HEX
   */
  export const getFileIconColor = (filename, isDirectory) => {
    if (isDirectory) return '#ffc107'; // Папки - желтые
    
    const fileType = getFileType(filename);
    
    const typeColors = {
      image: '#9b59b6',    // Фиолетовый
      document: '#3498db',  // Синий
      archive: '#f39c12',   // Оранжевый
      video: '#e74c3c',     // Красный
      audio: '#27ae60',     // Зеленый
      code: '#1abc9c',      // Бирюзовый
      other: '#95a5a6'      // Серый
    };
    
    return typeColors[fileType] || '#6c757d';
  };

/**
 * Форматирует размер файла в удобочитаемый вид
 * @param {number} bytes - Размер файла в байтах
 * @returns {string} - Отформатированный размер
 */
export const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Б';
  
  const k = 1024;
  const sizes = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

/**
 * Форматирует дату в локальный формат
 * @param {string|Date} date - Дата для форматирования
 * @returns {string} - Отформатированная дата
 */
export const formatDate = (date) => {
  if (!date) return '';
  
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  
  return dateObj.toLocaleDateString('ru-RU', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).replace(',', '');
};

/**
 * Определяет, является ли файл текстовым по его расширению
 * @param {string} fileName - Имя файла
 * @returns {boolean} - true, если файл текстовый
 */
export const isTextFile = (fileName) => {
  if (!fileName) return false;
  
  const extension = fileName.split('.').pop().toLowerCase();
  const textExtensions = [
    'txt', 'md', 'js', 'jsx', 'ts', 'tsx', 'html', 'css', 
    'json', 'yml', 'yaml', 'xml', 'csv', 'log', 'py', 'rb', 
    'java', 'c', 'cpp', 'php', 'sh', 'bat', 'ps1', 'sql'
  ];
  
  return textExtensions.includes(extension);
};