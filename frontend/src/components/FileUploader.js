import React, { useState, useRef, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUpload, faTimesCircle, faCheckCircle, faExclamationTriangle } from '@fortawesome/free-solid-svg-icons';
import useApi from '../hooks/useApi';
import '../styles/FileUploader.css';

const FileUploader = ({ onFileUploadComplete, currentPath, selectedDisk }) => {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({});
  const [uploadErrors, setUploadErrors] = useState({});
  const fileInputRef = useRef(null);
  const uploadCancelFunctions = useRef({});
  const { uploadFile } = useApi();

  useEffect(() => {
    // Восстанавливаем прогресс загрузки из localStorage
    try {
      const savedProgress = localStorage.getItem('uploadProgress');
      const savedErrors = localStorage.getItem('uploadErrors');
      
      if (savedProgress) {
        const parsed = JSON.parse(savedProgress);
        // Фильтруем только загрузки для текущего пути и диска
        const filteredProgress = Object.fromEntries(
          Object.entries(parsed).filter(([key]) => {
            const [disk, path] = key.split(':');
            return disk === selectedDisk && path === (currentPath || '');
          })
        );
        setUploadProgress(filteredProgress);
      }
      
      if (savedErrors) {
        const parsed = JSON.parse(savedErrors);
        // Фильтруем только ошибки для текущего пути и диска
        const filteredErrors = Object.fromEntries(
          Object.entries(parsed).filter(([key]) => {
            const [disk, path] = key.split(':');
            return disk === selectedDisk && path === (currentPath || '');
          })
        );
        setUploadErrors(filteredErrors);
      }
    } catch (error) {
      console.error('Ошибка при восстановлении прогресса загрузки:', error);
    }
  }, [selectedDisk, currentPath]);

  useEffect(() => {
    // Сохраняем прогресс загрузки в localStorage
    if (Object.keys(uploadProgress).length > 0) {
      try {
        localStorage.setItem('uploadProgress', JSON.stringify(uploadProgress));
      } catch (error) {
        console.error('Ошибка при сохранении прогресса загрузки:', error);
      }
    }
  }, [uploadProgress]);

  useEffect(() => {
    // Сохраняем ошибки загрузки в localStorage
    if (Object.keys(uploadErrors).length > 0) {
      try {
        localStorage.setItem('uploadErrors', JSON.stringify(uploadErrors));
      } catch (error) {
        console.error('Ошибка при сохранении ошибок загрузки:', error);
      }
    }
  }, [uploadErrors]);

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragging(true);
  };

  const handleDragLeave = () => {
    setDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFiles(files);
    }
  };

  const handleFileChange = (e) => {
    const files = e.target.files;
    if (files.length > 0) {
      handleFiles(files);
    }
  };

  const handleFiles = (files) => {
    setUploading(true);
    
    // Создаем массив файлов для обработки
    const filesArray = Array.from(files);
    
    // Обрабатываем каждый файл
    filesArray.forEach((file) => {
      // Создаем уникальный ключ для файла
      const fileKey = `${selectedDisk}:${currentPath || ''}:${file.name}`;
      
      // Проверяем, не загружается ли уже этот файл
      if (uploadProgress[fileKey] && uploadProgress[fileKey] < 100) {
        console.log(`Файл ${file.name} уже загружается, прогресс: ${uploadProgress[fileKey]}%`);
        return;
      }
      
      // Инициализируем прогресс для файла
      setUploadProgress(prev => ({
        ...prev,
        [fileKey]: 0
      }));
      
      // Очищаем предыдущие ошибки для этого файла
      if (uploadErrors[fileKey]) {
        setUploadErrors(prev => {
          const newErrors = { ...prev };
          delete newErrors[fileKey];
          return newErrors;
        });
      }
      
      // Функция для обновления прогресса
      const handleProgress = (progress) => {
        setUploadProgress(prev => ({
          ...prev,
          [fileKey]: progress
        }));
      };
      
      // Функция вызывается при успешном завершении загрузки
      const handleComplete = (fileInfo) => {
        console.log(`Загрузка файла ${file.name} завершена:`, fileInfo);
        
        // Устанавливаем прогресс 100%
        setUploadProgress(prev => ({
          ...prev,
          [fileKey]: 100
        }));
        
        // Удаляем файл из списка отменяемых загрузок
        if (uploadCancelFunctions.current[fileKey]) {
          delete uploadCancelFunctions.current[fileKey];
        }
        
        // Вызываем колбэк завершения загрузки
        if (onFileUploadComplete) {
          onFileUploadComplete(fileInfo);
        }
        
        // Проверяем, остались ли активные загрузки
        if (Object.keys(uploadCancelFunctions.current).length === 0) {
          setUploading(false);
        }
        
        // Удаляем прогресс и ошибки через некоторое время
        setTimeout(() => {
          setUploadProgress(prev => {
            const newProgress = { ...prev };
            delete newProgress[fileKey];
            
            // Сохраняем обновленный прогресс
            try {
              localStorage.setItem('uploadProgress', JSON.stringify(newProgress));
            } catch (error) {
              console.error('Ошибка при сохранении прогресса загрузки:', error);
            }
            
            return newProgress;
          });
        }, 10000); // Через 10 секунд убираем индикатор
      };
      
      // Функция вызывается при ошибке загрузки
      const handleError = (error) => {
        console.error(`Ошибка при загрузке файла ${file.name}:`, error);
        
        // Сохраняем ошибку
        setUploadErrors(prev => ({
          ...prev,
          [fileKey]: error.toString()
        }));
        
        // Устанавливаем прогресс в 0 (ошибка)
        setUploadProgress(prev => ({
          ...prev,
          [fileKey]: 0
        }));
        
        // Удаляем файл из списка отменяемых загрузок
        if (uploadCancelFunctions.current[fileKey]) {
          delete uploadCancelFunctions.current[fileKey];
        }
        
        // Проверяем, остались ли активные загрузки
        if (Object.keys(uploadCancelFunctions.current).length === 0) {
          setUploading(false);
        }
      };
      
      try {
        // Запускаем загрузку файла
        const cancelUpload = uploadFile(
          selectedDisk,
          currentPath || '',
          file,
          handleProgress,
          handleComplete,
          handleError
        );
        
        // Сохраняем функцию отмены
        uploadCancelFunctions.current[fileKey] = cancelUpload;
      } catch (error) {
        console.error(`Ошибка при инициализации загрузки файла ${file.name}:`, error);
        
        // Сохраняем ошибку
        setUploadErrors(prev => ({
          ...prev,
          [fileKey]: error.toString()
        }));
      }
    });
  };

  const handleCancel = (fileKey) => {
    // Отмена загрузки файла
    if (uploadCancelFunctions.current[fileKey]) {
      uploadCancelFunctions.current[fileKey]();
      delete uploadCancelFunctions.current[fileKey];
      
      // Устанавливаем прогресс в -1 (отменено)
      setUploadProgress(prev => ({
        ...prev,
        [fileKey]: -1
      }));
      
      // Удаляем прогресс и ошибки через некоторое время
      setTimeout(() => {
        setUploadProgress(prev => {
          const newProgress = { ...prev };
          delete newProgress[fileKey];
          
          // Сохраняем обновленный прогресс
          try {
            localStorage.setItem('uploadProgress', JSON.stringify(newProgress));
          } catch (error) {
            console.error('Ошибка при сохранении прогресса загрузки:', error);
          }
          
          return newProgress;
        });
        
        setUploadErrors(prev => {
          const newErrors = { ...prev };
          delete newErrors[fileKey];
          
          // Сохраняем обновленные ошибки
          try {
            localStorage.setItem('uploadErrors', JSON.stringify(newErrors));
          } catch (error) {
            console.error('Ошибка при сохранении ошибок загрузки:', error);
          }
          
          return newErrors;
        });
      }, 5000); // Через 5 секунд убираем индикатор
      
      // Проверяем, остались ли активные загрузки
      if (Object.keys(uploadCancelFunctions.current).length === 0) {
        setUploading(false);
      }
    }
  };

  const handleRemoveCompleted = (fileKey) => {
    // Удаление завершенной загрузки из списка
    setUploadProgress(prev => {
      const newProgress = { ...prev };
      delete newProgress[fileKey];
      
      // Сохраняем обновленный прогресс
      try {
        localStorage.setItem('uploadProgress', JSON.stringify(newProgress));
      } catch (error) {
        console.error('Ошибка при сохранении прогресса загрузки:', error);
      }
      
      return newProgress;
    });
  };

  return (
    <div className="file-uploader-container">
      <div 
        className={`file-uploader-dropzone ${dragging ? 'dragging' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current.click()}
      >
        <FontAwesomeIcon icon={faUpload} size="2x" />
        <p>Перетащите файлы сюда или кликните для выбора</p>
        <input 
          type="file" 
          ref={fileInputRef} 
          onChange={handleFileChange}
          multiple
          style={{ display: 'none' }}
        />
      </div>
      
      {Object.keys(uploadProgress).length > 0 && (
        <div className="upload-progress-container">
          <h4>Загрузки</h4>
          {Object.entries(uploadProgress).map(([fileKey, progress]) => {
            const [disk, path, fileName] = fileKey.split(':');
            
            // Показываем только загрузки для текущего пути и диска
            if (disk !== selectedDisk || path !== (currentPath || '')) {
              return null;
            }
            
            return (
              <div key={fileKey} className="upload-progress-item">
                <div className="upload-progress-info">
                  <span className="upload-filename">{fileName}</span>
                  <div className="upload-progress-bar-container">
                    <div 
                      className={`upload-progress-bar ${
                        progress === 100 ? 'complete' : 
                        progress === -1 ? 'cancelled' :
                        uploadErrors[fileKey] ? 'error' : ''
                      }`}
                      style={{ width: `${Math.max(0, progress)}%` }}
                    ></div>
                  </div>
                  <span className="upload-progress-text">
                    {progress === 100 ? (
                      <FontAwesomeIcon icon={faCheckCircle} className="success-icon" />
                    ) : progress === -1 ? (
                      'Отменено'
                    ) : uploadErrors[fileKey] ? (
                      <FontAwesomeIcon icon={faExclamationTriangle} className="error-icon" />
                    ) : (
                      `${Math.round(progress)}%`
                    )}
                  </span>
                </div>
                <div className="upload-progress-actions">
                  {progress === 100 ? (
                    <button 
                      className="upload-action-button"
                      onClick={() => handleRemoveCompleted(fileKey)}
                      title="Убрать из списка"
                    >
                      <FontAwesomeIcon icon={faTimesCircle} />
                    </button>
                  ) : progress !== -1 && !uploadErrors[fileKey] ? (
                    <button 
                      className="upload-action-button"
                      onClick={() => handleCancel(fileKey)}
                      title="Отменить загрузку"
                    >
                      <FontAwesomeIcon icon={faTimesCircle} />
                    </button>
                  ) : uploadErrors[fileKey] ? (
                    <div className="upload-error-message" title={uploadErrors[fileKey]}>
                      Ошибка: {uploadErrors[fileKey].substring(0, 30)}{uploadErrors[fileKey].length > 30 ? '...' : ''}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default FileUploader; 