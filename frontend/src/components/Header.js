import React from 'react';
import { useAuth } from '../context/AuthContext';

const Header = ({ title }) => {
  const { user, logout } = useAuth();
  
  return (
    <header className="App-header">
      <h1>{title}</h1>
      
      {user && (
        <div className="user-info">
          <span>{user.username}</span>
          <button 
            className="logout-button" 
            onClick={logout}
            title="Выйти из системы"
          >
            Выйти
          </button>
        </div>
      )}
    </header>
  );
};

export default Header;