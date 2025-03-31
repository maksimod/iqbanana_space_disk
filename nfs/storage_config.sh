#!/bin/bash

# IP-адрес клиента (для настройки NFS экспортов)
CLIENT_IP="192.168.0.103"

# IP-адрес SSH хоста (прокси-сервера)
SSH_HOST="46.35.241.37"

# Базовый путь для монтирования дисков
MOUNT_BASE="/mnt/data_storage"

# Массив дисков для монтирования (формат: сервер:диск:буква)
DISKS_TO_MOUNT=(
    "192.168.0.106:sda:A"
    "192.168.0.106:sdb:B"
    "192.168.0.102:sdb:C"
    "192.168.0.102:sdc:D"
)

# Опции монтирования для дисков
MOUNT_OPTIONS="rw,noatime,nodiratime,exec,nofail"

# Опции монтирования для NFS
NFS_MOUNT_OPTIONS="rw,noatime,soft,timeo=30,retry=0,nofail"

# Порты для подключения к серверам через SSH
SSH_PORTS=(
    "192.168.0.106:2222"
    "192.168.0.102:2223"
)

# Путь к конфигурационному файлу backend
CONFIG_PATH="/home/user/iqbanana_space_disk/backend/config/config.js"

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