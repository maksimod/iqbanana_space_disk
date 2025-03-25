import React from 'react';
import { FaArrowLeft } from 'react-icons/fa';
import Breadcrumbs from './Breadcrumbs';
import { useAppContext } from '../../context/AppContext';

const NavigationBar = ({ currentDisk, currentPath, onBack }) => {
  const { setCurrentPath } = useAppContext();
  
  // Обработчик навигации по breadcrumbs
  const handleBreadcrumbNavigate = (path) => {
    setCurrentPath(path);
  };
  
  return (
    <div className="navigation-bar">
      <button className="nav-button" onClick={onBack}>
        <FaArrowLeft /> Назад
      </button>
      
      {/* Классический путь (скрыт при использовании breadcrumbs) */}
      <div className="current-path">
        <strong>{currentDisk}:</strong> {currentPath || '/'}
      </div>
      
      {/* Интерактивная ветка пути */}
      <Breadcrumbs 
        disk={currentDisk} 
        path={currentPath} 
        onNavigate={handleBreadcrumbNavigate} 
      />
    </div>
  );
};

export default NavigationBar;