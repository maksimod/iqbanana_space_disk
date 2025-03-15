import React, { createContext, useState, useContext, useEffect } from 'react';
import useApi from '../hooks/useApi';
import useLocalStorage from '../hooks/useLocalStorage';

// Создание контекста
const AppContext = createContext();

/**
 * Провайдер контекста приложения
 */
export const AppProvider = ({ children }) => {
  // Состояние приложения
  const [disks, setDisks] = useState([]);
  const [currentDisk, setCurrentDisk] = useLocalStorage('currentDisk', null);
  const [currentPath, setCurrentPath] = useLocalStorage('currentPath', '');
  const [files, setFiles] = useState([]);
  const { loading, error, fetchDisks, fetchFiles, setError } = useApi();

  // Загрузка списка дисков при монтировании компонента
  useEffect(() => {
    loadDisks();
  }, []);

  // Загрузка файлов при изменении диска или пути
  useEffect(() => {
    if (currentDisk) {
      loadFiles();
    }
  }, [currentDisk, currentPath]);

  // Функция загрузки дисков
  const loadDisks = async () => {
    const data = await fetchDisks();
    if (data) {
      setDisks(data);
    }
  };

  // Функция загрузки файлов
  const loadFiles = async () => {
    const data = await fetchFiles(currentDisk, currentPath);
    if (data) {
      setFiles(data);
    }
  };

  // Выбор диска
  const handleDiskSelect = (diskName) => {
    setCurrentDisk(diskName);
    setCurrentPath('');
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

  // Навигация в папку
  const handleNavigate = (file) => {
    if (file.isDirectory) {
      setCurrentPath(file.path);
    }
  };

  // Возвращаем провайдер контекста с состоянием и методами
  return (
    <AppContext.Provider
      value={{
        disks,
        currentDisk,
        currentPath,
        files,
        loading,
        error,
        setError,
        loadDisks,
        loadFiles,
        handleDiskSelect,
        handleBack,
        handleNavigate
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

/**
 * Хук для использования контекста приложения
 */
export const useAppContext = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext должен использоваться внутри AppProvider');
  }
  return context;
};