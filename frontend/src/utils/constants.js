// API базовый URL
export const API_BASE_URL = process.env.REACT_APP_API_URL || '/api/v1';

// Константы состояний запросов
export const REQUEST_STATUS = {
  IDLE: 'idle',
  LOADING: 'loading',
  SUCCESS: 'success',
  ERROR: 'error'
}; 