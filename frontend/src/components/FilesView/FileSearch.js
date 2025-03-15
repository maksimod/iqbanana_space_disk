import React, { useState, useEffect } from 'react';
import { FaSearch, FaTimes } from 'react-icons/fa';

/**
 * Компонент для поиска файлов
 */
const FileSearch = ({ files, onSearchResults }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearchActive, setIsSearchActive] = useState(false);
  
  // Выполняем поиск при изменении searchTerm или files
  useEffect(() => {
    if (!searchTerm.trim()) {
      onSearchResults(null);
      return;
    }
    
    const lowerSearchTerm = searchTerm.toLowerCase();
    const results = files.filter(file => 
      file.name.toLowerCase().includes(lowerSearchTerm)
    );
    
    onSearchResults(results);
  }, [searchTerm, files, onSearchResults]);
  
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
    onSearchResults(null);
  };
  
  return (
    <div className="file-search">
      <div className="search-input-container">
        <FaSearch className="search-icon" />
        <input
          type="text"
          className="search-input"
          placeholder="Найти файлы..."
          value={searchTerm}
          onChange={handleSearchChange}
        />
        {isSearchActive && (
          <button
            className="clear-search-button"
            onClick={clearSearch}
            title="Очистить поиск"
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