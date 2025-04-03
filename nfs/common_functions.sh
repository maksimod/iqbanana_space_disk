#!/bin/bash

# Цветной вывод для наглядности
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

# Функция для выполнения команды на удаленном сервере через SSH
remote_exec() {
    local server=$1
    local port=$2
    local cmd=$3
    
    echo -e "${YELLOW}Выполнение команды на сервере $server через SSH ключ${NC}"
    
    # Создаем временный файл для команды и результата
    local tmp_cmd_file=$(mktemp)
    local tmp_result_file=$(mktemp)
    
    # Записываем команду во временный файл с явным возвратом кода завершения
    echo "#!/bin/bash" > "$tmp_cmd_file"
    echo "set -e" >> "$tmp_cmd_file"
    echo "$cmd" >> "$tmp_cmd_file"
    echo "exit \$?" >> "$tmp_cmd_file"
    chmod +x "$tmp_cmd_file"
    
    # Копируем файл на сервер
    local remote_file="/tmp/exec_cmd_$(date +%s).sh"
    if ! scp -P "$port" -i "$SSH_KEY_PATH" "$tmp_cmd_file" "${SSH_USER}@${server}:${remote_file}" > /dev/null 2>&1; then
        echo -e "${RED}✗ Ошибка копирования команды на сервер $server${NC}"
        rm -f "$tmp_cmd_file"
        return 1
    fi
    
    # Выполняем команду и сохраняем результат
    if ssh -p "$port" -i "$SSH_KEY_PATH" "${SSH_USER}@${server}" "chmod +x ${remote_file} && sudo ${remote_file}" > "$tmp_result_file" 2>&1; then
        echo -e "${GREEN}✓ Команда успешно выполнена на сервере $server${NC}"
        
        # Показываем результат и возвращаем его
        if [ -s "$tmp_result_file" ]; then
            cat "$tmp_result_file"
        fi
        
        # Удаляем временные файлы
        rm -f "$tmp_cmd_file" "$tmp_result_file"
        ssh -p "$port" -i "$SSH_KEY_PATH" "${SSH_USER}@${server}" "rm -f ${remote_file}" > /dev/null 2>&1
        return 0
    else
        local exit_code=$?
        echo -e "${RED}✗ Ошибка выполнения команды на сервере $server${NC}"
        echo -e "${RED}Код ошибки: $exit_code${NC}"
        
        # Показываем вывод команды, даже если она завершилась с ошибкой
        if [ -s "$tmp_result_file" ]; then
            cat "$tmp_result_file"
        fi
        
        # Удаляем временные файлы
        rm -f "$tmp_cmd_file" "$tmp_result_file"
        ssh -p "$port" -i "$SSH_KEY_PATH" "${SSH_USER}@${server}" "rm -f ${remote_file}" > /dev/null 2>&1
        return $exit_code
    fi
}

# Функция для проверки доступности сервера
check_server() {
    local server=$1
    local port=$2
    
    echo -e "${YELLOW}Проверка доступности сервера $server через SSH ключ...${NC}"
    
    # Проверяем наличие SSH ключа
    if [ ! -f "$SSH_KEY_PATH" ]; then
        echo -e "${RED}Ошибка: SSH ключ не найден по пути $SSH_KEY_PATH${NC}"
        return 1
    fi
    
    # Пробуем подключиться к серверу через SSH ключ
    if ssh -i "$SSH_KEY_PATH" -p "$port" -o StrictHostKeyChecking=no -o ConnectTimeout=5 $SERVER_USER@$server "echo 'OK'"; then
        echo -e "${GREEN}✓ Сервер $server доступен${NC}"
        
        # Проверяем наличие дисков
        echo -e "${YELLOW}Проверка дисков на сервере $server...${NC}"
        local disk_check_cmd="ls -l /dev/sd* 2>/dev/null || echo 'Диски не найдены'"
        ssh -i "$SSH_KEY_PATH" -p "$port" -o StrictHostKeyChecking=no -o ConnectTimeout=5 $SERVER_USER@$server "$disk_check_cmd"
        
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

# Функция для получения UUID диска
get_disk_uuid() {
    local server=$1
    local port=$2
    local disk=$3
    
    echo -e "${YELLOW}Получение UUID диска /dev/$disk на сервере $server...${NC}"
    
    # Выполняем команду получения UUID
    local uuid=$(remote_exec "$server" "$port" "blkid -s UUID -o value /dev/$disk 2>/dev/null")
    
    if [ -z "$uuid" ]; then
        echo -e "${RED}Ошибка: Не удалось получить UUID для диска /dev/$disk на сервере $server${NC}"
        return 1
    else
        echo -e "${GREEN}UUID диска /dev/$disk: $uuid${NC}"
        echo "$uuid"
        return 0
    fi
}

# Функция для получения порта сервера
get_server_port() {
    local server=$1
    
    # Ищем порт для сервера в массиве SSH_PORTS
    for port_entry in "${SSH_PORTS[@]}"; do
        local srv=$(echo $port_entry | cut -d':' -f1)
        local port=$(echo $port_entry | cut -d':' -f2)
        
        if [ "$srv" = "$server" ]; then
            echo "$port"
            return 0
        fi
    done
    
    # Если порт не найден, возвращаем пустую строку
    echo ""
    return 1
}