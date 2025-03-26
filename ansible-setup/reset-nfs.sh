#!/bin/bash

# Скрипт для полного сброса NFS монтирований и повторной попытки
# Запускается, если предыдущие попытки не дали результатов

# Цвета для вывода
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${RED}=== ПОЛНЫЙ СБРОС И ПЕРЕЗАГРУЗКА NFS СИСТЕМЫ ===${NC}"
echo "ВНИМАНИЕ: Этот скрипт размонтирует все NFS и очистит настройки"

# Проверка прав root
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Ошибка: Скрипт требует прав администратора${NC}"
  echo "Запустите: sudo $0"
  exit 1
fi

# Запрос подтверждения
read -p "Вы уверены, что хотите продолжить? (y/n): " confirm
if [ "$confirm" != "y" ]; then
  echo "Операция отменена."
  exit 0
fi

echo -e "\n${YELLOW}[1/5] Размонтирование всех NFS на клиенте...${NC}"
mount | grep nfs | awk '{print $3}' | xargs -r umount -f
echo "Размонтировано."

echo -e "\n${YELLOW}[2/5] Очистка кэша и перезапуск NFS клиента...${NC}"
systemctl restart nfs-common
exportfs -f
echo "Выполнено."

echo -e "\n${YELLOW}[3/5] Очистка и перезапуск NFS сервера...${NC}"
# Получаем IP сервера из inventory
SERVER_IP=$(grep -o "^[0-9]\+\.[0-9]\+\.[0-9]\+\.[0-9]\+" inventory | head -1)
SERVER_USER=$(grep -o "ansible_user=\w\+" inventory | head -1 | cut -d= -f2)
SERVER_PASS=$(grep -o "ansible_ssh_pass=[^ ]\+" inventory | head -1 | cut -d= -f2)

if [ -n "$SERVER_IP" ] && [ -n "$SERVER_USER" ]; then
  # Создаем команду для выполнения на сервере
  SERVER_CMD="sudo systemctl stop nfs-kernel-server; sudo exportfs -ua; sudo rm -f /etc/exports; sudo touch /etc/exports; sudo systemctl start nfs-kernel-server"
  
  # Выполняем команду на сервере
  if [ -n "$SERVER_PASS" ]; then
    sshpass -p "$SERVER_PASS" ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $SERVER_USER@$SERVER_IP "$SERVER_CMD"
  else
    ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $SERVER_USER@$SERVER_IP "$SERVER_CMD"
  fi
  
  echo "NFS сервер перезапущен."
else
  echo -e "${RED}Не удалось получить данные для подключения к серверу${NC}"
fi

echo -e "\n${YELLOW}[4/5] Очистка временных файлов и кэша Ansible...${NC}"
rm -rf /tmp/ansible_*
rm -f /var/lib/nfs/etab
rm -f /var/lib/nfs/rmtab
echo "Очистка завершена."

echo -e "\n${YELLOW}[5/5] Запуск скрипта поиска и монтирования дисков...${NC}"
echo "Начинаем процесс заново..."
sleep 2

# Запуск основного скрипта с нуля
bash ansible-setup-tuned.sh --forks=5 --strategy=linear

echo -e "\n${GREEN}Операция сброса и перезагрузки завершена!${NC}"
echo "Проверьте смонтированные NFS диски командой: df -h | grep nfs"