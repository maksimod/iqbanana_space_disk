import indexedDBStorage from '../utils/indexedDBStorage';
const API_URL = '/api';
const API_VERSION = 'v1';

/**
 * Сервис для синхронизации загруженных файлов между клиентом и сервером
 */
class SyncService {
  constructor() {
    this.apiUrl = `${API_URL}/${API_VERSION}`;
    this.syncQueue = [];
    this.isSyncing = false;
    this.listeners = [];
    
    // Проверяем поддержку IndexedDB
    this.isSupported = indexedDBStorage.isSupported();
    
    // Проверяем поддержку Service Worker API
    this.hasServiceWorker = 'serviceWorker' in navigator;
    
    // Информация о синхронизациях
    this.syncHistory = new Map();
    
    // Загружаем историю синхронизаций из localStorage
    this._loadSyncHistory();
    
    // Запускаем периодическую синхронизацию
    this._startPeriodicSync();
  }
  
  /**
   * Загрузка истории синхронизаций из localStorage
   */
  _loadSyncHistory() {
    try {
      const savedHistory = localStorage.getItem('syncHistory');
      if (savedHistory) {
        const history = JSON.parse(savedHistory);
        
        // Преобразуем обратно в Map
        this.syncHistory = new Map(Object.entries(history));
        
        console.log(`Загружена история синхронизаций: ${this.syncHistory.size} записей`);
      }
    } catch (error) {
      console.error('Ошибка при загрузке истории синхронизаций:', error);
    }
  }
  
  /**
   * Сохранение истории синхронизаций в localStorage
   */
  _saveSyncHistory() {
    try {
      // Ограничиваем размер истории (100 последних записей)
      if (this.syncHistory.size > 100) {
        const entries = Array.from(this.syncHistory.entries());
        const sortedEntries = entries.sort((a, b) => {
          return (b[1].startTime || 0) - (a[1].startTime || 0);
        });
        
        // Создаем новую Map с последними 100 записями
        this.syncHistory = new Map(sortedEntries.slice(0, 100));
      }
      
      // Преобразуем Map в объект для сохранения
      const history = Object.fromEntries(this.syncHistory);
      localStorage.setItem('syncHistory', JSON.stringify(history));
    } catch (error) {
      console.error('Ошибка при сохранении истории синхронизаций:', error);
    }
  }
  
  /**
   * Запуск периодической синхронизации
   */
  _startPeriodicSync() {
    // Запускаем первую проверку через 30 секунд
    setTimeout(() => this.processSyncQueue(), 30000);
    
    // Регулярные проверки каждые 5 минут
    setInterval(() => this.processSyncQueue(), 5 * 60 * 1000);
  }
  
  /**
   * Добавление слушателя событий синхронизации
   * @param {Function} listener - функция-обработчик
   */
  addSyncListener(listener) {
    this.listeners.push(listener);
  }
  
  /**
   * Удаление слушателя событий синхронизации
   * @param {Function} listener - функция-обработчик
   */
  removeSyncListener(listener) {
    this.listeners = this.listeners.filter(l => l !== listener);
  }
  
  /**
   * Отправка события слушателям
   * @param {string} type - тип события
   * @param {Object} data - данные события
   */
  _notifyListeners(type, data) {
    this.listeners.forEach(listener => {
      try {
        listener({ type, data });
      } catch (error) {
        console.error('Ошибка в обработчике события синхронизации:', error);
      }
    });
  }
  
