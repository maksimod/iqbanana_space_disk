import React from 'react';
import { formatFileSize, calculateUsagePercent } from '../../utils/formatters';

/**
 * Компонент для визуализации использования диска в виде круговой диаграммы
 */
const DiskUsageChart = ({ used, total, free }) => {
  // Рассчитываем угол для заполненной части
  const usedPercent = calculateUsagePercent(used, total);
  const angle = (usedPercent / 100) * 360;

  // Явно форматируем размеры здесь
  const formattedTotal = formatFileSize(total);
  const formattedUsed = formatFileSize(used);
  const formattedFree = formatFileSize(free);

  // Цвета для диаграммы в зависимости от заполненности
  const getChartColor = (percent) => {
    if (percent < 70) return '#3498db'; // синий
    if (percent < 90) return '#f39c12'; // оранжевый
    return '#e74c3c'; // красный
  };
  
  // Рассчитываем координаты для создания дуги
  const getCoordinatesForPercent = (percent) => {
    const x = Math.cos(2 * Math.PI * percent);
    const y = Math.sin(2 * Math.PI * percent);
    return [x, y];
  };
  
  const [startX, startY] = getCoordinatesForPercent(0);
  const [endX, endY] = getCoordinatesForPercent(usedPercent / 100);
  
  // Флаг для отображения большой дуги (используется, если заполнено больше 50%)
  const largeArcFlag = usedPercent > 50 ? 1 : 0;
  
  // Создаем SVG-путь для дуги
  const pathData = [
    `M 0 0`,
    `L ${startX} ${startY}`,
    `A 1 1 0 ${largeArcFlag} 1 ${endX} ${endY}`,
    `Z`
  ].join(' ');
  
  return (
    <div className="disk-usage-chart">
      <svg viewBox="-1.2 -1.2 2.4 2.4" className="chart">
        {/* Фоновый круг (серый) */}
        <circle cx="0" cy="0" r="1" fill="#e9ecef" />
        
        {/* Заполненная часть */}
        <path d={pathData} fill={getChartColor(usedPercent)} />
        
        {/* Внутренний белый круг для создания кольца */}
        <circle cx="0" cy="0" r="0.65" fill="white" />
        
        {/* Текст с процентом использования */}
        <text x="0" y="0" textAnchor="middle" dominantBaseline="middle" 
              fontSize="0.3" fontWeight="bold" fill="#2c3e50">
          {Math.round(usedPercent)}%
        </text>
      </svg>
      
      <div className="usage-details">
        <div className="usage-detail">
          <span className="label">Всего:</span>
          <span className="value">{formattedTotal}</span>
        </div>
        <div className="usage-detail">
          <span className="label">Занято:</span>
          <span className="value">{formattedUsed}</span>
        </div>
        <div className="usage-detail">
          <span className="label">Свободно:</span>
          <span className="value">{formattedFree}</span>
        </div>
      </div>
    </div>
  );
};

export default DiskUsageChart;