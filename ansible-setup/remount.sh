# Создаем скрипт для перемонтирования
cat > /tmp/remount_nfs.sh << 'EOL'
#!/bin/bash
echo "Перемонтирование NFS с оптимизированными параметрами..."

# Размонтируем все NFS каталоги
for mount in $(mount | grep nfs | awk '{print $3}'); do
  echo "Размонтирование $mount"
  umount -f $mount 2>/dev/null || umount -l $mount
done

# Размонтируем диски командой с принудительными опциями
umount -f -l /mnt/storage/sdb 2>/dev/null || true
umount -f -l /mnt/storage/sdc 2>/dev/null || true

# Перемонтируем с оптимизированными параметрами
mkdir -p /mnt/storage/sdb /mnt/storage/sdc

# Параметры оптимизированы для больших файлов
mount -t nfs -o rw,soft,timeo=600,retrans=3,noatime,_netdev,rsize=1048576,wsize=1048576,nconnect=16,lookupcache=positive,fsc,actimeo=600,nolock,local_lock=none,tcp,bg,nofail 192.168.0.108:/mnt/storage/sdb /mnt/storage/sdb
mount -t nfs -o rw,soft,timeo=600,retrans=3,noatime,_netdev,rsize=1048576,wsize=1048576,nconnect=16,lookupcache=positive,fsc,actimeo=600,nolock,local_lock=none,tcp,bg,nofail 192.168.0.108:/mnt/storage/sdc /mnt/storage/sdc

# Проверяем результат
echo "Статус монтирования:"
mount | grep nfs

echo "Выполнено!"
EOL

chmod +x /tmp/remount_nfs.sh
sudo /tmp/remount_nfs.sh