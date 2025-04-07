import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import '../../styles/auth.css';

const LoginForm = ({ onToggleForm }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { login, loading, error: authError } = useAuth();

  // Слушаем изменения ошибок авторизации
  useEffect(() => {
    if (authError) {
      setFormError(authError);
    }
  }, [authError]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Предотвращаем множественные отправки формы
    if (isSubmitting || loading) {
      return;
    }
    
    setFormError('');
    setIsSubmitting(true);

    try {
      if (!username.trim() || !password.trim()) {
        setFormError('Имя пользователя и пароль обязательны');
        setIsSubmitting(false);
        return;
      }

      console.log('Attempting login with:', { username });
      
      // Добавляем небольшую задержку для лучшей обработки запросов
      await new Promise(resolve => setTimeout(resolve, 300));
      
      const result = await login(username, password);
      console.log('Login result:', result);
      
      if (!result.success) {
        let errorMessage = result.message || 'Ошибка входа';
        
        // Обрабатываем различные типы ошибок
        if (result.message?.includes('сервер') || 
            result.message?.includes('соединения') || 
            result.message?.includes('доступен') || 
            result.message?.includes('time')) {
          // Серверные ошибки
          errorMessage = `${result.message}. Пожалуйста, проверьте подключение к интернету или повторите позже.`;
        } else if (result.message?.includes('пароль') || 
                  result.message?.includes('Не найден') ||
                  result.message?.includes('Неверн')) {
          // Ошибки аутентификации
          errorMessage = result.message;
        }
        
        setFormError(errorMessage);
      }
    } catch (error) {
      console.error('Ошибка при попытке входа:', error);
      setFormError('Произошла ошибка при попытке входа. Пожалуйста, попробуйте позже.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Определяем состояние кнопки и текст
  const buttonText = isSubmitting || loading ? 'Вход...' : 'Войти';
  const isButtonDisabled = isSubmitting || loading;

  return (
    <div className="auth-form-container">
      <h2>Вход в систему</h2>
      <form className="auth-form" onSubmit={handleSubmit}>
        {formError && (
          <div className="auth-error">
            {formError}
            {(formError.includes('сервер') || 
              formError.includes('соединения') || 
              formError.includes('подключение') || 
              formError.includes('доступен')) && (
              <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'center' }}>
                <button 
                  onClick={() => window.location.reload()} 
                  className="reload-button"
                  type="button"
                  style={{ 
                    padding: '8px 15px',
                    background: '#2980b9',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  Перезагрузить страницу
                </button>
              </div>
            )}
          </div>
        )}
        
        <div className="form-group">
          <label htmlFor="username">Имя пользователя</label>
          <input
            type="text"
            id="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={isButtonDisabled}
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
            disabled={isButtonDisabled}
            placeholder="Введите пароль"
            required
          />
        </div>
        
        <button 
          type="submit" 
          className="auth-button" 
          disabled={isButtonDisabled}
        >
          {buttonText}
        </button>
      </form>
      
      <div className="auth-links">
        <span>Нет аккаунта?</span>
        <button 
          className="auth-link-button" 
          onClick={onToggleForm}
          disabled={isButtonDisabled}
        >
          Зарегистрироваться
        </button>
      </div>
    </div>
  );
};

export default LoginForm; 