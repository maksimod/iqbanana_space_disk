#!/bin/bash

# Цветной вывод для наглядности
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

# Функция для выполнения команд на удаленном сервере через SSH
remote_exec() {
    local server=$1
    local port=$2
    local command=$3
    
    # Получаем пароль для сервера из переменной окружения
    local server_var="SERVER_$(echo $server | tr '.' '_')_PASSWORD"
    local server_password="${!server_var}"
    
    if [ -z "$server_password" ]; then
        echo -e "${RED}Ошибка: Не установлена переменная $server_var в .env${NC}"
        return 1
    fi
    
    # Добавляем отладочную информацию
    echo -e "${YELLOW}Выполнение команды на сервере $server через прокси $SSH_HOST:${port}${NC}"
    
    # Выполняем команду через SSH с использованием прокси
    sshpass -p "$server_password" ssh -p "$port" -o StrictHostKeyChecking=no -o ConnectTimeout=10 root@$SSH_HOST "$command"
    local result=$?
    
    if [ $result -eq 0 ]; then
        echo -e "${GREEN}✓ Команда успешно выполнена на сервере $server${NC}"
    else
        echo -e "${RED}✗ Ошибка выполнения команды на сервере $server${NC}"
    fi
    
    return $result
}

# Функция для проверки доступности сервера
check_server() {
    local server=$1
    local port=$2
    
    echo -e "${YELLOW}Проверка доступности сервера $server через прокси $SSH_HOST:${port}...${NC}"
    
    # Получаем пароль для сервера
    local server_var="SERVER_$(echo $server | tr '.' '_')_PASSWORD"
    local server_password="${!server_var}"
    
    if [ -z "$server_password" ]; then
        echo -e "${RED}Ошибка: Не установлена переменная $server_var в .env${NC}"
        return 1
    fi
    
    # Пробуем подключиться к серверу через прокси
    if sshpass -p "$server_password" ssh -p "$port" -o StrictHostKeyChecking=no -o ConnectTimeout=5 root@$SSH_HOST "echo 'OK'"; then
        echo -e "${GREEN}✓ Сервер $server доступен${NC}"
        return 0
    else
        echo -e "${RED}✗ Сервер $server недоступен${NC}"
        return 1
    fi
}

# Функция для проверки всех серверов
check_all_servers() {
    local all_ok=true
    
    for port_entry in "${SSH_PORTS[@]}"; do
        server=$(echo $port_entry | cut -d':' -f1)
        port=$(echo $port_entry | cut -d':' -f2)
        
        if ! check_server "$server" "$port"; then
            all_ok=false
        fi
    done
    
    if [ "$all_ok" = false ]; then
        echo -e "${RED}Ошибка: Не все серверы доступны${NC}"
        return 1
    fi
    
    return 0
}