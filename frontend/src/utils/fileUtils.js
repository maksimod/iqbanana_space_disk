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