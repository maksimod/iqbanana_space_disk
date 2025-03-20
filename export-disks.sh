#!/bin/bash

# Настройки
MOUNT_PREFIX="/mnt"
SAMBA_CONFIG="/etc/samba/smb.conf"
MIN_SIZE_GB=4
FSTAB_BACKUP="/etc/fstab.backup.$(date +%Y%m%d%H%M%S)"
SYSTEM_MOUNTS=("/" "/boot" "/var" "/home")  # Список системных точек монтирования для исключения

# Функция для логирования
log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a /var/log/storage_setup.log
}

# Проверка, что скрипт запущен от root
if [ "$EUID" -ne 0 ]; then
  log "Ошибка: Скрипт должен быть запущен от имени root"
  exit 1
fi

# Создаем базовую конфигурацию Samba
cat > /tmp/smb.conf <<EOF
[global]
   workgroup = WORKGROUP
   server string = Agger Server
   security = user
   map to guest = bad user
   guest account = nobody

[homes]
   comment = Home Directories
   browseable = no
   read only = no
   create mask = 0700
   directory mask = 0700
   valid users = %S

EOF

# Резервное копирование fstab
log "Создание резервной копии fstab: $FSTAB_BACKUP"
cp /etc/fstab "$FSTAB_BACKUP"

# Функция проверки, является ли устройство системным
is_system_device() {
  local device=$1
  for mount in "${SYSTEM_MOUNTS[@]}"; do
    if mountpoint -q "$mount" && grep -q "$device" /proc/mounts; then
      return 0  # Устройство системное
    fi
  done
  return 1  # Устройство не системное
}

# Функция для обработки накопителей
process_storage() {
  local device=$1
  local size_gb=$2
  
  # Пропускаем маленькие накопители
  if (( size_gb < MIN_SIZE_GB )); then
    log "Пропуск $device (размер: ${size_gb}GB < ${MIN_SIZE_GB}GB)"
    return
  fi

  # Проверяем, системное ли устройство
  if is_system_device "$device"; then
    log "Пропуск системного устройства $device"
    return
  fi

  # Получаем информацию о разделе
  local UUID=$(blkid -s UUID -o value "$device" 2>/dev/null)
  local FSTYPE=$(blkid -s TYPE -o value "$device" 2>/dev/null)
  local MOUNT_POINT="${MOUNT_PREFIX}/disk_$(basename "$device")"

  # Пропускаем, если устройство уже в fstab
  if [ -n "$UUID" ] && grep -q "$UUID" /etc/fstab; then
    log "Пропуск устройства $device (уже в fstab)"
    return
  fi

  # Если файловая система отсутствует, форматируем только после проверки
  if [ -z "$FSTYPE" ]; then
    log "Обнаружено неразмеченное пространство на $device (${size_gb}GB)"
    # Дополнительная проверка: устройство не должно быть частью LVM или RAID
    if pvdisplay "$device" >/dev/null 2>&1 || mdadm --examine "$device" >/dev/null 2>&1; then
      log "Пропуск $device: часть LVM или RAID"
      return
    fi
    mkfs.ext4 -F "$device"
    UUID=$(blkid -s UUID -o value "$device")
    FSTYPE="ext4"
  fi

  # Создаем точку монтирования
  mkdir -p "$MOUNT_POINT"

  # Добавляем в Samba
  local SHARE_NAME=$(basename "$device" | tr '[:lower:]' '[:upper:]')
  cat >> /tmp/smb.conf <<EOF
[DISK_$SHARE_NAME]
   comment = Disk $device
   path = $MOUNT_POINT
   browseable = yes
   read only = no
   guest ok = yes
   create mask = 0777
   directory mask = 0777

EOF
  log "Добавлен раздел Samba: DISK_$SHARE_NAME"

  # Добавляем в fstab
  echo "UUID=$UUID $MOUNT_POINT $FSTYPE defaults,nofail 0 2" >> /etc/fstab
  log "Добавлен в fstab: $device → $MOUNT_POINT"
}

# Основной цикл обработки
log "Поиск доступных дисков..."
for device in $(lsblk -rno NAME,TYPE,MOUNTPOINT | awk '$2=="disk" && $3=="" {print $1}'); do
  device="/dev/$device"
  size_gb=$(($(blockdev --getsize64 "$device") / 1024**3))
  
  if lsblk "$device" | grep -q "part"; then
    for part in "$device"*[0-9]; do
      part_size_gb=$(($(blockdev --getsize64 "$part") / 1024**3))
      process_storage "$part" "$part_size_gb"
    done
  else
    process_storage "$device" "$size_gb"
  fi
done

# Применяем изменения
mv /tmp/smb.conf "$SAMBA_CONFIG"
systemctl restart smbd 2>/dev/null || log "Ошибка перезапуска smbd"
log "Конфигурация Samba обновлена"

systemctl daemon-reload
mount -a 2>/dev/null || log "Ошибка монтирования дисков"
log "Диски смонтированы"

log "Экспорт завершен успешно"