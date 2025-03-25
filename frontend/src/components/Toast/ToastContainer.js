import React from 'react';
import { FaInfoCircle, FaCheckCircle, FaExclamationTriangle, FaTimesCircle, FaTimes } from 'react-icons/fa';
import { useToast } from '../../context/ToastContext';
import './toast.css';

/**
 * Компонент для отдельного уведомления
 */
const Toast = ({ toast, onClose }) => {
  const { id, message, type } = toast;
  
  // Определяем иконку в зависимости от типа уведомления
  const getIcon = () => {
    switch (type) {
      case 'success':
        return <FaCheckCircle className="toast-icon" />;
      case 'warning':
        return <FaExclamationTriangle className="toast-icon" />;
      case 'error':
        return <FaTimesCircle className="toast-icon" />;
      case 'info':
      default:
        return <FaInfoCircle className="toast-icon" />;
    }
  };
  
  return (
    <div className={`toast toast-${type}`}>
      <div className="toast-content">
        {getIcon()}
        <span className="toast-message">{message}</span>
      </div>
      <button className="toast-close" onClick={() => onClose(id)}>
        <FaTimes />
      </button>
    </div>
  );
};

/**
 * Контейнер для всех уведомлений
 */
const ToastContainer = () => {
  const { toasts, removeToast } = useToast();
  
  if (toasts.length === 0) return null;
  
  return (
    <div className="toast-container">
      {toasts.map(toast => (
        <Toast 
          key={toast.id}
          toast={toast}
          onClose={removeToast}
        />
      ))}
    </div>
  );
};

export default ToastContainer;