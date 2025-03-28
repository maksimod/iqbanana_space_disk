import React, { createContext, useContext, useState, useEffect } from 'react';
import { API_BASE_URL } from '../utils/constants';

// Создаем контекст аутентификации
const AuthContext = createContext();

// Провайдер контекста аутентификации
export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [initialized, setInitialized] = useState(false);

  // Отладочная функция для логирования
  const logDebug = (message, data) => {
    console.log(`[AuthContext] ${message}`, data || '');
  };

  // Проверяем статус аутентификации при загрузке
  useEffect(() => {
    const checkAuth = async () => {
      setLoading(true);
      try {
        const token = localStorage.getItem('token');
        logDebug('Checking token:', token ? 'Token exists' : 'No token found');
        
        if (!token) {
          setUser(null);
          setLoading(false);
          setInitialized(true);
          return;
        }

        const response = await fetch(`${API_BASE_URL}/auth/check`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        const data = await response.json();
        logDebug('Auth check response:', data);
        
        if (response.ok && data.success) {
          logDebug('User authenticated:', data.user);
          setUser(data.user);
        } else {
          logDebug('Auth check failed:', data.message || 'Unknown error');
          // Токен недействителен - очищаем локальное хранилище
          localStorage.removeItem('token');
          setUser(null);
          setError(data.message || 'Ошибка аутентификации');
        }
      } catch (err) {
        console.error('Ошибка проверки аутентификации:', err);
        setError('Ошибка проверки статуса аутентификации');
        setUser(null);
      } finally {
        setLoading(false);
        setInitialized(true);
      }
    };

    checkAuth();
  }, []);

  // Регистрация нового пользователя
  const register = async (username, password) => {
    setLoading(true);
    setError(null);
    try {
      logDebug('Sending registration request:', { username });
      
      const response = await fetch(`${API_BASE_URL}/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, password })
      });

      const data = await response.json();
      logDebug('Registration response:', data);

      if (response.ok && data.success) {
        // Убедимся, что токен присутствует и валиден
        if (data.user && data.user.token) {
          localStorage.setItem('token', data.user.token);
          setUser(data.user);
          return { success: true };
        } else {
          setError('Токен не получен от сервера');
          return { success: false, message: 'Токен не получен от сервера' };
        }
      } else {
        setError(data.message || 'Ошибка регистрации');
        return { success: false, message: data.message || 'Ошибка регистрации' };
      }
    } catch (err) {
      console.error('Ошибка регистрации:', err);
      setError('Ошибка соединения с сервером');
      return { success: false, message: 'Ошибка соединения с сервером' };
    } finally {
      setLoading(false);
    }
  };

  // Вход в систему
  const login = async (username, password) => {
    setLoading(true);
    setError(null);
    try {
      logDebug('Sending login request:', { username });
      
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, password })
      });

      const data = await response.json();
      logDebug('Login response:', data);

      if (response.ok && data.success) {
        // Убедимся, что токен присутствует и валиден
        if (data.user && data.user.token) {
          localStorage.setItem('token', data.user.token);
          setUser(data.user);
          return { success: true };
        } else {
          setError('Токен не получен от сервера');
          return { success: false, message: 'Токен не получен от сервера' };
        }
      } else {
        setError(data.message || 'Ошибка входа');
        return { success: false, message: data.message || 'Ошибка входа' };
      }
    } catch (err) {
      console.error('Ошибка входа:', err);
      setError('Ошибка соединения с сервером');
      return { success: false, message: 'Ошибка соединения с сервером' };
    } finally {
      setLoading(false);
    }
  };

  // Выход из системы
  const logout = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      if (token) {
        logDebug('Sending logout request');
        
        await fetch(`${API_BASE_URL}/auth/logout`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
      }
    } catch (err) {
      console.error('Ошибка выхода:', err);
    } finally {
      localStorage.removeItem('token');
      setUser(null);
      setLoading(false);
      logDebug('Logged out successfully');
    }
  };

  // Получение токена для использования в запросах
  const getAuthHeaders = () => {
    const token = localStorage.getItem('token');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  };

  // Значение контекста
  const value = {
    user,
    loading,
    error,
    initialized,
    register,
    login,
    logout,
    getAuthHeaders
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// Хук для использования контекста аутентификации
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth должен использоваться внутри AuthProvider');
  }
  return context;
}; 