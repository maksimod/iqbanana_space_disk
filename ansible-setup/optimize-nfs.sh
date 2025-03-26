#!/bin/bash

# Скрипт для диагностики и оптимизации NFS производительности
# Предназначен для запуска после установки и настройки NFS

# Проверяем, запущен ли скрипт с правами root
if [ "$(id -u)" -ne 0 ]; then
    echo "ОШИБКА: Этот скрипт должен быть запущен с правами root"
    echo "Используйте: sudo $0"
    exit 1
fi

echo "========================================================"
echo "     НАЧАЛО ДИАГНОСТИКИ И ОПТИМИЗАЦИИ NFS              "
echo "========================================================"

# Определяем тип узла (сервер или клиент)
is_server=false
is_client=false

if systemctl is-active --quiet nfs-kernel-server; then
    is_server=true
    echo "Обнаружен NFS сервер"
fi

if mount | grep -q nfs; then
    is_client=true
    echo "Обнаружен NFS клиент"
fi

# Проверка текущих системных параметров
echo -e "\n[Текущие параметры ядра]"
sysctl -a | grep -E 'nfs|tcp_rmem|tcp_wmem|dirty|vm.min_free|sunrpc'

# Применение оптимизаций для всех узлов
echo -e "\n[Применение оптимизаций ядра для NFS]"

# Оптимизация TCP
sysctl -w net.core.rmem_default=4194304
sysctl -w net.core.wmem_default=4194304
sysctl -w net.core.rmem_max=16777216
sysctl -w net.core.wmem_max=16777216
sysctl -w net.ipv4.tcp_rmem="4096 87380 16777216"
sysctl -w net.ipv4.tcp_wmem="4096 65536 16777216"
sysctl -w net.ipv4.tcp_low_latency=1
sysctl -w net.core.netdev_max_backlog=2500

# Оптимизация нагрузки на диск
sysctl -w vm.dirty_ratio=80
sysctl -w vm.dirty_background_ratio=5
sysctl -w vm.dirty_expire_centisecs=12000

# Оптимизация NFS
sysctl -w sunrpc.tcp_slot_table_entries=128

# Очистка кэшей для измерения производительности
echo -e "\n[Очистка кэшей файловой системы]"
echo 3 > /proc/sys/vm/drop_caches

# Специальные оптимизации для сервера
if [ "$is_server" = true ]; then
    echo -e "\n[Оптимизация NFS сервера]"
    
    # Увеличение числа NFS демонов
    if grep -q "RPCNFSDCOUNT" /etc/default/nfs-kernel-server; then
        sed -i 's/^RPCNFSDCOUNT=.*/RPCNFSDCOUNT=128/' /etc/default/nfs-kernel-server
    else
        echo "RPCNFSDCOUNT=128" >> /etc/default/nfs-kernel-server
    fi
    
    # Перезапуск NFS сервера
    systemctl restart nfs-kernel-server
    
    # Проверка экспортов
    echo -e "\n[Проверка NFS экспортов]"
    exportfs -v
fi

# Специальные оптимизации для клиента
if [ "$is_client" = true ]; then
    echo -e "\n[Оптимизация NFS клиента]"
    
    # Получение списка NFS монтирований
    nfs_mounts=$(mount | grep nfs | awk '{print $3}')
    
    if [ -z "$nfs_mounts" ]; then
        echo "NFS монтирований не обнаружено"
    else
        echo "Найдены следующие NFS монтирования:"
        mount | grep nfs
        
        echo -e "\n[Обновление опций монтирования для лучшей производительности]"
        
        # Размонтируем и перемонтируем с оптимальными параметрами
        for mount_point in $nfs_mounts; do
            # Получаем источник для текущей точки монтирования
            source=$(mount | grep -E "$mount_point\\s" | awk '{print $1}')
            
            if [ -n "$source" ]; then
                echo "Перемонтирование $source на $mount_point с оптимизированными параметрами"
                
                # Размонтирование
                umount -f "$mount_point" 2>/dev/null || umount -l "$mount_point"
                
                # Перемонтирование с оптимизированными параметрами
                mount -t nfs -o rw,soft,tcp,noatime,nodiratime,rsize=1048576,wsize=1048576,timeo=600,retrans=2,noresvport,_netdev,bg,nofail,nconnect=16,fsc,actimeo=600,nocto,noac,lookupcache=positive,local_lock=none "$source" "$mount_point"
                
                # Обновление fstab
                if grep -q "$source" /etc/fstab; then
                    sed -i "s|$source.*|$source $mount_point nfs rw,soft,tcp,noatime,nodiratime,rsize=1048576,wsize=1048576,timeo=600,retrans=2,noresvport,_netdev,bg,nofail,nconnect=16,fsc,actimeo=600,nocto,noac,lookupcache=positive,local_lock=none 0 0|" /etc/fstab
                else
                    echo "$source $mount_point nfs rw,soft,tcp,noatime,nodiratime,rsize=1048576,wsize=1048576,timeo=600,retrans=2,noresvport,_netdev,bg,nofail,nconnect=16,fsc,actimeo=600,nocto,noac,lookupcache=positive,local_lock=none 0 0" >> /etc/fstab
                fi
            fi
        done
    fi
fi

# Проверка текущих параметров монтирования
echo -e "\n[Текущие параметры монтирования]"
mount | grep nfs

# Тест производительности
echo -e "\n[Запуск теста производительности]"

# Находим NFS монтирования
nfs_mounts=$(mount | grep nfs | awk '{print $3}')

if [ -z "$nfs_mounts" ]; then
    echo "NFS монтирований не обнаружено, тест невозможен"
else
    # Берем первое монтирование для тестирования
    test_mount=$(echo "$nfs_mounts" | head -1)
    
    echo "Тестирование на $test_mount"
    
    # Создаем тестовый файл размером 1GB
    echo "Создание тестового файла (1GB)..."
    dd if=/dev/zero of="$test_mount/test_file" bs=1M count=1024 conv=fsync 2>&1
    
    # Тест скорости чтения
    echo -e "\nТест скорости чтения:"
    echo "3" > /proc/sys/vm/drop_caches  # Очистка кэша перед тестом
    dd if="$test_mount/test_file" of=/dev/null bs=1M 2>&1
    
    # Тест скорости записи
    echo -e "\nТест скорости записи:"
    dd if=/dev/zero of="$test_mount/test_file2" bs=1M count=1024 conv=fsync 2>&1
    
    # Очистка
    rm -f "$test_mount/test_file" "$test_mount/test_file2"
fi

echo -e "\n[Рекомендации]"
echo "1. Добавьте следующие строки в /etc/sysctl.conf для сохранения оптимизаций:"
echo "   net.core.rmem_default = 4194304"
echo "   net.core.wmem_default = 4194304"
echo "   net.core.rmem_max = 16777216"
echo "   net.core.wmem_max = 16777216"
echo "   net.ipv4.tcp_rmem = 4096 87380 16777216"
echo "   net.ipv4.tcp_wmem = 4096 65536 16777216"
echo "   net.ipv4.tcp_low_latency = 1"
echo "   net.core.netdev_max_backlog = 2500"
echo "   vm.dirty_ratio = 80"
echo "   vm.dirty_background_ratio = 5"
echo "   vm.dirty_expire_centisecs = 12000"
echo "   sunrpc.tcp_slot_table_entries = 128"
echo "2. Выполните команду 'sysctl -p' для применения изменений"

echo -e "\n[Готово]"
echo "Оптимизация NFS завершена"

exit 0