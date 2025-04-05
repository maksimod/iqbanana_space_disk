import React, { useState, useEffect } from 'react';
import '../../App.css';

/**
 * Компонент для редактирования текстовых файлов
 */
const FileEditor = ({ isOpen, fileName, fileContent, onSave, onClose }) => {
  const [content, setContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (isOpen && fileContent !== undefined) {
      setContent(fileContent);
      setHasChanges(false);
    }
  }, [isOpen, fileContent]);

  const handleContentChange = (e) => {
    setContent(e.target.value);
    setHasChanges(true);
  };

  const handleSave = async () => {
    if (!hasChanges) return;
    
    setIsSaving(true);
    try {
      await onSave(content);
      setHasChanges(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    if (hasChanges) {
      if (window.confirm('У вас есть несохраненные изменения. Вы уверены, что хотите закрыть редактор?')) {
        onClose();
      }
    } else {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="file-editor-overlay">
      <div className="file-editor-container">
        <div className="file-editor-header">
          <h3>{fileName}</h3>
          <button className="close-button" onClick={handleClose}>&times;</button>
        </div>
        <div className="file-editor-content">
          <textarea
            className="file-editor-textarea"
            value={content}
            onChange={handleContentChange}
            spellCheck={false}
          />
        </div>
        <div className="file-editor-actions">
          <button type="button" onClick={handleClose}>Закрыть</button>
          <button 
            type="button" 
            className="primary" 
            onClick={handleSave} 
            disabled={isSaving || !hasChanges}
          >
            {isSaving ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default FileEditor; 