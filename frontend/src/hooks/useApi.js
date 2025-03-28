import { useState, useCallback } from 'react';
import { useToast } from '../context/ToastContext';
import syncService from '../services/syncService';

// Базовый URL для API запросов
export const API_URL = '/api';
export const API_VERSION = 'v1'; // Версия API

/**
 * Hook для работы с API
 * @return {object} методы и состояния для работы с API
 */
const useApi = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();

  // Формирование базового URL с версией API
  const getApiUrl = useCallback((endpoint) => {
    return `${API_URL}/${API_VERSION}${endpoint}`;
  }, []);

  /**
   * Общая функция для выполнения запросов
   */
  const fetchData = useCallback(async (endpoint, options = {}) => {
    setLoading(true);
    setError('');
    
    try {
      const response = await fetch(getApiUrl(endpoint), options);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Ошибка HTTP: ${response.status}`);
      }
      
      const data = await response.json();
      return data;
    } catch (err) {
      console.error(`Ошибка API (${endpoint}):`, err);
      setError(err.message || 'Произошла ошибка при выполнении запроса');
      return null;
    } finally {
      setLoading(false);
    }
  }, [getApiUrl]);

  /**
   * Получение списка дисков
   */
  const fetchDisks = useCallback(async () => {
    return await fetchData('/disks');
  }, [fetchData]);

  /**
   * Получение списка файлов в директории
   */
  const fetchFiles = useCallback(async (disk, path = '') => {
    return await fetchData(`/disks/${disk}/files?path=${encodeURIComponent(path)}`);
  }, [fetchData]);

  /**
   * Удаление файла или директории
   */
  const deleteFile = useCallback(async (disk, filePath) => {
    return await fetchData(`/disks/${disk}/files`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ filePath }),
    });
  }, [fetchData]);

  /**
   * Создание новой папки
   */
  const createFolder = useCallback(async (disk, folderPath, folderName) => {
    try {
      console.log('Отправка запроса на создание папки:', { 
        disk, folderPath, folderName,
        url: getApiUrl(`/disks/${disk}/createFolder`)
      });
      
      return await fetchData(`/disks/${disk}/createFolder`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ folderPath, folderName }),
      });
    } catch (error) {
      console.error('Ошибка создания папки:', error);
      setError('Не удалось создать папку: ' + (error.message || 'Неизвестная ошибка'));
      return null;
    }
  }, [fetchData, getApiUrl, setError]);

  /**
   * Получение URL для скачивания файла
   */
  const getDownloadUrl = useCallback((disk, filePath) => {
    return `${getApiUrl(`/disks/${disk}/download`)}?path=${encodeURIComponent(filePath)}`;
  }, [getApiUrl]);

  /**
   * Получение списка активных загрузок
   */
  const getActiveUploads = useCallback(async (disk, path = '') => {
    try {
      return await fetchData(`/disks/${disk}/upload-status?path=${encodeURIComponent(path)}`);
    } catch (error) {
      console.error('Ошибка при получении статуса загрузок:', error);
      return { uploads: [] };
    }
  }, [fetchData]);

  /**
   * Очистка всех активных загрузок на сервере
   */
  const clearActiveUploads = useCallback(async (disk) => {
    try {
      const endpoint = disk ? 
        `/disks/${disk}/clear-uploads` : 
        '/uploads/clear';
      
      const result = await fetchData(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        }
      });
      
      if (result && result.success) {
        console.log('Активные загрузки успешно очищены на сервере');
        return { success: true, ...result };
      } else {
        console.error('Ошибка при очистке активных загрузок:', result?.error || 'Неизвестная ошибка');
        return { success: false, error: result?.error || 'Не удалось очистить загрузки' };
      }
    } catch (error) {
      console.error('Ошибка при очистке активных загрузок:', error);
      return { success: false, error: error.message || 'Не удалось очистить загрузки' };
    }
  }, [fetchData]);

  /**
   * Загрузка файла с прогрессом и оптимизацией для больших файлов
   */
  const uploadFile = useCallback((disk, path, file, onProgress, onComplete, onError) => {
    console.log(`Подготовка к загрузке файла: ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`);

  // Проверяем поддержку локального хранилища
  if (syncService.isSupported) {
    // Используем сервис синхронизации для загрузки файла
    syncService.uploadFile(file, {
      disk,
      path,
      onProgress,
      onComplete: (result) => {
        if (onComplete) {
          onComplete(result);
        }
      },
      onError: (error) => {
        if (onError) {
          onError(error.message || 'Произошла ошибка при загрузке файла');
        }
      }
    })
    .then(result => {
      console.log('Файл добавлен в очередь синхронизации:', result);
      // Добавляем обработчик событий для этого конкретного файла
      const syncListener = (event) => {
        if (event.data && event.data.fileId === result.fileId) {
          if (event.type === 'sync_progress') {
            if (onProgress) {
              onProgress(event.data.progress || 0);
            }
          } else if (event.type === 'sync_completed') {
            if (onComplete) {
              onComplete({
                name: file.name,
                size: file.size,
                path: path ? `${path}/${file.name}` : file.name,
                fullPath: path ? `${path}/${file.name}` : file.name
              });
            }
            // Удаляем обработчик после завершения
            syncService.removeSyncListener(syncListener);
          } else if (event.type === 'sync_error' || event.type === 'error') {
            if (onError) {
              onError(event.data.error || 'Произошла ошибка при синхронизации файла');
            }
            // Удаляем обработчик после ошибки
            syncService.removeSyncListener(syncListener);
          }
        }
      };
      
      // Добавляем обработчик
      syncService.addSyncListener(syncListener);
    })
    .catch(error => {
      console.error('Ошибка при добавлении файла в очередь синхронизации:', error);
      if (onError) {
        onError(error.message || 'Произошла ошибка при загрузке файла');
      }
    });
    
    // Возвращаем функцию для отмены загрузки
    return () => {
      console.log('Отмена загрузки файла:', file.name);
      
      // Отменяем синхронизацию, если есть fileId
      if (result && result.fileId) {
        syncService.cancelSync(result.fileId)
          .then(result => {
            console.log('Синхронизация отменена:', result);
          })
          .catch(error => {
            console.error('Ошибка при отмене синхронизации:', error);
          });
      }
    };
  } else {
    
    // ID загрузки для отслеживания
    const uploadId = `upload_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
    
    // Сохраняем информацию о файле в localStorage для постоянного хранения
    try {
      const activeUploads = JSON.parse(localStorage.getItem('activeUploads') || '{}');
      
      // Проверяем, существует ли уже такой файл в загрузке
      let existingUploadId = null;
      Object.keys(activeUploads).forEach(key => {
        const upload = activeUploads[key];
        if (upload.disk === disk && 
            upload.path === path && 
            upload.fileName === file.name) {
          existingUploadId = key;
        }
      });
      
      // Если файл уже загружается, используем тот же ID или обновляем статус
      if (existingUploadId) {
        const existingUpload = activeUploads[existingUploadId];
        if (existingUpload.status === 'error' || existingUpload.status === 'completed') {
          // Если предыдущая загрузка завершилась или была ошибка - удаляем запись
          delete activeUploads[existingUploadId];
        } else {
          // Если загрузка в процессе, перезапускаем ее
          activeUploads[existingUploadId].status = 'restarting';
          localStorage.setItem('activeUploads', JSON.stringify(activeUploads));
          
          // Отправляем запрос на отмену текущей загрузки на сервере
          fetch(getApiUrl(`/disks/${disk}/cancel-upload`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              filename: file.name,
              path: path
            })
          }).catch(e => console.warn('Не удалось отменить предыдущую загрузку:', e));
          
          // Удаляем старую запись
          delete activeUploads[existingUploadId];
        }
      }
      
      // Сохраняем новую запись
      activeUploads[uploadId] = {
        disk,
        path,
        fileName: file.name,
        fileSize: file.size,
        startTime: Date.now(),
        status: 'starting',
        progress: 0,
        visible: true, // Для отображения в интерфейсе
        pausable: true // Возможность приостановки
      };
      
      localStorage.setItem('activeUploads', JSON.stringify(activeUploads));
    } catch (e) {
      console.warn('Не удалось сохранить информацию о загрузке в localStorage:', e);
    }
    
    // Определяем, большой ли файл
    const isLargeFile = file.size > 50 * 1024 * 1024; // файлы больше 50MB 
    const isVeryLargeFile = file.size > 500 * 1024 * 1024; // файлы больше 500MB
    
    // Настраиваем размер чанка в зависимости от размера файла
    const chunkSize = isVeryLargeFile ? 5 * 1024 * 1024 : // 5MB для очень больших файлов
                     isLargeFile ? 2 * 1024 * 1024 : // 2MB для больших файлов
                     1 * 1024 * 1024; // 1MB для обычных файлов
    
    // Запоминаем, если загрузка была отменена
    let requestAborted = false;
    let lastProgress = 0;
    
    // Регистрируем обработчик beforeunload, чтобы предупредить пользователя о незавершенной загрузке
    const handleBeforeUnload = (e) => {
      if (!requestAborted && lastProgress < 100) {
        e.preventDefault();
        e.returnValue = 'Загрузка файла в процессе. Вы уверены, что хотите покинуть страницу?';
        return e.returnValue;
      }
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    // Общее количество чанков
    const totalChunks = Math.ceil(file.size / chunkSize);
    console.log(`Файл будет загружен в ${totalChunks} частях по ${(chunkSize / (1024 * 1024)).toFixed(2)} MB`);
    
    // Инициализируем абортконтроллер для возможности отмены загрузки
    const abortController = new AbortController();
    
    // Запускаем загрузку файла по чанкам
    const startChunkedUpload = async () => {
      try {
        // Обновляем статус загрузки
        updateLocalUploadStatus(uploadId, {
          status: 'uploading',
          totalChunks,
          progress: 0
        });
        
        let uploadedChunks = 0;
        let hasError = false;
        
        // Загружаем чанки последовательно
        for (let i = 0; i < totalChunks && !requestAborted; i++) {
          const start = i * chunkSize;
          const end = Math.min(file.size, start + chunkSize);
          const chunk = file.slice(start, end);
          
          // Создаем FormData для загрузки чанка
          const formData = new FormData();
          formData.append('chunk', chunk);
          formData.append('index', i.toString());
          formData.append('totalChunks', totalChunks.toString());
          formData.append('filename', file.name);
          formData.append('path', path);
          formData.append('uploadId', uploadId);
          formData.append('fileSize', file.size.toString());
          
          // Логируем информацию о загружаемом чанке
          console.log(`Загрузка чанка ${i+1}/${totalChunks} (${(start/(1024*1024)).toFixed(2)}-${(end/(1024*1024)).toFixed(2)} MB)`);
          
          try {
            // Отправляем чанк на сервер
            const response = await fetch(getApiUrl(`/disks/${disk}/upload-chunk`), {
              method: 'POST',
              body: formData,
              signal: abortController.signal
            });
            
            if (!response.ok) {
              const data = await response.json().catch(() => ({}));
              console.error(`Ошибка при загрузке чанка ${i}:`, data.error || response.statusText);
              
              // Делаем до 3-х попыток загрузки проблемного чанка
              let retryCount = 0;
              let retrySuccess = false;
              
              while (retryCount < 3 && !retrySuccess && !requestAborted) {
                retryCount++;
                console.log(`Повторная попытка ${retryCount}/3 для чанка ${i}`);
                
                // Обновляем статус в localStorage
                updateLocalUploadStatus(uploadId, {
                  status: 'retrying',
                  retryChunk: i,
                  retryCount
                });
                
                // Ждем перед повторной попыткой
                await new Promise(resolve => setTimeout(resolve, retryCount * 1000));
                
                try {
                  const retryResponse = await fetch(getApiUrl(`/disks/${disk}/upload-chunk`), {
                    method: 'POST',
                    body: formData,
                    signal: abortController.signal
                  });
                  
                  if (retryResponse.ok) {
                    console.log(`Успешно повторно загружен чанк ${i}`);
                    retrySuccess = true;
                  } else {
                    console.error(`Ошибка при повторной загрузке чанка ${i}:`, 
                      (await retryResponse.json().catch(() => ({}))).error || retryResponse.statusText);
                  }
                } catch (retryError) {
                  console.error(`Ошибка сети при повторной загрузке чанка ${i}:`, retryError);
                }
              }
              
              if (!retrySuccess) {
                hasError = true;
                throw new Error(`Не удалось загрузить чанк ${i} после нескольких попыток`);
              }
            }
            
            // Обрабатываем ответ сервера
            const data = await response.json();
            
            // Увеличиваем счетчик загруженных чанков
            uploadedChunks++;
            
            // Обновляем прогресс загрузки
            const progress = Math.min(Math.round((uploadedChunks / totalChunks) * 95), 95); // оставляем 5% на финализацию
            if (progress > lastProgress) {
              onProgress(progress);
              lastProgress = progress;
              
              // Обновляем статус в localStorage
              updateLocalUploadStatus(uploadId, {
                status: 'uploading',
                progress,
                uploadedChunks
              });
            }
            
            // Если это последний чанк, запускаем финализацию
            if (data.isLastChunk || uploadedChunks === totalChunks) {
              console.log('Загружен последний чанк, начинаем финализацию...');
              await finalizeUpload();
            }
          } catch (error) {
            // Проверяем, не была ли загрузка отменена пользователем
            if (error.name === 'AbortError' || requestAborted) {
              console.log('Загрузка была отменена пользователем');
              throw new Error('Загрузка отменена');
            }
            
            console.error(`Ошибка при загрузке чанка ${i}:`, error);
            hasError = true;
            throw error;
          }
        }
        
        // Если все чанки загружены, но финализация еще не запущена
        if (uploadedChunks === totalChunks && !requestAborted && !hasError) {
          console.log('Все чанки загружены, запускаем финализацию...');
          await finalizeUpload();
        }
      } catch (error) {
        // Проверяем, не была ли загрузка отменена пользователем
        if (error.name === 'AbortError' || requestAborted) {
          console.log('Загрузка была отменена');
          updateLocalUploadStatus(uploadId, {
            status: 'cancelled',
            cancelledAt: Date.now()
          });
        } else {
          console.error('Ошибка при чанковой загрузке файла:', error);
          updateLocalUploadStatus(uploadId, {
            status: 'error',
            error: error.message || 'Неизвестная ошибка при загрузке',
            errorAt: Date.now()
          });
          onError(error.message || 'Произошла ошибка при загрузке файла');
        }
        
        // Отправляем запрос на отмену загрузки на сервере
        try {
          await fetch(getApiUrl(`/disks/${disk}/cancel-upload`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              filename: file.name,
              path: path,
              uploadId
            })
          });
        } catch (cancelError) {
          console.warn('Не удалось отменить загрузку на сервере:', cancelError);
        }
        
        // Удаляем обработчик beforeunload
        window.removeEventListener('beforeunload', handleBeforeUnload);
        
        return false;
      }
    };
    
    // Функция для финализации загрузки
    const finalizeUpload = async () => {
      try {
        // Обновляем статус в localStorage
        updateLocalUploadStatus(uploadId, {
          status: 'finalizing',
          progress: 95
        });
        
        onProgress(95);
        lastProgress = 95;
        
        // Запрашиваем финализацию загрузки на сервере
        const response = await fetch(getApiUrl(`/disks/${disk}/finalize-upload`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: file.name,
            path: path,
            totalChunks,
            uploadId
          }),
          signal: abortController.signal
        });
        
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || 'Ошибка при финализации загрузки');
        }
        
        const data = await response.json();
        console.log('Ответ сервера при финализации:', data);
        
        // Если файл уже существует или финализация завершена мгновенно
        if (data.success && (data.file || data.status === 'completed')) {
          // Обновляем статус в localStorage
          updateLocalUploadStatus(uploadId, {
            status: 'completed',
            progress: 100,
            completedAt: Date.now()
          });
          
          onProgress(100);
          lastProgress = 100;
          
          // Вызываем колбэк завершения
          setTimeout(() => {
            onComplete({
              filename: file.name,
              path: path || '',
              disk,
              fullPath: path ? `${path}/${file.name}` : file.name
            });
          }, 500);
          
          // Удаляем обработчик beforeunload
          window.removeEventListener('beforeunload', handleBeforeUnload);
          
          return true;
        } else {
          // Финализация запущена, но будет выполняться на сервере в фоновом режиме
          // Запускаем проверку статуса
          await checkFinalizeStatus();
          return true;
        }
      } catch (error) {
        // Проверяем, не была ли загрузка отменена пользователем
        if (error.name === 'AbortError' || requestAborted) {
          console.log('Финализация была отменена');
          updateLocalUploadStatus(uploadId, {
            status: 'cancelled',
            cancelledAt: Date.now()
          });
        } else {
          console.error('Ошибка при финализации загрузки:', error);
          updateLocalUploadStatus(uploadId, {
            status: 'error',
            error: error.message || 'Неизвестная ошибка при финализации',
            errorAt: Date.now()
          });
          onError(error.message || 'Произошла ошибка при финализации загрузки');
        }
        
        // Удаляем обработчик beforeunload
        window.removeEventListener('beforeunload', handleBeforeUnload);
        
        return false;
      }
    };
    
    // Функция для проверки статуса финализации
    const checkFinalizeStatus = async () => {
      let maxAttempts = 30; // Максимальное количество попыток проверки
      let attempts = 0;
      let complete = false;
      let lastStatus = '';
      
      while (attempts < maxAttempts && !requestAborted && !complete) {
        attempts++;
        
        try {
          // Делаем паузу между запросами
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // Запрашиваем статус загрузки
          const response = await fetch(getApiUrl(`/disks/${disk}/upload-status?path=${encodeURIComponent(path)}`), {
            signal: abortController.signal
          });
          
          if (!response.ok) {
            console.error('Ошибка при проверке статуса загрузки:', response.statusText);
            continue;
          }
          
          const data = await response.json();
          const thisUpload = data.uploads?.find(upload => 
            upload.filename === file.name && 
            (upload.path === path || (!upload.path && !path))
          );
          
          if (thisUpload) {
            const status = thisUpload.status;
            const progress = thisUpload.progress || lastProgress;
            
            // Обновляем прогресс только если он увеличился
            if (progress > lastProgress) {
              onProgress(progress);
              lastProgress = progress;
              
              // Обновляем статус в localStorage
              updateLocalUploadStatus(uploadId, {
                status,
                progress,
                serverProgress: progress
              });
            }
            
            // Если статус изменился, логируем его
            if (status !== lastStatus) {
              console.log(`Статус загрузки изменился: ${lastStatus} -> ${status}, прогресс: ${progress}%`);
              lastStatus = status;
            }
            
            // Проверяем завершение загрузки
            if (status === 'completed' || progress >= 100) {
              complete = true;
              
              // Обновляем статус в localStorage
              updateLocalUploadStatus(uploadId, {
                status: 'completed',
                progress: 100,
                completedAt: Date.now()
              });
              
              onProgress(100);
              lastProgress = 100;
              
              // Вызываем колбэк завершения
              onComplete({
                filename: file.name,
                path: path || '',
                disk,
                fullPath: path ? `${path}/${file.name}` : file.name
              });
              
              // Удаляем обработчик beforeunload
              window.removeEventListener('beforeunload', handleBeforeUnload);
              
              return true;
            }
            
            // Если произошла ошибка на сервере
            if (status === 'error') {
              throw new Error(thisUpload.error || 'Ошибка при обработке файла на сервере');
            }
          } else if (attempts > 10) {
            // Если после 10 попыток загрузка не найдена, проверяем наличие файла напрямую
            try {
              const filesResponse = await fetch(getApiUrl(`/disks/${disk}/files?path=${encodeURIComponent(path)}`), {
                signal: abortController.signal
              });
              
              if (filesResponse.ok) {
                const filesData = await filesResponse.json();
                const fileExists = filesData.files?.some(f => f.name === file.name);
                
                if (fileExists) {
                  console.log('Файл найден в директории, загрузка, вероятно, завершена');
                  complete = true;
                  
                  // Обновляем статус в localStorage
                  updateLocalUploadStatus(uploadId, {
                    status: 'completed',
                    progress: 100,
                    completedAt: Date.now()
                  });
                  
                  onProgress(100);
                  lastProgress = 100;
                  
                  // Вызываем колбэк завершения
                  onComplete({
                    filename: file.name,
                    path: path || '',
                    disk,
                    fullPath: path ? `${path}/${file.name}` : file.name
                  });
                  
                  // Удаляем обработчик beforeunload
                  window.removeEventListener('beforeunload', handleBeforeUnload);
                  
                  return true;
                }
              }
            } catch (error) {
              console.error('Ошибка при проверке наличия файла:', error);
            }
          }
        } catch (error) {
          // Проверяем, не была ли загрузка отменена пользователем
          if (error.name === 'AbortError' || requestAborted) {
            console.log('Проверка статуса была отменена');
            return false;
          }
          
          console.error('Ошибка при проверке статуса загрузки:', error);
        }
      }
      
      // Если достигнут лимит попыток, но загрузка не завершена
      if (attempts >= maxAttempts && !complete && !requestAborted) {
        console.warn('Превышено максимальное количество попыток проверки статуса');
        
        // Проверяем наличие файла напрямую как последнюю попытку
        try {
          const filesResponse = await fetch(getApiUrl(`/disks/${disk}/files?path=${encodeURIComponent(path)}`));
          
          if (filesResponse.ok) {
            const filesData = await filesResponse.json();
            const fileExists = filesData.files?.some(f => f.name === file.name);
            
            if (fileExists) {
              console.log('Файл найден в директории, загрузка, вероятно, завершена');
              
              // Обновляем статус в localStorage
              updateLocalUploadStatus(uploadId, {
                status: 'completed',
                progress: 100,
                completedAt: Date.now()
              });
              
              onProgress(100);
              lastProgress = 100;
              
              // Вызываем колбэк завершения
              onComplete({
                filename: file.name,
                path: path || '',
                disk,
                fullPath: path ? `${path}/${file.name}` : file.name
              });
              
              // Удаляем обработчик beforeunload
              window.removeEventListener('beforeunload', handleBeforeUnload);
              
              return true;
            }
          }
        } catch (error) {
          console.error('Ошибка при финальной проверке наличия файла:', error);
        }
        
        // Обновляем статус в localStorage
        updateLocalUploadStatus(uploadId, {
          status: 'unknown',
          progress: lastProgress,
          lastChecked: Date.now()
        });
        
        // Показываем предупреждение пользователю
        toast.show({
          type: 'warning',
          title: 'Неопределенный статус загрузки',
          message: `Не удалось определить статус загрузки файла ${file.name}. Проверьте, появился ли файл в списке.`
        });
      }
      
      return complete;
    };
    
    // Функция для обновления статуса загрузки в localStorage
    const updateLocalUploadStatus = (id, updates) => {
      try {
        const activeUploads = JSON.parse(localStorage.getItem('activeUploads') || '{}');
        
        if (activeUploads[id]) {
          activeUploads[id] = {
            ...activeUploads[id],
            ...updates,
            lastUpdate: Date.now()
          };
          
          localStorage.setItem('activeUploads', JSON.stringify(activeUploads));
        }
      } catch (e) {
        console.warn('Не удалось обновить статус загрузки в localStorage:', e);
      }
    };
    
    // Показываем начальный прогресс
    onProgress(1);
    lastProgress = 1;
    
    // Запускаем загрузку
    startChunkedUpload();
    
    // Возвращаем функцию для отмены загрузки
    return () => {
      console.log('Отмена загрузки файла:', file.name);
      requestAborted = true;
      
      // Отменяем все запросы через AbortController
      abortController.abort();
      
      // Удаляем обработчик beforeunload
      window.removeEventListener('beforeunload', handleBeforeUnload);
      
      // Обновляем статус в localStorage
      updateLocalUploadStatus(uploadId, {
        status: 'cancelled',
        cancelledAt: Date.now()
      });
      
      // Отправляем запрос на отмену загрузки на сервере
      fetch(getApiUrl(`/disks/${disk}/cancel-upload`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          path: path,
          uploadId
        })
      }).catch(e => console.warn('Не удалось отправить запрос на отмену загрузки:', e));
    };
  }
  }, [getApiUrl, toast]);

  // Получение активных загрузок из localStorage для текущего пути
  const getLocalUploads = useCallback((disk, path = '') => {
    try {
      const activeUploads = JSON.parse(localStorage.getItem('activeUploads') || '{}');
      
      // Фильтруем загрузки по диску и пути
      return Object.entries(activeUploads)
        .filter(([_, upload]) => 
          upload.disk === disk && 
          (upload.path === path || (path === '' && !upload.path)) &&
          // Не показываем завершенные загрузки старше 1 часа
          !(upload.status === 'completed' && upload.completedAt && (Date.now() - upload.completedAt > 3600000))
        )
        .map(([id, upload]) => ({
          id,
          fileName: upload.fileName,
          fileSize: upload.fileSize,
          status: upload.status,
          progress: upload.progress || 0,
          startTime: upload.startTime,
          completedAt: upload.completedAt,
          visible: upload.visible !== false,
          path: upload.path
        }));
    } catch (e) {
      console.error('Ошибка при получении активных загрузок из localStorage:', e);
      return [];
    }
  }, []);

  // Возвращаем API-методы
  return {
    loading,
    error,
    setError,
    fetchDisks,
    fetchFiles,
    deleteFile,
    createFolder,
    getDownloadUrl,
    uploadFile,
    getActiveUploads,
    clearActiveUploads,
    getLocalUploads
  };
};

export default useApi;