  /**
   * Сохранение файла локально и добавление в очередь на синхронизацию
   * @param {File} file - файл для сохранения
   * @param {Object} options - опции синхронизации
   * @returns {Promise<Object>} - информация о загрузке
   */
  async uploadFile(file, options = {}) {
    if (!this.isSupported) {
      throw new Error('Локальное хранилище не поддерживается в вашем браузере');
    }
    
    try {
      const { disk, path, onProgress } = options;
      
      if (!disk) {
        throw new Error('Не указан диск для загрузки');
      }
      
      console.log(`Начинаем загрузку файла ${file.name} на диск ${disk}`);
      
      // Сохраняем файл в локальное хранилище
      const fileId = await indexedDBStorage.saveFile(file, {
        disk,
        path: path || '',
        syncStatus: 'pending',
        uploadTime: Date.now()
      });
      
      console.log(`Файл ${file.name} (${fileId}) сохранен локально`);
      
      // Создаем запись в истории синхронизаций
      const syncInfo = {
        fileId,
        filename: file.name,
        size: file.size,
        type: file.type,
        disk,
        path: path || '',
        status: 'local',
        localProgress: 100,
        serverProgress: 0,
        startTime: Date.now(),
        lastUpdate: Date.now()
      };
      
      this.syncHistory.set(fileId, syncInfo);
      this._saveSyncHistory();
      
      // Отправляем событие о локальном сохранении
      this._notifyListeners('local_upload', {
        fileId,
        filename: file.name,
        status: 'local',
        progress: 100
      });
      
      // Добавляем файл в очередь на синхронизацию
      this.syncQueue.push({
        fileId,
        priority: options.priority || 0,
        disk,
        path: path || '',
        onProgress
      });
      
      // Запускаем процесс синхронизации
      this.processSyncQueue();
      
      return {
        fileId,
        filename: file.name,
        status: 'local',
        progress: 100,
        message: 'Файл сохранен локально и добавлен в очередь на синхронизацию'
      };
    } catch (error) {
      console.error('Ошибка при загрузке файла:', error);
      
      // Отправляем событие об ошибке
      this._notifyListeners('error', {
        filename: file.name,
        error: error.message
      });
      
      throw error;
    }
  }
  
