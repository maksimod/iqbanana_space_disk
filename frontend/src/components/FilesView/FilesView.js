import React, { useState, useEffect, useRef, useCallback } from 'react';
import NavigationBar from './NavigationBar';
import FileActions from './FileActions';
import FilesList from './FilesList';
import FileSearch from './FileSearch';
import Loading from '../Loading';
import useApi from '../../hooks/useApi';
import { useAppContext } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';

const FilesView = () => {
  const [uploadProgress, setUploadProgress] = useState(0);
  const [searchResults, setSearchResults] = useState(null);
  const [uploadStatus, setUploadStatus] = useState('');
  const [activeUploads, setActiveUploads] = useState([]);
  // Трекер для отслеживания уже показанных уведомлений
  const shownNotifications = useRef(new Set());
  
  const { 
    currentDisk, 
    currentPath, 
    files, 
    loading, 
    handleBack, 
    handleNavigate, 
    loadFiles, 
    loadDisks 
  } = useAppContext();
  
  const { deleteFile, createFolder, getDownloadUrl, downloadFile, uploadFile, getActiveUploads, clearActiveUploads } = useApi();
  const toast = useToast();

  // Определяем, какие файлы отображать - результаты поиска или все файлы
  const displayFiles = searchResults || files;
  
  // Функция для полной очистки записей о загрузках в sessionStorage и на сервере
  const clearAllUploads = useCallback(async () => {
    try {
      toast.showInfo('Очистка активных загрузок...');
      
      // Очищаем sessionStorage от всех загрузок
      sessionStorage.removeItem('activeUploads');

      // Очищаем набор уведомлений
      shownNotifications.current.clear();
      
      // Сбрасываем состояние загрузки в UI
      setActiveUploads([]);
      setUploadProgress(0);
      setUploadStatus('');

      // Очищаем активные загрузки на сервере через API
      const result = await clearActiveUploads(currentDisk);
      
      // Перезагружаем файлы
      await loadFiles();
      
      if (result && result.success) {
        toast.showSuccess('Все записи о загрузках успешно очищены');
      } else {
        const errorMsg = result?.error || 'Не удалось очистить все загрузки на сервере';
        console.warn('Предупреждение при очистке загрузок:', errorMsg);
        toast.showWarning(`Локальные записи о загрузках очищены, но на сервере могли остаться активные загрузки: ${errorMsg}`);
      }
    } catch (e) {
      console.error('Ошибка при очистке загрузок:', e);
      toast.showError('Произошла ошибка при очистке загрузок: ' + (e.message || 'Неизвестная ошибка'));
      
      // Пытаемся очистить хотя бы локальные данные
      try {
        sessionStorage.removeItem('activeUploads');
        shownNotifications.current.clear();
        setActiveUploads([]);
        setUploadProgress(0);
        setUploadStatus('');
        
        toast.showWarning('Локальные записи о загрузках очищены, но на сервере могли остаться активные загрузки');
      } catch (innerError) {
        console.error('Критическая ошибка при очистке загрузок:', innerError);
      }
    }
  }, [clearActiveUploads, currentDisk, loadFiles, toast]);
  
  // Очистка старых загрузок при монтировании компонента
  useEffect(() => {
    // Функция для очистки устаревших загрузок
    const cleanupStalledUploads = () => {
      try {
        const savedUploads = JSON.parse(sessionStorage.getItem('activeUploads') || '{}');
        const now = Date.now();
        const oneHourAgo = now - 3600000; // 1 час
        let hasChanges = false;
        
        // Удаляем записи старше часа
        Object.keys(savedUploads).forEach(key => {
          const upload = savedUploads[key];
          if (upload.startTime < oneHourAgo) {
            delete savedUploads[key];
            hasChanges = true;
          }
        });
        
        if (hasChanges) {
          sessionStorage.setItem('activeUploads', JSON.stringify(savedUploads));
        }
      } catch (e) {
        console.error('Ошибка при очистке устаревших загрузок:', e);
      }
    };
    
    // Очищаем sessionStorage при загрузке компонента
    cleanupStalledUploads();
    
    // Полностью очищаем трекер уведомлений
    shownNotifications.current.clear();
    
  }, []);
  
  // Проверяем активные загрузки при монтировании компонента и смене диска/папки
  useEffect(() => {
    // Очищаем трекер уведомлений при смене диска/папки
    shownNotifications.current.clear();
    
    // Проверяем загрузки, сохраненные в sessionStorage
    try {
      const savedUploads = JSON.parse(sessionStorage.getItem('activeUploads') || '{}');
      const currentPathUploads = Object.values(savedUploads).filter(
        upload => upload.disk === currentDisk && upload.path === currentPath
      );
      
      if (currentPathUploads.length > 0) {
        console.log('Найдены незавершенные загрузки:', currentPathUploads);
        setActiveUploads(currentPathUploads);
        
        // Проверяем статус на сервере
        getActiveUploads(currentDisk, currentPath).then(response => {
          if (response && response.uploads && response.uploads.length > 0) {
            console.log('Активные загрузки на сервере:', response.uploads);
            
            // Обработка активных загрузок на сервере
            for (const upload of response.uploads) {
              const uploadId = `${upload.filename}:${upload.status}`;
              const matchingSavedUpload = currentPathUploads.find(
                saved => saved.fileName === upload.filename
              );
              
              if (matchingSavedUpload && !shownNotifications.current.has(uploadId)) {
                // Если загрузка завершена на сервере, обновляем интерфейс
                if (upload.status === 'completed') {
                  toast.showSuccess(`Файл ${upload.filename} был успешно загружен`);
                  shownNotifications.current.add(uploadId);
                  
                  // Удаляем из sessionStorage
                  const updatedUploads = {...savedUploads};
                  Object.keys(updatedUploads).forEach(key => {
                    if (updatedUploads[key].fileName === upload.filename &&
                        updatedUploads[key].disk === currentDisk &&
                        updatedUploads[key].path === currentPath) {
                      delete updatedUploads[key];
                    }
                  });
                  sessionStorage.setItem('activeUploads', JSON.stringify(updatedUploads));
                  
                  // Обновляем список файлов
                  loadFiles();
                }
                else if (upload.status === 'error') {
                  toast.showError(`Ошибка при загрузке файла ${upload.filename}`);
                  shownNotifications.current.add(uploadId);
                  
                  // Удаляем из sessionStorage
                  const updatedUploads = {...savedUploads};
                  Object.keys(updatedUploads).forEach(key => {
                    if (updatedUploads[key].fileName === upload.filename &&
                        updatedUploads[key].disk === currentDisk &&
                        updatedUploads[key].path === currentPath) {
                      delete updatedUploads[key];
                    }
                  });
                  sessionStorage.setItem('activeUploads', JSON.stringify(updatedUploads));
                }
                else if (upload.status === 'uploading') {
                  // Обрабатываем текущую загрузку
                  toast.showInfo(`Загрузка файла ${upload.filename} в процессе (${upload.progress}%)`);
                  shownNotifications.current.add(uploadId);
                  setUploadStatus(`Загрузка ${upload.filename}: ${upload.progress}%`);
                  setUploadProgress(upload.progress);
                }
              }
            }
          } else {
            // Если на сервере нет активных загрузок, очищаем sessionStorage
            const updatedUploads = {...savedUploads};
            Object.keys(updatedUploads).forEach(key => {
              if (updatedUploads[key].disk === currentDisk &&
                  updatedUploads[key].path === currentPath) {
                delete updatedUploads[key];
              }
            });
            sessionStorage.setItem('activeUploads', JSON.stringify(updatedUploads));
          }
        });
      }
    } catch (e) {
      console.error('Ошибка при проверке незавершенных загрузок:', e);
    }
  }, [currentDisk, currentPath, getActiveUploads, loadFiles, toast]);
  
  // Периодически проверяем активные загрузки
  useEffect(() => {
    if (currentDisk && activeUploads.length > 0) {
      const intervalId = setInterval(() => {
        getActiveUploads(currentDisk, currentPath).then(response => {
          if (response && response.uploads && response.uploads.length > 0) {
            // Обновляем статус активных загрузок
            const completedUploads = [];
            
            for (const upload of response.uploads) {
              const uploadId = `${upload.filename}:${upload.status}`;
              const matchingUpload = activeUploads.find(
                active => active.fileName === upload.filename
              );
              
              if (matchingUpload && !shownNotifications.current.has(uploadId)) {
                if (upload.status === 'completed') {
                  completedUploads.push(upload.filename);
                  toast.showSuccess(`Файл ${upload.filename} успешно загружен`);
                  shownNotifications.current.add(uploadId);
                  loadFiles();
                } 
                else if (upload.status === 'uploading') {
                  setUploadStatus(`Загрузка ${upload.filename}: ${upload.progress}%`);
                  setUploadProgress(upload.progress);
                }
              }
            }
            
            // Удаляем завершенные загрузки из списка активных
            if (completedUploads.length > 0) {
              setActiveUploads(prev => 
                prev.filter(upload => !completedUploads.includes(upload.fileName))
              );
              
              // Также удаляем из sessionStorage
              try {
                const savedUploads = JSON.parse(sessionStorage.getItem('activeUploads') || '{}');
                const updatedUploads = {...savedUploads};
                
                Object.keys(updatedUploads).forEach(key => {
                  if (completedUploads.includes(updatedUploads[key].fileName) &&
                      updatedUploads[key].disk === currentDisk &&
                      updatedUploads[key].path === currentPath) {
                    delete updatedUploads[key];
                  }
                });
                
                sessionStorage.setItem('activeUploads', JSON.stringify(updatedUploads));
              } catch (e) {
                console.error('Ошибка при обновлении sessionStorage:', e);
              }
            }
          } else {
            // Если на сервере нет активных загрузок, очищаем наш список
            setActiveUploads([]);
            setUploadProgress(0);
            setUploadStatus('');
            
            // Очищаем sessionStorage для текущего пути
            try {
              const savedUploads = JSON.parse(sessionStorage.getItem('activeUploads') || '{}');
              const updatedUploads = {...savedUploads};
              
              Object.keys(updatedUploads).forEach(key => {
                if (updatedUploads[key].disk === currentDisk &&
                    updatedUploads[key].path === currentPath) {
                  delete updatedUploads[key];
                }
              });
              
              sessionStorage.setItem('activeUploads', JSON.stringify(updatedUploads));
            } catch (e) {
              console.error('Ошибка при очистке sessionStorage:', e);
            }
          }
        });
      }, 3000); // Проверка каждые 3 секунды
      
      return () => {
        clearInterval(intervalId);
        // Очищаем трекер уведомлений при размонтировании
        shownNotifications.current.clear();
      };
    }
  }, [currentDisk, currentPath, activeUploads, getActiveUploads, loadFiles, toast]);

  // Загрузка файла
  const handleUpload = (file, onComplete) => {
    // Очищаем все старые уведомления перед новой загрузкой
    shownNotifications.current.clear();
    
    // Очищаем данные предыдущих загрузок
    setUploadProgress(0);
    setUploadStatus('');
    
    // Показываем информацию о файле
    const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2);
    setUploadStatus(`Подготовка к загрузке файла ${file.name} (${fileSizeMB} MB)...`);
    toast.showInfo(`Начинается загрузка файла: ${file.name} (${fileSizeMB} MB)`);
    
    // Большие файлы загружаем с более подробным отображением статуса
    if (file.size > 50 * 1024 * 1024) {
      console.log(`Начало загрузки большого файла: ${file.name} (${fileSizeMB} MB)`);
    }
    
    const cancelUpload = uploadFile(
      currentDisk,
      currentPath,
      file,
      (progress) => {
        setUploadProgress(progress);
        if (progress % 10 === 0 || progress === 100) {
          setUploadStatus(`Загрузка: ${progress}%`);
        }
      },
      (response) => {
        // Устанавливаем прогресс в 100% и обновляем статус
        setUploadProgress(100);
        setUploadStatus('Загрузка завершена');
        
        // Специальный идентификатор для предотвращения дублирования уведомлений
        const notificationId = `${file.name}:completed:${Date.now()}`;
        if (!shownNotifications.current.has(notificationId)) {
          toast.showSuccess(`Файл ${file.name} успешно загружен`);
          shownNotifications.current.add(notificationId);
        }
        
        // Увеличиваем задержку для маленьких файлов
        // Это дает больше времени для корректной обработки соединения
        const delayTime = file.size < 1024 * 1024 ? 1500 : 1000;
        
        // Даем время для завершения всех операций на сервере
        setTimeout(() => {
          console.log('Завершение загрузки после задержки:', file.name);
          setUploadProgress(0);
          setUploadStatus('');
          // Перезагружаем список файлов и дисков
          loadFiles();
          loadDisks();
          if (onComplete) onComplete();
        }, delayTime);
      },
      (errorMsg) => {
        setUploadProgress(0);
        setUploadStatus('');
        
        // Если ошибка связана с тем, что файл уже загружается, 
        // предлагаем очистить записи о загрузках
        if (errorMsg && errorMsg.includes('уже загружается')) {
          toast.showError(`${errorMsg}. Нажмите кнопку "Очистить загрузки" и попробуйте снова.`);
          return;
        }
        
        // Специальный идентификатор для предотвращения дублирования уведомлений об ошибках
        const errorId = `${file.name}:error:${Date.now()}`;
        if (!shownNotifications.current.has(errorId)) {
          toast.showError(errorMsg || `Ошибка при загрузке файла ${file.name}. Пожалуйста, попробуйте снова.`);
          shownNotifications.current.add(errorId);
        }
      }
    );
    
    // В случае, если компонент будет размонтирован до завершения загрузки,
    // возвращаем функцию отмены для использования в useEffect cleanup
    return cancelUpload;
  };

  // Удаление файла или директории
  const handleDelete = async (file) => {
    if (!window.confirm(`Вы уверены, что хотите удалить ${file.name}?`)) {
      return;
    }
    
    const result = await deleteFile(currentDisk, file.path);
    if (result) {
      toast.showSuccess('Файл успешно удален');
      loadFiles();
      loadDisks();
      // Сбрасываем результаты поиска после удаления
      setSearchResults(null);
    }
  };

  // Создание новой папки
  const handleCreateFolder = async (folderName, onComplete) => {
    try {
      console.log('Отправка запроса на создание папки:', { folderName, path: currentPath });
      
      const result = await createFolder(currentDisk, currentPath, folderName);
      if (result && result.success) {
        toast.showSuccess('Папка успешно создана');
        loadFiles();
        if (onComplete) onComplete();
        // Сбрасываем результаты поиска после создания папки
        setSearchResults(null);
      } else {
        const errorMessage = result && result.error ? result.error : 'Не удалось создать папку';
        toast.showError(errorMessage);
        console.error('Ошибка создания папки:', errorMessage);
      }
    } catch (error) {
      toast.showError('Ошибка при создании папки: ' + (error.message || 'Неизвестная ошибка'));
      console.error('Ошибка при создании папки:', error);
    }
  };

  // Скачивание файла или папки
  const handleDownload = (file) => {
    toast.showInfo(`Скачивание файла: ${file.name}`);
    const downloadUrl = getDownloadUrl(currentDisk, file.path);
    
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Обработка результатов поиска
  const handleSearchResults = (results) => {
    setSearchResults(results);
    
    if (results && results.length === 0) {
      toast.showWarning('По вашему запросу ничего не найдено');
    } else if (results && results.length > 0) {
      toast.showInfo(`Найдено ${results.length} результатов`);
    }
  };

  return (
    <div className="files-view">
      <NavigationBar 
        currentDisk={currentDisk} 
        currentPath={currentPath} 
        onBack={handleBack} 
      />
      
      <FileSearch 
        files={files} 
        onSearchResults={handleSearchResults} 
      />
      
      <FileActions 
        onUpload={handleUpload}
        onCreateFolder={handleCreateFolder}
        uploadProgress={uploadProgress}
        onClearUploads={clearAllUploads}
      />
      
      <div className="files-container">
        {loading ? (
          <Loading message="Загрузка файлов..." />
        ) : (
          <>
            {searchResults && (
              <div className="search-results-count">
                Найдено результатов: {searchResults.length}
              </div>
            )}
            <FilesList 
              files={displayFiles}
              onNavigate={handleNavigate}
              onDelete={handleDelete}
              onDownload={handleDownload}
            />
          </>
        )}
      </div>
    </div>
  );
};

export default FilesView;