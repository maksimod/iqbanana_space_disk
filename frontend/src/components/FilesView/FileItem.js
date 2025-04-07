import React from 'react';
import { FaFolder, FaFile, FaFileImage, FaFileVideo, FaFileAudio, FaFilePdf, FaFileArchive, FaFileCode } from 'react-icons/fa';
import { formatFileSize, formatDate } from '../../utils/fileUtils';
import '../../App.css';

const FileItem = ({ file, onFileClick, onDelete, onDownload }) => {
  const getFileIcon = () => {
    if (file.isDirectory) {
      return <FaFolder className="file-icon folder" />;
    }

    // Определяем тип файла по расширению
    const extension = file.name.split('.').pop().toLowerCase();
    
    // Типы файлов по категориям
    const imageTypes = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp'];
    const videoTypes = ['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'mkv'];
    const audioTypes = ['mp3', 'wav', 'ogg', 'flac', 'aac'];
    const codeTypes = ['js', 'jsx', 'ts', 'tsx', 'html', 'css', 'scss', 'json', 'xml', 'py', 'rb', 'java', 'c', 'cpp', 'php'];
    const documentTypes = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'];
    const archiveTypes = ['zip', 'rar', '7z', 'tar', 'gz'];
    
    if (imageTypes.includes(extension)) {
      return <FaFileImage className="file-icon image" />;
    } else if (videoTypes.includes(extension)) {
      return <FaFileVideo className="file-icon video" />;
    } else if (audioTypes.includes(extension)) {
      return <FaFileAudio className="file-icon audio" />;
    } else if (codeTypes.includes(extension)) {
      return <FaFileCode className="file-icon code" />;
    } else if (documentTypes.includes(extension)) {
      return <FaFilePdf className="file-icon document" />;
    } else if (archiveTypes.includes(extension)) {
      return <FaFileArchive className="file-icon archive" />;
    } else {
      return <FaFile className="file-icon file" />;
    }
  };

  const handleClick = (e) => {
    e.preventDefault();
    console.log('Клик по файлу:', file.name);
    onFileClick(file);
  };

  return (
    <div 
      className="file-item"
      onClick={handleClick}
    >
      <div className="file-icon-container">
        {getFileIcon()}
      </div>
      <div className="file-details">
        <div className="file-name" title={file.name}>
          {file.name}
        </div>
        <div className="file-info">
          <span>{file.isDirectory ? 'Папка' : formatFileSize(file.size)}</span>
          <span>{formatDate(file.lastModified)}</span>
        </div>
      </div>
      <div className="file-actions">
        <button 
          className="action-button download-btn"
          onClick={(e) => { e.stopPropagation(); onDownload(); }}
          aria-label="Скачать"
        >
          ⬇️
        </button>
        <button 
          className="action-button delete-btn"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          aria-label="Удалить"
        >
          🗑️
        </button>
      </div>
    </div>
  );
};

export default FileItem; 