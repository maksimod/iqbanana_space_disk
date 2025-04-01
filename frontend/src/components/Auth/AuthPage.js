import React, { useState, useEffect } from 'react';
import LoginForm from './LoginForm';
import RegisterForm from './RegisterForm';
import '../../styles/auth.css';
import { useAuth } from '../../context/AuthContext';

const AuthPage = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [statusMessage, setStatusMessage] = useState('');
  const { error } = useAuth();

  const toggleForm = () => {
    setIsLogin(!isLogin);
    setStatusMessage('');
  };

  useEffect(() => {
    if (error) {
      setStatusMessage(error);
    }
  }, [error]);

  return (
    <div className="auth-page">
      <div className="auth-container">
        <div className="auth-logo">
          <h1>Файловый менеджер</h1>
          <p>Войдите в систему для доступа к хранилищу</p>
          
          {statusMessage && (
            <div className="auth-status-message">
              {statusMessage}
            </div>
          )}
        </div>
        
        {isLogin ? (
          <LoginForm onToggleForm={toggleForm} />
        ) : (
          <RegisterForm onToggleForm={toggleForm} />
        )}
      </div>
    </div>
  );
};

export default AuthPage; 