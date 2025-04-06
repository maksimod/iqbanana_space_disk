import React, { useState, useEffect } from 'react';
import { 
  Modal, 
  Button, 
  Select, 
  message, 
  List, 
  Spin, 
  Typography, 
  Space, 
  Alert 
} from 'antd';
import { BackupOutlined, WarningOutlined, LoadingOutlined } from '@ant-design/icons';
import axios from 'axios';
import { API_BASE_URL } from '../../config';
import './RestoreBackupModal.css';

const { Option } = Select;
const { Text, Title } = Typography;

const RestoreBackupModal = ({ visible, onCancel, disks }) => {
  const [selectedDisk, setSelectedDisk] = useState(null);
  const [backups, setBackups] = useState([]);
  const [selectedBackup, setSelectedBackup] = useState(null);
  const [loading, setLoading] = useState(false);
  const [restoringStatus, setRestoringStatus] = useState(null); // null, 'progress', 'success', 'error'
  const [statusMessage, setStatusMessage] = useState('');
  const [isLoadingBackups, setIsLoadingBackups] = useState(false);
  const [error, setError] = useState(null);

  // Загрузка списка бэкапов при выборе диска
  useEffect(() => {
    if (selectedDisk) {
      loadBackups(selectedDisk.name);
    }
  }, [selectedDisk]);

  // Функция для загрузки бэкапов диска
  const loadBackups = async (diskName) => {
    setIsLoadingBackups(true);
    setError(null);
    setBackups([]);
    
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(`${API_BASE_URL}/api/v1/backups/${diskName}`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      
      if (response.data.success) {
        setBackups(response.data.backups);
      } else {
        setError(response.data.message || 'Не удалось загрузить список бэкапов');
      }
    } catch (err) {
      console.error('Ошибка при загрузке бэкапов:', err);
      setError(err.response?.data?.message || 'Ошибка при загрузке списка бэкапов');
    } finally {
      setIsLoadingBackups(false);
    }
  };

  // Функция для восстановления из бэкапа
  const handleRestore = async () => {
    if (!selectedDisk || !selectedBackup) {
      message.error('Выберите диск и файл бэкапа');
      return;
    }

    try {
      setLoading(true);
      setRestoringStatus('progress');
      setStatusMessage('Запуск процесса восстановления...');

      const token = localStorage.getItem('token');
      const response = await axios.post(
        `${API_BASE_URL}/api/v1/backups/restore`,
        {
          diskName: selectedDisk.name,
          backupFile: selectedBackup
        },
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );

      if (response.data.success) {
        setRestoringStatus('success');
        setStatusMessage(response.data.message);
        
        // Запускаем проверку статуса восстановления
        if (response.data.restoreId) {
          startStatusPolling(selectedDisk.uuid);
        }
      } else {
        setRestoringStatus('error');
        setStatusMessage(response.data.message || 'Ошибка при восстановлении из бэкапа');
      }
    } catch (err) {
      console.error('Ошибка при восстановлении из бэкапа:', err);
      setRestoringStatus('error');
      setStatusMessage(err.response?.data?.message || 'Ошибка при восстановлении из бэкапа');
    } finally {
      setLoading(false);
    }
  };

  // Функция для периодической проверки статуса восстановления
  const startStatusPolling = (diskUuid) => {
    const interval = setInterval(async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await axios.get(`${API_BASE_URL}/api/v1/disks/${diskUuid}/status`, {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });

        if (response.data.success) {
          const { backupStatus, backupMessage } = response.data.disk;
          
          // Обновляем статус восстановления
          if (backupStatus === 'PROCESSING') {
            setRestoringStatus('progress');
            setStatusMessage(backupMessage || 'Восстановление из бэкапа...');
          } else if (backupStatus === 'SUCCESS') {
            setRestoringStatus('success');
            setStatusMessage(backupMessage || 'Восстановление из бэкапа успешно завершено');
            clearInterval(interval);
          } else if (backupStatus === 'ERROR') {
            setRestoringStatus('error');
            setStatusMessage(backupMessage || 'Ошибка при восстановлении из бэкапа');
            clearInterval(interval);
          } else if (backupStatus === 'IDLE') {
            // Если статус вернулся в IDLE, значит восстановление завершено
            clearInterval(interval);
          }
        }
      } catch (err) {
        console.error('Ошибка при проверке статуса восстановления:', err);
      }
    }, 3000); // Проверка каждые 3 секунды

    // Сохраняем ID интервала для очистки при размонтировании
    return interval;
  };

  // Очистка интервала при размонтировании компонента
  useEffect(() => {
    let interval;
    if (restoringStatus === 'progress' && selectedDisk) {
      interval = startStatusPolling(selectedDisk.uuid);
    }
    
    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [restoringStatus, selectedDisk]);

  // Рендер содержимого модального окна
  const renderModalContent = () => {
    if (restoringStatus === 'progress') {
      return (
        <div className="restore-progress">
          <Spin 
            indicator={<LoadingOutlined style={{ fontSize: 24 }} spin />} 
            tip={statusMessage}
          />
          <Text type="secondary" style={{ marginTop: 16 }}>
            Пожалуйста, не закрывайте это окно до завершения процесса восстановления
          </Text>
        </div>
      );
    }

    if (restoringStatus === 'success') {
      return (
        <div className="restore-success">
          <Alert
            message="Восстановление успешно"
            description={statusMessage}
            type="success"
            showIcon
          />
          <Button 
            type="primary" 
            onClick={onCancel} 
            style={{ marginTop: 16 }}
          >
            Закрыть
          </Button>
        </div>
      );
    }

    if (restoringStatus === 'error') {
      return (
        <div className="restore-error">
          <Alert
            message="Ошибка восстановления"
            description={statusMessage}
            type="error"
            showIcon
          />
          <Button 
            type="primary" 
            danger 
            onClick={() => setRestoringStatus(null)} 
            style={{ marginTop: 16 }}
          >
            Попробовать снова
          </Button>
        </div>
      );
    }

    return (
      <>
        <div className="disk-selection">
          <Title level={5}>Выберите диск для восстановления:</Title>
          <Select
            style={{ width: '100%' }}
            placeholder="Выберите диск"
            onChange={(value) => {
              const disk = disks.find(d => d.name === value);
              setSelectedDisk(disk);
              setSelectedBackup(null);
            }}
            value={selectedDisk?.name}
          >
            {disks.map(disk => (
              <Option key={disk.name} value={disk.name}>
                {disk.name} ({disk.mountPoint})
              </Option>
            ))}
          </Select>
        </div>

        {selectedDisk && (
          <div className="backup-selection">
            <Title level={5} style={{ marginTop: 16 }}>Выберите файл бэкапа:</Title>
            
            {isLoadingBackups ? (
              <div className="loading-backups">
                <Spin tip="Загрузка списка бэкапов..." />
              </div>
            ) : error ? (
              <Alert
                message="Ошибка при загрузке бэкапов"
                description={error}
                type="error"
                showIcon
              />
            ) : backups.length === 0 ? (
              <Alert
                message="Нет доступных бэкапов"
                description="Для данного диска не найдено бэкапов"
                type="warning"
                showIcon
              />
            ) : (
              <List
                className="backup-list"
                bordered
                dataSource={backups}
                renderItem={item => (
                  <List.Item
                    className={`backup-list-item ${selectedBackup === item ? 'selected' : ''}`}
                    onClick={() => setSelectedBackup(item)}
                  >
                    <Space>
                      <BackupOutlined />
                      <Text>{item}</Text>
                    </Space>
                  </List.Item>
                )}
              />
            )}
          </div>
        )}

        {selectedDisk && selectedBackup && (
          <div className="restore-warning" style={{ marginTop: 16 }}>
            <Alert
              message="Внимание! Все данные на диске будут перезаписаны."
              description="Выполнение операции восстановления приведет к удалению всех текущих данных на выбранном диске. Убедитесь, что у вас есть все необходимые копии данных."
              type="warning"
              showIcon
              icon={<WarningOutlined />}
            />
          </div>
        )}
      </>
    );
  };

  return (
    <Modal
      title="Восстановление из бэкапа"
      open={visible}
      onCancel={restoringStatus === 'progress' ? null : onCancel}
      footer={
        restoringStatus ? null : [
          <Button key="cancel" onClick={onCancel}>
            Отмена
          </Button>,
          <Button
            key="restore"
            type="primary"
            danger
            disabled={!selectedDisk || !selectedBackup || loading}
            loading={loading}
            onClick={handleRestore}
          >
            Восстановить
          </Button>
        ]
      }
      closable={restoringStatus !== 'progress'}
      maskClosable={restoringStatus !== 'progress'}
      width={600}
      centered
    >
      {renderModalContent()}
    </Modal>
  );
};

export default RestoreBackupModal;