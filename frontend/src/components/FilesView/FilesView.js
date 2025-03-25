import React, { useState } from 'react';
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
  
  const { deleteFile, createFolder, getDownloadUrl, uploadFile } = useApi();
  const toast = useToast();

  // Определяем, какие файлы отображать - результаты поиска или все файлы
  const displayFiles = searchResults || files;

  // Загрузка файла
  const handleUpload = (file, onComplete) => {
    setUploadProgress(0);
    
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
        setUploadProgress(100);
        setUploadStatus('Загрузка завершена');
        toast.showSuccess(`Файл ${file.name} успешно загружен`);
        
        // Даем время для завершения всех операций на сервере
        setTimeout(() => {
          setUploadProgress(0);
          setUploadStatus('');
          loadFiles();
          loadDisks();
          if (onComplete) onComplete();
        }, 1000);
      },
      (errorMsg) => {
        setUploadProgress(0);
        setUploadStatus('');
        toast.showError(errorMsg || `Ошибка при загрузке файла ${file.name}. Пожалуйста, попробуйте снова.`);
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