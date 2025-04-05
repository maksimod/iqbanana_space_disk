import React, { useState } from 'react';
import '../../App.css';

const FolderDialog = ({ isOpen, onClose, onSubmit, currentPath }) => {
  const [folderName, setFolderName] = useState('');
  const [error, setError] = useState('');

  const validateFolderName = (name) => {
    if (!name.trim()) {
      setError('Имя папки не может быть пустым');
      return false;
    }

    // Проверка на недопустимые символы в имени папки
    const invalidChars = /[\/\\:*?"<>|]/;
    if (invalidChars.test(name)) {
      setError('Имя папки содержит недопустимые символы (/ \\ : * ? " < > |)');
      return false;
    }

    setError('');
    return true;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (validateFolderName(folderName)) {
      onSubmit({ folderName, path: currentPath });
      setFolderName('');
    }
  };

  const handleClose = () => {
    setFolderName('');
    setError('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="dialog-overlay">
      <div className="dialog-container">
        <div className="dialog-header">
          <h3>Создать новую папку</h3>
          <button className="close-button" onClick={handleClose}>&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="dialog-content">
            <div className="form-group">
              <label htmlFor="folderName">Имя папки:</label>
              <input
                type="text"
                id="folderName"
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
                placeholder="Введите имя папки"
                autoFocus
              />
              {error && <div className="error">{error}</div>}
            </div>
          </div>
          <div className="dialog-actions">
            <button type="button" onClick={handleClose}>Отмена</button>
            <button type="submit" className="primary">Создать</button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default FolderDialog; 