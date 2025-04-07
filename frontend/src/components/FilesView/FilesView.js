import React, { useState, useEffect, useRef, useCallback } from 'react';
import NavigationBar from './NavigationBar';
import FileActions from './FileActions';
import FilesList from './FilesList';
import FileSearch from './FileSearch';
import Loading from '../Loading';
import FileUploader from '../FileUploader';
import useApi from '../../hooks/useApi';
import { useAppContext } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import FileDialog from './FileDialog';
import FileEditor from './FileEditor';
import FolderDialog from './FolderDialog';

const FilesView = () => {
  const [searchResults, setSearchResults] = useState(null);
  const [activeUploads, setActiveUploads] = useState([]);
  const [isFileDialogOpen, setIsFileDialogOpen] = useState(false);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingFile, setEditingFile] = useState(null);
  const [fileContent, setFileContent] = useState('');
  const [isFolderDialogOpen, setIsFolderDialogOpen] = useState(false);
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
    loadDisks,
    disks
  } = useAppContext();
  
  const api = useApi();
  const { deleteFile, createFolder, getDownloadUrl, downloadFile, uploadFile, getActiveUploads, clearActiveUploads } = api;
  const toast = useToast();

  // Определяем, какие файлы отображать - результаты поиска или все файлы
  const displayFiles = searchResults || files;
  
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
      };
    }
  }, [currentDisk, currentPath, activeUploads, getActiveUploads, loadFiles, toast]);

  // Удаление файла или директории
  const handleDelete = async (file) => {
    if (!window.confirm(`Вы уверены, что хотите удалить ${file.name}?`)) {
      return;
    }
    
    const result = await deleteFile(currentDisk, file.path);
    if (result && result.success) {
      toast.showSuccess('Файл успешно удален');
      loadFiles();
      loadDisks();
      // Сбрасываем результаты поиска после удаления
      setSearchResults(null);
    } else if (result && result.requiresAdmin) {
      toast.showError('Недостаточно прав для удаления. Запросите разрешение у администратора');
    }
  };

  // Создание новой папки
  const handleCreateFolder = async (folderData) => {
    try {
      const { folderName } = folderData;
      console.log('Отправка запроса на создание папки:', { folderName, path: currentPath });
      
      const result = await createFolder(currentDisk, currentPath, folderName);
      if (result && result.success) {
        toast.showSuccess('Папка успешно создана');
        loadFiles();
        setIsFolderDialogOpen(false);
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

  /**
   * Создает пустой файл
   */
  const createEmptyFile = async (fileData) => {
    try {
      // Проверяем наличие текущего диска
      if (!currentDisk) {
        toast.showError('Не выбран диск');
        return;
      }
      
      // Находим объект диска по имени в списке дисков
      const diskObj = disks.find(disk => disk.name === currentDisk);
      
      if (!diskObj) {
        console.error('Не удалось найти диск:', currentDisk, 'в списке:', disks);
        toast.showError('Не удалось найти диск!');
        return;
      }
      
      // Используем имя диска как ID, если _id отсутствует
      const diskId = diskObj._id || diskObj.name;
      
      console.log('Отправка запроса на создание файла:', { 
        diskId, 
        fileName: fileData.fileName,
        path: currentPath
      });
      
      const result = await api.createEmptyFile(diskId, {
        fileName: fileData.fileName,
        path: currentPath
      });
      
      if (result.success) {
        toast.showSuccess('Файл успешно создан');
        setIsFileDialogOpen(false);
        loadFiles();
      }
    } catch (error) {
      console.error('Ошибка при создании файла:', error);
      toast.showError('Не удалось создать файл');
    }
  };

  /**
   * Открывает текстовый файл для редактирования
   * @param {Object} file - Объект файла для редактирования
   */
  const openFileEditor = async (file) => {
    try {
      // Проверяем наличие текущего диска
      if (!currentDisk) {
        toast.showError('Не выбран диск');
        return;
      }
      
      // Находим объект диска по имени в списке дисков
      const diskObj = disks.find(disk => disk.name === currentDisk);
      
      if (!diskObj) {
        console.error('Не удалось найти диск:', currentDisk, 'в списке:', disks);
        toast.showError('Не удалось найти диск!');
        return;
      }
      
      // Используем имя диска как ID, если _id отсутствует
      const diskId = diskObj._id || diskObj.name;
      
      // Проверяем, является ли файл текстовым по расширению
      const fileExt = file.name.split('.').pop().toLowerCase();
      const textExtensions = ['txt', 'md', 'js', 'jsx', 'ts', 'tsx', 'html', 'css', 'json', 'yml', 'yaml', 'xml', 'csv', 'log'];
      
      if (!textExtensions.includes(fileExt)) {
        toast.showWarning('Этот тип файла не поддерживается для редактирования');
        return;
      }
      
      console.log('Открываем файл для редактирования:', file.name);
      console.log('Диск объект:', diskObj);
      console.log('Используемый ID диска:', diskId);
      
      // Получаем полный путь к файлу
      const filePath = currentPath
        ? `${currentPath}/${file.name}`
        : file.name;
      
      console.log('Путь к файлу:', filePath, 'ID диска:', diskId);
      
      // Получаем содержимое файла
      const result = await api.getFileContent(diskId, filePath);
      if (result.success) {
        console.log('Содержимое файла получено, открываем редактор');
        setFileContent(result.content);
        setEditingFile({
          ...file,
          path: filePath
        });
        setIsEditorOpen(true);
      }
    } catch (error) {
      console.error('Ошибка при открытии файла:', error);
      toast.showError('Не удалось открыть файл: ' + (error.message || 'Неизвестная ошибка'));
    }
  };

  /**
   * Сохраняет изменения в текстовом файле
   * @param {string} newContent - Новое содержимое файла
   */
  const saveFileContent = async (newContent) => {
    if (!editingFile || !currentDisk) return;
    
    try {
      // Находим объект диска по имени в списке дисков
      const diskObj = disks.find(disk => disk.name === currentDisk);
      
      if (!diskObj) {
        console.error('Не удалось найти диск:', currentDisk, 'в списке:', disks);
        toast.showError('Не удалось найти диск!');
        return;
      }
      
      // Используем имя диска как ID, если _id отсутствует
      const diskId = diskObj._id || diskObj.name;
      
      console.log('Сохраняем файл:', editingFile.path, 'ID диска:', diskId);
      
      await api.saveFileContent(diskId, editingFile.path, newContent);
      // Обновляем список файлов, чтобы отразить изменение даты модификации и размера
      loadFiles();
    } catch (error) {
      console.error('Ошибка при сохранении файла:', error);
    }
  };

  /**
   * Закрывает редактор файлов
   */
  const closeFileEditor = () => {
    setIsEditorOpen(false);
    setEditingFile(null);
    setFileContent('');
  };

  /**
   * Обработчик клика по файлу
   * @param {Object} file - Объект файла
   */
  const handleFileClick = async (file) => {
    // Если это текстовый файл, открываем его в редакторе
    const fileExt = file.name.split('.').pop().toLowerCase();
    const textExtensions = ['txt', 'md', 'js', 'jsx', 'ts', 'tsx', 'html', 'css', 'json', 'yml', 'yaml', 'xml', 'csv', 'log'];
    
    if (textExtensions.includes(fileExt)) {
      openFileEditor(file);
    } else {
      // Для других типов файлов используем существующий обработчик
      if (handleNavigate) {
        handleNavigate(file);
      }
    }
  };

  const handleClearSearch = () => {
    setSearchResults(null);
  };

  return (
    <div className="files-view">
      <NavigationBar 
        path={currentPath} 
        onBack={handleBack} 
        onNavigate={handleNavigate}
      />
      
      <div className="files-actions-container">
        <FileSearch 
          files={files}
          onSearch={handleSearchResults}
          onClearSearch={handleClearSearch}
        />
        <FileActions 
          onCreateFolder={() => setIsFolderDialogOpen(true)}
          onCreateFile={() => setIsFileDialogOpen(true)}
        />
      </div>
      
      {/* Компонент загрузки файлов с отображением прогресса */}
      <FileUploader 
        onFileUploadComplete={() => loadFiles()}
        currentPath={currentPath}
        selectedDisk={currentDisk}
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
              onNavigate={(file) => file.isDirectory ? handleNavigate(file) : handleFileClick(file)}
              onDelete={handleDelete}
              onDownload={handleDownload}
            />
          </>
        )}
      </div>
      
      {isFolderDialogOpen && (
        <FolderDialog
          isOpen={isFolderDialogOpen}
          onClose={() => setIsFolderDialogOpen(false)}
          onSubmit={handleCreateFolder}
          currentPath={currentPath}
        />
      )}
      
      {isFileDialogOpen && (
        <FileDialog
          isOpen={isFileDialogOpen}
          onClose={() => setIsFileDialogOpen(false)}
          onSubmit={createEmptyFile}
          currentPath={currentPath}
        />
      )}
      
      {isEditorOpen && editingFile && (
        <FileEditor
          isOpen={isEditorOpen}
          fileName={editingFile.name}
          fileContent={fileContent}
          onSave={saveFileContent}
          onClose={closeFileEditor}
        />
      )}
    </div>
  );
};

export default FilesView;