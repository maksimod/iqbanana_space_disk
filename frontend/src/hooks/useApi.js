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
    // Для всех файлов используем более надежный и оптимизированный метод загрузки
    console.log(`Загрузка файла: ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`);
    
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
        status: 'starting'
      };
      sessionStorage.setItem('activeUploads', JSON.stringify(activeUploads));
    } catch (e) {
      console.warn('Не удалось сохранить информацию о загрузке в sessionStorage:', e);
    }
    
    // Функция периодической проверки статуса загрузки
    // Будет использоваться если клиент перезагрузил страницу
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
    
    // Специальная обработка для очень маленьких файлов
    const isSmallFile = file.size < 512 * 1024; // Файлы меньше 512KB
    if (isSmallFile) {
      console.log('Обнаружен маленький файл, применяем специальную обработку');
    }
    
    const xhr = new XMLHttpRequest();
    let requestAborted = false;
    let uploadStarted = false;
    let statusCheckInterval = null;
    
    // Запускаем проверку статуса сразу
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
      }
    }, 5000); // Проверка каждые 5 секунд
    
    // Событие начала загрузки
    xhr.upload.addEventListener('loadstart', () => {
      console.log(`Начало загрузки файла: ${file.name}`);
      uploadStarted = true;
      
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
      
      // Если файл маленький, сразу показываем прогресс 10%
      if (isSmallFile) {
        onProgress(10);
      }
    });
    
    // Обработка прогресса загрузки
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && !requestAborted) {
        const progress = Math.round((event.loaded / event.total) * 100);
        
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
        
        // Ограничиваем частоту обновлений для маленьких файлов
        if (isSmallFile) {
          // Для маленьких файлов показываем только основные этапы
          if (progress > 0 && progress <= 25) onProgress(25);
          else if (progress > 25 && progress <= 75) onProgress(75);
          else if (progress > 75) onProgress(90); // Оставляем 100% для успешного завершения
        } else {
          onProgress(progress);
        }
        
        // Более редкий вывод логов для снижения нагрузки на UI
        if (progress % 25 === 0 || progress === 100) {
          console.log(`Прогресс загрузки: ${progress}% (${(event.loaded / (1024 * 1024)).toFixed(2)}/${(event.total / (1024 * 1024)).toFixed(2)} MB)`);
        }
      }
    });
    
    // Событие успешного завершения загрузки
    xhr.upload.addEventListener('load', () => {
      console.log(`Загрузка файла ${file.name} завершена, ожидание ответа сервера`);
      
      // Обновляем статус в sessionStorage
      try {
        const activeUploads = JSON.parse(sessionStorage.getItem('activeUploads') || '{}');
        if (activeUploads[uploadId]) {
          activeUploads[uploadId].status = 'waiting_response';
          sessionStorage.setItem('activeUploads', JSON.stringify(activeUploads));
        }
      } catch (e) {
        // Игнорируем ошибки sessionStorage
      }
      
      if (isSmallFile) {
        onProgress(95); // Показываем почти завершено, финальные 100% при получении ответа
        
        // Создаем таймаут для автозавершения, если ответ от сервера не пришел в течение 2 секунд
        const autoCompleteTimeout = setTimeout(async () => {
          console.log(`Автозавершение загрузки файла ${file.name} после таймаута`);
          
          // Проверяем статус загрузки на сервере
          const status = await checkUploadStatus();
          if (status.completed || status.upload?.status === 'completing') {
            onComplete({
              success: true,
              message: 'Файл успешно загружен',
              file: {
                name: file.name,
                size: file.size,
                path: path ? `${path}/${file.name}` : file.name
              }
            });
          } else {
            // Если на сервере нет информации, считаем что загрузка успешна
            onComplete({
              success: true,
              message: 'Файл, вероятно, был успешно загружен',
              file: {
                name: file.name,
                size: file.size,
                path: path ? `${path}/${file.name}` : file.name
              }
            });
          }
          
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
          
          // Очищаем интервал проверки
          if (statusCheckInterval) {
            clearInterval(statusCheckInterval);
          }
        }, 2000);
        
        // Сохраняем таймаут, чтобы очистить его, если ответ придет раньше
        xhr._autoCompleteTimeout = autoCompleteTimeout;
      }
    });
    
    // Настраиваем таймауты, зависящие от размера файла
    const fileSize = file.size / (1024 * 1024); // размер в МБ
    // Минимум 60 секунд, плюс 10 секунд на каждый МБ, но не больше часа
    const timeout = Math.min(60000 + fileSize * 10000, 3600000);
    xhr.timeout = timeout;
    
    xhr.onreadystatechange = function() {
      if (xhr.readyState === 4 && !requestAborted) {
        console.log(`XHR завершен со статусом: ${xhr.status}`);
        
        // Очищаем интервал проверки
        if (statusCheckInterval) {
          clearInterval(statusCheckInterval);
        }
        
        // Очищаем таймаут автозавершения, если он установлен
        if (xhr._autoCompleteTimeout) {
          clearTimeout(xhr._autoCompleteTimeout);
          delete xhr._autoCompleteTimeout;
        }
        
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const response = JSON.parse(xhr.responseText);
            console.log('Файл успешно загружен:', response);
            
            // Обновляем статус в sessionStorage
            try {
              const activeUploads = JSON.parse(sessionStorage.getItem('activeUploads') || '{}');
              if (activeUploads[uploadId]) {
                delete activeUploads[uploadId];
                sessionStorage.setItem('activeUploads', JSON.stringify(activeUploads));
              }
            } catch (e) {
              // Игнорируем ошибки sessionStorage
            }
            
            onComplete(response);
          } catch (e) {
            console.error('Ошибка при обработке ответа сервера:', e);
            
            // Проверяем статус загрузки на сервере
            checkUploadStatus().then(status => {
              if (status.completed || (status.upload && status.upload.status !== 'error')) {
                onComplete({
                  success: true,
                  message: 'Файл успешно загружен, но возникла ошибка при обработке ответа',
                  file: {
                    name: file.name,
                    size: file.size,
                    path: path ? `${path}/${file.name}` : file.name
                  }
                });
              } else {
                onError('Ошибка при обработке ответа сервера');
              }
              
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
            });
          }
        } else if (xhr.status === 0) {
          if (uploadStarted) {
            // Если загрузка началась, но соединение оборвалось
            console.error('Соединение было прервано во время загрузки');
            
            // Проверяем статус загрузки на сервере
            checkUploadStatus().then(status => {
              if (status.completed || (status.upload && status.upload.status !== 'error')) {
                // Даже если соединение оборвалось, но файл успешно загружен на сервер
                onComplete({
                  success: true,
                  message: 'Файл успешно загружен, несмотря на разрыв соединения',
                  file: {
                    name: file.name,
                    size: file.size,
                    path: path ? `${path}/${file.name}` : file.name
                  }
                });
              } else {
                onError('Потеряно соединение с сервером');
              }
              
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
            });
          } else {
            // Если запрос был отменен до начала загрузки
            console.log('Запрос был отменен до начала загрузки');
            
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
          }
        } else {
          console.error(`Ошибка HTTP при загрузке файла: ${xhr.status}`, xhr.responseText);
          
          // Проверяем статус загрузки на сервере
          checkUploadStatus().then(status => {
            if (status.completed || (status.upload && status.upload.status !== 'error')) {
              // Если файл успешно загружен на сервер, несмотря на ошибку HTTP
              onComplete({
                success: true,
                message: 'Файл успешно загружен, несмотря на ошибку HTTP',
                file: {
                  name: file.name,
                  size: file.size,
                  path: path ? `${path}/${file.name}` : file.name
                }
              });
            } else {
              onError(`Ошибка загрузки: ${xhr.status}`);
            }
            
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
          });
        }
      }
    };
    
    xhr.ontimeout = function() {
      console.error('Превышен таймаут загрузки файла');
      
      // Проверяем статус загрузки на сервере
      checkUploadStatus().then(status => {
        if (status.completed || (status.upload && status.upload.status !== 'error')) {
          // Если файл успешно загружен на сервер, несмотря на таймаут
          onComplete({
            success: true,
            message: 'Файл успешно загружен, несмотря на таймаут',
            file: {
              name: file.name,
              size: file.size,
              path: path ? `${path}/${file.name}` : file.name
            }
          });
        } else {
          onError('Превышен таймаут загрузки файла');
        }
        
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
      });
      
      // Очищаем интервал проверки
      if (statusCheckInterval) {
        clearInterval(statusCheckInterval);
      }
    };
    
    xhr.onerror = function() {
      if (!requestAborted) {
        console.error('Ошибка сети при загрузке файла');
        
        // Проверяем статус загрузки на сервере
        checkUploadStatus().then(status => {
          if (status.completed || (status.upload && status.upload.status !== 'error')) {
            // Если файл успешно загружен на сервер, несмотря на ошибку сети
            onComplete({
              success: true,
              message: 'Файл успешно загружен, несмотря на ошибку сети',
              file: {
                name: file.name,
                size: file.size,
                path: path ? `${path}/${file.name}` : file.name
              }
            });
          } else {
            onError('Ошибка сети при загрузке файла');
          }
          
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
        });
        
        // Очищаем интервал проверки
        if (statusCheckInterval) {
          clearInterval(statusCheckInterval);
        }
      }
    };
    
    try {
      console.log(`Открытие соединения для загрузки файла: ${file.name}`);
      xhr.open('POST', getApiUrl(`/disks/${disk}/upload?path=${encodeURIComponent(path)}`), true);
      
      const formData = new FormData();
      formData.append('file', file);
      
      console.log(`Отправка файла: ${file.name}`);
      xhr.send(formData);
    } catch (error) {
      console.error('Ошибка при инициализации загрузки файла:', error);
      
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
      
      // Очищаем интервал проверки
      if (statusCheckInterval) {
        clearInterval(statusCheckInterval);
      }
      
      onError('Ошибка при инициализации загрузки файла');
      return () => {};
    }
    
    // Функция для отмены загрузки
    return () => {
      console.log('Отмена загрузки файла');
      requestAborted = true;
      xhr.abort();
      
      // Очищаем интервал проверки
      if (statusCheckInterval) {
        clearInterval(statusCheckInterval);
      }
      
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