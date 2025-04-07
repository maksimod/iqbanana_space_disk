import React from 'react';
import { FaFolderPlus, FaFile } from 'react-icons/fa';
import '../../App.css';

const FileActions = ({ onCreateFolder, onCreateFile }) => {
  // Инлайн-стили для гарантированного отображения
  const containerStyle = {
    display: 'flex',
    gap: '10px',
    marginBottom: '0',
    visibility: 'visible',
    opacity: 1,
    minHeight: '40px',
    position: 'relative',
    zIndex: 5
  };

  const buttonStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 15px',
    backgroundColor: '#4a90e2',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    whiteSpace: 'nowrap',
    visibility: 'visible',
    opacity: 1,
    minHeight: '40px'
  };

  return (
    <div className="file-actions" style={containerStyle}>
      <button 
        className="action-button" 
        style={buttonStyle}
        onClick={onCreateFolder}
      >
        <FaFolderPlus /> Создать папку
      </button>
      
      <button 
        className="action-button" 
        style={buttonStyle}
        onClick={onCreateFile}
      >
        <FaFile /> Создать файл
      </button>
    </div>
  );
};

export default FileActions;