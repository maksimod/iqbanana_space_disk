import React, { useState } from 'react';
import { FaUpload, FaFolderPlus } from 'react-icons/fa';

const FileActions = ({ 
  onUpload, 
  onCreateFolder, 
  uploadProgress = 0 
}) => {
  const [selectedFile, setSelectedFile] = useState(null);
  const [folderName, setFolderName] = useState('');

  const handleFileChange = (event) => {
    setSelectedFile(event.target.files[0]);
  };

  const handleUpload = () => {
    if (!selectedFile) {
      alert('Пожалуйста, выберите файл для загрузки');
      return;
    }
    
    onUpload(selectedFile, () => {
      setSelectedFile(null);
      document.getElementById('file-upload').value = '';
    });
  };

  const handleCreateFolder = () => {
    if (!folderName.trim()) {
      alert('Пожалуйста, введите имя папки');
      return;
    }
    
    onCreateFolder(folderName.trim(), () => setFolderName(''));
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleCreateFolder();
    }
  };

  return (
    <div className="file-actions">
      <div className="upload-section">
        <input
          type="file"
          id="file-upload"
          onChange={handleFileChange}
        />
        <button className="action-button" onClick={handleUpload}>
          <FaUpload /> Загрузить
        </button>
        {uploadProgress > 0 && (
          <div className="upload-progress">
            <div className="progress-bar">
              <div 
                className="progress-fill" 
                style={{ width: `${uploadProgress}%` }}
              ></div>
            </div>
            <span>{uploadProgress}%</span>
          </div>
        )}
      </div>
      
      <div className="create-folder-section">
        <input
          type="text"
          placeholder="Имя новой папки"
          value={folderName}
          onChange={(e) => setFolderName(e.target.value)}
          onKeyPress={handleKeyPress}
        />
        <button className="action-button" onClick={handleCreateFolder}>
          <FaFolderPlus /> Создать папку
        </button>
      </div>
    </div>
  );
};

export default FileActions;