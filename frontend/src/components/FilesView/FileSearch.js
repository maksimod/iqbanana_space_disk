import React, { useState, useEffect } from 'react';
import { FaSearch, FaTimes } from 'react-icons/fa';

/**
 * Компонент для поиска файлов
 */
const FileSearch = ({ files, onSearch, onClearSearch }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearchActive, setIsSearchActive] = useState(false);
  
  // Выполняем поиск при изменении searchTerm или files
  useEffect(() => {
    if (!searchTerm.trim()) {
      if (onClearSearch) {
        onClearSearch();
      } else if (onSearch) {
        onSearch(null);
      }
      return;
    }
    
    if (!files || !onSearch) return;

    const lowerSearchTerm = searchTerm.toLowerCase();
    
    // Фильтруем файлы с учетом исключения служебных файлов
    const results = files.filter(file => 
      file.name.toLowerCase().includes(lowerSearchTerm) && 
      !file.name.includes('.tmp_chunks') && 
      file.name !== '.disk_uuid'
    );
    
    onSearch(results);
  }, [searchTerm, files, onSearch, onClearSearch]);
  
  // Обработчик изменения поисковой фразы
  const handleSearchChange = (e) => {
    setSearchTerm(e.target.value);
    if (e.target.value.trim()) {
      setIsSearchActive(true);
    } else {
      setIsSearchActive(false);
    }
  };
  
  // Очистка поиска
  const clearSearch = () => {
    setSearchTerm('');
    setIsSearchActive(false);
    if (onClearSearch) {
      onClearSearch();
    } else if (onSearch) {
      onSearch(null);
    }
  };
  
  return (
    <div className="file-search">
      <div className="search-input-container" style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <FaSearch className="search-icon" style={{ position: 'absolute', left: '10px', zIndex: 1 }} />
        <input
          type="text"
          className="search-input"
          placeholder="Найти файлы..."
          value={searchTerm}
          onChange={handleSearchChange}
          style={{ paddingLeft: '35px', width: '100%' }}
        />
        {isSearchActive && (
          <button
            className="clear-search-button"
            onClick={clearSearch}
            title="Очистить поиск"
            style={{ position: 'absolute', right: '10px', zIndex: 1, background: 'none', border: 'none', cursor: 'pointer' }}
          >
            <FaTimes />
          </button>
        )}
      </div>
      {isSearchActive && (
        <div className="search-status">
          Поиск по: <strong>{searchTerm}</strong>
        </div>
      )}
    </div>
  );
};

export default FileSearch;