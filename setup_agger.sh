#!/bin/bash

# Настройки
SAMBA_USER="agger"
SAMBA_PASS="2864"
MOUNT_PREFIX="/mnt"
SAMBA_CONFIG="/etc/samba/smb.conf"
MIN_SIZE_GB=4
LOG_FILE="/var/log/agger_setup.log"
IP_ADDRESS="192.168.0.104"
APPER_IP="192.168.0.100"  # IP сервера apper
APPER_USER="apper"

# Системные точки монтирования для исключения
SYSTEM_MOUNTS=("/" "/boot" "/var" "/home" "/swap.img" "/dev" "/proc" "/sys" "/run" "/tmp")

# Функция для логирования
log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Создаём лог-файл с правильными правами, если его нет
if [ ! -f "$LOG_FILE" ]; then
  touch "$LOG_FILE"
  chmod 644 "$LOG_FILE"
fi

# Проверка, что скрипт запущен от root
if [ "$EUID" -ne 0 ]; then
  log "Ошибка: Скрипт должен быть запущен от имени root"
  exit 1
fi

# Функция проверки, является ли устройство системным или частью LVM
is_system_device() {
  local device=$1
  for mount in "${SYSTEM_MOUNTS[@]}"; do
    if mountpoint -q "$mount" && grep -q "$device" <(findmnt -n -o SOURCE "$mount"); then
      log "Устройство $device смонтировано в системную точку $mount"
      return 0
    fi
  done
  if pvdisplay "$device" >/dev/null 2>&1; then
    log "Устройство $device является частью LVM"
    return 0
  fi
  return 1  # Устройство не системное
}

# Функция очистки /etc/fstab от записей для /mnt/disk_*
clean_fstab() {
  log "Очистка /etc/fstab от записей для $MOUNT_PREFIX/disk_*..."
  cp /etc/fstab /etc/fstab.bak
  grep -v "$MOUNT_PREFIX/disk_" /etc/fstab > /tmp/fstab.new
  mv /tmp/fstab.new /etc/fstab
  log "Записи для $MOUNT_PREFIX/disk_* удалены из /etc/fstab"
  systemctl daemon-reload
  log "systemd обновлен после изменения /etc/fstab"
}

# Функция обновления /etc/fstab
update_fstab() {
  log "Обновление /etc/fstab с текущими монтированиями..."
  for device in $(lsblk -rno NAME,TYPE | awk '$2=="part" {print "/dev/" $1}'); do
    mount_point="${MOUNT_PREFIX}/disk_$(basename "$device" | sed 's/[0-9]*$//')_$(echo $(basename "$device") | grep -o '[0-9]*$')"
    if mountpoint -q "$mount_point"; then
      UUID=$(blkid -s UUID -o value "$device" 2>/dev/null)
      FSTYPE=$(blkid -s TYPE -o value "$device" 2>/dev/null)
      if [ -n "$UUID" ] && [ -n "$FSTYPE" ]; then
        if [ "$FSTYPE" = "ntfs" ]; then
          echo "UUID=$UUID $mount_point $FSTYPE defaults,nofail,uid=$SAMBA_USER,gid=$SAMBA_USER,remove_hiberfile 0 2" >> /etc/fstab
        else
          echo "UUID=$UUID $mount_point $FSTYPE defaults,nofail 0 2" >> /etc/fstab
        fi
        log "Добавлена запись в /etc/fstab: $device → $mount_point"
      fi
    fi
  done
  systemctl daemon-reload
  log "systemd обновлен после изменения /etc/fstab"
}

# Функция очистки устаревших шар в smb.conf
clean_samba_shares() {
  log "Очистка устаревших шар в $SAMBA_CONFIG..."
  temp_config="/tmp/smb.conf.tmp"
  cp "$SAMBA_CONFIG" "$temp_config"
  sed '/^\[DISK_[A-Za-z0-9_]*\]/,/^\s*$/d' "$temp_config" > "$SAMBA_CONFIG"
  rm "$temp_config"
  log "Устаревшие шары удалены из $SAMBA_CONFIG"
}

