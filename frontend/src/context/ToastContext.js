import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

// Создание контекста
const ToastContext = createContext();

/**
 * Провайдер уведомлений
 */
export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);
  
  // Используем ref для отслеживания недавних уведомлений, 
  // чтобы предотвратить дубликаты
  const recentToasts = useRef(new Map());
  
  // Добавление нового уведомления
  const addToast = useCallback((message, type = 'info', duration = 3000) => {
    // Создаем уникальный ключ для проверки дубликатов
    const toastKey = `${type}:${message}`;
    
    // Проверяем, было ли такое же уведомление недавно
    const lastShown = recentToasts.current.get(toastKey);
    const now = Date.now();
    
    // Если такое же уведомление было показано менее 2 секунд назад, игнорируем
    if (lastShown && (now - lastShown) < 2000) {
      console.log('Предотвращение дублирующегося уведомления:', message);
      return null;
    }
    
    // Запоминаем время показа этого уведомления
    recentToasts.current.set(toastKey, now);
    
    // Удаляем старые записи (старше 10 секунд)
    recentToasts.current.forEach((timestamp, key) => {
      if (now - timestamp > 10000) {
        recentToasts.current.delete(key);
      }
    });
    
    const id = Date.now();
    
    // Добавляем новое уведомление
    setToasts(prevToasts => [...prevToasts, { id, message, type }]);
    
    // Удаляем уведомление через указанный промежуток времени
    setTimeout(() => {
      removeToast(id);
    }, duration);
    
    return id;
  }, []);
  
  // Удаление уведомления
  const removeToast = useCallback((id) => {
    setToasts(prevToasts => prevToasts.filter(toast => toast.id !== id));
  }, []);
  
  // Информационное уведомление
  const showInfo = useCallback((message, duration) => {
    return addToast(message, 'info', duration);
  }, [addToast]);
  
  // Уведомление об успехе
  const showSuccess = useCallback((message, duration) => {
    return addToast(message, 'success', duration);
  }, [addToast]);
  
  // Уведомление о предупреждении
  const showWarning = useCallback((message, duration) => {
    return addToast(message, 'warning', duration);
  }, [addToast]);
  
  // Уведомление об ошибке
  const showError = useCallback((message, duration) => {
    return addToast(message, 'error', duration);
  }, [addToast]);
  
  return (
    <ToastContext.Provider
      value={{
        toasts,
        addToast,
        removeToast,
        showInfo,
        showSuccess,
        showWarning,
        showError
      }}
    >
      {children}
    </ToastContext.Provider>
  );
};

/**
 * Хук для использования системы уведомлений
 */
export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast должен использоваться внутри ToastProvider');
  }
  return context;
};