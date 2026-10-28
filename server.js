// server.js
const express = require("express");
const path = require("path");

const OrdersService = require("./service/orders.service");
const ordersRouter = require("./api/orders.routes");
const { requestId, rateLimit } = require("./api/middleware");

const app = express();
const PORT = 8080;

app.use(express.json());
app.use(requestId);
app.use(rateLimit({
    limit: Number(process.env.RATE_LIMIT || 60),
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
}));
app.use(express.static(path.join(__dirname, "public")));

// Docker uses PostgreSQL; local runs keep the existing SQLite/in-memory fallback.
let ordersRepository;
if (process.env.DATABASE_URL) {
    const PostgresOrdersRepository = require("./repository/PostgresOrdersRepository");
    ordersRepository = new PostgresOrdersRepository(process.env.DATABASE_URL);
} else {
    try {
        const SqliteOrdersRepository = require("./repository/SqliteOrdersRepository");
        ordersRepository = new SqliteOrdersRepository("masterhub.db");
    } catch (e) {
        console.warn("SQLite repository unavailable, falling back to in-memory:", e.message);
        const InMemoryOrdersRepository = require("./repository/InMemoryOrdersRepository");
        ordersRepository = new InMemoryOrdersRepository();
    }
}

const ordersService = new OrdersService(ordersRepository);

app.get("/health", async (req, res) => {
    try {
        if (ordersRepository.ready) await ordersRepository.ready;
        res.status(200).json({ status: "ok" });
    } catch (err) {
        res.status(503).json({
            error: "DependencyUnavailableError",
            code: "DEPENDENCY_UNAVAILABLE",
            details: { cause: err.message },
            requestId: req.requestId,
        });
    }
});

app.use(ordersRouter(ordersService));

app.use((req, res) => {
    res.status(404).json({
        error: "NotFoundError",
        code: "ROUTE_NOT_FOUND",
        details: { path: req.path },
        requestId: req.requestId,
    });
});
app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const isJsonError = err && (err.type === "entity.parse.failed" || err instanceof SyntaxError);
    res.status(isJsonError ? 400 : 500).json({
        error: isJsonError ? "ValidationError" : "InternalError",
        code: isJsonError ? "INVALID_JSON" : "INTERNAL_ERROR",
        details: isJsonError ? "Request body must be valid JSON" : null,
        requestId: req.requestId,
    });
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Сервер запущено: http://localhost:${PORT}`);
        console.log(`API:            http://localhost:${PORT}/orders`);
        console.log(`Health:         http://localhost:${PORT}/health`);
    });
}

module.exports = app;