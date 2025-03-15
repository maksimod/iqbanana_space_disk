FROM node:18-alpine

# Установка рабочей директории
WORKDIR /app

# Копирование файлов package.json и package-lock.json (если есть)
COPY package*.json ./

# Установка зависимостей
RUN npm ci --only=production

# Копирование исходного кода
COPY . .

# Создание директории для логов
RUN mkdir -p logs

# Экспорт порта
EXPOSE 6005

# Запуск приложения
CMD ["node", "server.js"]