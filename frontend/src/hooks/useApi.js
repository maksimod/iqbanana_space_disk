import { useState, useCallback } from 'react';

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
    return await fetchData(`/disks/${disk}/createFolder`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ folderPath, folderName }),
    });
  }, [fetchData]);

  /**
   * Получение URL для скачивания файла
   */
  const getDownloadUrl = useCallback((disk, filePath) => {
    return `${getApiUrl(`/disks/${disk}/download`)}?path=${encodeURIComponent(filePath)}`;
  }, [getApiUrl]);

  /**
   * Загрузка файла с прогрессом
   */
  const uploadFile = useCallback((disk, path, file, onProgress, onComplete, onError) => {
    const formData = new FormData();
    formData.append('file', file);
    
    const xhr = new XMLHttpRequest();
    
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        const progress = Math.round((event.loaded / event.total) * 100);
        onProgress(progress);
      }
    });
    
    xhr.onreadystatechange = function() {
      if (xhr.readyState === 4) {
        if (xhr.status === 200) {
          try {
            const response = JSON.parse(xhr.responseText);
            onComplete(response);
          } catch (e) {
            onError('Ошибка при обработке ответа сервера');
          }
        } else {
          onError(`Ошибка загрузки: ${xhr.status}`);
        }
      }
    };
    
    xhr.open('POST', getApiUrl(`/disks/${disk}/upload?path=${encodeURIComponent(path)}`), true);
    xhr.send(formData);
    
    return () => {
      // Функция для отмены загрузки
      xhr.abort();
    };
  }, [getApiUrl]);

  return {
    loading,
    error,
    setError,
    fetchDisks,
    fetchFiles,
    deleteFile,
    createFolder,
    getDownloadUrl,
    uploadFile
  };
};

export default useApi;