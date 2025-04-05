import React, { useState } from 'react';
import { FaUpload, FaFolderPlus, FaFile } from 'react-icons/fa';
import FolderDialog from './FolderDialog';

const FileActions = ({ 
  onUpload, 
  onCreateFolder, 
  uploadProgress = 0,
  onCreateFile
}) => {
  const [selectedFile, setSelectedFile] = useState(null);
  const [folderName, setFolderName] = useState('');
  const [showFolderDialog, setShowFolderDialog] = useState(false);

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (file) {
      setSelectedFile(file);
      handleUpload(file);
    }
  };

  const handleUpload = (file) => {
    const fileToUpload = file || selectedFile;
    
    // Проверка наличия файла перед загрузкой
    if (!fileToUpload) {
      alert('Пожалуйста, выберите файл для загрузки');
      return;
    }
    
    onUpload(fileToUpload, () => {
      setSelectedFile(null);
      document.getElementById('file-upload').value = '';
    });
  };

  const handleCreateFolder = () => {
    if (!folderName.trim()) {
      return;
    }
    
    onCreateFolder(folderName.trim(), () => setFolderName(''));
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleCreateFolder();
    }
  };

  const handleOpenFolderDialog = () => {
    setShowFolderDialog(true);
  };

  const handleCloseFolderDialog = () => {
    setShowFolderDialog(false);
  };

  const handleSubmitFolder = (name) => {
    onCreateFolder(name, () => {
      setShowFolderDialog(false);
    });
  };

  const handleCreateFile = () => {
    if (onCreateFile) {
      onCreateFile();
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
        <button className="action-button" onClick={() => handleUpload()}>
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
        <button className="action-button" onClick={handleOpenFolderDialog}>
          <FaFolderPlus /> Создать папку
        </button>
      </div>
      
      {onCreateFile && (
        <div className="create-file-section">
          <button className="action-button" onClick={handleCreateFile}>
            <FaFile /> Создать файл
          </button>
        </div>
      )}

      {showFolderDialog && (
        <FolderDialog
          onClose={handleCloseFolderDialog}
          onSubmit={handleSubmitFolder}
        />
      )}
    </div>
  );
};

export default FileActions;