# Функция обработки устройств
process_devices() {
  log "Поиск доступных дисков и разделов..."
  # Очищаем устаревшие шары перед обработкой
  clean_samba_shares

  # Остановка служб, которые могут блокировать диски
  log "Временная остановка служб Samba для безопасного размонтирования..."
  systemctl stop smbd nmbd 2>/dev/null
  sleep 2

  # Принудительное размонтирование всех точек /mnt/disk_* с убийством блокирующих процессов
  for mount in $(mount | grep "$MOUNT_PREFIX/disk_" | awk '{print $3}'); do
    log "Попытка размонтирования $mount..."
    
    # Найти и завершить процессы, использующие точку монтирования
    if command -v fuser >/dev/null 2>&1; then
      log "Завершение процессов, использующих $mount..."
      fuser -k -9 "$mount" 2>/dev/null
    fi
    
    # Ожидание перед размонтированием
    sleep 2
    
    # Принудительное размонтирование
    if ! umount -f -l "$mount" 2>/dev/null; then
      log "Первая попытка размонтирования $mount не удалась, повторяем с другими параметрами..."
      umount -f "$mount" 2>/dev/null || log "Ошибка размонтирования $mount, продолжаем..."
    else
      log "Успешное размонтирование $mount"
    fi
    
    # Дополнительное ожидание для освобождения ресурсов
    sleep 2
  done

  # Перезапуск Samba
  log "Перезапуск Samba..."
  systemctl start smbd nmbd

  # Обработка каждого устройства
  for device in $(lsblk -rno NAME,TYPE | awk '$2=="part" {print "/dev/" $1}'); do
    size_gb=$(($(blockdev --getsize64 "$device") / 1024**3))
    mount_point="${MOUNT_PREFIX}/disk_$(basename "$device" | sed 's/[0-9]*$//')_$(echo $(basename "$device") | grep -o '[0-9]*$')"

    # Пропускаем устройства меньше минимального размера
    if (( size_gb < MIN_SIZE_GB )); then
      log "Пропуск $device (размер: ${size_gb}GB < ${MIN_SIZE_GB}GB)"
      continue
    fi

    # Проверяем, системное ли устройство
    if is_system_device "$device"; then
      log "Пропуск системного устройства или LVM $device"
      continue
    fi

    # Проверяем, не заблокировано ли устройство
    if command -v lsof >/dev/null 2>&1 && lsof "$device" >/dev/null 2>&1; then
      log "Устройство $device заблокировано другим процессом, пытаемся убить блокирующие процессы..."
      lsof "$device" | awk 'NR>1 {print $2}' | xargs -r kill -9 2>/dev/null
      sleep 3
    fi

    # Получаем UUID и тип файловой системы
    UUID=$(blkid -s UUID -o value "$device" 2>/dev/null)
    FSTYPE=$(blkid -s TYPE -o value "$device" 2>/dev/null)

    # Создаем точку монтирования
    if [ ! -d "$mount_point" ]; then
      mkdir -p "$mount_point"
    fi
    chown "$SAMBA_USER:$SAMBA_USER" "$mount_point"
    chmod 775 "$mount_point"
    log "Настроены права доступа для $mount_point"

    # Настраиваем Samba (добавляем шар независимо от монтирования)
    SHARE_NAME=$(basename "$device" | tr '[:lower:]' '[:upper:]')
    if ! grep -q "\[DISK_$SHARE_NAME\]" "$SAMBA_CONFIG"; then
      cat >> "$SAMBA_CONFIG" <<EOF

[DISK_$SHARE_NAME]
   comment = Disk $device
   path = $mount_point
   browseable = yes
   read only = no
   writable = yes
   valid users = $SAMBA_USER
   create mask = 0777
   directory mask = 0777
   force user = $SAMBA_USER
   force group = $SAMBA_USER
EOF
      log "Добавлен раздел Samba: DISK_$SHARE_NAME"
    else
      log "Раздел Samba DISK_$SHARE_NAME уже существует, пропускаем"
    fi

    # Монтируем устройство (только если оно не смонтировано)
    if ! mountpoint -q "$mount_point"; then
      if [ -z "$FSTYPE" ]; then
        log "Обнаружено неразмеченное пространство на $device (${size_gb}GB)"
        if pvdisplay "$device" >/dev/null 2>&1 || mdadm --examine "$device" >/dev/null 2>&1; then
          log "Пропуск $device: часть LVM или RAID"
          continue
        fi
        log "Форматирование $device в ext4..."
        mkfs.ext4 -F "$device"
        UUID=$(blkid -s UUID -o value "$device")
        FSTYPE="ext4"
        sleep 2
      fi
      
      # Монтируем с учетом типа файловой системы
      log "Монтирование $device на $mount_point (filesystem: $FSTYPE)..."
      if [ "$FSTYPE" = "ntfs" ]; then
        # Особая обработка для NTFS
        if ! mount -t ntfs-3g "$device" "$mount_point" -o defaults,nofail,uid=$SAMBA_USER,gid=$SAMBA_USER,umask=0002,remove_hiberfile; then
          log "Ошибка монтирования NTFS $device, пробуем дополнительные опции..."
          ntfsfix "$device" 2>/dev/null
          sleep 2
          mount -t ntfs-3g "$device" "$mount_point" -o defaults,nofail,uid=$SAMBA_USER,gid=$SAMBA_USER,umask=0002,remove_hiberfile,force || 
            log "Окончательная ошибка монтирования NTFS $device"
        else
          log "Устройство NTFS $device успешно смонтировано на $mount_point"
        fi
      else
        # Обычная файловая система (ext4, xfs и др.)
        if ! mount "$device" "$mount_point" -o defaults,nofail; then
          log "Ошибка монтирования $device, проверяем файловую систему..."
          if [ "$FSTYPE" = "ext4" ]; then
            e2fsck -p -f "$device" 2>/dev/null
          elif [ "$FSTYPE" = "xfs" ]; then
            xfs_repair -L "$device" 2>/dev/null
          fi
          sleep 2
          mount "$device" "$mount_point" -o defaults,nofail || 
            log "Окончательная ошибка монтирования $device"
        else
          log "Устройство $device успешно смонтировано на $mount_point"
        fi
      fi
    else
      log "Точка $mount_point уже смонтирована, пропускаем монтирование"
    fi
  done

  # Переписываем /etc/fstab
  clean_fstab
  update_fstab

  # Проверяем синтаксис smb.conf
  if ! testparm -s >/dev/null 2>&1; then
    log "Ошибка в конфигурации Samba: проверьте $SAMBA_CONFIG"
    testparm -s 2>&1 | while IFS= read -r line; do log "  $line"; done
    exit 1
  fi

  # Перезапускаем Samba для применения изменений
  systemctl restart smbd 2>/dev/null || log "Ошибка перезапуска smbd"
  systemctl restart nmbd 2>/dev/null || log "Ошибка перезапуска nmbd"
  log "Конфигурация Samba обновлена"

  # Проверяем доступность сети
  log "Проверка доступности сети..."
  if ! ping -c 4 -w 10 $APPER_IP >/dev/null 2>&1; then
    log "ОШИБКА: Сервер $APPER_IP недоступен"
    exit 1
  fi

  # Открываем порты для Samba
  log "Открытие портов для Samba..."
  if command -v ufw >/dev/null 2>&1; then
    ufw allow proto tcp from 192.168.0.0/24 to any port 137,138,139,445 2>/dev/null || log "Ошибка настройки ufw"
    ufw allow proto tcp from $APPER_IP to any port 137,138,139,445 2>/dev/null || log "Ошибка настройки ufw для $APPER_IP"
    ufw --force enable 2>/dev/null || log "Ошибка активации ufw"
  else
    log "UFW не установлен, пропускаем настройку брандмауэра"
  fi

  # Уведомление apper с повторными попытками
  log "Уведомление сервера apper ($APPER_IP) о необходимости синхронизации..."
  for attempt in {1..3}; do
    # Используем пользователя agger для SSH-соединения
    if su - "$SAMBA_USER" -c "ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 $APPER_USER@$APPER_IP 'touch /tmp/sync_trigger'" 2>/dev/null; then
      log "Уведомление успешно отправлено на $APPER_IP"
      break
    else
      log "Попытка $attempt: Ошибка уведомления apper"
      sleep 5
    fi
  done
}

