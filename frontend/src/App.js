// App.js
import React from 'react';
import './styles/common.css';
import './styles/disks.css';
import './styles/files.css';
import './styles/animations.css';
import './styles/modal.css';
import './styles/auth.css';
import Header from './components/Header';
import ErrorMessage from './components/ErrorMessage';
import DisksGrid from './components/DisksView/DisksGrid';
import FilesView from './components/FilesView/FilesView';
import SystemInfo from './components/SystemInfo/SystemInfo';
import ToastContainer from './components/Toast/ToastContainer';
import AuthPage from './components/Auth/AuthPage';
import RestoreBackupModal from './components/RestoreBackupModal/RestoreBackupModal';
import { AppProvider, useAppContext } from './context/AppContext';
import { ToastProvider } from './context/ToastContext';
import { AuthProvider, useAuth } from './context/AuthContext';

// Основной компонент приложения с проверкой авторизации
const AppContent = () => {
  const { currentDisk, error } = useAppContext();
  const { user, loading, initialized } = useAuth();
  
  // Показываем загрузку при инициализации
  if (!initialized || loading) {
    return (
      <div className="app-loading">
        <div className="loading-spinner"></div>
        <p>Загрузка...</p>
      </div>
    );
  }
  
  // Если пользователь не аутентифицирован, показываем страницу входа
  if (!user) {
    return <AuthPage />;
  }
  
  return (
    <div className="App">
      <Header title="Файловый менеджер" />
      
      <ErrorMessage message={error} />
      
      {!currentDisk ? (
        <>
          <DisksGrid />
          <SystemInfo />
        </>
      ) : (
        <FilesView />
      )}
      
      <ToastContainer />
      
      {/* Добавляем модальное окно восстановления из бэкапа */}
      <RestoreBackupModal />
    </div>
  );
};

// Оборачиваем приложение в провайдеры
function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <AppProvider>
          <AppContent />
        </AppProvider>
      </AuthProvider>
    </ToastProvider>
  );
}

export default App;