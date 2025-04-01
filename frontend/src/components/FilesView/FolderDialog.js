import React, { useState } from 'react';
import './FolderDialog.css';

const FolderDialog = ({ onClose, onSubmit }) => {
  const [folderName, setFolderName] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    
    // Валидация имени папки
    if (!folderName.trim()) {
      setError('Имя папки не может быть пустым');
      return;
    }
    
    // Проверка на недопустимые символы в имени папки
    const invalidChars = /[<>:"/\\|?*]/;
    if (invalidChars.test(folderName)) {
      setError('Имя папки содержит недопустимые символы (< > : " / \\ | ? *)');
      return;
    }
    
    onSubmit(folderName.trim());
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className="folder-dialog-overlay" onClick={onClose}>
      <div className="folder-dialog" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className="folder-dialog-header">
          <h3>Создать новую папку</h3>
          <button className="close-button" onClick={onClose}>×</button>
        </div>
        
        <form onSubmit={handleSubmit}>
          <div className="folder-dialog-content">
            <label htmlFor="folder-name">Имя папки:</label>
            <input
              id="folder-name"
              type="text"
              value={folderName}
              onChange={(e) => {
                setFolderName(e.target.value);
                setError(''); // Сбрасываем ошибку при изменении
              }}
              autoFocus
              placeholder="Новая папка"
            />
            {error && <div className="error-message">{error}</div>}
          </div>
          
          <div className="folder-dialog-footer">
            <button type="button" className="cancel-button" onClick={onClose}>
              Отмена
            </button>
            <button type="submit" className="create-button">
              Создать
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default FolderDialog; 