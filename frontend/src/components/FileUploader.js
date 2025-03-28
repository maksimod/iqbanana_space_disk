import React, { useState, useRef, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUpload, faTimesCircle, faCheckCircle, faExclamationTriangle, faSyncAlt } from '@fortawesome/free-solid-svg-icons';
import useApi from '../hooks/useApi';
import syncService from '../services/syncService';
import '../styles/FileUploader.css';

const FileUploader = ({ onFileUploadComplete, currentPath, selectedDisk }) => {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({});
  const [uploadErrors, setUploadErrors] = useState({});
  const [syncFiles, setSyncFiles] = useState([]);
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
      };
      
      // Функция вызывается при успешном завершении загрузки
      const handleComplete = (fileInfo) => {
        console.log(`Загрузка файла ${file.name} завершена:`, fileInfo);
        
        // Устанавливаем прогресс 100%
        setUploadProgress(prev => ({
          ...prev,
          [tempKey]: 100
        }));
        
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
    // Отмена загрузки файла
    if (fileId.startsWith('temp_')) {
      // Временный ключ - стандартная отмена
      if (uploadCancelFunctions.current[fileId]) {
        uploadCancelFunctions.current[fileId]();
        delete uploadCancelFunctions.current[fileId];
        
        // Устанавливаем прогресс в -1 (отменено)
        setUploadProgress(prev => ({
          ...prev,
          [fileId]: -1
        }));
        
        // Удаляем прогресс и ошибки через некоторое время
        setTimeout(() => {
          setUploadProgress(prev => {
            const newProgress = { ...prev };
            delete newProgress[fileId];
            return newProgress;
          });
          
          setUploadErrors(prev => {
            const newErrors = { ...prev };
            delete newErrors[fileId];
            return newErrors;
          });
        }, 5000); // Через 5 секунд убираем индикатор
      }
    } else {
      // Реальный fileId - отменяем синхронизацию
      syncService.cancelSync(fileId)
        .then(result => {
          console.log('Синхронизация отменена:', result);
          
          // Обновляем список синхронизируемых файлов
          loadSyncFiles();
        })
        .catch(error => {
          console.error('Ошибка при отмене синхронизации:', error);
          
          // Добавляем ошибку
          setUploadErrors(prev => ({
            ...prev,
            [fileId]: error.message || 'Ошибка при отмене синхронизации'
          }));
        });
    }
    
    // Проверяем, остались ли активные загрузки
    if (Object.keys(uploadCancelFunctions.current).length === 0) {
      setUploading(false);
    }
  };

  const handleRemoveCompleted = (fileId) => {
    // Удаление завершенной загрузки из списка
    if (fileId.startsWith('temp_')) {
      // Временный ключ - просто удаляем из состояния
      setUploadProgress(prev => {
        const newProgress = { ...prev };
        delete newProgress[fileId];
        return newProgress;
      });
    } else {
      // Реальный fileId - удаляем из сервиса синхронизации
      syncService.deleteFile(fileId)
        .then(result => {
          console.log('Файл удален из истории синхронизаций:', result);
          
          // Обновляем список синхронизируемых файлов
          loadSyncFiles();
        })
        .catch(error => {
          console.error('Ошибка при удалении файла из истории синхронизаций:', error);
        });
    }
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
      
      {(Object.keys(uploadProgress).length > 0 || syncFiles.length > 0) && (
        <div className="upload-progress-container">
          <h4>Загрузки и синхронизация</h4>
          
          {/* Временные загрузки (до получения fileId) */}
          {Object.entries(uploadProgress)
            .filter(([key]) => key.startsWith('temp_'))
            .map(([fileId, progress]) => {
              const fileName = fileId.split('_').slice(2).join('_');
              
              return (
                <div key={fileId} className="upload-progress-item">
                  <div className="upload-progress-info">
                    <span className="upload-filename">{fileName}</span>
                    <div className="upload-progress-bar-container">
                      <div 
                        className={`upload-progress-bar ${
                          progress === 100 ? 'complete' : 
                          progress === -1 ? 'cancelled' :
                          uploadErrors[fileId] ? 'error' : ''
                        }`}
                        style={{ width: `${Math.max(0, progress)}%` }}
                      ></div>
                    </div>
                    <span className="upload-progress-text">
                      {progress === 100 ? (
                        <FontAwesomeIcon icon={faCheckCircle} className="success-icon" />
                      ) : progress === -1 ? (
                        'Отменено'
                      ) : uploadErrors[fileId] ? (
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
                        onClick={() => handleRemoveCompleted(fileId)}
                        title="Убрать из списка"
                      >
                        <FontAwesomeIcon icon={faTimesCircle} />
                      </button>
                    ) : progress !== -1 && !uploadErrors[fileId] ? (
                      <button 
                        className="upload-action-button"
                        onClick={() => handleCancel(fileId)}
                        title="Отменить загрузку"
                      >
                        <FontAwesomeIcon icon={faTimesCircle} />
                      </button>
) : uploadErrors[fileId] ? (
  <div className="upload-error-message" title={uploadErrors[fileId]}>
    Ошибка: {uploadErrors[fileId].substring(0, 30)}{uploadErrors[fileId].length > 30 ? '...' : ''}
  </div>
) : null}
</div>
</div>
);
})
}

{/* Синхронизируемые файлы */}
{syncFiles.map(sync => (
<div key={sync.fileId} className="upload-progress-item">
<div className="upload-progress-info">
<span className="upload-filename">{sync.filename}</span>
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
) : sync.status === 'error' ? (
<div className="upload-error-message" title={sync.error}>
Ошибка: {(sync.error || '').substring(0, 30)}{(sync.error || '').length > 30 ? '...' : ''}
</div>
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