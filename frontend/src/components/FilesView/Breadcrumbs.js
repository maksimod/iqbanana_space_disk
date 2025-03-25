import React from 'react';
import { FaHome, FaChevronRight } from 'react-icons/fa';

/**
 * Компонент для отображения ветки пути (breadcrumbs)
 */
const Breadcrumbs = ({ disk, path, onNavigate }) => {
  // Парсим путь в массив сегментов
  const pathSegments = path ? path.split('/').filter(segment => segment !== '') : [];
  
  // Функция для генерации пути до определенного сегмента
  const getPathToSegment = (index) => {
    return pathSegments.slice(0, index + 1).join('/');
  };
  
  // Обработчик клика по сегменту пути
  const handleSegmentClick = (index) => {
    const pathToSegment = getPathToSegment(index);
    onNavigate(pathToSegment);
  };
  
  // Обработчик клика по корневой директории
  const handleRootClick = () => {
    onNavigate('');
  };
  
  return (
    <div className="breadcrumbs">
      <div className="breadcrumb-item" onClick={handleRootClick}>
        <FaHome className="home-icon" />
        <span className="disk-name">{disk}</span>
      </div>
      
      {pathSegments.map((segment, index) => (
        <React.Fragment key={index}>
          <FaChevronRight className="breadcrumb-separator" />
          <div 
            className="breadcrumb-item" 
            onClick={() => handleSegmentClick(index)}
          >
            {segment}
          </div>
        </React.Fragment>
      ))}
    </div>
  );
};

export default Breadcrumbs;