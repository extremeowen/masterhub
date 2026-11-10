
У роботі змодельовано розгортання бекенд-сервісу MasterHub API (сервіс бронювання послуг перевірених майстрів на Node.js/Express із базою даних PostgreSQL), який функціонує в ізольованому просторі імен masterhub-prod.

Зовнішній трафік надходить на домен api.masterhub.ua, проходить через DNS, хмарний Load Balancer та Ingress Controller (nginx), який за шляхами /orders і /health маршрутизує запити до внутрішнього Service masterhub-api-svc типу ClusterIP, а той балансує навантаження між Pod-ами.

У Deployment закладено 2 репліки Pod-ів для забезпечення базової відмовостійкості (High Availability) та підтримки оновлень без простою (Rolling Update).

У ланцюжку доставки розробник виконує git push до репозиторію github.com/extremeowen/masterhub, після чого автоматично спрацьовує pipeline у GitHub Actions, збирає Docker-образ і публікує його в GitHub Container Registry (ghcr.io), звідки Kubernetes автоматично викачує образ при запуску Pod-ів.

### 5. Опис дизайну архітектури


* **Сервіс:** `MasterHub API` — REST-сервіс бронювання та управління замовленнями послуг майстрів (Node.js/Express + PostgreSQL).
* **Namespace:** `masterhub-prod` — виділений простір імен для ізоляції компонентів проєкту в кластері.
* **Шлях зовнішнього трафіку:** Домен `api.masterhub.ua` ➔ DNS ➔ Cloud Load Balancer (порти 80/443) ➔ Ingress Controller (nginx), який за маршрутами `/orders` та `/health` передає запити на внутрішній Service `masterhub-api-svc` (тип `ClusterIP`), а той балансує трафік між Pod-ами.
* **Кількість Pod-ів:** **2 репліки** — для забезпечення базової відмовостійкості (HA) та оновлення версій без переривання сервісу (Rolling Update).
* **Місце Git, CI/CD та Registry:** Розробник пушить код у `github.com/extremeowen/masterhub` ➔ GitHub Actions автоматично тестує, збирає Docker-образ і пушить його у `ghcr.io/extremeowen/masterhub-api:1.0.0` ➔ K8s Deployment викачує образ із реєстру під час деплою.