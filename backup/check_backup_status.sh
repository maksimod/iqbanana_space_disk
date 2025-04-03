#!/bin/bash

# Скрипт для проверки статуса резервного копирования и обновления файла backups.yml
SSH_KEY_PATH="/root/.ssh/id_rsa_server"
BACKUP_SERVER="192.168.0.106"
BACKUP_SERVER_PORT="22"
BACKUP_STATUS_FILE="/root/backup_status.log"
BACKUPS_YML_FILE="/home/user/iqbanana_space_disk/monitor/backups.yml"

# Выполняем команду для получения статуса с сервера
status_output=$(ssh -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no -p "$BACKUP_SERVER_PORT" "root@$BACKUP_SERVER" "cat $BACKUP_STATUS_FILE 2>/dev/null || echo 'STATUS=UNKNOWN'")

# Парсим вывод для получения параметров
CLIENT_IP=$(echo "$status_output" | grep "CLIENT_IP" | cut -d'=' -f2)
STATUS=$(echo "$status_output" | grep "STATUS" | cut -d'=' -f2)
DISK=$(echo "$status_output" | grep "DISK" | cut -d'=' -f2)

# Проверяем, что получили все параметры
if [ -z "$CLIENT_IP" ] || [ -z "$STATUS" ] || [ -z "$DISK" ]; then
    echo "Ошибка: Не удалось получить параметры статуса"
    exit 1
fi

DISK_NAME="$CLIENT_IP/$DISK"
echo "Обновление статуса для диска $DISK_NAME: $STATUS"

# Проверяем, существует ли файл backups.yml
if [ ! -f "$BACKUPS_YML_FILE" ]; then
    echo "Создание файла $BACKUPS_YML_FILE"
    echo "DISKS_STATUSES:" > "$BACKUPS_YML_FILE"
fi

# Проверяем, существует ли запись для этого диска
if grep -q "$DISK_NAME" "$BACKUPS_YML_FILE"; then
    # Заменяем статус, если запись существует
    sed -i "s/\(name: \"$DISK_NAME\"\n  status: \)\"[A-Z]*\"/\1\"$STATUS\"/" "$BACKUPS_YML_FILE"
else
    # Добавляем новую запись, если её нет
    echo "  - name: \"$DISK_NAME\"" >> "$BACKUPS_YML_FILE"
    echo "    status: \"$STATUS\"" >> "$BACKUPS_YML_FILE"
fi

echo "Статус резервного копирования обновлен"
