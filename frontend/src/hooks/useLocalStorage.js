import { useState, useEffect } from 'react';

/**
 * Хук для сохранения состояния в localStorage
 * @param {string} key - ключ для хранения в localStorage
 * @param {any} initialValue - начальное значение
 * @return {array} [storedValue, setValue] - состояние и функция для его изменения
 */
const useLocalStorage = (key, initialValue) => {
  // Инициализация состояния
  const [storedValue, setStoredValue] = useState(() => {
    try {
      // Пытаемся получить значение из localStorage
      const item = window.localStorage.getItem(key);
      // Если значение найдено, парсим его, иначе возвращаем initialValue
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.error(`Ошибка при получении из localStorage (${key}):`, error);
      return initialValue;
    }
  });

  // Обновление localStorage при изменении состояния
  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(storedValue));
    } catch (error) {
      console.error(`Ошибка при сохранении в localStorage (${key}):`, error);
    }
  }, [key, storedValue]);

  return [storedValue, setStoredValue];
};

export default useLocalStorage;