import React from 'react';
import { FaFolder, FaFile, FaTimes } from 'react-icons/fa';
import { formatFileSize } from '../../utils/formatters';
import { getFileExtension, getFileIconColor, getFileType } from '../../utils/fileUtils';

/**
 * Модальное окно с информацией о файле
 */
const FileInfoModal = ({ file, onClose }) => {
  if (!file) return null;
  
  // Получаем расширение файла
  const fileExtension = getFileExtension(file.name);
  
  // Получаем иконку в зависимости от типа файла
  const FileIcon = file.isDirectory ? FaFolder : FaFile;
  
  // Получаем группу файла
  const fileTypeGroup = file.isDirectory ? 'directory' : getFileType(file.name);
  
  // Получаем название типа файла для отображения
  const getFileTypeName = (type) => {
    const typeNames = {
      directory: 'Папка',
      image: 'Изображение',
      document: 'Документ',
      archive: 'Архив',
      video: 'Видео',
      audio: 'Аудио',
      code: 'Код',
      other: 'Файл'
    };
    
    return typeNames[type] || 'Файл';
  };
  
  // Определяем стиль для иконки в зависимости от типа файла
  const iconColor = getFileIconColor(file.name, file.isDirectory);
  
  return (
    <div className="modal-overlay">
      <div className="file-info-modal">
        <div className="modal-header">
          <h3>Информация о {file.isDirectory ? 'папке' : 'файле'}</h3>
          <button className="close-button" onClick={onClose}>
            <FaTimes />
          </button>
        </div>
        
        <div className="file-info-content">
          <div className="file-icon-container">
            <FileIcon className="file-info-icon" style={{ color: iconColor }} />
            {fileExtension && !file.isDirectory && (
              <div className="file-extension">{fileExtension}</div>
            )}
          </div>
          
          <div className="file-details">
            <div className="file-detail-row">
              <span className="detail-label">Имя:</span>
              <span className="detail-value">{file.name}</span>
            </div>
            
            <div className="file-detail-row">
              <span className="detail-label">Тип:</span>
              <span className="detail-value">
                {getFileTypeName(fileTypeGroup)}
                {fileExtension ? ` (${fileExtension})` : ''}
              </span>
            </div>
            
            {!file.isDirectory && (
              <div className="file-detail-row">
                <span className="detail-label">Размер:</span>
                <span className="detail-value">{formatFileSize(file.size)}</span>
              </div>
            )}
            
            <div className="file-detail-row">
              <span className="detail-label">Путь:</span>
              <span className="detail-value">{file.path}</span>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button className="action-button" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  );
};

export default FileInfoModal;