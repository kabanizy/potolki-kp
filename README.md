# Калькулятор КП — потолочная1.рф

Production-контур Node.js/Express/SQLite для двух адресов:

- `https://kp.potolochnaya1.ru` — основной адрес и адрес публичных КП;
- `https://кп.потолочная1.рф` — дополнительный адрес калькулятора.

## Состав

- `app` — приложение Node.js 24 в отдельном Docker-контейнере;
- `caddy` — reverse proxy, HTTP→HTTPS, автоматическое получение и продление сертификата Let's Encrypt;
- `data/` — постоянные данные SQLite, исключённые из Git;
- Docker `restart: unless-stopped` — восстановление контейнеров после падения и перезагрузки;
- systemd unit — запуск Compose-проекта при старте VPS;
- systemd timer — перезапуск контейнеров с состоянием `unhealthy`;
- ежедневная согласованная резервная копия SQLite с хранением 14 дней;
- ротация Docker-логов.

## Запуск

```bash
cp .env.example .env
# Задать APP_USER и APP_PASS в .env
docker compose up -d --build
docker compose ps
```

DNS A-записи обоих доменов должны указывать на `62.217.178.110`, а порты 80 и 443 должны быть доступны извне.
