/**
 * Утилита для работы с IndexedDB в браузере
 * Обеспечивает локальное хранение файлов перед отправкой на сервер
 */

// Название базы данных и хранилища
const DB_NAME = 'DiskManagerFilesDB';
const STORE_NAME = 'files';
const DB_VERSION = 1;

// Максимальный размер хранимых данных (5GB)
const MAX_STORAGE_SIZE = 5 * 1024 * 1024 * 1024;

// Функция для открытия соединения с БД
const openDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      console.error('Ошибка при открытии IndexedDB:', event.target.error);
      reject(event.target.error);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      
      // Создаем хранилище для файлов, если его еще нет
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        // Используем fileId как ключ
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'fileId' });
        
        // Создаем индексы для поиска
        store.createIndex('filename', 'filename', { unique: false });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        
        console.log('Хранилище файлов создано в IndexedDB');
      }
    };

    request.onsuccess = (event) => {
      const db = event.target.result;
      resolve(db);
    };
  });
};

/**
 * Сохранение файла в локальное хранилище
 * @param {File} file - файл для сохранения
 * @param {Object} metadata - метаданные файла
 * @returns {Promise<string>} - ID сохраненного файла
 */
const saveFile = async (file, metadata = {}) => {
  try {
    // Генерируем уникальный ID для файла
    const fileId = `file_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    
    // Преобразуем файл в ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();
    
    // Открываем соединение с БД
    const db = await openDB();
    
    // Создаем транзакцию
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
    // Проверяем размер хранилища перед добавлением нового файла
    await checkStorageSize(db, file.size);
    
    // Подготавливаем данные для сохранения
    const fileData = {
      fileId,
      filename: file.name,
      data: arrayBuffer,
      size: file.size,
      type: file.type,
      lastModified: file.lastModified,
      timestamp: Date.now(),
      status: 'stored',
      metadata: {
        ...metadata,
        originalName: file.name
      }
    };
    
    // Сохраняем файл
    return new Promise((resolve, reject) => {
      const request = store.add(fileData);
      
      request.onsuccess = () => {
        console.log(`Файл "${file.name}" сохранен локально с ID: ${fileId}`);
        resolve(fileId);
      };
      
      request.onerror = (event) => {
        console.error('Ошибка при сохранении файла в IndexedDB:', event.target.error);
        reject(event.target.error);
      };
    });
  } catch (error) {
    console.error('Ошибка при сохранении файла:', error);
    throw error;
  }
};

/**
 * Проверка и очистка хранилища при необходимости
 * @param {IDBDatabase} db - соединение с БД
 * @param {number} newFileSize - размер нового файла
 */
const checkStorageSize = async (db, newFileSize) => {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    
    // Получаем все файлы, отсортированные по дате (старые вначале)
    const index = store.index('timestamp');
    const request = index.openCursor();
    
    let totalSize = 0;
    const filesToDelete = [];
    
    request.onsuccess = (event) => {
        const cursor = event.target.result;
      
        if (cursor) {
          totalSize += cursor.value.size;
          
          // Добавляем старые файлы в список на удаление
          if (totalSize + newFileSize > MAX_STORAGE_SIZE) {
            filesToDelete.push(cursor.value.fileId);
          }
          
          cursor.continue();
        } else {
          // Если нужно освободить место, удаляем старые файлы
          if (filesToDelete.length > 0) {
            console.log(`Требуется очистка хранилища. Удаление ${filesToDelete.length} старых файлов...`);
            
            // Создаем транзакцию для удаления
            const deleteTransaction = db.transaction([STORE_NAME], 'readwrite');
            const deleteStore = deleteTransaction.objectStore(STORE_NAME);
            
            // Удаляем файлы последовательно
            const deleteNext = (index) => {
              if (index >= filesToDelete.length) {
                console.log('Очистка хранилища завершена');
                resolve();
                return;
              }
              
              const request = deleteStore.delete(filesToDelete[index]);
              
              request.onsuccess = () => {
                deleteNext(index + 1);
              };
              
              request.onerror = (event) => {
                console.error('Ошибка при удалении файла из IndexedDB:', event.target.error);
                // Продолжаем удаление других файлов
                deleteNext(index + 1);
              };
            };
            
            deleteNext(0);
          } else {
            resolve();
          }
        }
      };
      
      request.onerror = (event) => {
        console.error('Ошибка при проверке размера хранилища:', event.target.error);
        reject(event.target.error);
      };
    });
  };
  
  /**
   * Получение файла из локального хранилища
   * @param {string} fileId - ID файла
   * @returns {Promise<Object>} - данные файла и метаданные
   */
  const getFile = async (fileId) => {
    try {
      const db = await openDB();
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      
      return new Promise((resolve, reject) => {
        const request = store.get(fileId);
        
        request.onsuccess = (event) => {
          const fileData = event.target.result;
          
          if (fileData) {
            resolve(fileData);
          } else {
            reject(new Error(`Файл с ID ${fileId} не найден в локальном хранилище`));
          }
        };
        
        request.onerror = (event) => {
          console.error('Ошибка при получении файла из IndexedDB:', event.target.error);
          reject(event.target.error);
        };
      });
    } catch (error) {
      console.error('Ошибка при получении файла:', error);
      throw error;
    }
  };
  
  /**
   * Обновление статуса файла в хранилище
   * @param {string} fileId - ID файла
   * @param {Object} updates - обновления
   * @returns {Promise<Object>} - обновленные данные файла
   */
  const updateFileStatus = async (fileId, updates) => {
    try {
      const db = await openDB();
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      
      return new Promise((resolve, reject) => {
        // Сначала получаем текущие данные
        const getRequest = store.get(fileId);
        
        getRequest.onsuccess = (event) => {
          const fileData = event.target.result;
          
          if (!fileData) {
            reject(new Error(`Файл с ID ${fileId} не найден в локальном хранилище`));
            return;
          }
          
          // Обновляем данные
          const updatedData = {
            ...fileData,
            ...updates,
            lastUpdated: Date.now()
          };
          
          // Сохраняем обновленные данные
          const updateRequest = store.put(updatedData);
          
          updateRequest.onsuccess = () => {
            console.log(`Статус файла ${fileId} обновлен:`, updates);
            resolve(updatedData);
          };
          
          updateRequest.onerror = (event) => {
            console.error('Ошибка при обновлении статуса файла:', event.target.error);
            reject(event.target.error);
          };
        };
        
        getRequest.onerror = (event) => {
          console.error('Ошибка при получении файла для обновления:', event.target.error);
          reject(event.target.error);
        };
      });
    } catch (error) {
      console.error('Ошибка при обновлении статуса файла:', error);
      throw error;
    }
  };
  
  /**
   * Удаление файла из локального хранилища
   * @param {string} fileId - ID файла
   * @returns {Promise<boolean>} - результат удаления
   */
  const deleteFile = async (fileId) => {
    try {
      const db = await openDB();
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      
      return new Promise((resolve, reject) => {
        const request = store.delete(fileId);
        
        request.onsuccess = () => {
          console.log(`Файл ${fileId} удален из локального хранилища`);
          resolve(true);
        };
        
        request.onerror = (event) => {
          console.error('Ошибка при удалении файла из IndexedDB:', event.target.error);
          reject(event.target.error);
        };
      });
    } catch (error) {
      console.error('Ошибка при удалении файла:', error);
      throw error;
    }
  };
  
  /**
   * Получение списка файлов в локальном хранилище
   * @param {Object} filter - фильтр для поиска файлов
   * @returns {Promise<Array>} - массив файлов
   */
  const listFiles = async (filter = {}) => {
    try {
      const db = await openDB();
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      
      return new Promise((resolve, reject) => {
        const request = store.getAll();
        
        request.onsuccess = (event) => {
          let files = event.target.result;
          
          // Фильтрация результатов, если указаны фильтры
          if (Object.keys(filter).length > 0) {
            files = files.filter(file => {
              // Проверяем соответствие каждому критерию фильтра
              return Object.entries(filter).every(([key, value]) => {
                if (key === 'metadata') {
                  // Для метаданных проверяем вложенные поля
                  return Object.entries(value).every(([metaKey, metaValue]) => 
                    file.metadata && file.metadata[metaKey] === metaValue
                  );
                } else {
                  return file[key] === value;
                }
              });
            });
          }
          
          // Исключаем большие бинарные данные для списка
          const filesList = files.map(file => {
            const { data, ...fileInfo } = file;
            return {
              ...fileInfo,
              hasData: !!data
            };
          });
          
          resolve(filesList);
        };
        
        request.onerror = (event) => {
          console.error('Ошибка при получении списка файлов из IndexedDB:', event.target.error);
          reject(event.target.error);
        };
      });
    } catch (error) {
      console.error('Ошибка при получении списка файлов:', error);
      throw error;
    }
  };
  
  /**
   * Очистка локального хранилища
   * @param {Object} filter - фильтр для удаления файлов
   * @returns {Promise<number>} - количество удаленных файлов
   */
  const clearStorage = async (filter = {}) => {
    try {
      const db = await openDB();
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      
      // Если фильтр пустой, удаляем все файлы
      if (Object.keys(filter).length === 0) {
        return new Promise((resolve, reject) => {
          const request = store.clear();
          
          request.onsuccess = () => {
            console.log('Локальное хранилище полностью очищено');
            resolve(true);
          };
          
          request.onerror = (event) => {
            console.error('Ошибка при очистке локального хранилища:', event.target.error);
            reject(event.target.error);
          };
        });
      }
      
      // Если задан фильтр, получаем список файлов и удаляем подходящие
      const filesToDelete = await listFiles(filter);
      let deletedCount = 0;
      
      // Последовательно удаляем файлы
      for (const file of filesToDelete) {
        try {
          await deleteFile(file.fileId);
          deletedCount++;
        } catch (error) {
          console.error(`Ошибка при удалении файла ${file.fileId}:`, error);
        }
      }
      
      console.log(`Удалено ${deletedCount} файлов из локального хранилища`);
      return deletedCount;
    } catch (error) {
      console.error('Ошибка при очистке хранилища:', error);
      throw error;
    }
  };
  
  /**
   * Проверка поддержки IndexedDB
   * @returns {boolean} - результат проверки
   */
  const isSupported = () => {
    return !!window.indexedDB;
  };
  
  /**
   * Получение текущего состояния хранилища
   * @returns {Promise<Object>} - информация о хранилище
   */
  const getStorageInfo = async () => {
    try {
      const db = await openDB();
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      
      return new Promise((resolve, reject) => {
        const request = store.getAll();
        
        request.onsuccess = (event) => {
          const files = event.target.result;
          let totalSize = 0;
          let oldestTimestamp = Date.now();
          let newestTimestamp = 0;
          
          // Подсчитываем общий размер и находим самый старый/новый файл
          files.forEach(file => {
            totalSize += file.size;
            
            if (file.timestamp < oldestTimestamp) {
              oldestTimestamp = file.timestamp;
            }
            
            if (file.timestamp > newestTimestamp) {
              newestTimestamp = file.timestamp;
            }
          });
          
          // Группировка по статусам
          const statusCount = files.reduce((acc, file) => {
            acc[file.status] = (acc[file.status] || 0) + 1;
            return acc;
          }, {});
          
          resolve({
            fileCount: files.length,
            totalSize,
            usedPercentage: (totalSize / MAX_STORAGE_SIZE) * 100,
            oldestFile: oldestTimestamp !== Date.now() ? new Date(oldestTimestamp) : null,
            newestFile: newestTimestamp !== 0 ? new Date(newestTimestamp) : null,
            statusCount
          });
        };
        
        request.onerror = (event) => {
          console.error('Ошибка при получении информации о хранилище:', event.target.error);
          reject(event.target.error);
        };
      });
    } catch (error) {
      console.error('Ошибка при получении информации о хранилище:', error);
      throw error;
    }
  };
  
  export default {
    saveFile,
    getFile,
    updateFileStatus,
    deleteFile,
    listFiles,
    clearStorage,
    isSupported,
    getStorageInfo
  };