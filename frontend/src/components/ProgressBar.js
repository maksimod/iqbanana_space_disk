import React, { useEffect, useState } from 'react';
import './ProgressBar.css';

const ProgressBar = ({ progress }) => {
  // Создаем состояние для анимированного прогресса
  const [displayProgress, setDisplayProgress] = useState(0);
  
  // Плавно анимируем прогресс
  useEffect(() => {
    // Убедимся, что прогресс находится в пределах от 0 до 100
    const safeProgress = Math.min(100, Math.max(0, progress));
    
    // Если разница большая - быстрее догоняем
    const difference = Math.abs(safeProgress - displayProgress);
    const step = difference > 10 ? 2 : 0.5;
    
    if (safeProgress > displayProgress) {
      const timer = setTimeout(() => {
        setDisplayProgress(prev => Math.min(safeProgress, prev + step));
      }, 50);
      return () => clearTimeout(timer);
    } else if (safeProgress < displayProgress) {
      setDisplayProgress(safeProgress); // Сразу сбрасываем, если прогресс уменьшился
    }
  }, [progress, displayProgress]);
  
  return (
    <div className="progress-bar">
      <div 
        className="progress-bar-fill" 
        style={{ width: `${displayProgress}%` }}
      />
      <div className="progress-text">{Math.round(displayProgress)}%</div>
    </div>
  );
};

export default ProgressBar; 