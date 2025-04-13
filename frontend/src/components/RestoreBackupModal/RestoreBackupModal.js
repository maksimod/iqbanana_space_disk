import React, { useState, useEffect } from 'react';
import { FaSpinner, FaTimes, FaExclamationTriangle, FaHistory } from 'react-icons/fa';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import './RestoreBackupModal.css';

const RestoreBackupModal = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [diskName, setDiskName] = useState('');
  const [backups, setBackups] = useState([]);
  const [selectedBackup, setSelectedBackup] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [restoreInProgress, setRestoreInProgress] = useState(false);
  const [confirmationVisible, setConfirmationVisible] = useState(false);
  
  const toast = useToast();
  const { token, getAuthHeaders } = useAuth();
  
  // Используем функцию для получения заголовков авторизации
  const authHeaders = getAuthHeaders ? getAuthHeaders() : {};
  
  // Слушаем событие открытия модального окна
  useEffect(() => {
    const handleOpenModal = (event) => {
      const { diskName } = event.detail;
      setDiskName(diskName);
      setIsOpen(true);
      loadBackups(diskName);
    };
    
    window.addEventListener('open-restore-backup-modal', handleOpenModal);
    
    return () => {
      window.removeEventListener('open-restore-backup-modal', handleOpenModal);
    };
  }, [token]);
  
  // Функция загрузки списка бэкапов
  const loadBackups = async (diskName) => {
    setIsLoading(true);
    setError(null);
    
    try {
      // Логируем токен для отладки (только первые несколько символов)
      console.log("Используемый токен:", token ? `${token.substring(0, 10)}...` : "не определен");
      console.log("Заголовки авторизации:", authHeaders);
      
      // Запрос с правильной версией API и улучшенными заголовками
      const response = await fetch(`/api/v1/system/backup/${diskName}`, {
        headers: {
          ...authHeaders
        }
      });
      
      if (!response.ok) {
        throw new Error(`Ошибка загрузки бэкапов: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (data.success) {
        setBackups(data.backups || []);
        if (data.backups && data.backups.length === 0) {
          setError('Для этого диска нет доступных бэкапов');
        }
      } else {
        setError(data.message || 'Не удалось загрузить список бэкапов');
      }
    } catch (err) {
      console.error('Ошибка при загрузке бэкапов:', err);
      setError(err.message || 'Ошибка при загрузке списка бэкапов');
    } finally {
      setIsLoading(false);
    }
  };
  
  // Функция восстановления из бэкапа
  const restoreFromBackup = async () => {
    if (!selectedBackup) {
      toast.showWarning('Выберите бэкап для восстановления');
      return;
    }
    
    setRestoreInProgress(true);
    setError(null);
    
    try {
      // Лог токена для отладки
      console.log("Используемый токен для восстановления:", token ? `${token.substring(0, 10)}...` : "не определен");
      console.log("Заголовки авторизации для восстановления:", authHeaders);
      
      // Используем правильный URL с версией API и заголовками авторизации
      const response = await fetch('/api/v1/system/backup/restore', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders
        },
        body: JSON.stringify({
          diskName,
          backupFile: selectedBackup.filename
        })
      });
      
      if (!response.ok) {
        throw new Error(`Ошибка при запуске восстановления: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (data.success) {
        toast.showSuccess(`Начато восстановление диска ${diskName} из бэкапа ${selectedBackup.filename}`);
        closeModal();
      } else {
        setError(data.message || 'Ошибка при запуске восстановления');
      }
    } catch (err) {
      console.error('Ошибка при восстановлении из бэкапа:', err);
      setError(err.message || 'Ошибка при запуске процесса восстановления');
    } finally {
      setRestoreInProgress(false);
      setConfirmationVisible(false);
    }
  };
  
  // Форматирование размера бэкапа
  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Байт';
    
    const k = 1024;
    const sizes = ['Байт', 'КБ', 'МБ', 'ГБ', 'ТБ'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };
  
  // Закрытие модального окна
  const closeModal = () => {
    setIsOpen(false);
    setSelectedBackup(null);
    setConfirmationVisible(false);
    setBackups([]);
    setError(null);
  };
  
  // Выбор бэкапа
  const handleSelectBackup = (backup) => {
    setSelectedBackup(backup);
  };
  
  // Подтверждение восстановления
  const handleConfirmRestore = () => {
    setConfirmationVisible(true);
  };
  
  // Если модальное окно закрыто, не отображаем ничего
  if (!isOpen) {
    return null;
  }
  
  return (
    <div className="restore-backup-modal-overlay">
      <div className="restore-backup-modal">
        <div className="restore-backup-modal-header">
          <h2>Восстановление из бэкапа - Диск {diskName}</h2>
          <button className="close-button" onClick={closeModal}>
            <FaTimes />
          </button>
        </div>
        
        <div className="restore-backup-modal-content">
          {isLoading ? (
            <div className="loading-container">
              <FaSpinner className="spinner" />
              <p>Загрузка списка бэкапов...</p>
            </div>
          ) : error ? (
            <div className="error-container">
              <FaExclamationTriangle className="error-icon" />
              <p>{error}</p>
            </div>
          ) : backups.length === 0 ? (
            <div className="empty-container">
              <p>Для этого диска нет доступных бэкапов</p>
            </div>
          ) : (
            <>
              <div className="backups-list">
                <div className="backups-list-header">
                  <span className="backup-name-header">Имя файла</span>
                  <span className="backup-date-header">Дата создания</span>
                  <span className="backup-size-header">Размер</span>
                </div>
                
                {backups.map((backup) => (
                  <div 
                    key={backup.filename}
                    className={`backup-item ${selectedBackup && selectedBackup.filename === backup.filename ? 'selected' : ''}`}
                    onClick={() => handleSelectBackup(backup)}
                  >
                    <span className="backup-name">{backup.filename}</span>
                    <span className="backup-date">{backup.dateFormatted}</span>
                    <span className="backup-size">{formatFileSize(backup.size)}</span>
                  </div>
                ))}
              </div>
              
              {selectedBackup && (
                <div className="selected-backup-info">
                  <h3>Выбранный бэкап:</h3>
                  <p>
                    <strong>Имя файла:</strong> {selectedBackup.filename}<br />
                    <strong>Дата создания:</strong> {selectedBackup.dateFormatted}<br />
                    <strong>Размер:</strong> {formatFileSize(selectedBackup.size)}
                  </p>
                </div>
              )}
            </>
          )}
          
          {confirmationVisible && (
            <div className="confirmation-dialog">
              <div className="confirmation-content">
                <FaExclamationTriangle className="warning-icon" />
                <h3>Внимание! Подтвердите восстановление</h3>
                <p>
                  Вы собираетесь восстановить диск <strong>{diskName}</strong> из бэкапа <strong>{selectedBackup.filename}</strong>.
                </p>
                <p>
                  Все текущие данные на диске будут перемещены в резервную директорию (будет создана копия текущего состояния).
                  Затем данные из бэкапа будут восстановлены на диск.
                </p>
                <p className="warning-text">
                  Этот процесс нельзя отменить после его начала!
                </p>
                
                <div className="confirmation-buttons">
                  <button 
                    className="cancel-button"
                    onClick={() => setConfirmationVisible(false)}
                    disabled={restoreInProgress}
                  >
                    Отмена
                  </button>
                  <button 
                    className="confirm-button"
                    onClick={restoreFromBackup}
                    disabled={restoreInProgress}
                  >
                    {restoreInProgress ? (
                      <>
                        <FaSpinner className="spinner" /> Восстановление...
                      </>
                    ) : (
                      <>
                        <FaHistory /> Восстановить
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className="restore-backup-modal-footer">
          <button 
            className="cancel-button"
            onClick={closeModal}
            disabled={restoreInProgress}
          >
            Отмена
          </button>
          
          <button 
            className="restore-button"
            onClick={handleConfirmRestore}
            disabled={!selectedBackup || isLoading || restoreInProgress || confirmationVisible}
          >
            {restoreInProgress ? (
              <>
                <FaSpinner className="spinner" /> Восстановление...
              </>
            ) : (
              <>
                <FaHistory /> Восстановить из бэкапа
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RestoreBackupModal; 