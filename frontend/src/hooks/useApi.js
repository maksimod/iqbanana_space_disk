import { useState, useCallback } from 'react';
import { useToast } from '../context/ToastContext';

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
    
    // ID загрузки для отслеживания
    const uploadId = `upload_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
    
    // Очищаем существующие загрузки того же файла перед началом новой
    try {
      const activeUploads = JSON.parse(sessionStorage.getItem('activeUploads') || '{}');
      let hasChanges = false;
      
      // Удаляем предыдущие записи о загрузке того же файла
      Object.keys(activeUploads).forEach(key => {
        const upload = activeUploads[key];
        if (upload.disk === disk && 
            upload.path === path && 
            upload.fileName === file.name) {
          delete activeUploads[key];
          hasChanges = true;
          console.log(`Удалена предыдущая запись о загрузке файла: ${file.name}`);
        }
      });
      
      if (hasChanges) {
        sessionStorage.setItem('activeUploads', JSON.stringify(activeUploads));
      }
    } catch (e) {
      console.warn('Не удалось очистить предыдущие записи о загрузке в sessionStorage:', e);
    }
    
    // Сохраняем в sessionStorage информацию о текущей загрузке
    try {
      const activeUploads = JSON.parse(sessionStorage.getItem('activeUploads') || '{}');
      activeUploads[uploadId] = {
        disk,
        path,
        fileName: file.name,
        fileSize: file.size,
        startTime: Date.now(),
        status: 'preparing'
      };
      sessionStorage.setItem('activeUploads', JSON.stringify(activeUploads));
    } catch (e) {
      console.warn('Не удалось сохранить информацию о загрузке в sessionStorage:', e);
    }
    
    // Функция проверки статуса загрузки на сервере
    const checkUploadStatus = async () => {
      try {
        const response = await fetch(getApiUrl(`/disks/${disk}/upload-status?path=${encodeURIComponent(path)}`));
        const data = await response.json();
        
        const thisUpload = data.uploads.find(upload => upload.filename === file.name);
        if (thisUpload) {
          console.log(`Статус загрузки ${file.name}: ${thisUpload.status}, прогресс: ${thisUpload.progress}%`);
          
          if (thisUpload.status === 'completed') {
            // Обновляем статус в sessionStorage
            try {
              const activeUploads = JSON.parse(sessionStorage.getItem('activeUploads') || '{}');
              if (activeUploads[uploadId]) {
                delete activeUploads[uploadId];
                sessionStorage.setItem('activeUploads', JSON.stringify(activeUploads));
              }
            } catch (e) {
              console.warn('Не удалось обновить информацию о загрузке в sessionStorage:', e);
            }
            
            return { completed: true, upload: thisUpload };
          }
          
          return { completed: false, upload: thisUpload };
        }
        
        return { completed: false, upload: null };
      } catch (error) {
        console.error('Ошибка при проверке статуса загрузки:', error);
        return { completed: false, error };
      }
    };
    
    // Определяем, большой ли файл
    const isLargeFile = file.size > 50 * 1024 * 1024; // файлы больше 50MB 
    const isVeryLargeFile = file.size > 500 * 1024 * 1024; // файлы больше 500MB
    const isSmallFile = file.size < 2 * 1024 * 1024; // файлы меньше 2MB
    
    // Настраиваем размер чанка в зависимости от размера файла
    const chunkSize = isVeryLargeFile ? 5 * 1024 * 1024 : // 5MB для очень больших файлов
                     isLargeFile ? 2 * 1024 * 1024 : // 2MB для больших файлов
                     1 * 1024 * 1024; // 1MB для обычных файлов
    
    // Для малых файлов не используем чанки
    const useChunks = !isSmallFile;
    
    // Логируем информацию о стратегии загрузки
    if (isVeryLargeFile) {
      console.log(`Очень большой файл (${(file.size / (1024 * 1024)).toFixed(2)} MB): используем чанки по ${chunkSize / (1024 * 1024)}MB`);
    } else if (isLargeFile) {
      console.log(`Большой файл (${(file.size / (1024 * 1024)).toFixed(2)} MB): используем чанки по ${chunkSize / (1024 * 1024)}MB`);
    } else if (useChunks) {
      console.log(`Средний файл (${(file.size / (1024 * 1024)).toFixed(2)} MB): используем чанки по ${chunkSize / (1024 * 1024)}MB`);
    } else {
      console.log(`Малый файл (${(file.size / (1024 * 1024)).toFixed(2)} MB): загружаем одним запросом`);
    }

    // Запоминаем, если загрузка была отменена
    let requestAborted = false;
    let statusCheckInterval = null;
    let progressUpdateInterval = null;
    let lastProgress = 0;
    
    // Настройка частоты обновления UI
    const statusCheckFrequency = isLargeFile ? 2000 : 3000; // Проверка статуса каждые 2 или 3 секунды
    const simulatedProgressFrequency = 3000; // Обновление симулированного прогресса каждые 3 секунды
    
    // Запускаем интервал проверки статуса загрузки
    statusCheckInterval = setInterval(async () => {
      if (requestAborted) {
        clearInterval(statusCheckInterval);
        return;
      }
      
      const status = await checkUploadStatus();
      if (status.completed) {
        clearInterval(statusCheckInterval);
        if (!requestAborted) {
          onComplete(status.upload);
        }
      } else if (status.upload && status.upload.progress) {
        // Обновляем прогресс из статуса сервера
        onProgress(status.upload.progress);
      }
    }, statusCheckFrequency);
    
    // Для больших файлов добавляем интервал обновления прогресса (симуляция)
    if (isLargeFile) {
      progressUpdateInterval = setInterval(() => {
        if (requestAborted || lastProgress >= 100) {
          clearInterval(progressUpdateInterval);
          return;
        }
        
        if (lastProgress < 95) {
          const newProgress = lastProgress + 0.2;
          onProgress(newProgress);
          lastProgress = newProgress;
          
          // Обновляем статус в sessionStorage
          try {
            const activeUploads = JSON.parse(sessionStorage.getItem('activeUploads') || '{}');
            if (activeUploads[uploadId]) {
              activeUploads[uploadId].progress = newProgress;
              sessionStorage.setItem('activeUploads', JSON.stringify(activeUploads));
            }
          } catch (e) {
            // Игнорируем ошибки sessionStorage
          }
        }
      }, simulatedProgressFrequency);
    }
    
    // Функция для загрузки файла без чанков (для маленьких файлов)
    const uploadStandard = () => {
      const xhr = new XMLHttpRequest();
      
      // Событие начала загрузки
      xhr.upload.addEventListener('loadstart', () => {
        console.log(`Начало загрузки файла: ${file.name}`);
        
        // Обновляем статус в sessionStorage
        try {
          const activeUploads = JSON.parse(sessionStorage.getItem('activeUploads') || '{}');
          if (activeUploads[uploadId]) {
            activeUploads[uploadId].status = 'uploading';
            sessionStorage.setItem('activeUploads', JSON.stringify(activeUploads));
          }
        } catch (e) {
          console.warn('Не удалось обновить информацию о загрузке в sessionStorage:', e);
        }
        
        // Показываем начальный прогресс
        onProgress(5);
        lastProgress = 5;
      });
      
      // Обработка прогресса загрузки
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable && !requestAborted) {
          const progress = Math.round((event.loaded / event.total) * 100);
          lastProgress = progress;
          
          // Обновляем статус в sessionStorage
          try {
            const activeUploads = JSON.parse(sessionStorage.getItem('activeUploads') || '{}');
            if (activeUploads[uploadId]) {
              activeUploads[uploadId].progress = progress;
              sessionStorage.setItem('activeUploads', JSON.stringify(activeUploads));
            }
          } catch (e) {
            // Игнорируем ошибки sessionStorage
          }
          
          onProgress(progress);
          console.log(`Прогресс загрузки: ${progress}%`);
        }
      });
      
      // Событие успешного завершения загрузки
      xhr.upload.addEventListener('load', () => {
        console.log(`Загрузка файла ${file.name} завершена, ожидание ответа сервера`);
        onProgress(95);
        lastProgress = 95;
      });
      
      // Добавляем обработчики ошибок
      xhr.onerror = () => {
        console.error(`Сетевая ошибка при загрузке файла ${file.name}`);
        
        if (statusCheckInterval) clearInterval(statusCheckInterval);
        if (progressUpdateInterval) clearInterval(progressUpdateInterval);
        
        onError(`Сетевая ошибка при загрузке файла. Проверьте соединение.`);
      };
      
      xhr.ontimeout = () => {
        console.error(`Таймаут соединения при загрузке файла ${file.name}`);
        
        if (statusCheckInterval) clearInterval(statusCheckInterval);
        if (progressUpdateInterval) clearInterval(progressUpdateInterval);
        
        onError(`Превышено время ожидания ответа от сервера.`);
      };
      
      xhr.onreadystatechange = function() {
        if (xhr.readyState === 4) {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const response = JSON.parse(xhr.responseText);
              console.log(`Файл ${file.name} успешно загружен`);
              onProgress(100);
              lastProgress = 100;
              onComplete(response);
            } catch (e) {
              console.error('Ошибка при обработке ответа сервера:', e);
              onError('Ошибка при обработке ответа сервера');
            }
          } else {
            onError(`Ошибка загрузки: ${xhr.status}`);
          }
        }
      };
      
      try {
        xhr.open('POST', getApiUrl(`/disks/${disk}/upload?path=${encodeURIComponent(path)}`), true);
        xhr.timeout = 600000; // 10 минут
        
        const formData = new FormData();
        formData.append('file', file);
        
        xhr.send(formData);
      } catch (error) {
        console.error('Ошибка при инициализации загрузки файла:', error);
        onError('Ошибка при инициализации загрузки файла');
      }
      
      return () => {
        requestAborted = true;
        xhr.abort();
        
        if (statusCheckInterval) clearInterval(statusCheckInterval);
        if (progressUpdateInterval) clearInterval(progressUpdateInterval);
        
        // Очищаем запись в sessionStorage
        try {
          const activeUploads = JSON.parse(sessionStorage.getItem('activeUploads') || '{}');
          if (activeUploads[uploadId]) {
            delete activeUploads[uploadId];
            sessionStorage.setItem('activeUploads', JSON.stringify(activeUploads));
          }
        } catch (e) {
          // Игнорируем ошибки
        }
      };
    };
    
    // Функция для загрузки файла по частям (чанкам)
    const uploadWithChunks = () => {
      // Общее количество чанков
      const totalChunks = Math.ceil(file.size / chunkSize);
      console.log(`Файл будет загружен в ${totalChunks} частях`);
      
      let currentChunk = 0;
      let aborted = false;
      
      // Обновляем информацию в sessionStorage
      try {
        const activeUploads = JSON.parse(sessionStorage.getItem('activeUploads') || '{}');
        if (activeUploads[uploadId]) {
          activeUploads[uploadId].status = 'chunked_upload';
          activeUploads[uploadId].totalChunks = totalChunks;
          activeUploads[uploadId].currentChunk = 0;
          sessionStorage.setItem('activeUploads', JSON.stringify(activeUploads));
        }
      } catch (e) {
        console.warn('Не удалось обновить информацию о загрузке в sessionStorage:', e);
      }
      
      // Функция для загрузки следующего чанка
      const uploadNextChunk = () => {
        if (aborted) {
          console.log('Загрузка отменена, прекращаем загрузку чанков');
          return;
        }
        
        if (currentChunk >= totalChunks) {
          console.log('Все чанки загружены, завершаем');
          
          // По завершении загрузки всех чанков, проверяем статус на сервере
          checkUploadStatus().then(status => {
            if (status.completed) {
              onProgress(100);
              lastProgress = 100;
              onComplete(status.upload);
            } else {
              // Если статус не завершен, но все чанки загружены,
              // считаем загрузку успешной и ждем подтверждения
              onProgress(99);
              lastProgress = 99;
              
              // Сохраняем в sessionStorage для отслеживания
              try {
                const activeUploads = JSON.parse(sessionStorage.getItem('activeUploads') || '{}');
                if (activeUploads[uploadId]) {
                  activeUploads[uploadId].status = 'finalizing';
                  activeUploads[uploadId].progress = 99;
                  sessionStorage.setItem('activeUploads', JSON.stringify(activeUploads));
                }
              } catch (e) {
                // Игнорируем ошибки sessionStorage
              }
            }
          });
          return;
        }
        
        const start = currentChunk * chunkSize;
        const end = Math.min(file.size, start + chunkSize);
        const chunk = file.slice(start, end);
        
        // Используем более короткий и уникальный идентификатор для чанка
        const chunkId = `${uploadId}_chunk${currentChunk}`;
        
        console.log(`Загрузка чанка ${currentChunk + 1}/${totalChunks} (${(start / (1024 * 1024)).toFixed(2)}-${(end / (1024 * 1024)).toFixed(2)} MB)`);
        
        // Обновляем прогресс
        const progress = Math.round((currentChunk / totalChunks) * 95); // оставляем 5% на финализацию
        onProgress(progress);
        lastProgress = progress;
        
        // Обновляем информацию о текущем чанке в sessionStorage
        try {
          const activeUploads = JSON.parse(sessionStorage.getItem('activeUploads') || '{}');
          if (activeUploads[uploadId]) {
            activeUploads[uploadId].currentChunk = currentChunk;
            activeUploads[uploadId].progress = progress;
            sessionStorage.setItem('activeUploads', JSON.stringify(activeUploads));
          }
        } catch (e) {
          // Игнорируем ошибки sessionStorage
        }
        
        const xhr = new XMLHttpRequest();
        
        xhr.onreadystatechange = function() {
          if (xhr.readyState === 4) {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                // Увеличиваем счетчик чанков и загружаем следующий
                currentChunk++;
                
                // Используем setTimeout для предотвращения переполнения стека вызовов
                // и разгрузки основного потока
                setTimeout(uploadNextChunk, 100);
              } catch (e) {
                console.error('Ошибка при обработке ответа сервера для чанка:', e);
                onError('Ошибка при обработке ответа сервера');
              }
            } else {
              console.error(`Ошибка при загрузке чанка ${currentChunk + 1}: ${xhr.status}`);
              
              // При ошибке пробуем повторить этот же чанк до 3-х раз
              const retriesKey = `${chunkId}_retries`;
              const retries = parseInt(sessionStorage.getItem(retriesKey) || '0');
              
              if (retries < 3) {
                console.log(`Повторная попытка загрузки чанка ${currentChunk + 1} (попытка ${retries + 1})`);
                sessionStorage.setItem(retriesKey, (retries + 1).toString());
                
                // Повторяем через небольшую задержку
                setTimeout(uploadNextChunk, 1000);
              } else {
                onError(`Ошибка загрузки чанка ${currentChunk + 1}: ${xhr.status}`);
              }
            }
          }
        };
        
        xhr.onerror = () => {
          console.error(`Ошибка сети при загрузке чанка ${currentChunk + 1}`);
          
          // При ошибке сети пробуем повторить этот же чанк до 3-х раз
          const retriesKey = `${chunkId}_retries`;
          const retries = parseInt(sessionStorage.getItem(retriesKey) || '0');
          
          if (retries < 3) {
            console.log(`Повторная попытка загрузки чанка ${currentChunk + 1} (попытка ${retries + 1})`);
            sessionStorage.setItem(retriesKey, (retries + 1).toString());
            
            // Повторяем через небольшую задержку
            setTimeout(uploadNextChunk, 2000);
          } else {
            onError(`Сетевая ошибка при загрузке чанка ${currentChunk + 1}`);
          }
        };
        
        try {
          xhr.open('POST', getApiUrl(`/disks/${disk}/upload-chunk?path=${encodeURIComponent(path)}&chunk=${currentChunk}&totalChunks=${totalChunks}&filename=${encodeURIComponent(file.name)}`), true);
          xhr.timeout = 300000; // 5 минут на чанк
          
          const formData = new FormData();
          formData.append('chunk', chunk, `${file.name}.part${currentChunk}`);
          formData.append('chunkIndex', currentChunk.toString());
          formData.append('totalChunks', totalChunks.toString());
          formData.append('filename', file.name);
          formData.append('fileSize', file.size.toString());
          formData.append('uploadId', uploadId);
          
          xhr.send(formData);
        } catch (error) {
          console.error(`Ошибка при инициализации загрузки чанка ${currentChunk + 1}:`, error);
          onError('Ошибка при инициализации загрузки чанка');
        }
      };
      
      // Начинаем загрузку с первого чанка
      uploadNextChunk();
      
      // Возвращаем функцию для отмены загрузки
      return () => {
        console.log('Отмена чанковой загрузки');
        aborted = true;
        requestAborted = true;
        
        // Очищаем интервалы
        if (statusCheckInterval) clearInterval(statusCheckInterval);
        if (progressUpdateInterval) clearInterval(progressUpdateInterval);
        
        // Удаляем запись из sessionStorage
        try {
          const activeUploads = JSON.parse(sessionStorage.getItem('activeUploads') || '{}');
          if (activeUploads[uploadId]) {
            delete activeUploads[uploadId];
            sessionStorage.setItem('activeUploads', JSON.stringify(activeUploads));
          }
        } catch (e) {
          // Игнорируем ошибки sessionStorage
        }
      };
    };
    
    // Показываем начальный прогресс
    onProgress(1);
    lastProgress = 1;
    
    // Выбираем метод загрузки в зависимости от размера файла
    if (useChunks) {
      return uploadWithChunks();
    } else {
      return uploadStandard();
    }
  }, [getApiUrl]);

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
    clearActiveUploads
  };
};

export default useApi;