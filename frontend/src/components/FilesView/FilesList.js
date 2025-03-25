import React, { useState } from 'react';
import { FaFolder, FaFile, FaTrash, FaDownload, FaInfo } from 'react-icons/fa';
import { formatFileSize } from '../../utils/formatters';
import FileInfoModal from './FileInfoModal';

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
  
  if (files.length === 0) {
    return <p className="no-files">Нет файлов в этой директории</p>;
  }

  return (
    <>
      <table className="files-table">
        <thead>
          <tr>
            <th>Тип</th>
            <th>Имя</th>
            <th>Размер</th>
            <th>Действия</th>
          </tr>
        </thead>
        <tbody>
          {files.map((file) => (
            <tr key={file.path}>
              <td>
                {file.isDirectory ? (
                  <FaFolder className="folder-icon" />
                ) : (
                  <FaFile className="file-icon" />
                )}
              </td>
              <td>
                {file.isDirectory ? (
                  <span 
                    className="directory-name"
                    onClick={() => onNavigate(file)}
                  >
                    {file.name}
                  </span>
                ) : (
                  <span>{file.name}</span>
                )}
              </td>
              <td>{file.isDirectory ? '-' : formatFileSize(file.size)}</td>
              <td>
                <div className="file-actions-buttons">
                  <button 
                    className="info-button"
                    onClick={(e) => showFileInfo(file, e)}
                    title="Информация"
                  >
                    <FaInfo />
                  </button>
                  <button 
                    className="download-button"
                    onClick={() => onDownload(file)}
                    title="Скачать"
                  >
                    <FaDownload />
                  </button>
                  <button 
                    className="delete-button"
                    onClick={() => onDelete(file)}
                    title="Удалить"
                  >
                    <FaTrash />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      
      {/* Модальное окно с информацией о файле */}
      {selectedFile && (
        <FileInfoModal 
          file={selectedFile} 
          onClose={closeFileInfo} 
        />
      )}
    </>
  );
};

export default FilesList;