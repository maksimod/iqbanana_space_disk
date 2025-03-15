import React, { useState, useEffect } from 'react';
import { FaServer, FaMemory, FaInfoCircle, FaHdd } from 'react-icons/fa';
import { formatFileSize } from '../../utils/formatters';
import './systemInfo.css';

const SystemInfo = () => {
  const [systemInfo, setSystemInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(false);
  
  useEffect(() => {
    const fetchSystemInfo = async () => {
      try {
        const response = await fetch('/api/v1/system/info');
        if (!response.ok) {
          throw new Error('Не удалось получить информацию о системе');
        }
        const data = await response.json();
        setSystemInfo(data);
      } catch (err) {
        console.error('Ошибка при загрузке системной информации:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    
    fetchSystemInfo();
  }, []);
  
  const toggleExpanded = () => {
    setExpanded(!expanded);
  };
  
  if (loading) {
    return <div className="system-info-loading">Загрузка информации о системе...</div>;
  }
  
  if (error) {
    return <div className="system-info-error">{error}</div>;
  }
  
  if (!systemInfo) {
    return null;
  }
  
  // Форматирование времени работы в часы:минуты:секунды
  const formatUptime = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };
  
  // Процент использования памяти
  const memoryUsagePercent = Math.round(
    ((systemInfo.system.totalMemory - systemInfo.system.freeMemory) / systemInfo.system.totalMemory) * 100
  );
  
  return (
    <div className={`system-info ${expanded ? 'expanded' : 'collapsed'}`}>
      <div className="system-info-header" onClick={toggleExpanded}>
        <FaInfoCircle className="system-info-icon" />
        <span>Информация о системе</span>
        <span className="system-info-toggle">{expanded ? '▲' : '▼'}</span>
      </div>
      
      {expanded && (
        <div className="system-info-content">
          <div className="system-info-section">
            <h4>
              <FaServer className="section-icon" />
              Сервер
            </h4>
            <div className="info-grid">
              <div className="info-item">
                <span className="info-label">Версия:</span>
                <span className="info-value">{systemInfo.server.version}</span>
              </div>
              <div className="info-item">
                <span className="info-label">API:</span>
                <span className="info-value">{systemInfo.server.apiVersion}</span>
              </div>
              <div className="info-item">
                <span className="info-label">Время работы:</span>
                <span className="info-value">{formatUptime(systemInfo.server.uptime)}</span>
              </div>
            </div>
          </div>
          
          <div className="system-info-section">
            <h4>
              <FaMemory className="section-icon" />
              Система
            </h4>
            <div className="info-grid">
              <div className="info-item">
                <span className="info-label">Платформа:</span>
                <span className="info-value">{systemInfo.system.platform} ({systemInfo.system.type})</span>
              </div>
              <div className="info-item">
                <span className="info-label">Ядра CPU:</span>
                <span className="info-value">{systemInfo.system.cpus}</span>
              </div>
              <div className="info-item">
                <span className="info-label">Память:</span>
                <span className="info-value">
                  {formatFileSize(systemInfo.system.totalMemory - systemInfo.system.freeMemory)} / {formatFileSize(systemInfo.system.totalMemory)} ({memoryUsagePercent}%)
                </span>
              </div>
              <div className="info-item">
                <span className="info-label">Хост:</span>
                <span className="info-value">{systemInfo.system.hostname}</span>
              </div>
            </div>
          </div>
          
          <div className="system-info-section">
            <h4>
              <FaHdd className="section-icon" />
              Диски
            </h4>
            <div className="disk-mount-list">
              {systemInfo.disks.map((disk, index) => (
                <div key={index} className="disk-mount-item">
                  <span className="disk-name">{disk.name}</span>
                  <span className="disk-mount">{disk.mountPoint}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SystemInfo;