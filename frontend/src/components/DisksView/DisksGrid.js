import React from 'react';
import DiskCard from './DiskCard';
import Loading from '../Loading';
import { useAppContext } from '../../context/AppContext';

const DisksGrid = () => {
  const { disks, loading, handleDiskSelect } = useAppContext();

  if (loading && disks.length === 0) {
    return <Loading />;
  }

  return (
    <div className="disks-container">
      <h2>Доступные диски</h2>
      <div className="disks-grid">
        {disks.map((disk) => (
          <DiskCard 
            key={disk.name} 
            disk={disk} 
            onSelect={handleDiskSelect} 
          />
        ))}
      </div>
    </div>
  );
};

export default DisksGrid;