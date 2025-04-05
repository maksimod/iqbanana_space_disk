import React, { useState } from 'react';
import '../../App.css';

/**
 * Диалог для создания файла
 */
const FileDialog = ({ isOpen, onClose, onSubmit, currentPath }) => {
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');

  const validateFileName = (name) => {
    if (!name.trim()) {
      setError('Имя файла не может быть пустым');
      return false;
    }

    // Проверка на недопустимые символы в имени файла
    const invalidChars = /[\/\\:*?"<>|]/;
    if (invalidChars.test(name)) {
      setError('Имя файла содержит недопустимые символы (/ \\ : * ? " < > |)');
      return false;
    }

    setError('');
    return true;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (validateFileName(fileName)) {
      onSubmit({ fileName, path: currentPath });
      setFileName('');
    }
  };

  const handleClose = () => {
    setFileName('');
    setError('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="dialog-overlay">
      <div className="dialog-container">
        <div className="dialog-header">
          <h3>Создать новый файл</h3>
          <button className="close-button" onClick={handleClose}>&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="dialog-content">
            <div className="form-group">
              <label htmlFor="fileName">Имя файла:</label>
              <input
                type="text"
                id="fileName"
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                placeholder="Введите имя файла"
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

export default FileDialog; 