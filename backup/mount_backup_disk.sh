#!/bin/bash

# Скрипт для монтирования и проверки диска резервных копий

# Загружаем конфигурацию
SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
source "$SCRIPT_DIR/backup_config.sh"

echo "Монтирование диска резервных копий (UUID: $TARGET_UUID)"

# Проверяем наличие диска в системе
if ! sudo blkid | grep -q "$TARGET_UUID"; then
    echo "Ошибка: Диск с UUID=$TARGET_UUID не найден в системе"
    exit 1
fi

# Определяем тип файловой системы
FS_TYPE=$(sudo blkid | grep "$TARGET_UUID" | grep -o 'TYPE="[^"]*"' | cut -d'"' -f2)
echo "Тип файловой системы: $FS_TYPE"

# Создаем точку монтирования
echo "Создание точки монтирования $TARGET_MOUNT"
sudo mkdir -p "$TARGET_MOUNT"

# Проверяем, смонтирован ли уже диск
if mount | grep -q "$TARGET_MOUNT"; then
    echo "Диск уже смонтирован в $TARGET_MOUNT"
else
    # Монтируем диск с указанием его файловой системы
    echo "Монтирование диска UUID=$TARGET_UUID в $TARGET_MOUNT"
    if [ -n "$FS_TYPE" ]; then
        sudo mount -t "$FS_TYPE" UUID="$TARGET_UUID" "$TARGET_MOUNT"
    else
        sudo mount UUID="$TARGET_UUID" "$TARGET_MOUNT"
    fi
    
    # Проверяем успешность монтирования
    if mount | grep -q "$TARGET_MOUNT"; then
        echo "Диск успешно смонтирован"
    else
        echo "Ошибка: Не удалось смонтировать диск"
        exit 1
    fi
fi

# Проверяем доступность записи
echo "Проверка доступности записи на диск"
TEST_FILE="$TARGET_MOUNT/test_write_$(date +%s)"
if sudo touch "$TEST_FILE"; then
    echo "Запись на диск работает"
    sudo rm -f "$TEST_FILE"
else
    echo "Ошибка: Невозможно записать на диск"
    exit 1
fi

echo "Диск резервных копий доступен и готов к использованию"

# Проверяем запись в fstab
if ! grep -q "UUID=$TARGET_UUID" /etc/fstab; then
    echo "Добавление записи в /etc/fstab для автоматического монтирования"
    echo "UUID=$TARGET_UUID $TARGET_MOUNT $FS_TYPE defaults,nofail 0 2" | sudo tee -a /etc/fstab > /dev/null
else
    echo "Запись в /etc/fstab уже существует"
fi

exit 0 