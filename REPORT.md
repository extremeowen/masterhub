# Практична робота 9: Теоретична схема Kubernetes-додатку

> **Проєкт**: MasterHub (курсовий проєкт)  
> **Сервіс**: MasterHub API (`extremeowen/masterhub`)  
> **Інтерактивна схема**: [`k8s_architecture_diagram.html`](./k8s_architecture_diagram.html)  

---

## 1. Обраний сервіс із курсового проєкту

Для виконання практичної роботи обрано основний бекенд-сервіс курсового проєкту — **MasterHub API**.

- **Призначення**: REST API сервіс платформи пошуку та замовлення послуг верифікованих майстрів (сантехніки, електрики, ремонтники тощо). Сервіс відповідає за обробку запитів бронювання майстрів, валідацію вхідних даних, ідемпотентне створення замовлень, перевірку працездатності та роботу з базою даних PostgreSQL.
- **Користувачі**: Клієнти платформи (пошук майстрів, бронювання слотів, створення замовлень) та Майстри (отримання замовлень, оновлення статусів робіт).
- **Основні ендпоінти**:
  - `GET /health` — перевірка працездатності сервісу та підключення до БД.
  - `GET /orders` — отримання списку замовлень.
  - `POST /orders` — ідемпотентне створення нового замовлення (з обов'язковим `Idempotency-Key` та `X-Request-Id`).
  - `GET /orders/:id` — деталі конкретного замовлення.
  - `PUT /orders/:id` — оновлення замовлення / зміна статусу.
- **Технологічний стек**: Node.js 22, Express 5, PostgreSQL 16 (збереження замовлень), Docker, GitHub Actions (CI/CD), GHCR.

---

## 2. Діаграма архітектури додатку в Kubernetes

```mermaid
flowchart TD
    subgraph external["🌐 Зовнішній трафік (Public Network)"]
        User["👤 Користувач / Клієнт<br/>(Браузер / Web / Mobile)"]
        DNS["🌐 DNS-сервер<br/>api.masterhub.ua → IP Load Balancer"]
        LB["⚖️ Cloud Load Balancer / Gateway<br/>Порти: 80 / 443 (TLS termination)"]
    end

    subgraph k8s["☸ Kubernetes Cluster"]
        subgraph ns["Namespace: masterhub-prod"]
            
            Ingress["🚪 Ingress Controller (nginx-ingress)<br/>Host: api.masterhub.ua<br/>Path: /orders, /health"]
            
            Service["🔀 Service: masterhub-api-svc<br/>Type: ClusterIP<br/>Port: 80 → TargetPort: 8080<br/>(kube-proxy / Endpoints)"]
            
            subgraph deploy["📦 Deployment: masterhub-api (Replicas: 2)"]
                Pod1["🟢 Pod 1 (masterhub-api)<br/>Container: ghcr.io/extremeowen/masterhub-api:1.0.0<br/>Port: 8080<br/>Liveness: /health | Readiness: /health"]
                Pod2["🟢 Pod 2 (masterhub-api)<br/>Container: ghcr.io/extremeowen/masterhub-api:1.0.0<br/>Port: 8080<br/>Liveness: /health | Readiness: /health"]
            end

            CM["📋 ConfigMap: masterhub-config<br/>PORT=8080<br/>NODE_ENV=production<br/>RATE_LIMIT=60"]
            Secret["🔐 Secret: masterhub-secret<br/>DATABASE_URL=postgresql://...<br/>POSTGRES_PASSWORD=***"]

            DBSvc["🔀 Service: masterhub-db-svc<br/>Type: ClusterIP<br/>Port: 5432"]

            subgraph dbdeploy["StatefulSet: masterhub-db"]
                DBPod["🐘 Pod: PostgreSQL 16<br/>Image: postgres:16-alpine<br/>PVC: 10Gi (Persistent Storage)"]
            end
        end
    end

    subgraph cicd["🔄 Розробка та CI/CD Pipeline"]
        GitRepo["📂 Git Repository<br/>github.com/extremeowen/masterhub"]
        GHA["⚙️ CI/CD: GitHub Actions (.github/workflows/ci.yml)<br/>1. Checkout & npm ci<br/>2. npm test<br/>3. docker build -t masterhub-api<br/>4. docker push"]
        GHCR["📦 Container Registry (GHCR)<br/>ghcr.io/extremeowen/masterhub-api:1.0.0"]
    end

    %% Маршрутизація трафіку
    User -->|HTTPS запит| DNS
    DNS -->|IP адреса| LB
    LB -->|Вхідний трафік| Ingress
    Ingress -->|Маршрутизація за Host та Path| Service
    Service -->|Балансування round-robin| Pod1
    Service -->|Балансування round-robin| Pod2
    Pod1 -->|TCP 5432 (Запити до БД)| DBSvc
    Pod2 -->|TCP 5432 (Запити до БД)| DBSvc
    DBSvc --> DBPod

    %% Підключення конфігурації
    CM -.->|envFrom| Pod1
    CM -.->|envFrom| Pod2
    Secret -.->|envFrom| Pod1
    Secret -.->|envFrom| Pod2

    %% CI/CD ланцюжок
    GitRepo -->|git push main| GHA
    GHA -->|docker push| GHCR
    GHCR -.->|image pull при старті| Pod1
    GHCR -.->|image pull при старті| Pod2
```

---

## 3. Зовнішня схема: від користувача до кластера

```
[ Клієнт / Браузер ]
         │ (1. HTTPS https://api.masterhub.ua/orders)
         ▼
[ DNS: api.masterhub.ua ] ──► резолвить в зовнішній IP балансувальника
         │ (2)
         ▼
[ Cloud Load Balancer ] ────► приймає трафік з інтернету (порти 80/443)
         │ (3)
         ▼
[ Kubernetes Ingress Controller (nginx) ]
         │
         │  Маршрутизація правил Ingress:
         │  • Host: api.masterhub.ua
         │  • Path: /orders, /health ──► направляє до masterhub-api-svc:80
         ▼
[ Kubernetes Cluster: masterhub-prod ]
```

- **Домен**: `api.masterhub.ua` (доменне ім'я публічного API сервісу).
- **Роль Ingress / Gateway**: є єдиною захищеною точкою входу в кластер (Single Point of Entry). На основі заголовка `Host: api.masterhub.ua` та префіксів шляхів (`/orders`, `/health`) маршрутизує запити до відповідного внутрішнього сервісу `masterhub-api-svc` без необхідності надавати кожному Pod-у публічну IP-адресу.

---

## 4. Внутрішня схема всередині кластера

```
┌─────────────────────────────────────── Kubernetes Cluster ──────────────────────────────────────┐
│                                                                                                  │
│  ┌──────────────────────────────── Namespace: masterhub-prod ─────────────────────────────────┐  │
│  │                                                                                             │  │
│  │  ┌─── ConfigMap: masterhub-config ───┐      ┌───── Secret: masterhub-secret ─────────────┐ │  │
│  │  │  PORT: "8080"                     │      │  DATABASE_URL: "postgresql://..."          │ │  │
│  │  │  NODE_ENV: "production"           │      │  POSTGRES_PASSWORD: "..."                  │ │  │
│  │  │  RATE_LIMIT: "60"                 │      └────────────────────────────────────────────┘ │  │
│  │  └───────────────────────────────────┘                                                     │  │
│  │                                                                                             │  │
│  │                            Ingress (api.masterhub.ua)                                       │  │
│  │                                        │                                                    │  │
│  │                                        ▼                                                    │  │
│  │                          Service: masterhub-api-svc                                         │  │
│  │                          Type: ClusterIP | Port: 80 → 8080                                  │  │
│  │                                  /            \                                             │  │
│  │                  (балансування) ▼              ▼ (балансування)                             │  │
│  │                 ┌───────────────────┐      ┌───────────────────┐                            │  │
│  │                 │       Pod 1       │      │       Pod 2       │                            │  │
│  │                 │  masterhub-api    │      │  masterhub-api    │   Deployment:              │  │
│  │                 │  Image: :1.0.0    │      │  Image: :1.0.0    │   masterhub-api            │  │
│  │                 │  Port: 8080       │      │  Port: 8080       │   Replicas: 2              │  │
│  │                 │  envFrom: CM/Sec  │      │  envFrom: CM/Sec  │                            │  │
│  │                 └───────────────────┘      └───────────────────┘                            │  │
│  │                           │                          │                                      │  │
│  │                           └────────────┬─────────────┘                                      │  │
│  │                                        ▼ (TCP 5432)                                         │  │
│  │                            Service: masterhub-db-svc                                        │  │
│  │                            Type: ClusterIP | Port: 5432                                     │  │
│  │                                        │                                                    │  │
│  │                                        ▼                                                    │  │
│  │                            ┌───────────────────────┐                                        │  │
│  │                            │     Pod: masterhub-db │   StatefulSet:                         │  │
│  │                            │   PostgreSQL 16-alpine│   masterhub-db                         │  │
│  │                            │   PVC: postgres-data  │   Replicas: 1                          │  │
│  │                            │   Port: 5432          │                                        │  │
│  │                            └───────────────────────┘                                        │  │
│  │                                                                                             │  │
│  └─────────────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

1. **Namespace**: `masterhub-prod` — логічна ізоляція ресурсів проєкту від системних компонентів та інших середовищ (dev/stage).
2. **Deployment**: `masterhub-api`
   - Ім'я: `masterhub-api`
   - Кількість реплік: **2**
   - Контейнерний образ: `ghcr.io/extremeowen/masterhub-api:1.0.0`
3. **Service**: `masterhub-api-svc`
   - Тип: `ClusterIP` (надає внутрішню віртуальну IP-адресу всередині кластера).
   - Порт: 80 транслюється на порт 8080 контейнера Pod-а.
   - Здійснює балансування запитів між обома репліками Pod-ів.
4. **Pod-и**:
   - 2 ідентичні репліки Pod-ів, кожен виконує контейнер MasterHub API.
   - Отримують трафік від `masterhub-api-svc`.
5. **База даних**:
   - `masterhub-db` (StatefulSet) з томом `PersistentVolumeClaim` (10Gi), до якої сервіси звертаються через DNS-ім'я внутрішнього сервісу `masterhub-db-svc:5432`.

---

## 5. Місце Git, CI/CD та Container Registry

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           CI/CD Delivery Flow                           │
│                                                                         │
│   [ Git Repository ] ──────► github.com/extremeowen/masterhub           │
│           │                                                             │
│           │ git push (main branch)                                      │
│           ▼                                                             │
│   [ GitHub Actions CI ] ───► .github/workflows/ci.yml                   │
│           │                  1. Checkout коду                           │
│           │                  2. npm ci (встановлення залежностей)       │
│           │                  3. npm test (юніт-тести API)               │
│           │                  4. docker build -t masterhub-api:1.0.0     │
│           │                  5. docker push до GHCR                     │
│           ▼                                                             │
│   [ Container Registry ] ──► ghcr.io/extremeowen/masterhub-api:1.0.0    │
│           │                                                             │
│           │ Image Pull під час деплою / рестарту                        │
│           ▼                                                             │
│   [ Kubernetes Cluster ] ──► Deployment оновлює Pod-и з новим образом   │
└─────────────────────────────────────────────────────────────────────────┘
```

- **git-репозиторій**: `github.com/extremeowen/masterhub` з кодом бекенду, тестами, Dockerfile та k8s-маніфестами.
- **CI/CD pipeline (GitHub Actions)**: отримує код після push у `main`, валідує його через `npm test`, збирає Docker-образ API та пушить його у реєстр.
- **Container Registry**: `ghcr.io/extremeowen/masterhub-api:1.0.0` (GitHub Container Registry). Під час оновлення маніфесту або створення нового Pod-а Kubelet звертається до GHCR і завантажує образ.

---

## 6. Короткий опис дизайну (пункт 5 завдання)

Я моделюю **MasterHub API** — REST-сервіс для управління замовленнями послуг майстрів, побудований на Node.js/Express із базою даних PostgreSQL. У кластері Kubernetes сервіс функціонує в ізольованому просторі імен `masterhub-prod`. 

Зовнішній трафік надходить на домен `api.masterhub.ua`, резолвиться через DNS і спрямовується на хмарний Load Balancer, після чого передається на Ingress Controller (nginx), який за правилами хоста та шляхів (`/orders`, `/health`) надсилає запити до внутрішнього Service `masterhub-api-svc` типу `ClusterIP`, а той балансує трафік між Pod-ами. 

У Deployment закладено **2 Pod-и** для забезпечення базової відмовостійкості (High Availability): при падінні одного Pod-а сервіс продовжує обробляти запити без простою, а також це дозволяє виконувати оновлення методом Rolling Update. 

У ланцюжку доставки коду розробник виконує `git push` до репозиторію `github.com/extremeowen/masterhub`, після чого автоматично спрацьовує pipeline у GitHub Actions, проганяє тести, збирає Docker-образ і публікує його в GitHub Container Registry (`ghcr.io/extremeowen/masterhub-api:1.0.0`), звідки Kubernetes Deployment стягує свіжий образ для запуску нових Pod-ів.

---

## 7. Повний шлях проходження запиту

```
Клієнт (Браузер / Застосунок)
  │ (HTTPS GET https://api.masterhub.ua/orders)
  ▼
DNS
  │ (Резолв api.masterhub.ua → Зовнішній IP)
  ▼
Cloud Load Balancer
  │ (Передає TCP 80/443 усередину кластера)
  ▼
Ingress Controller (nginx)
  │ (Перевіряє Host: api.masterhub.ua та Path: /orders)
  ▼
Service (masterhub-api-svc, ClusterIP: 80 → 8080)
  │ (Балансує запит через kube-proxy)
  ▼
Pod 1 або Pod 2 (Express API, порт 8080)
  │ (Виконує логіку orders.service.js)
  │ (Звертається через PostgresOrdersRepository до masterhub-db-svc:5432)
  ▼
Service: masterhub-db-svc → Pod: PostgreSQL (порт 5432)
  │ (Повертає дані замовлень)
  ▼
Відповідь HTTP 200 OK повертається клієнту у зворотному напрямку
```
