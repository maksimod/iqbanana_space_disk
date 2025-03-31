#!/bin/bash

# IP-адрес клиента (текущий сервер)
CLIENT_IP="192.168.0.103"

# IP-адрес прокси-сервера
SSH_HOST="46.35.241.37"

# SSH порты для серверов через прокси
SSH_PORTS=(
    "192.168.0.106:2222"
    "192.168.0.102:2223"
)

# Диски для каждого сервера, которые нужно монтировать
# Формат: "сервер:диск:буква"
DISKS_TO_MOUNT=(
    "192.168.0.106:sda:A"
    "192.168.0.106:sdb:B"
    "192.168.0.102:sdb:C"
    "192.168.0.102:sdc:D"
)

# Базовый путь для монтирования
MOUNT_BASE="/mnt/data_storage"

# Путь к конфигурации backend
CONFIG_PATH="/home/user/iqbanana_space_disk/backend/config.js"

# Опции монтирования для локальных дисков
MOUNT_OPTIONS="defaults,noatime,nodiratime"

# Опции монтирования для NFS
NFS_MOUNT_OPTIONS="rw,sync,no_subtree_check,no_root_squash,hard,intr"

# Настройки RAID
RAID_METADATA_DIR="/etc/storage_raid"
DRBD_PORT_BASE=7788
LVM_VG_PREFIX="raid_vg"
LVM_LV_PREFIX="raid_lv"
ISCSI_TARGET_PREFIX="iqn.2025-03.local.storage"

# Функция для проверки, является ли конфигурация RAID-конфигурацией
is_raid_config() {
    local config=$1
    [[ $config == *"raid"* ]]
}