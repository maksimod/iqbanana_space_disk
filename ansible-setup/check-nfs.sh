#!/bin/bash

# Скрипт для проверки и отладки NFS

# Цвета для вывода
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== ДИАГНОСТИКА NFS НАСТРОЕК ===${NC}"

# Определение пути к каталогу скрипта
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
INVENTORY_FILE="$SCRIPT_DIR/inventory"

if [ ! -f "$INVENTORY_FILE" ]; then
  echo -e "${RED}Ошибка: Файл inventory не найден: $INVENTORY_FILE${NC}"
  
  # Пробуем найти файл inventory в других местах
  POSSIBLE_INVENTORY=$(find ~/iqbanana_space_disk -name inventory -type f 2>/dev/null | head -1)
  if [ -n "$POSSIBLE_INVENTORY" ]; then
    echo -e "${YELLOW}Найден файл inventory: $POSSIBLE_INVENTORY${NC}"
    INVENTORY_FILE="$POSSIBLE_INVENTORY"
  else
    echo -e "${RED}Файл inventory не найден в системе. Некоторые проверки будут пропущены.${NC}"
    SERVER_IP=""
  fi
fi

if [ -f "$INVENTORY_FILE" ]; then
  echo "Используется файл inventory: $INVENTORY_FILE"
  # Проверяем настройки на сервере
  SERVER_IP=$(grep -o "^[0-9]\+\.[0-9]\+\.[0-9]\+\.[0-9]\+" "$INVENTORY_FILE" | head -1)
  SERVER_USER=$(grep -o "ansible_user=\w\+" "$INVENTORY_FILE" | head -1 | cut -d= -f2)
  SERVER_PASS=$(grep -o "ansible_ssh_pass=[^ ]\+" "$INVENTORY_FILE" | head -1 | cut -d= -f2)
else
  SERVER_IP=""
fi

if [ -n "$SERVER_IP" ]; then
  echo -e "\n${YELLOW}Проверка настроек сервера NFS ($SERVER_IP):${NC}"
  
  if [ -n "$SERVER_USER" ]; then
    # Команды для выполнения на сервере
    SERVER_CMD="echo -e '${GREEN}Проверка статуса NFS-сервера:${NC}' && 
              systemctl status nfs-kernel-server | grep Active && 
              echo -e '${GREEN}Экспорты NFS:${NC}' && 
              cat /etc/exports && 
              echo -e '${GREEN}Проверка активных экспортов:${NC}' && 
              exportfs -v && 
              echo -e '${GREEN}Проверка папок и прав:${NC}' && 
              ls -la /mnt/storage &&
              echo -e '${GREEN}Проверка занятых портов:${NC}' && 
              rpcinfo -p | grep -E 'nfs|mountd'"
    
    # Выполнение команд на сервере
    if [ -n "$SERVER_PASS" ]; then
      echo "Подключение к серверу $SERVER_IP..."
      sshpass -p "$SERVER_PASS" ssh -o StrictHostKeyChecking=no $SERVER_USER@$SERVER_IP "$SERVER_CMD"
    else
      ssh -o StrictHostKeyChecking=no $SERVER_USER@$SERVER_IP "$SERVER_CMD"
    fi
  else
    echo "Не удалось определить пользователя для SSH подключения к серверу"
  fi
fi

# Проверяем настройки на клиенте
echo -e "\n${YELLOW}Проверка настроек клиента NFS:${NC}"

if [ -n "$SERVER_IP" ]; then
  echo -e "${GREEN}Проверка доступных экспортов:${NC}"
  showmount -e $SERVER_IP || echo "Ошибка: Не удается получить список экспортов с сервера"

  echo -e "${GREEN}Проверка доступности сервера:${NC}"
  ping -c 1 $SERVER_IP

  echo -e "${GREEN}Проверка доступности NFS порта:${NC}"
  nc -z -v $SERVER_IP 2049 2>&1 || echo "Порт NFS недоступен"
else
  echo "IP-адрес сервера не определен, пропускаем проверки связи"
fi

echo -e "${GREEN}Проверка смонтированных NFS:${NC}"
mount | grep nfs || echo "NFS не смонтированы"

# Ручное монтирование для теста
if [ -n "$SERVER_IP" ]; then
  echo -e "\n${YELLOW}Попытка ручного монтирования NFS:${NC}"
  if [ -d /mnt/storage/sda ]; then
    sudo umount /mnt/storage/sda 2>/dev/null || true
    echo "Пробуем примонтировать вручную..."
    sudo mount -t nfs $SERVER_IP:/mnt/storage/sda /mnt/storage/sda -v
    if [ $? -eq 0 ]; then
      echo -e "${GREEN}Успешно смонтировано!${NC}"
      ls -la /mnt/storage/sda
      sudo umount /mnt/storage/sda
    else
      echo -e "${RED}Ошибка монтирования.${NC}"
    fi
  else
    echo "Каталог /mnt/storage/sda не существует"
  fi
fi

echo -e "\n${GREEN}Диагностика завершена!${NC}"