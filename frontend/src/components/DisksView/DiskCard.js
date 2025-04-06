// frontend/src/components/DisksView/DiskCard.js
import React from 'react';
import { formatFileSize, calculateUsagePercent } from '../../utils/formatters';
import { FaExclamationTriangle, FaPlug, FaExclamationCircle, FaSpinner, FaCheck, FaClock, FaHistory } from 'react-icons/fa';
import DiskUsageChart from './DiskUsageChart';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';

const DiskCard = ({ disk, onSelect }) => {
  // Use toast context for showing warnings
  const toast = useToast();
  const { user } = useAuth();
  
  // Determine if disk is in error state and create a CSS class for it
  const cardClassName = `disk-card ${disk.error ? 'disk-card-error' : ''}`;

  // Handle disk selection with unavailability check
  const handleDiskClick = (e) => {
    if (disk.error || disk.status === 'offline' || disk.status === 'error') {
      e.stopPropagation();
      toast.showWarning(`Диск ${disk.name} недоступен. ${disk.error || 'Проверьте подключение и повторите попытку.'}`);
      return;
    }
    
    // Only navigate to available disks
    onSelect(disk.name);
  };
  
  // Обработчик для кнопки восстановления из бэкапа
  const handleRestoreBackup = (e) => {
    e.stopPropagation(); // Предотвращаем дальнейшую обработку клика
    
    // Проверяем, доступен ли диск
    if (disk.error || disk.status === 'offline' || disk.status === 'error') {
      toast.showWarning(`Диск ${disk.name} недоступен. ${disk.error || 'Проверьте подключение и повторите попытку.'}`);
      return;
    }
    
    // Открываем модальное окно с выбором бэкапа
    window.dispatchEvent(new CustomEvent('open-restore-backup-modal', { 
      detail: { diskName: disk.name }
    }));
  };

  // Компонент отображения статуса бэкапа
  const renderBackupStatus = () => {
    // Добавляем подробное логирование для отладки
    console.log("Рендеринг статуса бэкапа для диска:", disk.name);
    console.log("Объект диска целиком:", disk);
    console.log("Статус бэкапа:", disk.backupStatus);
    console.log("Сообщение бэкапа:", disk.backupMessage);
    console.log("Время обновления бэкапа:", disk.backupUpdatedAt);
    
    if (!disk.backupStatus) {
      console.log(`Диск ${disk.name} НЕ имеет статуса бэкапа!`);
      return null;
    }
    
    let statusIcon, statusText, statusClass;
    
    switch(disk.backupStatus) {
      case 'PROCESSING':
        statusIcon = <FaSpinner className="backup-status-icon-processing spinning" />;
        statusText = "Резервное копирование";
        statusClass = "backup-status-processing";
        break;
      case 'SUCCESS':
        statusIcon = <FaCheck className="backup-status-icon-success" />;
        statusText = "Бэкап создан";
        statusClass = "backup-status-success";
        break;
      case 'ERROR':
        statusIcon = <FaExclamationCircle className="backup-status-icon-error" />;
        statusText = "Ошибка бэкапа";
        statusClass = "backup-status-error";
        break;
      default:
        console.log("Неизвестный статус бэкапа:", disk.backupStatus);
        return null;
    }
    
    // Добавляем информацию о времени последнего обновления и сообщение если есть
    const updatedTime = disk.backupUpdatedAt ? new Date(disk.backupUpdatedAt).toLocaleString() : null;
    const hasDetailMessage = disk.backupMessage && disk.backupMessage !== statusText;
    
    return (
      <div className={`backup-status ${statusClass}`} title={hasDetailMessage ? disk.backupMessage : ""}>
        <div className="backup-status-header">
          {statusIcon}
          <span className="backup-status-text">{statusText}</span>
        </div>
        
        {hasDetailMessage && (
          <div className="backup-status-message">
            {disk.backupMessage}
          </div>
        )}
        
        {updatedTime && (
          <div className="backup-status-time">
            <FaClock /> {updatedTime}
          </div>
        )}
      </div>
    );
  };

  return (
    <div 
      className={cardClassName}
      onClick={handleDiskClick}
    >
      <h3>{disk.name}</h3>
      {disk.error ? (
        <div className="disk-error-content">
          <div className="disk-error-icon">
            <FaExclamationTriangle />
          </div>
          <div className="disk-error-message">
            <p className="disk-status-text">Недоступен</p>
            <p className="disk-error-details">{disk.error}</p>
          </div>
          <div className="disk-error-action">
            <FaPlug className="disk-plug-icon" />
          </div>
        </div>
      ) : (
        <>
          <DiskUsageChart 
            used={disk.used} 
            total={disk.total} 
            free={disk.free} 
            userFilesSize={disk.userFilesSize}
          />
          
          {/* Оставляем также прогресс-бар для совместимости */}
          <div className="usage-bar">
            <div 
              className="usage-fill" 
              style={{ 
                width: `${calculateUsagePercent(
                  // Handle NaN/undefined values
                  isNaN(disk.userFilesSize) || disk.userFilesSize === undefined 
                    ? (isNaN(disk.used) ? 0 : disk.used) 
                    : disk.userFilesSize, 
                  isNaN(disk.total) ? 0 : disk.total
                )}%` 
              }}
            ></div>
          </div>
          
          {/* Отображение статуса бэкапа */}
          {renderBackupStatus()}
          
          {/* Кнопка восстановления из бэкапа (только для администратора) */}
          {user && user.isAdmin && (
            <div className="disk-actions">
              <button
                className="restore-backup-btn"
                onClick={handleRestoreBackup}
                title="Восстановить из бэкапа"
              >
                <FaHistory /> Восстановить из бэкапа
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default DiskCard;