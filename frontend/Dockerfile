FROM node:18-alpine AS build

# Установка рабочей директории
WORKDIR /app

# Копирование файлов package.json и package-lock.json (если есть)
COPY package*.json ./

# Установка зависимостей
RUN npm ci 

# Копирование исходного кода
COPY . .

# Сборка приложения
RUN npm run build

# Этап запуска приложения
FROM nginx:alpine

# Копирование собранных файлов из предыдущего этапа
COPY --from=build /app/build /usr/share/nginx/html

# Копирование конфигурации nginx
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Экспорт порта
EXPOSE 80

# Запуск nginx
CMD ["nginx", "-g", "daemon off;"]