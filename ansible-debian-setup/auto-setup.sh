#!/bin/bash

# Цвета для вывода
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}=== Автоматическая настройка NFS с помощью Ansible ===${NC}"

# Проверка наличия ansible
if ! command -v ansible &> /dev/null; then
    echo -e "${RED}Ansible не установлен. Устанавливаем...${NC}"
    sudo apt update
    sudo apt install -y ansible sshpass
fi

# Проверка наличия других необходимых утилит
for package in sshpass python3-pip; do
    if ! dpkg -l | grep -q "ii  $package"; then
        echo -e "${YELLOW}Устанавливаем пакет $package...${NC}"
        sudo apt install -y $package
    fi
done

# Установка необходимых модулей Python для Ansible
sudo pip3 install --upgrade pip
sudo pip3 install --upgrade pyOpenSSL cryptography

# Настройка прав на скрипты
echo -e "${YELLOW}Настройка прав на скрипты...${NC}"
find . -name "*.sh" -exec chmod +x {} \;
find ./scripts -name "*.sh" -exec chmod +x {} \; 2>/dev/null || true

echo -e "${YELLOW}Проверка доступности серверов...${NC}"

# Проверка сервера agger
if ping -c 1 -W 2 192.168.0.104 > /dev/null 2>&1; then
    echo -e "${GREEN}Сервер agger (192.168.0.104) доступен${NC}"
else
    echo -e "${RED}Сервер agger (192.168.0.104) недоступен! Проверьте сетевое подключение.${NC}"
    exit 1
fi

# Проверка сервера apper
if ping -c 1 -W 2 192.168.0.100 > /dev/null 2>&1; then
    echo -e "${GREEN}Сервер apper (192.168.0.100) доступен${NC}"
else
    echo -e "${RED}Сервер apper (192.168.0.100) недоступен! Проверьте сетевое подключение.${NC}"
    exit 1
fi

# Проверка SSH доступа к серверам
echo -e "${YELLOW}Проверка SSH доступа к серверам...${NC}"

# Проверка SSH доступа к agger
ssh -o StrictHostKeyChecking=no -o BatchMode=yes agger@192.168.0.104 "echo Тест" >/dev/null 2>&1
if [ $? -eq 0 ]; then
    echo -e "${GREEN}SSH доступ к серверу agger работает${NC}"
else
    echo -e "${RED}Проблемы с SSH доступом к серверу agger. Выполните сначала ./setup-access.sh${NC}"
    exit 1
fi

# Проверка SSH доступа к apper
ssh -o StrictHostKeyChecking=no -o BatchMode=yes apper@192.168.0.100 "echo Тест" >/dev/null 2>&1
if [ $? -eq 0 ]; then
    echo -e "${GREEN}SSH доступ к серверу apper работает${NC}"
else
    echo -e "${RED}Проблемы с SSH доступом к серверу apper. Выполните сначала ./setup-access.sh${NC}"
    exit 1
fi

echo -e "${YELLOW}Запуск Ansible плейбука...${NC}"
ANSIBLE_HOST_KEY_CHECKING=False ansible-playbook -i hosts playbook.yml -vv

# Проверка успешности выполнения
if [ $? -eq 0 ]; then
    echo -e "${GREEN}Плейбук выполнен успешно!${NC}"
    echo -e "${YELLOW}Проверка монтирования NFS на сервере apper...${NC}"
    
    # Проверка монтирования на клиенте
    ANSIBLE_HOST_KEY_CHECKING=False ansible apper -i hosts -m shell -a "df -h | grep nfs" -vv
    
    echo -e "${GREEN}Настройка завершена. Все диски должны быть доступны на сервере apper.${NC}"
    echo -e "${YELLOW}Вы можете проверить смонтированные диски с помощью команды 'df -h'${NC}"
else
    echo -e "${RED}Возникла ошибка при выполнении плейбука.${NC}"
    exit 1
fi 