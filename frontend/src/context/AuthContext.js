import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { API_BASE_URL } from '../utils/constants';

// Создаем контекст аутентификации
const AuthContext = createContext();

// Провайдер контекста аутентификации
export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [initialized, setInitialized] = useState(false);
  // Флаг для отслеживания текущей попытки авторизации
  const isAuthenticating = useRef(false);
  // Добавляем счетчик последовательных ошибок
  const consecutiveErrors = useRef(0);

  // Отладочная функция для логирования
  const logDebug = (message, data) => {
    console.log(`[AuthContext] ${message}`, data || '');
  };

  // Функция для проверки доступности сервера перед запросом
  const checkServerAvailability = async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      
      // Используем корневой API эндпоинт вместо несуществующего /health
      const response = await fetch(`${API_BASE_URL}`, { 
        method: 'GET',
        signal: controller.signal 
      });
      clearTimeout(timeoutId);
      
      // Даже если ответ 404, это означает что сервер работает
      return response.status < 500;
    } catch (err) {
      console.warn('Сервер недоступен:', err);
      return false;
    }
  };
  
  // Получение сохраненного токена
  const getStoredToken = () => {
    try {
      return localStorage.getItem('token');
    } catch (e) {
      console.error('Ошибка при чтении токена из localStorage:', e);
      return null;
    }
  };

  // Проверяем статус аутентификации при загрузке
  useEffect(() => {
    // Вспомогательная функция для паузы
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    
    const checkAuth = async (retryCount = 0, maxRetries = 3) => {
      // Если инициализация уже завершена, пропускаем повторную проверку
      if (initialized) {
        logDebug('Аутентификация уже инициализирована, пропускаем проверку');
        return;
      }
      
      // Предотвращаем множественные вызовы
      if (isAuthenticating.current) {
        logDebug('Проверка аутентификации уже выполняется, пропускаем запрос');
        return;
      }
      
      isAuthenticating.current = true;
      setLoading(true);
      
      try {
        const token = getStoredToken();
        logDebug('Checking token:', token ? 'Token exists' : 'No token found');
        
        if (!token) {
          setUser(null);
          setLoading(false);
          setInitialized(true);
          isAuthenticating.current = false;
          return;
        }

        // Проверка доступности сервера перед запросом
        const isServerAvailable = await checkServerAvailability();
        if (!isServerAvailable) {
          // Если сервер недоступен, пробуем позже
          if (retryCount < maxRetries) {
            logDebug(`Сервер недоступен, повторная попытка ${retryCount + 1}/${maxRetries}`);
            isAuthenticating.current = false;
            // Увеличиваем интервал с каждой попыткой
            setTimeout(() => checkAuth(retryCount + 1, maxRetries), 1500 * (retryCount + 1));
            return;
          } else {
            // Если сервер недоступен после всех попыток, считаем что у нас есть локальная сессия
            logDebug('Сервер недоступен, считаем что пользователь авторизован по сохраненному токену');
            // Используем минимальные данные пользователя только для UI
            const minimumUserData = { id: 'offline', username: 'Пользователь' };
            setUser(minimumUserData);
            setError('Сервер временно недоступен, работа в офлайн режиме');
            setLoading(false);
            setInitialized(true);
            isAuthenticating.current = false;
            return;
          }
        }

        // Добавляем небольшую задержку для уменьшения нагрузки
        await delay(300);
        
        try {
          const response = await fetch(`${API_BASE_URL}/auth/check`, {
            headers: {
              'Authorization': `Bearer ${token}`
            },
            // Устанавливаем таймаут для fetch запроса
            signal: AbortSignal.timeout(10000)
          });

          const data = await response.json();
          logDebug('Auth check response:', data);
          
          if (response.ok && data.success) {
            logDebug('User authenticated:', data.user);
            consecutiveErrors.current = 0; // Сбрасываем счетчик ошибок
            setUser(data.user);
            setError(null);
            setLoading(false);
            setInitialized(true);
          } else if (retryCount < maxRetries) {
            // Попробуем повторить через увеличенную паузу
            logDebug(`Auth check retry ${retryCount + 1}/${maxRetries}`);
            isAuthenticating.current = false;
            // Увеличиваем интервал с каждой попыткой
            setTimeout(() => checkAuth(retryCount + 1, maxRetries), 1500 * (retryCount + 1));
            return;
          } else {
            logDebug('Auth check failed:', data.message || 'Unknown error');
            // Токен недействителен - очищаем локальное хранилище
            localStorage.removeItem('token');
            setUser(null);
            setError(data.message || 'Ошибка аутентификации');
            setLoading(false);
            setInitialized(true);
          }
        } catch (responseError) {
          // Ошибка при обработке ответа
          if (retryCount < maxRetries) {
            logDebug(`Auth check retry ${retryCount + 1}/${maxRetries} после ошибки ответа`);
            isAuthenticating.current = false;
            setTimeout(() => checkAuth(retryCount + 1, maxRetries), 1500 * (retryCount + 1));
            return;
          } else {
            throw responseError;
          }
        }
      } catch (err) {
        if (retryCount < maxRetries) {
          // Попробуем повторить через увеличенную паузу при ошибке соединения
          logDebug(`Auth check retry ${retryCount + 1}/${maxRetries} after error: ${err.message}`);
          isAuthenticating.current = false;
          // Увеличиваем интервал с каждой попыткой
          setTimeout(() => checkAuth(retryCount + 1, maxRetries), 1500 * (retryCount + 1));
          return;
        }
        
        // Если произошла финальная ошибка
        console.error('Ошибка проверки аутентификации:', err);
        consecutiveErrors.current++; // Увеличиваем счетчик ошибок
        
        // Если это первая серия ошибок, мы все еще пытаемся показать интерфейс пользователя
        if (consecutiveErrors.current <= 3) {
          setError('Ошибка проверки статуса аутентификации, но вы можете продолжать работу');
          
          // Если у нас уже есть сохраненный токен, используем минимальные данные для UI
          if (getStoredToken()) {
            const minimumUserData = { id: 'error_fallback', username: 'Пользователь' };
            setUser(minimumUserData);
          } else {
            setUser(null);
          }
        } else {
          // После нескольких последовательных ошибок, возможно, токен недействителен
          setError('Проблемы с авторизацией, требуется повторный вход');
          localStorage.removeItem('token');
          setUser(null);
        }
      } finally {
        // Убедимся, что состояние загрузки сбрасывается только если еще не было сброшено
        if ((retryCount >= maxRetries || !getStoredToken()) && loading) {
          setLoading(false);
          setInitialized(true);
        }
        isAuthenticating.current = false;
      }
    };

    checkAuth();
    
    // Проверяем авторизацию каждые 10 минут
    const authCheckInterval = setInterval(() => {
      // Только если уже успешно авторизованы
      if (initialized && user && !isAuthenticating.current) {
        checkAuth();
      }
    }, 10 * 60 * 1000);
    
    return () => {
      clearInterval(authCheckInterval);
    };
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

  // Вход в систему с предварительной проверкой доступности сервера
  const login = async (username, password) => {
    // Предотвращаем множественные вызовы
    if (isAuthenticating.current) {
      logDebug('Процесс входа уже запущен, пропускаем запрос');
      return { success: false, message: 'Выполняется предыдущий запрос авторизации' };
    }
    
    isAuthenticating.current = true;
    setLoading(true);
    setError(null);
    
    try {
      // Сначала проверим доступность сервера, но не будем прерывать операцию,
      // если сервер недоступен - просто продолжим попытку входа
      const isServerAvailable = await checkServerAvailability();
      if (!isServerAvailable) {
        console.warn('Сервер может быть недоступен, но продолжаем попытку входа');
      }
      
      logDebug('Sending login request:', { username });
      
      // Создаем AbortController для таймаута запроса
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, password }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      const data = await response.json();
      logDebug('Login response:', data);

      if (response.ok && data.success) {
        // Сбрасываем счетчик последовательных ошибок
        consecutiveErrors.current = 0;
        
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
      if (err.name === 'AbortError') {
        setError('Истекло время ожидания ответа от сервера');
        return { success: false, message: 'Истекло время ожидания ответа от сервера' };
      } else {
        setError('Ошибка соединения с сервером');
        return { success: false, message: 'Ошибка соединения с сервером' };
      }
    } finally {
      setLoading(false);
      isAuthenticating.current = false;
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
    getAuthHeaders,
    token: localStorage.getItem('token')
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