// Service Worker для фоновой синхронизации файлов

const CACHE_NAME = 'disk-manager-cache-v1';
const API_VERSION = 'v1';

// Установка Service Worker
self.addEventListener('install', (event) => {
  console.log('Service Worker: установка');
  
  // Пропускаем фазу ожидания
  self.skipWaiting();
});

// Активация Service Worker
self.addEventListener('activate', (event) => {
  console.log('Service Worker: активация');
  
  // Получаем контроль немедленно
  event.waitUntil(clients.claim());
});

// Обработка фоновой синхронизации
self.addEventListener('sync', (event) => {
  console.log('Service Worker: получено событие sync', event.tag);
  
  if (event.tag.startsWith('file-sync:')) {
    const fileId = event.tag.split(':')[1];
    
    event.waitUntil(
      syncFile(fileId)
    );
  }
});

// Функция синхронизации файла
async function syncFile(fileId) {
  try {
    console.log(`Service Worker: начинаем синхронизацию файла ${fileId}`);
    
    // Получаем данные о файле из IndexedDB
    const fileData = await getFileFromDB(fileId);
    
    if (!fileData) {
      console.error(`Service Worker: файл ${fileId} не найден в IndexedDB`);
      return;
    }
    
    // Обновляем статус
    await updateFileStatus(fileId, { syncStatus: 'syncing', syncStartTime: Date.now() });
    
    // Создаем FormData для отправки
    const formData = new FormData();
    
    // Создаем объект File из данных
    const file = new File([fileData.data], fileData.filename, {
      type: fileData.type,
      lastModified: fileData.lastModified
    });
    
    formData.append('file', file);
    formData.append('fileId', fileId);
    formData.append('originalName', fileData.filename);
    formData.append('size', fileData.size);
    formData.append('lastModified', fileData.lastModified);
    
    // Отправляем запрос на синхронизацию
    const disk = fileData.metadata.disk;
    const path = fileData.metadata.path || '';
    
    const response = await fetch(`/api/${API_VERSION}/disks/${disk}/sync?path=${encodeURIComponent(path)}`, {
      method: 'POST',
      body: formData
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Ошибка HTTP: ${response.status}`);
    }
    
    const responseData = await response.json();
    
    console.log(`Service Worker: файл ${fileId} принят сервером для синхронизации:`, responseData);
    
    // Обновляем статус
    await updateFileStatus(fileId, {
      syncStatus: 'accepted',
      serverFileId: responseData.fileId || fileId,
      syncAcceptTime: Date.now()
    });
    
    // Запускаем проверку статуса синхронизации
    await pollSyncStatus(fileId, disk, path);
    
    return true;
  } catch (error) {
    console.error(`Service Worker: ошибка при синхронизации файла ${fileId}:`, error);
    
    // Обновляем статус
    await updateFileStatus(fileId, {
      syncStatus: 'error',
      syncError: error.message,
      syncErrorTime: Date.now()
    });
    
    return false;
  }
}

// Функция для опроса статуса синхронизации
async function pollSyncStatus(fileId, disk, path) {
  let attempts = 0;
  const maxAttempts = 60; // 5 минут (60 x 5 секунд)
  const pollInterval = 5000; // 5 секунд
  
  while (attempts < maxAttempts) {
    attempts++;
    
    try {
      // Отправляем запрос на проверку статуса
      const response = await fetch(`/api/${API_VERSION}/sync/${fileId}/status?disk=${disk}&path=${encodeURIComponent(path || '')}`);
      
      if (!response.ok) {
        throw new Error(`Ошибка HTTP: ${response.status}`);
      }
      
      const statusData = await response.json();
      
      // Если синхронизация не найдена
      if (!statusData.sync || statusData.sync.status === 'not_found' || statusData.sync.status === 'unknown') {
        console.warn(`Service Worker: синхронизация ${fileId} не найдена на сервере`);
        
        // Если превышено количество попыток, считаем, что синхронизация завершилась с ошибкой
        if (attempts >= maxAttempts) {
          throw new Error('Синхронизация не найдена на сервере');
        }
        
        // Ждем перед следующей попыткой
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        continue;
      }
      
      const { status, progress, error } = statusData.sync;
      
      console.log(`Service Worker: статус синхронизации ${fileId}: ${status}, прогресс: ${progress}%`);
      
      // Обновляем статус файла
      await updateFileStatus(fileId, {
        syncStatus: status,
        serverProgress: progress || 0,
        lastSyncUpdate: Date.now()
      });
      
      // Если синхронизация завершена или произошла ошибка, прекращаем проверки
      if (status === 'completed') {
        console.log(`Service Worker: синхронизация ${fileId} успешно завершена`);
        
        // Обновляем статус файла
        await updateFileStatus(fileId, {
          syncStatus: 'completed',
          syncCompletedTime: Date.now()
        });
        
        return true;
      } else if (status === 'error' || status === 'cancelled') {
        console.error(`Service Worker: синхронизация ${fileId} завершилась с ошибкой:`, error);
        
        // Обновляем статус файла
        await updateFileStatus(fileId, {
          syncStatus: 'error',
          syncError: error || 'Неизвестная ошибка',
          syncErrorTime: Date.now()
        });
        
        return false;
      }
      
      // Ждем перед следующей попыткой
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    } catch (error) {
      console.error(`Service Worker: ошибка при проверке статуса синхронизации ${fileId}:`, error);
      
      // Если превышено количество попыток, считаем, что синхронизация завершилась с ошибкой
      if (attempts >= maxAttempts) {
        await updateFileStatus(fileId, {
          syncStatus: 'error',
          syncError: error.message,
          syncErrorTime: Date.now()
        });
        
        return false;
      }
      
      // Ждем перед следующей попыткой
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
  }
  
  return false;
}

// Функции для работы с IndexedDB

async function openDB() {
  return new Promise((resolve, reject) => {
    const DB_NAME = 'DiskManagerFilesDB';
    const STORE_NAME = 'files';
    const DB_VERSION = 1;
    
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = event => {
      reject(event.target.error);
    };
    
    request.onsuccess = event => {
      resolve(event.target.result);
    };
    
    request.onupgradeneeded = event => {
      const db = event.target.result;
      
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'fileId' });
      }
    };
  });
}

async function getFileFromDB(fileId) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['files'], 'readonly');
      const store = transaction.objectStore('files');
      const request = store.get(fileId);
      
      request.onsuccess = event => {
        resolve(event.target.result);
      };
      
      request.onerror = event => {
        reject(event.target.error);
      };
      
      transaction.oncomplete = () => {
        db.close();
      };
    });
  } catch (error) {
    console.error('Service Worker: ошибка при получении файла из IndexedDB:', error);
    return null;
  }
}

async function updateFileStatus(fileId, updates) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['files'], 'readwrite');
      const store = transaction.objectStore('files');
      
      // Сначала получаем файл
      const getRequest = store.get(fileId);
      
      getRequest.onsuccess = event => {
        const file = event.target.result;
        
        if (!file) {
          reject(new Error(`Файл ${fileId} не найден в IndexedDB`));
          return;
        }
        
        // Обновляем данные
        const updatedFile = {
          ...file,
          ...updates,
          lastUpdated: Date.now()
        };
        
        // Сохраняем обновленные данные
        const putRequest = store.put(updatedFile);
        
        putRequest.onsuccess = () => {
          resolve(updatedFile);
        };
        
        putRequest.onerror = event => {
          reject(event.target.error);
        };
      };
      
      getRequest.onerror = event => {
        reject(event.target.error);
      };
      
      transaction.oncomplete = () => {
        db.close();
      };
    });
  } catch (error) {
    console.error('Service Worker: ошибка при обновлении статуса файла:', error);
    return null;
  }
}