  /**
   * Обработка очереди синхронизации
   */
  async processSyncQueue() {
    // Если уже идет синхронизация или очередь пуста, выходим
    if (this.isSyncing || this.syncQueue.length === 0) {
      return;
    }
    
    this.isSyncing = true;
    
    try {
      // Сортируем очередь по приоритету (высший приоритет - наименьшее число)
      this.syncQueue.sort((a, b) => a.priority - b.priority);
      
      // Берем первый файл из очереди
      const syncTask = this.syncQueue.shift();
      const { fileId, disk, path, onProgress } = syncTask;
      
      console.log(`Начинаем синхронизацию файла ${fileId} на диск ${disk}`);
      
      // Получаем файл из локального хранилища
      const fileData = await indexedDBStorage.getFile(fileId);
      
      if (!fileData) {
        console.error(`Файл ${fileId} не найден в локальном хранилище`);
        this.isSyncing = false;
        
        // Пробуем следующий файл
        setTimeout(() => this.processSyncQueue(), 100);
        return;
      }
      
      // Обновляем статус файла
      await indexedDBStorage.updateFileStatus(fileId, {
        syncStatus: 'syncing',
        syncStartTime: Date.now()
      });
      
      // Обновляем историю синхронизаций
      if (this.syncHistory.has(fileId)) {
        const syncInfo = this.syncHistory.get(fileId);
        syncInfo.status = 'syncing';
        syncInfo.serverProgress = 1;
        syncInfo.syncStartTime = Date.now();
        syncInfo.lastUpdate = Date.now();
        this.syncHistory.set(fileId, syncInfo);
        this._saveSyncHistory();
      }
      
      // Отправляем событие о начале синхронизации
      this._notifyListeners('sync_start', {
        fileId,
        filename: fileData.filename,
        status: 'syncing',
        progress: 1
      });
      
      // Создаем объект File из данных
      const file = new File([fileData.data], fileData.filename, {
        type: fileData.type,
        lastModified: fileData.lastModified
      });
      
      // Создаем FormData для отправки
      const formData = new FormData();
      formData.append('file', file);
      formData.append('fileId', fileId);
      formData.append('originalName', fileData.filename);
      formData.append('size', fileData.size);
      formData.append('lastModified', fileData.lastModified);
      
      // Отправляем запрос на синхронизацию
      const response = await fetch(`${this.apiUrl}/disks/${disk}/sync?path=${encodeURIComponent(path)}`, {
        method: 'POST',
        body: formData
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Ошибка HTTP: ${response.status}`);
      }
      
      const responseData = await response.json();
      
      console.log(`Файл ${fileId} принят сервером для синхронизации:`, responseData);
      
      // Обновляем статус файла в локальном хранилище
      await indexedDBStorage.updateFileStatus(fileId, {
        syncStatus: 'accepted',
        serverFileId: responseData.fileId || fileId,
        syncAcceptTime: Date.now()
      });
      
      // Обновляем историю синхронизаций
      if (this.syncHistory.has(fileId)) {
        const syncInfo = this.syncHistory.get(fileId);
        syncInfo.status = 'accepted';
        syncInfo.serverProgress = 10;
        syncInfo.syncAcceptTime = Date.now();
        syncInfo.lastUpdate = Date.now();
        this.syncHistory.set(fileId, syncInfo);
        this._saveSyncHistory();
      }
      
      // Отправляем событие о приеме файла сервером
      this._notifyListeners('sync_accepted', {
        fileId,
        filename: fileData.filename,
        status: 'accepted',
        progress: 10
      });
      
      // Обновляем прогресс, если был передан callback
      if (onProgress) {
        onProgress(10);
      }
      
      // Запускаем проверку статуса синхронизации
      this._pollSyncStatus(fileId, disk, path, onProgress);
      
      // Продолжаем обработку очереди
      this.isSyncing = false;
      
      // Запускаем обработку следующего файла с небольшой задержкой
      setTimeout(() => this.processSyncQueue(), 500);
    } catch (error) {
      console.error('Ошибка при синхронизации файла:', error);
      
      // Отправляем событие об ошибке
      this._notifyListeners('sync_error', {
        error: error.message
      });
      
      this.isSyncing = false;
      
      // Продолжаем обработку очереди через некоторое время
      setTimeout(() => this.processSyncQueue(), 5000);
    }
  }
  
  /**
   * Опрос статуса синхронизации
   * @param {string} fileId - ID файла
   * @param {string} disk - диск
   * @param {string} path - путь
   * @param {Function} onProgress - функция для обновления прогресса
   */
  async _pollSyncStatus(fileId, disk, path, onProgress) {
    let attempts = 0;
    const maxAttempts = 60; // 5 минут (60 x 5 секунд)
    const pollInterval = 5000; // 5 секунд
    
    const checkStatus = async () => {
      attempts++;
      
      try {
        // Отправляем запрос на проверку статуса
        const response = await fetch(`${this.apiUrl}/sync/${fileId}/status?disk=${disk}&path=${encodeURIComponent(path || '')}`);
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          console.warn(`Ошибка при проверке статуса синхронизации: ${errorData.error || response.statusText}`);
          
          // Если превышено количество попыток, считаем, что синхронизация завершилась с ошибкой
          if (attempts >= maxAttempts) {
            console.error(`Превышено максимальное количество попыток (${maxAttempts}) для проверки статуса синхронизации`);
            
            // Обновляем статус файла в локальном хранилище
            await indexedDBStorage.updateFileStatus(fileId, {
              syncStatus: 'error',
              syncError: 'Превышено максимальное количество попыток проверки статуса',
              syncErrorTime: Date.now()
            });
            
            // Обновляем историю синхронизаций
            if (this.syncHistory.has(fileId)) {
              const syncInfo = this.syncHistory.get(fileId);
              syncInfo.status = 'error';
              syncInfo.error = 'Превышено максимальное количество попыток проверки статуса';
              syncInfo.syncErrorTime = Date.now();
              syncInfo.lastUpdate = Date.now();
              this.syncHistory.set(fileId, syncInfo);
              this._saveSyncHistory();
            }
            
            // Отправляем событие об ошибке
            this._notifyListeners('sync_error', {
              fileId,
              error: 'Превышено максимальное количество попыток проверки статуса'
            });
            
            return;
          }
          
          // Продолжаем проверки через интервал
          setTimeout(checkStatus, pollInterval);
          return;
        }
        
        const statusData = await response.json();
        
        // Если синхронизация не найдена
        if (!statusData.sync || statusData.sync.status === 'not_found' || statusData.sync.status === 'unknown') {
          console.warn(`Синхронизация ${fileId} не найдена на сервере`);
          
          // Если превышено количество попыток, считаем, что синхронизация завершилась с ошибкой
          if (attempts >= maxAttempts) {
            console.error(`Превышено максимальное количество попыток (${maxAttempts}) для проверки статуса синхронизации`);
            
            // Обновляем статус файла в локальном хранилище
            await indexedDBStorage.updateFileStatus(fileId, {
              syncStatus: 'error',
              syncError: 'Синхронизация не найдена на сервере',
              syncErrorTime: Date.now()
            });
            
            // Обновляем историю синхронизаций
            if (this.syncHistory.has(fileId)) {
              const syncInfo = this.syncHistory.get(fileId);
              syncInfo.status = 'error';
              syncInfo.error = 'Синхронизация не найдена на сервере';
              syncInfo.syncErrorTime = Date.now();
              syncInfo.lastUpdate = Date.now();
              this.syncHistory.set(fileId, syncInfo);
              this._saveSyncHistory();
            }
            
            // Отправляем событие об ошибке
            this._notifyListeners('sync_error', {
              fileId,
              error: 'Синхронизация не найдена на сервере'
            });
            
            return;
          }
          
          // Продолжаем проверки через интервал
          setTimeout(checkStatus, pollInterval);
          return;
        }
        
        const { status, progress, error } = statusData.sync;
        
        console.log(`Статус синхронизации ${fileId}: ${status}, прогресс: ${progress}%`);
        
        // Обновляем прогресс, если был передан callback
        if (onProgress) {
          onProgress(progress || 0);
        }
        
        // Обновляем историю синхронизаций
        if (this.syncHistory.has(fileId)) {
          const syncInfo = this.syncHistory.get(fileId);
          syncInfo.status = status;
          syncInfo.serverProgress = progress || syncInfo.serverProgress || 0;
          syncInfo.lastUpdate = Date.now();
          
          if (error) {
            syncInfo.error = error;
            syncInfo.syncErrorTime = Date.now();
          }
          
          this.syncHistory.set(fileId, syncInfo);
          this._saveSyncHistory();
        }
        
        // Обновляем статус файла в локальном хранилище
        await indexedDBStorage.updateFileStatus(fileId, {
          syncStatus: status,
          serverProgress: progress || 0,
          lastSyncUpdate: Date.now()
        });
        
        // Отправляем событие об обновлении статуса
        this._notifyListeners('sync_progress', {
          fileId,
          status,
          progress: progress || 0
        });
        
        // Если синхронизация завершена или произошла ошибка, прекращаем проверки
        if (status === 'completed') {
          console.log(`Синхронизация ${fileId} успешно завершена`);
          
          // Обновляем статус файла в локальном хранилище
          await indexedDBStorage.updateFileStatus(fileId, {
            syncStatus: 'completed',
            syncCompletedTime: Date.now()
          });
          
          // Отправляем событие о завершении синхронизации
          this._notifyListeners('sync_completed', {
            fileId,
            status: 'completed',
            progress: 100
          });
          
          // Обновляем прогресс, если был передан callback
          if (onProgress) {
            onProgress(100);
          }
          
          return;
        } else if (status === 'error' || status === 'cancelled') {
          console.error(`Синхронизация ${fileId} завершилась с ошибкой:`, error);
          
          // Обновляем статус файла в локальном хранилище
          await indexedDBStorage.updateFileStatus(fileId, {
            syncStatus: 'error',
            syncError: error || 'Неизвестная ошибка',
            syncErrorTime: Date.now()
          });
          
          // Отправляем событие об ошибке
          this._notifyListeners('sync_error', {
            fileId,
            error: error || 'Неизвестная ошибка'
          });
          
          return;
        }
        
        // Продолжаем проверки через интервал
        setTimeout(checkStatus, pollInterval);
      } catch (error) {
        console.error('Ошибка при проверке статуса синхронизации:', error);
        
        // Если превышено количество попыток, считаем, что синхронизация завершилась с ошибкой
        if (attempts >= maxAttempts) {
          console.error(`Превышено максимальное количество попыток (${maxAttempts}) для проверки статуса синхронизации`);
          
          // Обновляем статус файла в локальном хранилище
          await indexedDBStorage.updateFileStatus(fileId, {
            syncStatus: 'error',
            syncError: error.message,
            syncErrorTime: Date.now()
          });
          
          // Обновляем историю синхронизаций
          if (this.syncHistory.has(fileId)) {
            const syncInfo = this.syncHistory.get(fileId);
            syncInfo.status = 'error';
            syncInfo.error = error.message;
            syncInfo.syncErrorTime = Date.now();
            syncInfo.lastUpdate = Date.now();
            this.syncHistory.set(fileId, syncInfo);
            this._saveSyncHistory();
          }
          
          // Отправляем событие об ошибке
          this._notifyListeners('sync_error', {
            fileId,
            error: error.message
          });
          
          return;
        }
        
        // Продолжаем проверки через интервал
        setTimeout(checkStatus, pollInterval);
      }
    };
    
    // Запускаем первую проверку
    checkStatus();
  }
  
  /**
   * Получение истории синхронизаций
   * @param {Object} filter - фильтр для поиска записей
   * @returns {Array} - список записей
   */
  getSyncHistory(filter = {}) {
    let entries = Array.from(this.syncHistory.entries());
    
    // Применяем фильтры, если они есть
    if (Object.keys(filter).length > 0) {
      entries = entries.filter(([_, syncInfo]) => {
        return Object.entries(filter).every(([key, value]) => {
          return syncInfo[key] === value;
        });
      });
    }
    
    // Сортируем по времени (новые вначале)
    entries.sort((a, b) => (b[1].startTime || 0) - (a[1].startTime || 0));
    
    return entries.map(([fileId, syncInfo]) => ({
      fileId,
      ...syncInfo
    }));
  }
  
  /**
   * Отмена синхронизации
   * @param {string} fileId - ID файла
   * @returns {Promise<Object>} - результат отмены
   */
  async cancelSync(fileId) {
    try {
      // Проверяем, есть ли запись в истории
      if (!this.syncHistory.has(fileId)) {
        return {
          success: false,
          message: 'Синхронизация не найдена'
        };
      }
      
      const syncInfo = this.syncHistory.get(fileId);
      
      // Если синхронизация уже завершена или произошла ошибка
      if (syncInfo.status === 'completed' || syncInfo.status === 'error') {
        return {
          success: false,
          message: `Синхронизация уже ${syncInfo.status === 'completed' ? 'завершена' : 'завершилась с ошибкой'}`
        };
      }
      
      // Отправляем запрос на отмену синхронизации
      const response = await fetch(`${this.apiUrl}/sync/${fileId}/cancel`, {
        method: 'POST'
      });
      
      const responseData = await response.json();
      
      // Обновляем статус файла в локальном хранилище
      await indexedDBStorage.updateFileStatus(fileId, {
        syncStatus: 'cancelled',
        syncCancelledTime: Date.now()
      });
      
      // Обновляем историю синхронизаций
      syncInfo.status = 'cancelled';
      syncInfo.syncCancelledTime = Date.now();
      syncInfo.lastUpdate = Date.now();
      this.syncHistory.set(fileId, syncInfo);
      this._saveSyncHistory();
      
      // Удаляем из очереди, если файл был в ней
      this.syncQueue = this.syncQueue.filter(task => task.fileId !== fileId);
      
      // Отправляем событие об отмене
      this._notifyListeners('sync_cancelled', {
        fileId,
        status: 'cancelled'
      });
      
      return {
        success: true,
        message: 'Синхронизация успешно отменена'
      };
    } catch (error) {
      console.error('Ошибка при отмене синхронизации:', error);
      
      // Отправляем событие об ошибке
      this._notifyListeners('error', {
        fileId,
        error: error.message
      });
      
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Удаление файла и записи синхронизации
   * @param {string} fileId - ID файла
   * @returns {Promise<Object>} - результат удаления
   */
  async deleteFile(fileId) {
    try {
      // Удаляем файл из локального хранилища
      await indexedDBStorage.deleteFile(fileId);
      
      // Удаляем из истории синхронизаций
      this.syncHistory.delete(fileId);
      this._saveSyncHistory();
      
      // Удаляем из очереди, если файл был в ней
      this.syncQueue = this.syncQueue.filter(task => task.fileId !== fileId);
      
      // Отправляем событие об удалении
      this._notifyListeners('file_deleted', {
        fileId
      });
      
      return {
        success: true,
        message: 'Файл успешно удален'
      };
    } catch (error) {
      console.error('Ошибка при удалении файла:', error);
      
      // Отправляем событие об ошибке
      this._notifyListeners('error', {
        fileId,
        error: error.message
      });
      
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Очистка истории синхронизаций
   * @param {Object} filter - фильтр для удаления записей
   * @returns {Promise<number>} - количество удаленных записей
   */
  async clearSyncHistory(filter = {}) {
    try {
      let count = 0;
      
      // Если фильтр пустой, удаляем все записи
      if (Object.keys(filter).length === 0) {
        count = this.syncHistory.size;
        this.syncHistory.clear();
      } else {
        // Удаляем записи по фильтру
        for (const [fileId, syncInfo] of this.syncHistory.entries()) {
          const match = Object.entries(filter).every(([key, value]) => {
            return syncInfo[key] === value;
          });
          
          if (match) {
            this.syncHistory.delete(fileId);
            count++;
          }
        }
      }
      
      // Сохраняем обновленную историю
      this._saveSyncHistory();
      
      // Отправляем событие об очистке
      this._notifyListeners('history_cleared', {
        count
      });
      
      return count;
    } catch (error) {
      console.error('Ошибка при очистке истории синхронизаций:', error);
      
      // Отправляем событие об ошибке
      this._notifyListeners('error', {
        error: error.message
      });
      
      return 0;
    }
  }
}

// Создаем и экспортируем экземпляр сервиса
const syncService = new SyncService();
export default syncService;