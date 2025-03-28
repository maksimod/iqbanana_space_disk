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
   * Загрузка файла с прогрессом
   */
  const uploadFile = useCallback((disk, path, file, onProgress, onComplete, onError) => {
    console.log(`Начинаем загрузку файла: ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`);

    // ID загрузки для отслеживания
    const uploadId = `upload_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
    
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
          formData.append('path', path || '');
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
            
            // Обновляем счетчик загруженных чанков
            uploadedChunks++;
            
            // Рассчитываем прогресс загрузки (от 0 до 95% - для загрузки чанков)
            const progress = Math.floor((uploadedChunks / totalChunks) * 95);
            
            console.log(`Прогресс загрузки: ${progress}% (${uploadedChunks}/${totalChunks} чанков)`);
            
            // Обновляем прогресс
            if (progress > lastProgress) {
              if (onProgress) {
                onProgress(progress);
              }
              
              lastProgress = progress;
              
              // Обновляем статус в localStorage
              updateLocalUploadStatus(uploadId, {
                status: 'uploading',
                progress,
                uploadedChunks
              });
            }
          } catch (error) {
            if (requestAborted) {
              console.log('Загрузка была отменена');
              break;
            }
            
            console.error(`Ошибка при загрузке чанка ${i}:`, error);
            hasError = true;
            
            // Обновляем статус в localStorage
            updateLocalUploadStatus(uploadId, {
              status: 'error',
              error: error.message,
              failedChunk: i
            });
            
            // Вызываем колбэк ошибки
            if (onError) {
              onError(error.message);
            }
            
            // Удаляем обработчик beforeunload
            window.removeEventListener('beforeunload', handleBeforeUnload);
            
            return;
          }
        }
        
        // Если загрузка была отменена, прекращаем
        if (requestAborted) {
          console.log('Загрузка была отменена, прекращаем обработку');
          return;
        }
        
        // Если все чанки загружены успешно, отправляем запрос на завершение загрузки
        if (uploadedChunks === totalChunks && !hasError) {
          console.log('Все чанки загружены успешно, завершаем загрузку');
          
          // Обновляем статус в localStorage
          updateLocalUploadStatus(uploadId, {
            status: 'finalizing',
            progress: 95,
            uploadedChunks
          });
          
          // Обновляем прогресс
          if (onProgress) {
            onProgress(95);
          }
          
          lastProgress = 95;
          
          try {
            // Отправляем запрос на завершение загрузки
            const finalizeResponse = await fetch(getApiUrl(`/disks/${disk}/finalize-upload`), {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                uploadId,
                filename: file.name,
                path: path || '',
                totalChunks,
                fileSize: file.size
              }),
              signal: abortController.signal
            });
            
            if (!finalizeResponse.ok) {
              const data = await finalizeResponse.json().catch(() => ({}));
              throw new Error(data.error || `Ошибка при завершении загрузки: ${finalizeResponse.status}`);
            }
            
            const finalizeData = await finalizeResponse.json();
            
            // Проверяем ответ сервера
            if (!finalizeData.success) {
              throw new Error(finalizeData.error || 'Не удалось завершить загрузку файла');
            }
            
            console.log('Загрузка успешно завершена:', finalizeData);
            
            // Обновляем статус в localStorage
            updateLocalUploadStatus(uploadId, {
              status: 'completed',
              progress: 100,
              completedAt: Date.now()
            });
            
            // Обновляем прогресс
            if (onProgress) {
              onProgress(100);
            }
            
            lastProgress = 100;
            
            // Вызываем колбэк завершения
            if (onComplete) {
              onComplete({
                name: file.name,
                size: file.size,
                path: path || '',
                fullPath: path ? `${path}/${file.name}` : file.name
              });
            }
            
            // Удаляем обработчик beforeunload
            window.removeEventListener('beforeunload', handleBeforeUnload);
            
            return;
          } catch (error) {
            console.error('Ошибка при завершении загрузки:', error);
            
            // Пробуем проверить, появился ли файл в директории
            const checkFileExists = async () => {
              try {
                const filesResponse = await fetch(getApiUrl(`/disks/${disk}/files?path=${encodeURIComponent(path || '')}`));
                
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
                    
                    // Обновляем прогресс
                    if (onProgress) {
                      onProgress(100);
                    }
                    
                    lastProgress = 100;
                    
                    // Вызываем колбэк завершения
                    if (onComplete) {
                      onComplete({
                        name: file.name,
                        size: file.size,
                        path: path || '',
                        fullPath: path ? `${path}/${file.name}` : file.name
                      });
                    }
                    
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
                status: 'error',
                error: error.message,
                progress: lastProgress
              });
              
              // Вызываем колбэк ошибки
              if (onError) {
                onError(error.message);
              }
              
              // Удаляем обработчик beforeunload
              window.removeEventListener('beforeunload', handleBeforeUnload);
              
              return false;
            };
            
            // Запускаем проверку
            return await checkFileExists();
          }
        }
        
        // Если не все чанки загружены или была ошибка
        if (hasError) {
          const errorMessage = 'Не удалось загрузить все чанки файла';
          console.error(errorMessage);
          
          // Обновляем статус в localStorage
          updateLocalUploadStatus(uploadId, {
            status: 'error',
            error: errorMessage,
            uploadedChunks
          });
          
          // Вызываем колбэк ошибки
          if (onError) {
            onError(errorMessage);
          }
          
          // Удаляем обработчик beforeunload
          window.removeEventListener('beforeunload', handleBeforeUnload);
          
          return false;
        }
      } catch (error) {
        // Если загрузка была отменена, не считаем это ошибкой
        if (requestAborted) {
          console.log('Загрузка была отменена');
          
          // Обновляем статус в localStorage
          updateLocalUploadStatus(uploadId, {
            status: 'cancelled',
            cancelledAt: Date.now(),
            progress: lastProgress
          });
          
          // Удаляем обработчик beforeunload
          window.removeEventListener('beforeunload', handleBeforeUnload);
          
          return false;
        }
        
        console.error('Ошибка при загрузке файла:', error);
        
        // Обновляем статус в localStorage
        updateLocalUploadStatus(uploadId, {
          status: 'error',
          error: error.message,
          progress: lastProgress
        });
        
        // Вызываем колбэк ошибки
        if (onError) {
          onError(error.message);
        }
        
        // Удаляем обработчик beforeunload
        window.removeEventListener('beforeunload', handleBeforeUnload);
        
        return false;
      }
    };
    
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