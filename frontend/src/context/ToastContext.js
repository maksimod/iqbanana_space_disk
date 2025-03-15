import React, { createContext, useContext, useState, useCallback } from 'react';

// Создание контекста
const ToastContext = createContext();

/**
 * Провайдер уведомлений
 */
export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);
  
  // Добавление нового уведомления
  const addToast = useCallback((message, type = 'info', duration = 3000) => {
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