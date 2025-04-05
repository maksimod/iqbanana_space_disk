import React, { useState } from 'react';
import { FaFolder, FaFile, FaTrash, FaDownload, FaInfo } from 'react-icons/fa';
import { formatFileSize } from '../../utils/formatters';
import FileInfoModal from './FileInfoModal';
import FileItem from './FileItem';

const FilesList = ({ files, onNavigate, onDelete, onDownload }) => {
  const [selectedFile, setSelectedFile] = useState(null);
  
  // Показать информацию о файле
  const showFileInfo = (file, e) => {
    e.stopPropagation(); // Предотвращаем навигацию для директорий
    setSelectedFile(file);
  };
  
  // Закрыть модальное окно
  const closeFileInfo = () => {
    setSelectedFile(null);
  };

  const handleFileClick = (file) => {
    console.log('Клик по файлу в FilesList:', file.name);
    onNavigate(file);
  };

  return (
    <div className="files-list">
      {files.length === 0 ? (
        <div className="no-files">
          <p>Нет файлов для отображения</p>
        </div>
      ) : (
        files.map((file) => (
          <FileItem
            key={file.path || file.name}
            file={file}
            onFileClick={handleFileClick}
            onDelete={() => onDelete(file)}
            onDownload={() => onDownload(file)}
          />
        ))
      )}
      
      {/* Модальное окно с информацией о файле */}
      {selectedFile && (
        <FileInfoModal 
          file={selectedFile} 
          onClose={closeFileInfo} 
        />
      )}
    </div>
  );
};

export default FilesList;