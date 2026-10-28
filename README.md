# Практична 5 — MasterHub: надійний CRUD API

## Що зроблено
- **ADR 0001** — обрано модульний моноліт (`docs/adr/0001-architecture-style.md`).
- **ADR 0002** — шарова архітектура `api/ → service/ → domain/` + `repository/` (`docs/adr/0002-layered-architecture.md`).
- **ADR 0003** — стиль REST і єдиний формат помилки (`docs/adr/0003-api-style-and-error-model.md`).
- **Контракт API** — `docs/api/openapi.yaml`, CRUD для `Order` (піддомен Booking з Практичної 3). Перевірено: валідний OpenAPI 3.0.3.
- **Реалізація CRUD** — `api/orders.routes.js` (HTTP), `service/orders.service.js` (валідація, use-cases), `domain/booking/Order.js` (з Практичної 3), `repository/` (in-memory для тестів + SQLite для реального запуску).
- **`GET /health`** — повертає `{ "status": "ok" }`.
- **Надійність API** — `X-Request-Id` у заголовку та помилках, єдиний формат помилки, обов'язковий `Idempotency-Key` для POST, replay результату, rate limit (`429` + `Retry-After`), timeout/retry helper для залежностей і degraded-відповідь `503`.
- **Юніт-тести** — `tests/orders.service.test.js`, 4 тести (2 успішні, 2 помилкові), запускаються вбудованим тест-раннером Node.

## Як запустити

```bash
npm install
npm run init-db      # очистити й заново створити таблицю orders      # опційно, якщо хочеш почати з чистою SQLite-базою
npm start             # http://localhost:8080
npm test              # прогнати юніт-тести
```

Для ручної перевірки reliability-сценаріїв:

```bash
curl -i http://localhost:8080/health
curl -i -X POST http://localhost:8080/orders -H "Content-Type: application/json" -d '{"clientId":"c-1","masterId":"m-1","serviceId":"s-1","scheduledAt":"2026-09-20T10:00:00Z"}'
curl -i -X POST http://localhost:8080/orders -H "Content-Type: application/json" -H "Idempotency-Key: demo-1" -d '{"clientId":"c-1","masterId":"m-1","serviceId":"s-1","scheduledAt":"2026-09-20T10:00:00Z"}'
# Повторити останню команду: відповідь і id замовлення будуть тотожними.
```

Ліміт можна налаштувати змінними `RATE_LIMIT` і `RATE_LIMIT_WINDOW_MS` перед `npm start`.

## Перевірка вручну

```bash
curl http://localhost:8080/health
curl -X POST http://localhost:8080/orders \
  -H "Content-Type: application/json" \
  -d '{"clientId":"c-1","masterId":"m-1","serviceId":"s-1","scheduledAt":"2026-09-20T10:00:00Z"}'
curl http://localhost:8080/orders
```

## Практична 6 — Docker web → API → PostgreSQL

У Практичній 6 додано контейнеризацію MasterHub:

- `web` — Nginx зі статичним frontend на `http://localhost:3000`;
- `api` — Node/Express на `http://localhost:8080`;
- `db` — PostgreSQL 16 із healthcheck;
- `postgres-data` — named volume для збереження даних;
- `repository/PostgresOrdersRepository.js` — CRUD через `pg` і `DATABASE_URL`;
- `web/nginx.conf` — proxy `/orders` і `/health` до API;
- `docs/practical6-defense.md` — детальна підказка для захисту.

### Запуск і перевірка Docker Desktop

Переконайся, що Docker Desktop запущений, і перевір Docker:

```bash
docker run hello-world
```

Перевірити підсумкову Compose-конфігурацію:

```bash
docker compose config
```

Зібрати та запустити стек:

```bash
docker compose up -d --build
```

Перевірити статус:

```bash
docker compose ps
```

Очікується, що `api` і `web` мають статус `Up`, а `db` — `Up (healthy)`.

### Перевірка health, frontend та API

API:

```bash
curl -i http://localhost:8080/health
```

Очікувана відповідь: `200` і `{"status":"ok"}`.

Frontend відкривається у браузері:

```text
http://localhost:3000
```

CRUD через Nginx можна перевірити так:

```bash
curl -i -X POST http://localhost:3000/orders ^
  -H "Content-Type: application/json" ^
  -H "Idempotency-Key: practical6-demo-1" ^
  -d "{\"clientId\":\"c-6\",\"masterId\":\"m-6\",\"serviceId\":\"s-6\",\"scheduledAt\":\"2026-10-28T12:00:00Z\"}"
curl -i http://localhost:3000/orders
```

### Перевірка PostgreSQL через `psql`

```bash
docker compose exec db psql -U masterhub -d masterhub -c "\dt"
docker compose exec db psql -U masterhub -d masterhub -c "\d orders"
docker compose exec db psql -U masterhub -d masterhub -c "SELECT count(*) FROM orders;"
docker compose exec db psql -U masterhub -d masterhub -c "SELECT id, status, \"clientId\" FROM orders;"
```

### Логи, restart і persistence

Переглянути логи:

```bash
docker compose logs
docker compose logs -f api
docker compose logs db
```

Перевірити збереження даних після перезапуску:

```bash
docker compose restart
curl http://localhost:3000/orders
```

Зупинити стек без видалення PostgreSQL volume:

```bash
docker compose down
```

Не використовуй `docker compose down -v`, якщо потрібно зберегти дані.

### Типові питання

- **Чому `db`, а не `localhost`?** У Compose сервіси звертаються один до одного через DNS-ім'я сервісу.
- **Навіщо healthcheck?** Контейнер може бути запущений до того, як PostgreSQL готовий приймати з'єднання.
- **Чи працює persistence?** Так, дані зберігаються у named volume `postgres-data`.
- **Що буде без PostgreSQL?** API повертає зрозумілий `503` degraded mode; локально без `DATABASE_URL` зберігається SQLite/in-memory fallback.
- **Де повний сценарій захисту?** У `docs/practical6-defense.md`.