#!/bin/bash

# Проверка fstab на сервере
echo "========== Проверка fstab на сервере =========="
ssh root@192.168.0.102 "cat /etc/fstab | grep -v '^#'"

echo 
echo "========== Проверка fstab на клиенте =========="
cat /etc/fstab | grep -v '^#'

echo
echo "========== Проверка смонтированных NFS дисков =========="
df -h | grep -E 'nfs|192.168.0.108'