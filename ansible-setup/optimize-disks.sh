#!/bin/bash

# Скрипт для оптимизации работы с дисками и ускорения выполнения Ansible
# Запускается на хосте перед основным Ansible скриптом

# Для ускорения монтирования дисков
echo "Оптимизация кэша файловой системы..."
echo 3 > /proc/sys/vm/drop_caches
echo 1024 > /proc/sys/vm/nr_hugepages

# Увеличиваем лимиты для файловой системы
echo "Оптимизация параметров файловой системы..."
sysctl -w fs.file-max=500000
sysctl -w vm.dirty_ratio=80
sysctl -w vm.dirty_background_ratio=5
sysctl -w vm.dirty_expire_centisecs=12000

# Оптимизация монтирования NFS
echo "Оптимизация параметров NFS..."
sysctl -w sunrpc.tcp_slot_table_entries=128
echo Y > /sys/module/sunrpc/parameters/tcp_slot_table_entries
echo "options sunrpc tcp_slot_table_entries=128" > /etc/modprobe.d/sunrpc.conf

# Оптимизация размера буферов TCP
echo "Оптимизация сетевых буферов..."
sysctl -w net.core.rmem_default=262144
sysctl -w net.core.rmem_max=16777216
sysctl -w net.core.wmem_default=262144
sysctl -w net.core.wmem_max=16777216
sysctl -w net.core.netdev_max_backlog=300000

# Разгон файловой системы NFS
echo "Настройка оптимальных параметров монтирования NFS..."
echo "Увеличиваем размер буферов чтения/записи и включаем агрессивный кэш"
echo "
options nfs rsize=262144 wsize=262144
options nfs nfs4_disable_idmapping=1
options nfs noatime lookupcache=all" > /etc/modprobe.d/nfs-performance.conf

# Ускорение работы с NTFS
echo "Оптимизация драйвера NTFS..."
echo "
options ntfs max_prealloc_size=64M
options ntfs big_writes=1
options ntfs compression=1" > /etc/modprobe.d/ntfs-performance.conf

# Применяем изменения
echo "Применение оптимизаций..."
sysctl -p

echo "Оптимизация выполнена!" 