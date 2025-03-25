import http.server
import socketserver
import socket
import os

# Используем другой порт, чтобы избежать конфликта с уже запущенным сервером
PORT = 8081

# Получаем локальный IP-адрес для отображения
def get_local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # Подключается к внешнему адресу для определения интерфейса
        s.connect(('10.255.255.255', 1))
        IP = s.getsockname()[0]
    except:
        IP = '127.0.0.1'
    finally:
        s.close()
    return IP

# Проверяем наличие preseed-файла в текущей директории
def check_file():
    file_to_check = 'preseed_server.cfg'
    if not os.path.isfile(file_to_check):
        print(f"ОШИБКА: Файл {file_to_check} не найден в текущей директории!")
        print(f"Создайте файл {file_to_check} перед запуском этого скрипта.")
        return False
    return True

# Запускаем простой HTTP-сервер
ip_address = get_local_ip()

# Проверяем наличие файла перед запуском сервера
if not check_file():
    exit(1)

print("\n--- HTTP-сервер для раздачи preseed_server.cfg ---")
print(f"Локальный IP-адрес: {ip_address}")
print(f"Порт: {PORT}")
print("\nPreseed-файл доступен по URL:")
print(f"http://{ip_address}:{PORT}/preseed_server.cfg")

print("\nДля использования в установщике Debian добавьте параметры загрузки:")
print(f"auto=true priority=critical url=http://{ip_address}:{PORT}/preseed_server.cfg")

print("\nНажмите Ctrl+C для остановки сервера...")

with socketserver.TCPServer(("0.0.0.0", PORT), http.server.SimpleHTTPRequestHandler) as httpd:
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nСервер остановлен")