# Основная логика скрипта
if [ "$1" == "--check-disks" ]; then
  # Периодическая проверка дисков
  log "Запуск проверки дисков..."
  process_devices
  log "Проверка дисков завершена"
  exit 0
else
  # Первый запуск: полная настройка
  log "Начало полной настройки сервера..."

  # Остановка и удаление старых автозапусков
  log "Удаление старых автозапусков..."
  systemctl stop storage-setup.timer 2>/dev/null
  systemctl disable storage-setup.timer 2>/dev/null
  rm /etc/systemd/system/storage-setup.service 2>/dev/null
  rm /etc/systemd/system/storage-setup.timer 2>/dev/null
  rm /usr/local/bin/storage_setup.sh 2>/dev/null
  systemctl daemon-reload

  # Обновление системы и установка пакетов
  log "Обновление системы и установка пакетов..."
  apt update -y && apt upgrade -y
  apt install -y openssh-server samba smbclient cifs-utils sshpass net-tools apparmor-utils ufw fuse ntfs-3g lsof

  # Настройка SSH
  log "Настройка SSH-сервера..."
  sed -i 's/#PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config
  sed -i 's/#PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config
  sed -i 's/#PubkeyAuthentication.*/PubkeyAuthentication yes/' /etc/ssh/sshd_config
  systemctl enable ssh
  systemctl restart ssh
  log "SSH-сервер настроен и запущен"

  # Настройка статического IP
  log "Настройка статического IP $IP_ADDRESS..."
  if ! ip addr show | grep -q "$IP_ADDRESS"; then
    cat > /etc/netplan/01-netcfg.yaml <<EOF
