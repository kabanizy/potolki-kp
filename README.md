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

## Возможности калькулятора

- подробный расчёт по общей базе позиций;
- автоматическое добавление «Установки полотна» по количеству выбранного полотна;
- ручное изменение цены позиции внутри конкретного расчёта;
- быстрый расчёт с произвольными строками и готовыми суммами;
- единая история подробных и быстрых расчётов;
- КП с отдельными блоками «Полотна», «Услуги и материалы» и «Товары»;
- управление категориями, позициями, ценами и единицами на странице `/prices.html`.

## Запуск

```bash
cp .env.example .env
# Задать APP_USER и APP_PASS в .env
docker compose up -d --build
docker compose ps
```

DNS A-записи обоих доменов должны указывать на `62.217.178.110`, а порты 80 и 443 должны быть доступны извне.


### v19 updates
- Quick calculation fields explicitly show units: `Площадь помещения, м²` and `Периметр помещения, м`.
- Added a one-time `Добавить строку` action for the current quick calculation without changing permanent settings.
- Quick settings order is displayed from 1 with an explanation.
- Prices-page title/brand links back to the calculator homepage.
- History and KP date/time displays now include seconds.


### v20 updates
- Quick calculation area/perimeter use explicit units and compact fields.
- Detailed calculation quantity steppers now increment by whole units.
- Auto installation of the canvas is added once with quantity 1 regardless of canvas quantity.
- Auto-installation price and quantity are editable directly in the "В расчёт вошло" block; the edit is local to the current calculation.


### v21
- Persistent room area/perimeter fields moved above detailed/quick calculation.
- Area/perimeter are no longer quick-calculation categorized rows.
- Auto installation edit inputs have explicit borders.
- Room area/perimeter persist in calculations.

### v22
- «Площадь помещения» и «Периметр помещения» полностью удаляются из постоянных настроек быстрого расчёта, включая ранее сохранённые строки.
- После добавления или удаления строки порядок автоматически пересчитывается без повторного открытия настроек.
- Удаление постоянной строки применяется сразу; кнопка сохранения остаётся для названия, раздела и новых строк.
- Локальный вход по умолчанию и пример окружения используют `manager` / `potolki2026`.

### v23
- Поле «Порядок» снова доступно для изменения.
- При вводе номера строка сразу перемещается на выбранную позицию, а остальные номера автоматически пересчитываются.
- Перестановка выполняется без полной перерисовки настроек и с небольшой задержкой для серии быстрых нажатий, поэтому интерфейс не зависает.
