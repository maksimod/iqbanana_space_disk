import React from 'react';
import { FaUpload, FaFolderPlus, FaFile } from 'react-icons/fa';
import '../../App.css';

const FileActions = ({ onUploadFile, onCreateFolder, onCreateFile }) => {
  return (
    <div className="file-actions">
      <button className="action-button" onClick={onUploadFile}>
        <FaUpload /> Загрузить файл
      </button>
      
      <button className="action-button" onClick={onCreateFolder}>
        <FaFolderPlus /> Создать папку
      </button>
      
      <button className="action-button" onClick={onCreateFile}>
        <FaFile /> Создать файл
      </button>
    </div>
  );
};

export default FileActions;