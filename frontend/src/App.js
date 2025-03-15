// App.js
import React from 'react';
import './styles/common.css';
import './styles/disks.css';
import './styles/files.css';
import './styles/animations.css';
import './styles/modal.css';
import Header from './components/Header';
import ErrorMessage from './components/ErrorMessage';
import DisksGrid from './components/DisksView/DisksGrid';
import FilesView from './components/FilesView/FilesView';
import SystemInfo from './components/SystemInfo/SystemInfo';
import ToastContainer from './components/Toast/ToastContainer';
import { AppProvider, useAppContext } from './context/AppContext';
import { ToastProvider } from './context/ToastContext';

// Основной компонент приложения
const AppContent = () => {
  const { currentDisk, error } = useAppContext();
  
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
    </div>
  );
};

// Оборачиваем приложение в провайдеры
function App() {
  return (
    <ToastProvider>
      <AppProvider>
        <AppContent />
      </AppProvider>
    </ToastProvider>
  );
}

export default App;