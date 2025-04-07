import React, { useState, useRef, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUpload, faTimesCircle, faCheckCircle, faExclamationTriangle, faSyncAlt, faFileAlt } from '@fortawesome/free-solid-svg-icons';
import useApi from '../hooks/useApi';
import syncService from '../services/syncService';
import '../styles/FileUploader.css';

const FileUploader = ({ onFileUploadComplete, currentPath, selectedDisk }) => {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({});
  const [uploadErrors, setUploadErrors] = useState({});
  const [syncFiles, setSyncFiles] = useState([]);
  const [overallProgress, setOverallProgress] = useState(0);
  const [totalFiles, setTotalFiles] = useState(0);
  const [completedFiles, setCompletedFiles] = useState(0);
  const fileInputRef = useRef(null);
  const uploadCancelFunctions = useRef({});
  const { uploadFile } = useApi();

  // Загружаем и отслеживаем файлы в синхронизации
  useEffect(() => {
    // Первоначальная загрузка синхронизируемых файлов
    loadSyncFiles();
    
    // Добавляем обработчик событий синхронизации
    const syncHandler = (event) => {
      // Обновляем список синхронизируемых файлов при изменениях
      if (['sync_progress', 'sync_completed', 'sync_error', 'sync_cancelled'].includes(event.type)) {
        loadSyncFiles();
      }
    };
    
    // Регистрируем обработчик
    syncService.addSyncListener(syncHandler);
    
    // Удаляем обработчик при размонтировании
    return () => {
      syncService.removeSyncListener(syncHandler);
    };
  }, [selectedDisk, currentPath]);

  // Эффект для обновления общего прогресса
  useEffect(() => {
    if (totalFiles === 0) return;
    
    // Рассчитываем общий прогресс на основе прогресса всех файлов
    const progressValues = Object.values(uploadProgress);
    if (progressValues.length === 0) return;
    
    const totalProgress = progressValues.reduce((sum, progress) => sum + progress, 0);
    const calculatedProgress = Math.round(totalProgress / progressValues.length);
    
    setOverallProgress(calculatedProgress);
  }, [uploadProgress, totalFiles]);

  // Загрузка синхронизируемых файлов
  const loadSyncFiles = () => {
    // Получаем историю синхронизаций для текущего диска и пути
    const syncHistory = syncService.getSyncHistory({
      disk: selectedDisk,
      path: currentPath || ''
    });
    
    // Фильтруем только активные или недавние синхронизации
    const recentTime = Date.now() - 30 * 60 * 1000; // 30 минут назад
    const activeSync = syncHistory.filter(sync => {
      // Активные синхронизации
      if (['local', 'pending', 'syncing', 'accepted'].includes(sync.status)) {
        return true;
      }
      
      // Недавно завершенные синхронизации
      if (['completed', 'error', 'cancelled'].includes(sync.status) && 
          (sync.lastUpdate && sync.lastUpdate > recentTime)) {
        return true;
      }
      
      return false;
    });
    
    setSyncFiles(activeSync);
    
    // Обновляем прогресс для активных загрузок
    const newProgress = {};
    const newErrors = {};
    
    activeSync.forEach(sync => {
      // Для локальных файлов показываем 100% локального прогресса
      if (sync.status === 'local' || sync.status === 'pending') {
        newProgress[sync.fileId] = 0;
      } 
      // Для синхронизируемых файлов показываем серверный прогресс
      else if (['syncing', 'accepted'].includes(sync.status)) {
        newProgress[sync.fileId] = sync.serverProgress || 10;
      }
      // Для завершенных файлов показываем 100%
      else if (sync.status === 'completed') {
        newProgress[sync.fileId] = 100;
      }
      // Для файлов с ошибками сохраняем ошибку
      else if (sync.status === 'error') {
        newErrors[sync.fileId] = sync.error || 'Произошла ошибка при синхронизации';
        newProgress[sync.fileId] = 0;
      }
      // Для отмененных файлов
      else if (sync.status === 'cancelled') {
        newProgress[sync.fileId] = -1; // Специальный код для отмененных
      }
    });
    
    setUploadProgress(newProgress);
    setUploadErrors(newErrors);
  };

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
    
    // Устанавливаем общее количество файлов для загрузки
    setTotalFiles(prevTotal => prevTotal + filesArray.length);
    setCompletedFiles(0);
    
    // Обрабатываем каждый файл
    filesArray.forEach((file) => {
      // Генерируем временный ключ для файла (до получения fileId)
      const tempKey = `temp_${Date.now()}_${file.name}`;
      
      // Инициализируем прогресс для файла
      setUploadProgress(prev => ({
        ...prev,
        [tempKey]: 0
      }));
      
      // Очищаем предыдущие ошибки для этого файла
      setUploadErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[tempKey];
        return newErrors;
      });
      
      // Функция для обновления прогресса
      const handleProgress = (progress) => {
        setUploadProgress(prev => ({
          ...prev,
          [tempKey]: progress
        }));
        console.log(`Прогресс загрузки ${file.name}: ${progress}%`);
      };
      
      // Функция вызывается при успешном завершении загрузки
      const handleComplete = (fileInfo) => {
        console.log(`Загрузка файла ${file.name} завершена:`, fileInfo);
        
        // Устанавливаем прогресс 100%
        setUploadProgress(prev => ({
          ...prev,
          [tempKey]: 100
        }));
        
        // Увеличиваем счетчик завершенных файлов
        setCompletedFiles(prev => prev + 1);
        
        // Удаляем файл из списка отменяемых загрузок
        if (uploadCancelFunctions.current[tempKey]) {
          delete uploadCancelFunctions.current[tempKey];
        }
        
        // Вызываем колбэк завершения загрузки
        if (onFileUploadComplete) {
          onFileUploadComplete(fileInfo);
        }
        
        // Проверяем, остались ли активные загрузки
        if (Object.keys(uploadCancelFunctions.current).length === 0) {
          setUploading(false);
          // Сбрасываем общий прогресс через некоторое время
          setTimeout(() => {
            setTotalFiles(0);
            setCompletedFiles(0);
            setOverallProgress(0);
          }, 3000);
        }
        
        // Обновляем список синхронизируемых файлов
        loadSyncFiles();
        
        // Удаляем прогресс через некоторое время
        setTimeout(() => {
          setUploadProgress(prev => {
            const newProgress = { ...prev };
            delete newProgress[tempKey];
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
          [tempKey]: error.toString()
        }));
        
        // Устанавливаем прогресс в 0 (ошибка)
        setUploadProgress(prev => ({
          ...prev,
          [tempKey]: 0
        }));
        
        // Увеличиваем счетчик завершенных файлов (с ошибкой, но завершенных)
        setCompletedFiles(prev => prev + 1);
        
        // Удаляем файл из списка отменяемых загрузок
        if (uploadCancelFunctions.current[tempKey]) {
          delete uploadCancelFunctions.current[tempKey];
        }
        
        // Проверяем, остались ли активные загрузки
        if (Object.keys(uploadCancelFunctions.current).length === 0) {
          setUploading(false);
        }
        
        // Обновляем список синхронизируемых файлов
        loadSyncFiles();
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
        uploadCancelFunctions.current[tempKey] = cancelUpload;
      } catch (error) {
        console.error(`Ошибка при инициализации загрузки файла ${file.name}:`, error);
        
        // Сохраняем ошибку
        setUploadErrors(prev => ({
          ...prev,
          [tempKey]: error.toString()
        }));
        
        // Обновляем список синхронизируемых файлов
        loadSyncFiles();
      }
    });
  };

  const handleCancel = (fileId) => {
    console.log(`Отмена загрузки файла с id: ${fileId}`);
    
    // Проверяем, есть ли функция отмены для этого файла
    if (uploadCancelFunctions.current[fileId]) {
      // Вызываем функцию отмены
      uploadCancelFunctions.current[fileId]();
      
      // Удаляем из списка активных загрузок
      delete uploadCancelFunctions.current[fileId];
      
      // Обновляем статус загрузки
      setUploadProgress(prev => ({
        ...prev,
        [fileId]: -1  // -1 означает "отменено"
      }));
      
      // Очищаем любые ошибки
      setUploadErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[fileId];
        return newErrors;
      });
      
      // Проверяем, остались ли активные загрузки
      if (Object.keys(uploadCancelFunctions.current).length === 0) {
        setUploading(false);
      }
      
      // Для синхронизируемых файлов отменяем синхронизацию
      if (fileId.startsWith('sync_')) {
        syncService.cancelSync(fileId);
      }
    } else {
      // Для синхронизируемых файлов
      syncService.cancelSync(fileId);
    }
    
    // Обновляем список синхронизируемых файлов
    loadSyncFiles();
  };

  const handleRemoveCompleted = (fileId) => {
    console.log(`Удаление файла из списка: ${fileId}`);
    
    // Удаляем информацию о загрузке из состояния
    setUploadProgress(prev => {
      const newProgress = { ...prev };
      delete newProgress[fileId];
      return newProgress;
    });
    
    // Если это синхронизируемый файл, удаляем его из истории
    syncService.removeFromHistory(fileId);
    
    // Обновляем список синхронизируемых файлов
    loadSyncFiles();
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
        <FontAwesomeIcon icon={faUpload} size="2x" className="upload-icon" />
        <h3>Перетащите файлы сюда или кликните для выбора</h3>
        <p>Поддерживаются все типы файлов</p>
        
        <input 
          type="file" 
          ref={fileInputRef} 
          onChange={handleFileChange} 
          style={{ display: 'none' }}
          multiple
        />
      </div>

      {(Object.keys(uploadProgress).length > 0 || syncFiles.length > 0) && (
        <div className="upload-progress-container">
          <h4>Загрузки и синхронизация</h4>
          
          {/* Отображение активных загрузок */}
          {Object.entries(uploadProgress).map(([fileId, progress]) => {
            const fileName = fileId.includes('temp_') 
              ? fileId.split('_').slice(2).join('_')  // Извлекаем имя файла из временного ключа
              : syncFiles.find(f => f.fileId === fileId)?.fileName || fileId;
              
            const error = uploadErrors[fileId];
            const isComplete = progress === 100;
            const isCancelled = progress === -1;
            
            let statusText = '';
            let progressBarClass = '';
            
            if (isComplete) {
              statusText = 'Завершено';
              progressBarClass = 'complete';
            } else if (isCancelled) {
              statusText = 'Отменено';
              progressBarClass = 'cancelled';
            } else if (error) {
              statusText = 'Ошибка';
              progressBarClass = 'error';
            } else {
              statusText = `${progress}%`;
              progressBarClass = '';
            }

            return (
              <div key={fileId} className="upload-progress-item">
                <div className="upload-progress-file-icon">
                  <FontAwesomeIcon icon={faFileAlt} />
                </div>
                <div className="upload-progress-info">
                  <div className="upload-filename">{fileName}</div>
                  <div className="upload-progress-bar-container">
                    <div 
                      className={`upload-progress-bar ${progressBarClass}`}
                      style={{ width: `${isCancelled ? 100 : progress}%` }}
                    ></div>
                  </div>
                  <div className="upload-progress-details">
                    <span className="upload-progress-text">
                      {statusText}
                    </span>
                    {error && (
                      <div className="upload-error-message">
                        <FontAwesomeIcon icon={faExclamationTriangle} className="error-icon" /> {error}
                      </div>
                    )}
                  </div>
                </div>
                <div className="upload-progress-actions">
                  {isComplete ? (
                    <button 
                      className="upload-action-button"
                      onClick={() => handleRemoveCompleted(fileId)}
                      title="Убрать из списка"
                    >
                      <FontAwesomeIcon icon={faCheckCircle} className="success-icon" />
                    </button>
                  ) : isCancelled ? (
                    <button 
                      className="upload-action-button"
                      title="Загрузка отменена"
                    >
                      <FontAwesomeIcon icon={faTimesCircle} />
                    </button>
                  ) : error ? (
                    <button 
                      className="upload-action-button"
                      title="Ошибка загрузки"
                    >
                      <FontAwesomeIcon icon={faExclamationTriangle} className="error-icon" />
                    </button>
                  ) : (
                    <button 
                      className="upload-action-button"
                      onClick={() => handleCancel(fileId)}
                      title="Отменить загрузку"
                    >
                      <FontAwesomeIcon icon={faTimesCircle} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {/* Синхронизируемые файлы */}
          {syncFiles.map(sync => (
            <div key={sync.fileId} className="upload-progress-item">
              <div className="upload-progress-file-icon">
                <FontAwesomeIcon icon={faFileAlt} />
              </div>
              <div className="upload-progress-info">
                <div className="upload-filename">{sync.filename}</div>
                <div className="upload-progress-bar-container">
                  <div 
                    className={`upload-progress-bar ${
                      sync.status === 'completed' ? 'complete' : 
                      sync.status === 'cancelled' ? 'cancelled' :
                      sync.status === 'error' ? 'error' :
                      sync.status === 'syncing' ? 'syncing' : ''
                    }`}
                    style={{ width: `${sync.status === 'local' ? 0 : Math.max(0, sync.serverProgress || 0)}%` }}
                  ></div>
                </div>
                <div className="upload-progress-details">
                  <span className="upload-progress-text">
                    {sync.status === 'completed' ? (
                      <><FontAwesomeIcon icon={faCheckCircle} className="success-icon" /> Завершено</>
                    ) : sync.status === 'cancelled' ? (
                      'Отменено'
                    ) : sync.status === 'error' ? (
                      <><FontAwesomeIcon icon={faExclamationTriangle} className="error-icon" /> Ошибка</>
                    ) : sync.status === 'local' ? (
                      'Ожидание синхронизации...'
                    ) : sync.status === 'syncing' || sync.status === 'accepted' ? (
                      <><FontAwesomeIcon icon={faSyncAlt} className="sync-icon" spin /> {Math.round(sync.serverProgress || 0)}%</>
                    ) : (
                      sync.status
                    )}
                  </span>
                  {sync.error && (
                    <div className="upload-error-message">
                      <FontAwesomeIcon icon={faExclamationTriangle} className="error-icon" /> {sync.error}
                    </div>
                  )}
                </div>
              </div>
              <div className="upload-progress-actions">
                {sync.status === 'completed' ? (
                  <button 
                    className="upload-action-button"
                    onClick={() => handleRemoveCompleted(sync.fileId)}
                    title="Убрать из списка"
                  >
                    <FontAwesomeIcon icon={faTimesCircle} />
                  </button>
                ) : ['local', 'pending', 'syncing', 'accepted'].includes(sync.status) ? (
                  <button 
                    className="upload-action-button"
                    onClick={() => handleCancel(sync.fileId)}
                    title="Отменить синхронизацию"
                  >
                    <FontAwesomeIcon icon={faTimesCircle} />
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default FileUploader;