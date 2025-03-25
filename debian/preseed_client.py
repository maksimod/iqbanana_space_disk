import http.server
import socketserver

PORT = 8080  # Изменили порт с 8000 на 8080
Handler = http.server.SimpleHTTPRequestHandler

with socketserver.TCPServer(("0.0.0.0", PORT), Handler) as httpd:
    print(f"Сервер запущен на порту {PORT}")
    print(f"Preseed-файл доступен по адресу: http://192.168.0.102:{PORT}/preseed_client.cfg")
    httpd.serve_forever()