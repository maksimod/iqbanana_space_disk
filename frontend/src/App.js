// App.js
import React, { useState, useEffect } from 'react';
import './App.css';
import { FaFolder, FaFile, FaTrash, FaUpload, FaFolderPlus, FaArrowLeft, FaDownload } from 'react-icons/fa';

function App() {
  const [disks, setDisks] = useState([]);
  const [currentDisk, setCurrentDisk] = useState(null);
  const [files, setFiles] = useState([]);
  const [currentPath, setCurrentPath] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [folderName, setFolderName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  
  // Use relative URL for API requests
  const API_URL = 'http://46.35.241.37:6005/api';
  
  // Загрузка списка дисков при монтировании компонента
  useEffect(() => {
    fetchDisks();
  }, []);
  
  // Загрузка файлов при изменении диска или пути
  useEffect(() => {
    if (currentDisk) {
      fetchFiles();
    }
  }, [currentDisk, currentPath]);
  
  // Получение списка дисков с информацией о пространстве
  const fetchDisks = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/disks`);
      if (!response.ok) {
        throw new Error('Не удалось получить список дисков');
      }
      const data = await response.json();
      setDisks(data);
      setError('');
    } catch (err) {
      console.error('Ошибка при получении дисков:', err);
      setError('Не удалось загрузить диски. Пожалуйста, попробуйте позже.');
    } finally {
      setLoading(false);
    }
  };
  
  // Получение списка файлов в текущей директории
  const fetchFiles = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/disks/${currentDisk}/files?path=${currentPath}`);
      if (!response.ok) {
        throw new Error('Не удалось получить список файлов');
      }
      const data = await response.json();
      setFiles(data);
      setError('');
    } catch (err) {
      console.error('Ошибка при получении файлов:', err);
      setError('Не удалось загрузить файлы. Пожалуйста, попробуйте позже.');
      setFiles([]);
    } finally {
      setLoading(false);
    }
  };
  
  // Выбор диска
  const handleDiskSelect = (diskName) => {
    setCurrentDisk(diskName);
    setCurrentPath('');
  };
  
  // Навигация по директориям
  const handleNavigate = (file) => {
    if (file.isDirectory) {
      setCurrentPath(file.path);
    }
  };
  
  // Навигация назад
  const handleBack = () => {
    if (currentPath === '') {
      setCurrentDisk(null);
      return;
    }
    
    const pathParts = currentPath.split('/');
    pathParts.pop();
    setCurrentPath(pathParts.join('/'));
  };
  
  // Обработка выбора файла для загрузки
  const handleFileChange = (event) => {
    setSelectedFile(event.target.files[0]);
  };
  
  // Загрузка файла с прогрессом
  const handleUpload = async () => {
    if (!selectedFile) {
      alert('Пожалуйста, выберите файл для загрузки');
      return;
    }
    
    const formData = new FormData();
    formData.append('file', selectedFile);
    
    try {
      // Создаем XMLHttpRequest для отслеживания прогресса
      const xhr = new XMLHttpRequest();
      
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          const progress = Math.round((event.loaded / event.total) * 100);
          setUploadProgress(progress);
        }
      });
      
      xhr.onreadystatechange = function() {
        if (xhr.readyState === 4) {
          setUploadProgress(0);
          
          if (xhr.status === 200) {
            alert('Файл успешно загружен');
            setSelectedFile(null);
            document.getElementById('file-upload').value = '';
            fetchFiles();
            fetchDisks(); // Обновляем информацию о дисках после загрузки
          } else {
            alert('Ошибка при загрузке файла. Пожалуйста, попробуйте снова.');
          }
        }
      };
      
      xhr.open('POST', `${API_URL}/disks/${currentDisk}/upload?path=${currentPath}`, true);
      xhr.send(formData);
    } catch (err) {
      console.error('Ошибка при загрузке файла:', err);
      alert('Не удалось загрузить файл. Пожалуйста, попробуйте снова.');
      setUploadProgress(0);
    }
  };
  
  // Удаление файла
  const handleDelete = async (file) => {
    if (!window.confirm(`Вы уверены, что хотите удалить ${file.name}?`)) {
      return;
    }
    
    try {
      const response = await fetch(`${API_URL}/disks/${currentDisk}/files`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ filePath: file.path }),
      });
      
      if (!response.ok) {
        throw new Error('Ошибка при удалении файла');
      }
      
      const data = await response.json();
      alert('Файл успешно удален');
      fetchFiles();
      fetchDisks(); // Обновляем информацию о дисках после удаления
    } catch (err) {
      console.error('Ошибка при удалении файла:', err);
      alert('Не удалось удалить файл. Пожалуйста, попробуйте снова.');
    }
  };
  
  // Скачивание файла или папки
  const handleDownload = (file) => {
    // Создаем ссылку для скачивания
    const downloadUrl = `${API_URL}/disks/${currentDisk}/download?path=${file.path}`;
    
    // Создаем временный элемент <a> для скачивания
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = file.name; // Имя файла для скачивания
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  
  // Создание новой папки
  const handleCreateFolder = async () => {
    if (!folderName.trim()) {
      alert('Пожалуйста, введите имя папки');
      return;
    }
    
    try {
      const response = await fetch(`${API_URL}/disks/${currentDisk}/createFolder`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          folderPath: currentPath, 
          folderName: folderName.trim() 
        }),
      });
      
      if (!response.ok) {
        throw new Error('Ошибка при создании папки');
      }
      
      const data = await response.json();
      alert('Папка успешно создана');
      setFolderName('');
      fetchFiles();
    } catch (err) {
      console.error('Ошибка при создании папки:', err);
      alert('Не удалось создать папку. Пожалуйста, попробуйте снова.');
    }
  };
  
  // Форматирование размера файла
  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    
    return parseFloat((bytes / Math.pow(1024, i)).toFixed(2)) + ' ' + sizes[i];
  };
  
  // Вычисление процента использования диска
  const calculateUsagePercent = (used, total) => {
    if (!total) return 0;
    return (used / total) * 100;
  };
  
  return (
    <div className="App">
      <header className="App-header">
        <h1>Файловый менеджер</h1>
      </header>
      
      {error && <div className="error-message">{error}</div>}
      
      {loading && !currentDisk && <div className="loading">Загрузка данных...</div>}
      
      {!currentDisk ? (
        <div className="disks-container">
          <h2>Доступные диски</h2>
          <div className="disks-grid">
            {disks.map((disk) => (
              <div 
                key={disk.name} 
                className="disk-card" 
                onClick={() => handleDiskSelect(disk.name)}
              >
                <h3>{disk.name}</h3>
                {disk.error ? (
                  <p className="error-text">{disk.error}</p>
                ) : (
                  <>
                    <div className="usage-bar">
                      <div 
                        className="usage-fill" 
                        style={{ width: `${calculateUsagePercent(disk.used, disk.total)}%` }}
                      ></div>
                    </div>
                    <p className="disk-info">
                      Используется: {formatFileSize(disk.used)} из {formatFileSize(disk.total)}
                    </p>
                    <p className="disk-info">
                      Свободно: {formatFileSize(disk.free)} 
                      ({(100 - calculateUsagePercent(disk.used, disk.total)).toFixed(1)}%)
                    </p>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="files-view">
          <div className="navigation-bar">
            <button className="nav-button" onClick={handleBack}>
              <FaArrowLeft /> Назад
            </button>
            <div className="current-path">
              <strong>{currentDisk}:</strong> {currentPath || '/'}
            </div>
          </div>
          
          <div className="file-actions">
            <div className="upload-section">
              <input
                type="file"
                id="file-upload"
                onChange={handleFileChange}
              />
              <button className="action-button" onClick={handleUpload}>
                <FaUpload /> Загрузить
              </button>
              {uploadProgress > 0 && (
                <div className="upload-progress">
                  <div className="progress-bar">
                    <div 
                      className="progress-fill" 
                      style={{ width: `${uploadProgress}%` }}
                    ></div>
                  </div>
                  <span>{uploadProgress}%</span>
                </div>
              )}
            </div>
            
            <div className="create-folder-section">
              <input
                type="text"
                placeholder="Имя новой папки"
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleCreateFolder()}
              />
              <button className="action-button" onClick={handleCreateFolder}>
                <FaFolderPlus /> Создать папку
              </button>
            </div>
          </div>
          
          {loading ? (
            <div className="loading">Загрузка файлов...</div>
          ) : (
            <div className="files-container">
              {files.length === 0 ? (
                <p className="no-files">Нет файлов в этой директории</p>
              ) : (
                <table className="files-table">
                  <thead>
                    <tr>
                      <th>Тип</th>
                      <th>Имя</th>
                      <th>Размер</th>
                      <th>Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {files.map((file) => (
                      <tr key={file.path}>
                        <td>
                          {file.isDirectory ? (
                            <FaFolder className="folder-icon" />
                          ) : (
                            <FaFile className="file-icon" />
                          )}
                        </td>
                        <td>
                          {file.isDirectory ? (
                            <span 
                              className="directory-name"
                              onClick={() => handleNavigate(file)}
                            >
                              {file.name}
                            </span>
                          ) : (
                            <span>{file.name}</span>
                          )}
                        </td>
                        <td>{file.isDirectory ? '-' : formatFileSize(file.size)}</td>
                        <td>
                          <div className="file-actions-buttons">
                            <button 
                              className="download-button"
                              onClick={() => handleDownload(file)}
                              title="Скачать"
                            >
                              <FaDownload />
                            </button>
                            <button 
                              className="delete-button"
                              onClick={() => handleDelete(file)}
                              title="Удалить"
                            >
                              <FaTrash />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;