network:
  version: 2
  ethernets:
    $(ip link | grep '^[0-9]' | grep -v lo | awk -F: '{print $2}' | tr -d ' '):
      dhcp4: no
      addresses:
        - $IP_ADDRESS/24
      gateway4: 192.168.0.1
      nameservers:
        addresses: [8.8.8.8, 8.8.4.4]
EOF
    netplan apply
    log "Статический IP $IP_ADDRESS настроен"
  else
    log "IP $IP_ADDRESS уже настроен"
  fi

  # Настройка SSH ключей для удобства
  log "Настройка SSH-ключей для пользователя $SAMBA_USER..."
  if [ ! -f "/home/$SAMBA_USER/.ssh/id_rsa" ]; then
    mkdir -p "/home/$SAMBA_USER/.ssh"
    ssh-keygen -t rsa -b 4096 -N "" -f "/home/$SAMBA_USER/.ssh/id_rsa"
    chown -R "$SAMBA_USER:$SAMBA_USER" "/home/$SAMBA_USER/.ssh"
    chmod 700 "/home/$SAMBA_USER/.ssh"
    chmod 600 "/home/$SAMBA_USER/.ssh/id_rsa"
    chmod 644 "/home/$SAMBA_USER/.ssh/id_rsa.pub"
    log "SSH-ключи созданы"
    
    log "Копирование публичного ключа на $APPER_IP..."
    su - "$SAMBA_USER" -c "ssh-copy-id -o StrictHostKeyChecking=no $APPER_USER@$APPER_IP" || 
      log "Не удалось автоматически скопировать ключ, попробуйте вручную"
  else
    log "SSH-ключи уже существуют"
  fi

  # Создание пользователя Samba
  log "Создание пользователя Samba: $SAMBA_USER..."
  if ! id "$SAMBA_USER" &>/dev/null; then
    useradd -m -s /bin/bash "$SAMBA_USER"
    echo -e "$SAMBA_PASS\n$SAMBA_PASS" | passwd "$SAMBA_USER"
  fi
  echo -e "$SAMBA_PASS\n$SAMBA_PASS" | smbpasswd -a "$SAMBA_USER"
  smbpasswd -e "$SAMBA_USER"
  log "Пользователь Samba $SAMBA_USER создан и активирован"

  # Создание базовой конфигурации Samba
  log "Создание базовой конфигурации Samba..."
  cat > "$SAMBA_CONFIG" <<EOF
