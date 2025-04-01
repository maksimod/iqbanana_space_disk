import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import '../../styles/auth.css';

const LoginForm = ({ onToggleForm }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState('');
  const { login, loading, error: authError } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');

    if (!username.trim() || !password.trim()) {
      setFormError('Имя пользователя и пароль обязательны');
      return;
    }

    console.log('Attempting login with:', { username, password });
    const result = await login(username, password);
    console.log('Login result:', result);
    
    if (!result.success) {
      setFormError(result.message || 'Ошибка входа');
    }
  };

  return (
    <div className="auth-form-container">
      <h2>Вход в систему</h2>
      <form className="auth-form" onSubmit={handleSubmit}>
        {formError && <div className="auth-error">{formError}</div>}
        
        <div className="form-group">
          <label htmlFor="username">Имя пользователя</label>
          <input
            type="text"
            id="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={loading}
            placeholder="Введите имя пользователя"
            required
          />
        </div>
        
        <div className="form-group">
          <label htmlFor="password">Пароль</label>
          <input
            type="password"
            id="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            placeholder="Введите пароль"
            required
          />
        </div>
        
        <button 
          type="submit" 
          className="auth-button" 
          disabled={loading}
        >
          {loading ? 'Вход...' : 'Войти'}
        </button>
      </form>
      
      <div className="auth-links">
        <span>Нет аккаунта?</span>
        <button 
          className="auth-link-button" 
          onClick={onToggleForm}
          disabled={loading}
        >
          Зарегистрироваться
        </button>
      </div>
    </div>
  );
};

export default LoginForm; 