// Модифицируем renderFilesList для отображения активных загрузок
const renderFilesList = () => {
  if (loading) {
    return <div className="loading-indicator"><FontAwesomeIcon icon={faSpinner} spin /> Загрузка...</div>;
  }

  if (error) {
    return <div className="error-message">{error}</div>;
  }

  // Получаем активные загрузки для текущего пути
  const activeUploads = api.getLocalUploads ? api.getLocalUploads(selectedDisk, currentPath) : [];
  
  // Создаем объекты для загружаемых файлов, чтобы отобразить их в списке
  const uploadingFiles = activeUploads
    .filter(upload => 
      // Отображаем файлы, которые загружаются, финализируются или были загружены недавно (меньше 30 минут назад)
      ['uploading', 'finalizing', 'starting'].includes(upload.status) || 
      (upload.status === 'completed' && upload.completedAt && (Date.now() - upload.completedAt < 30 * 60 * 1000))
    )
    .map(upload => ({
      name: upload.fileName,
      path: upload.path ? `${upload.path}/${upload.fileName}` : upload.fileName,
      size: upload.fileSize || 0,
      isDirectory: false,
      isUploading: upload.status !== 'completed',
      uploadProgress: upload.progress || 0,
      uploadStatus: upload.status
    }));

  // Объединяем файлы из API и загружаемые файлы
  const allFiles = [...(files || [])];
  
  // Добавляем загружаемые файлы, если их нет в списке файлов
  uploadingFiles.forEach(uploadingFile => {
    // Проверяем, есть ли уже такой файл в списке
    const existingFileIndex = allFiles.findIndex(f => f.name === uploadingFile.name);
    
    if (existingFileIndex >= 0) {
      // Если файл уже есть, но загружается, обновляем информацию о нем
      if (uploadingFile.isUploading) {
        allFiles[existingFileIndex] = {
          ...allFiles[existingFileIndex],
          isUploading: true,
          uploadProgress: uploadingFile.uploadProgress,
          uploadStatus: uploadingFile.uploadStatus
        };
      }
    } else {
      // Если файла нет в списке, добавляем его
      allFiles.push(uploadingFile);
    }
  });

  if (allFiles.length === 0) {
    return <div className="empty-folder-message">Папка пуста</div>;
  }

  // Сортировка файлов: сначала директории, затем файлы по алфавиту
  const sortedFiles = [...allFiles].sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="files-list">
      {sortedFiles.map((file, index) => (
        <div 
          key={`${file.name}-${index}`} 
          className={`file-item ${selectedFiles.includes(file.name) ? 'selected' : ''} ${file.isUploading ? 'uploading' : ''}`}
          onClick={(e) => handleFileClick(e, file)}
          onDoubleClick={() => handleFileDoubleClick(file)}
          onContextMenu={(e) => handleContextMenu(e, file)}
        >
          <div className="file-icon">
            {file.isDirectory ? (
              <FontAwesomeIcon icon={faFolder} />
            ) : (
              <FontAwesomeIcon icon={getFileIcon(file.name)} />
            )}
          </div>
          <div className="file-details">
            <div className="file-name">{file.name}</div>
            <div className="file-meta">
              {!file.isDirectory && (
                <span className="file-size">{formatFileSize(file.size)}</span>
              )}
            </div>
            {file.isUploading && (
              <div className="upload-progress">
                <div 
                  className="upload-progress-bar" 
                  style={{ width: `${file.uploadProgress}%` }}
                ></div>
                <span className="upload-status">
                  {file.uploadStatus === 'uploading' ? 'Загрузка' : 
                   file.uploadStatus === 'finalizing' ? 'Завершение' : 
                   file.uploadStatus === 'starting' ? 'Начало загрузки' : 
                   'Обработка'} ({Math.round(file.uploadProgress)}%)
                </span>
              </div>
            )}
          </div>
          {/* Добавим иконку для удаления загружаемого файла */}
          {file.isUploading && (
            <div className="file-actions">
              <button 
                className="cancel-upload-button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleCancelUpload(file);
                }}
                title="Отменить загрузку"
              >
                <FontAwesomeIcon icon={faTimes} />
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

// Функция для отмены загрузки файла
const handleCancelUpload = (file) => {
  if (api.cancelUpload) {
    // Формируем ключ для загрузки
    const uploadKey = `${selectedDisk}:${currentPath || ''}:${file.name}`;
    api.cancelUpload(uploadKey);
    
    // Обновляем список файлов
    fetchFiles();
  }
}; 