[global]
   workgroup = WORKGROUP
   server string = Agger Server
   security = user
   netbios name = AGGER
   bind interfaces only = yes
   interfaces = $IP_ADDRESS
   min protocol = SMB2
   server min protocol = SMB2
   server max protocol = SMB3
   socket options = TCP_NODELAY IPTOS_LOWDELAY SO_KEEPALIVE
   deadtime = 5
   keepalive = 60
   log level = 1
   max log size = 50
   log file = /var/log/samba/log.%m

[homes]
   comment = Home Directories
   browseable = no
   read only = no
   create mask = 0700
   directory mask = 0700
   valid users = %S
EOF

  # Первоначальная обработка дисков
  process_devices

  # Настройка udev для автоматического запуска при изменении дисков
  log "Настройка udev для автоматического перезапуска при изменении дисков..."
  cat > /etc/udev/rules.d/99-storage-setup.rules <<EOF
ACTION=="add|remove", SUBSYSTEM=="block", RUN+="/usr/local/bin/setup_agger.sh --check-disks"
EOF

  # Копирование скрипта в системную папку
  cp "$(readlink -f "$0")" "/usr/local/bin/setup_agger.sh"
  chmod 755 "/usr/local/bin/setup_agger.sh"

  # Перезагрузка правил udev
  udevadm control --reload-rules
  udevadm trigger
  log "udev настроен для отслеживания изменений дисков"

  # Создание systemd сервиса для периодического запуска
  log "Настройка периодического запуска через systemd..."
  cat > /etc/systemd/system/disk-check.service <<EOF
[Unit]
Description=Disk Check Service
After=network.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/setup_agger.sh --check-disks
User=root

[Install]
WantedBy=multi-user.target
EOF

  cat > /etc/systemd/system/disk-check.timer <<EOF
[Unit]
Description=Run Disk Check Every 15 Minutes
Requires=disk-check.service

[Timer]
OnBootSec=5min
OnUnitActiveSec=15min
Unit=disk-check.service
Persistent=true

[Install]
WantedBy=timers.target
EOF

  systemctl daemon-reload
  systemctl enable disk-check.timer
  systemctl start disk-check.timer
  log "Настроен периодический запуск проверки дисков через systemd"

  # Проверка состояния сервисов
  log "Проверка состояния сервисов..."
  if systemctl is-active --quiet ssh; then
    log "SSH работает"
  else
    log "Ошибка: SSH не работает"
  fi
  if systemctl is-active --quiet smbd; then
    log "Samba работает"
  else
    log "Ошибка: Samba не работает"
  fi
  if systemctl is-active --quiet nmbd; then
    log "NMB работает"
  else
    log "Ошибка: NMB не работает"
  fi

  log "Настройка сервера agger завершена успешно!"
  log "Теперь сервер apper ($APPER_IP) может подключаться через SSH и Samba с пользователем $SAMBA_USER и паролем $SAMBA_PASS"
fi