# Dockerfile для бэкенда
FROM node:16-alpine

WORKDIR /app

# Копирование package.json и package-lock.json
COPY package*.json ./

# Установка зависимостей
RUN npm install

# Копирование исходного кода
COPY . .

# Экспорт порта
EXPOSE 5000

# Запуск сервера
CMD ["node", "server.js"]