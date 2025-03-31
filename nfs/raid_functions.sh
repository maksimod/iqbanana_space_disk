#!/bin/bash

# Определить, является ли запись RAID-массивом
is_raid_config() {
    local disk_config="$1"
    if [[ "$disk_config" == *"||"* || "$disk_config" == *"--"* ]]; then
        return 0  # Это RAID-конфигурация
    else
        return 1  # Обычный диск
    fi
}

# Разобрать RAID-конфигурацию на диски
parse_raid_config() {
    local disk_config="$1"
    local raid_type=""
    local disk1=""
    local disk2=""
    
    if [[ "$disk_config" == *"||"* ]]; then
        raid_type="mirror"
        IFS="||" read -r disk1 disk2 <<< "$disk_config"
    elif [[ "$disk_config" == *"--"* ]]; then
        raid_type="stripe"
        IFS="--" read -r disk1 disk2 <<< "$disk_config"
    fi
    
    echo "$raid_type $disk1 $disk2"
}

# Проверить наличие данных на удаленном устройстве
check_data_exists() {
    local device="$1"
    local server="$2"
    local port="$3"
    
    # Запрос проверки наличия данных на устройстве
    local result=$(remote_exec "$server" "$port" "
        if [ -e '$device' ]; then
            if blkid '$device' | grep -q 'TYPE='; then
                echo 'true'
            else
                echo 'false'
            fi
        else
            echo 'not_exists'
        fi
    ")
    
    echo "$result"
}

# Безопасно спросить пользователя о форматировании диска
ask_for_format_confirmation() {
    local device="$1"
    local server="$2"
    local raid_type="$3"
    
    while true; do
        echo -e "${YELLOW}ВНИМАНИЕ: Диск $device на сервере $server уже имеет данные, но вы хотите его использовать как часть RAID-$raid_type.${NC}"
        echo -e "${RED}ЭТО УНИЧТОЖИТ ВСЕ ЕГО ДАННЫЕ!${NC}"
        echo -n "Продолжить? (нет!/да!): "
        read -r response
        
        if [ "$response" == "да!" ]; then
            return 0  # Пользователь согласился
        elif [ "$response" == "нет!" ]; then
            return 1  # Пользователь отказался
        else
            echo "Пожалуйста, введите точно 'да!' или 'нет!'."
        fi
    done
}

# Настроить RAID-1 (зеркалирование) через DRBD
setup_raid1_mirror() {
    local disk1_info="$1"
    local disk2_info="$2"
    local raid_name="$3"
    
    # Извлечь информацию о дисках
    IFS=':' read -r server1 disk1 letter <<< "$disk1_info"
    IFS=':' read -r server2 disk2 _ <<< "$disk2_info"
    
    # Получаем порты для SSH
    local port1=$(echo "${SSH_PORTS[@]}" | grep -o "$server1:[0-9]*" | cut -d':' -f2)
    local port2=$(echo "${SSH_PORTS[@]}" | grep -o "$server2:[0-9]*" | cut -d':' -f2)
    
    echo "Проверка RAID-1 (зеркало) между $server1:$disk1 и $server2:$disk2 как $letter:"
    
    # Проверка наличия данных на дисках
    echo "Проверка наличия данных на дисках..."
    local has_data1=$(check_data_exists "/dev/$disk1" "$server1" "$port1")
    local has_data2=$(check_data_exists "/dev/$disk2" "$server2" "$port2")
    
    # Проверка существования устройств
    if [ "$has_data1" == "not_exists" ]; then
        echo -e "${RED}ОШИБКА: Диск /dev/$disk1 не существует на сервере $server1${NC}"
        return 1
    fi
    
    if [ "$has_data2" == "not_exists" ]; then
        echo -e "${RED}ОШИБКА: Диск /dev/$disk2 не существует на сервере $server2${NC}"
        return 1
    fi
    
    # Проверка наличия данных и запрос подтверждения
    if [ "$has_data1" == "true" ]; then
        if ! ask_for_format_confirmation "/dev/$disk1" "$server1" "1"; then
            echo "Настройка RAID-1 отменена пользователем для сохранения данных."
            return 1
        fi
    fi
    
    if [ "$has_data2" == "true" ]; then
        if ! ask_for_format_confirmation "/dev/$disk2" "$server2" "1"; then
            echo "Настройка RAID-1 отменена пользователем для сохранения данных."
            return 1
        fi
    fi
    
    echo "Настройка RAID-1 (зеркало) между $server1:$disk1 и $server2:$disk2 как $letter:"
    
    # 1. Установка DRBD на обоих серверах
    echo "Установка DRBD на серверах..."
    remote_exec "$server1" "$port1" "apt-get update && apt-get install -y drbd8-utils"
    remote_exec "$server2" "$port2" "apt-get update && apt-get install -y drbd8-utils"
    
    # 2. Создание конфигурации DRBD
    local drbd_config="resource $raid_name {
  device     /dev/drbd0;
  meta-disk  internal;
  on $server1 {
    disk       /dev/$disk1;
    address    $server1:$(($DRBD_PORT_BASE + ${#CONFIGURED_RAIDS[@]}));
  }
  on $server2 {
    disk       /dev/$disk2;
    address    $server2:$(($DRBD_PORT_BASE + ${#CONFIGURED_RAIDS[@]}));
  }
}"
    
    # 3. Отправка конфигурации на оба сервера
    remote_exec "$server1" "$port1" "mkdir -p /etc/drbd.d && echo '$drbd_config' > /etc/drbd.d/$raid_name.res"
    remote_exec "$server2" "$port2" "mkdir -p /etc/drbd.d && echo '$drbd_config' > /etc/drbd.d/$raid_name.res"
    
    # 4. Инициализация и запуск DRBD на обоих серверах
    echo "Инициализация DRBD на $server1..."
    remote_exec "$server1" "$port1" "drbdadm create-md $raid_name && drbdadm up $raid_name"
    
    echo "Инициализация DRBD на $server2..."
    remote_exec "$server2" "$port2" "drbdadm create-md $raid_name && drbdadm up $raid_name"
    
    # 5. Настройка primary/secondary и синхронизация
    echo "Настройка primary/secondary и начало синхронизации..."
    remote_exec "$server1" "$port1" "drbdadm primary --force $raid_name"
    
    # 6. Создание файловой системы на DRBD устройстве
    echo "Создание XFS на DRBD устройстве..."
    remote_exec "$server1" "$port1" "mkfs.xfs -f /dev/drbd0"
    
    # 7. Монтирование DRBD на сервере и экспорт через NFS
    echo "Монтирование DRBD и экспорт через NFS..."
    remote_exec "$server1" "$port1" "mkdir -p /mnt/drbd/$raid_name && mount /dev/drbd0 /mnt/drbd/$raid_name"
    remote_exec "$server1" "$port1" "chmod 777 /mnt/drbd/$raid_name"
    remote_exec "$server1" "$port1" "grep -v '/mnt/drbd/$raid_name' /etc/exports > /tmp/exports.tmp || echo '# NFS exports' > /tmp/exports.tmp"
    remote_exec "$server1" "$port1" "mv /tmp/exports.tmp /etc/exports"
    remote_exec "$server1" "$port1" "echo '/mnt/drbd/$raid_name $CLIENT_IP(rw,sync,no_subtree_check,no_root_squash,insecure)' >> /etc/exports"
    remote_exec "$server1" "$port1" "exportfs -ra"
    
    # 8. Добавляем в fstab на сервере
    local mount_options="defaults,nofail,noatime,x-systemd.device-timeout=30"
    remote_exec "$server1" "$port1" "grep -v '/mnt/drbd/$raid_name' /etc/fstab > /tmp/fstab.new"
    remote_exec "$server1" "$port1" "mv /tmp/fstab.new /etc/fstab"
    remote_exec "$server1" "$port1" "echo '/dev/drbd0 /mnt/drbd/$raid_name xfs $mount_options 0 0' >> /etc/fstab"
    
    # 9. Возвращаем информацию о новом RAID
    echo "$server1:/mnt/drbd/$raid_name:$letter"
}

# Настроить RAID-0 (чередование) через LVM и iSCSI
setup_raid0_stripe() {
    local disk1_info="$1"
    local disk2_info="$2"
    local raid_name="$3"
    
    # Извлечь информацию о дисках
    IFS=':' read -r server1 disk1 letter <<< "$disk1_info"
    IFS=':' read -r server2 disk2 _ <<< "$disk2_info"
    
    # Получаем порты для SSH
    local port1=$(echo "${SSH_PORTS[@]}" | grep -o "$server1:[0-9]*" | cut -d':' -f2)
    local port2=$(echo "${SSH_PORTS[@]}" | grep -o "$server2:[0-9]*" | cut -d':' -f2)
    
    echo "Проверка RAID-0 (чередование) между $server1:$disk1 и $server2:$disk2 как $letter:"
    
    # Проверка наличия данных на дисках
    echo "Проверка наличия данных на дисках..."
    local has_data1=$(check_data_exists "/dev/$disk1" "$server1" "$port1")
    local has_data2=$(check_data_exists "/dev/$disk2" "$server2" "$port2")
    
    # Проверка существования устройств
    if [ "$has_data1" == "not_exists" ]; then
        echo -e "${RED}ОШИБКА: Диск /dev/$disk1 не существует на сервере $server1${NC}"
        return 1
    fi
    
    if [ "$has_data2" == "not_exists" ]; then
        echo -e "${RED}ОШИБКА: Диск /dev/$disk2 не существует на сервере $server2${NC}"
        return 1
    fi
    
    # Проверка наличия данных и запрос подтверждения
    if [ "$has_data1" == "true" ]; then
        if ! ask_for_format_confirmation "/dev/$disk1" "$server1" "0"; then
            echo "Настройка RAID-0 отменена пользователем для сохранения данных."
            return 1
        fi
    fi
    
    if [ "$has_data2" == "true" ]; then
        if ! ask_for_format_confirmation "/dev/$disk2" "$server2" "0"; then
            echo "Настройка RAID-0 отменена пользователем для сохранения данных."
            return 1
        fi
    fi
    
    echo "Настройка RAID-0 (чередование) между $server1:$disk1 и $server2:$disk2 как $letter:"
    
    # 1. Установка iSCSI target на обоих серверах
    echo "Установка iSCSI target на серверах..."
    remote_exec "$server1" "$port1" "apt-get update && apt-get install -y tgt"
    remote_exec "$server2" "$port2" "apt-get update && apt-get install -y tgt"
    
    # 2. Настройка iSCSI target на обоих серверах
    local target1="${ISCSI_TARGET_PREFIX}.${raid_name}.1"
    local target2="${ISCSI_TARGET_PREFIX}.${raid_name}.2"
    
    remote_exec "$server1" "$port1" "tgtadm --lld iscsi --op new --mode target --tid 1 --targetname $target1 && tgtadm --lld iscsi --op new --mode logicalunit --tid 1 --lun 1 --backing-store /dev/$disk1"
    remote_exec "$server2" "$port2" "tgtadm --lld iscsi --op new --mode target --tid 1 --targetname $target2 && tgtadm --lld iscsi --op new --mode logicalunit --tid 1 --lun 1 --backing-store /dev/$disk2"
    
    # 3. Установка iSCSI initiator на клиенте
    echo "Установка iSCSI initiator на клиенте..."
    apt-get update && apt-get install -y open-iscsi lvm2 mdadm
    
    # 4. Подключение к iSCSI target
    echo "Подключение к iSCSI targets..."
    iscsiadm -m discovery -t sendtargets -p $server1
    iscsiadm -m discovery -t sendtargets -p $server2
    iscsiadm -m node --targetname $target1 --portal $server1:3260 --login
    iscsiadm -m node --targetname $target2 --portal $server2:3260 --login
    
    # 5. Дождемся, пока устройства появятся в системе
    echo "Ожидание появления устройств..."
    sleep 5
    
    # 6. Получение имен устройств
    local iscsi_dev1=$(ls -l /dev/disk/by-path/*$target1* 2>/dev/null | awk '{print $NF}' | awk -F/ '{print $NF}')
    local iscsi_dev2=$(ls -l /dev/disk/by-path/*$target2* 2>/dev/null | awk '{print $NF}' | awk -F/ '{print $NF}')
    
    if [ -z "$iscsi_dev1" ] || [ -z "$iscsi_dev2" ]; then
        echo -e "${RED}ОШИБКА: Не удалось найти iSCSI устройства. Попробуйте выполнить поиск вручную.${NC}"
        iscsi_dev1=$(find /dev/disk/by-path -name "*iscsi*" | head -1)
        iscsi_dev2=$(find /dev/disk/by-path -name "*iscsi*" | tail -1)
        
        if [ -z "$iscsi_dev1" ] || [ -z "$iscsi_dev2" ]; then
            echo -e "${RED}ОШИБКА: iSCSI устройства не обнаружены. Невозможно создать RAID-0.${NC}"
            return 1
        fi
    fi
    
    echo "Обнаружены устройства: $iscsi_dev1 и $iscsi_dev2"
    
    # 7. Создание RAID-0 с помощью mdadm
    echo "Создание RAID-0 с помощью mdadm..."
    mkdir -p /dev/md
    mdadm --create /dev/md/$raid_name --level=0 --raid-devices=2 /dev/$iscsi_dev1 /dev/$iscsi_dev2
    
    # 8. Создание файловой системы на RAID
    echo "Создание XFS на RAID-0 устройстве..."
    mkfs.xfs -f /dev/md/$raid_name
    
    # 9. Монтирование RAID
    echo "Монтирование RAID-0..."
    mkdir -p /mnt/raid0/$raid_name
    mount /dev/md/$raid_name /mnt/raid0/$raid_name
    chmod 777 /mnt/raid0/$raid_name
    
    # 10. Добавляем в fstab на клиенте
    local mount_options="defaults,nofail,noatime,x-systemd.device-timeout=30"
    grep -v "/mnt/raid0/$raid_name" /etc/fstab > /tmp/fstab.new
    mv /tmp/fstab.new /etc/fstab
    echo "/dev/md/$raid_name /mnt/raid0/$raid_name xfs $mount_options 0 0" >> /etc/fstab
    
    # 11. Возвращаем информацию о новом RAID
    echo "/mnt/raid0/$raid_name:$letter"
}