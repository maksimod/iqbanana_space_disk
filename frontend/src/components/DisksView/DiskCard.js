import React from 'react';
import { formatFileSize, calculateUsagePercent } from '../../utils/formatters';
import DiskUsageChart from './DiskUsageChart';

const DiskCard = ({ disk, onSelect }) => {
  return (
    <div 
      className="disk-card" 
      onClick={() => onSelect(disk.name)}
    >
      <h3>{disk.name}</h3>
      {disk.error ? (
        <p className="error-text">{disk.error}</p>
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
        </>
      )}
    </div>
  );
};

export default DiskCard;