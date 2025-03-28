import React from 'react';
import './ProgressBar.css';

const ProgressBar = ({ progress }) => {
  // Убедимся, что прогресс находится в пределах от 0 до 100
  const safeProgress = Math.min(100, Math.max(0, progress));
  
  return (
    <div className="progress-bar">
      <div 
        className="progress-bar-fill" 
        style={{ width: `${safeProgress}%` }}
      />
    </div>
  );
};

export default ProgressBar; 