// frontend/src/components/DisksView/DiskCard.js
import React from 'react';
import { formatFileSize, calculateUsagePercent } from '../../utils/formatters';
import { FaExclamationTriangle, FaPlug, FaExclamationCircle } from 'react-icons/fa';
import DiskUsageChart from './DiskUsageChart';

const DiskCard = ({ disk, onSelect }) => {
  // Determine if disk is in error state and create a CSS class for it
  const cardClassName = `disk-card ${disk.error ? 'disk-card-error' : ''}`;

  return (
    <div 
      className={cardClassName}
      onClick={() => onSelect(disk.name)}
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
          />
          
          {/* Оставляем также прогресс-бар для совместимости */}
          <div className="usage-bar">
            <div 
              className="usage-fill" 
              style={{ width: `${calculateUsagePercent(disk.used, disk.total)}%` }}
            ></div>
          </div>
          
          {/* Убираем дублирующий блок с размерами, если он есть */}
        </>
      )}
    </div>
  );
};

export default DiskCard;