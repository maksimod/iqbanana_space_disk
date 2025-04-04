# Скрипты для управления хранилищем и резервным копированием

В этой директории содержатся скрипты для настройки и управления дисками, а также для создания резервных копий.

## Настройка MongoDB

Скрипт `setup_mongodb.sh` устанавливает и настраивает MongoDB для работы с системой.

```bash
sudo ./setup_mongodb.sh
```

## Резервное копирование

### Создание резервной копии

Скрипт `make_backup.sh` создает резервную копию указанного диска и отправляет статус процесса через API.

```bash
./make_backup.sh disk_name backup_path api_key api_url [interval]
```

Параметры:
- `disk_name` - Имя диска для бэкапа
- `backup_path` - Путь для сохранения бэкапов
- `api_key` - Ключ API для отправки статусов (должен совпадать с backupApiKey в config.js)
- `api_url` - URL API сервера (например: http://localhost:6005)
- `interval` - Интервал резервного копирования (daily, weekly, monthly) - опционально

### Настройка расписания для резервного копирования

Скрипт `setup_backup_cron.sh` настраивает cron-задание для автоматического создания резервных копий:

```bash
./setup_backup_cron.sh disk_name api_key api_url backup_path [interval]
```

Параметры:
- `disk_name` - Имя диска для бэкапа
- `api_key` - Ключ API для отправки статусов
- `api_url` - URL API сервера (например: http://localhost:6005)
- `backup_path` - Путь для сохранения бэкапов
- `interval` - Интервал бэкапов (daily, weekly, monthly). По умолчанию: daily

Интервалы резервного копирования:
- `daily` - Ежедневно в 2:00
- `weekly` - Еженедельно в воскресенье в 3:00
- `monthly` - Ежемесячно 1-го числа в 4:00

## Статусы резервного копирования

Скрипт резервного копирования отправляет статусы через API, которые затем отображаются в веб-интерфейсе:

- `PROCESSING` - Процесс резервного копирования запущен
- `SUCCESS` - Резервное копирование успешно завершено
- `ERROR` - Произошла ошибка при резервном копировании

## Примеры использования

### Создание разового бэкапа

```bash
./make_backup.sh C /mnt/backups backup_system_api_key_secure http://localhost:6005
```

### Настройка ежедневного бэкапа

```bash
./setup_backup_cron.sh C backup_system_api_key_secure http://localhost:6005 /mnt/backups daily
```

### Настройка еженедельного бэкапа

```bash
./setup_backup_cron.sh C backup_system_api_key_secure http://localhost:6005 /mnt/backups weekly
``` 