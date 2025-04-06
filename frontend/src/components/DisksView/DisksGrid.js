import React from 'react';
import DiskCard from './DiskCard';
import Loading from '../Loading';
import { useAppContext } from '../../context/AppContext';

const DisksGrid = () => {
  const { disks, loading, handleDiskSelect } = useAppContext();

  // Добавляем отладочный вывод, чтобы проверить данные дисков
  console.log("DisksGrid получил диски:", JSON.stringify(disks, null, 2));

  if (loading && disks.length === 0) {
    return <Loading />;
  }

  return (
    <div className="disks-grid">
      {disks.map((disk) => (
        <DiskCard 
          key={disk.name} 
          disk={disk} 
          onSelect={handleDiskSelect} 
        />
      ))}
    </div>
  );
};

export default DisksGrid;