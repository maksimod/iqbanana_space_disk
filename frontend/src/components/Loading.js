import React from 'react';

const Loading = ({ message = 'Загрузка данных...' }) => {
  return <div className="loading">{message}</div>;
};

export default Loading;