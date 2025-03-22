# На сервере apper проверьте, что диски успешно смонтированы
df -h | grep /mnt/disk_
mount | grep sshfs