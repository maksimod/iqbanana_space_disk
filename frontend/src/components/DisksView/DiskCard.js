// frontend/src/components/DisksView/DiskCard.js
import React from 'react';
import { formatFileSize, calculateUsagePercent } from '../../utils/formatters';
import { FaExclamationTriangle, FaPlug, FaExclamationCircle } from 'react-icons/fa';
import DiskUsageChart from './DiskUsageChart';
import { useToast } from '../../context/ToastContext';

const DiskCard = ({ disk, onSelect }) => {
  // Use toast context for showing warnings
  const toast = useToast();
  
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
          
          {/* Убираем дублирующий блок с размерами, если он есть */}
        </>
      )}
    </div>
  );
};

export default DiskCard;