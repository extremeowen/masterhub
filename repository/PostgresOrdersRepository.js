const { Pool } = require("pg");
const crypto = require("node:crypto");
const Order = require("../domain/booking/Order");

class PostgresOrdersRepository {
    constructor(connectionString = process.env.DATABASE_URL) {
        if (!connectionString) {
            throw new Error("DATABASE_URL is required");
        }

        this.pool = new Pool({ connectionString });
        this.ready = this.initialize();
    }

    async initialize() {
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS orders (
                id TEXT PRIMARY KEY,
                "clientId" TEXT NOT NULL,
                "masterId" TEXT NOT NULL,
                "serviceId" TEXT NOT NULL,
                "scheduledAt" TEXT NOT NULL,
                status TEXT NOT NULL,
                "createdAt" TEXT NOT NULL,
                "updatedAt" TEXT NOT NULL
            );
        `);
    }

    async nextId() {
        await this.ready;
        return `o-${crypto.randomUUID()}`;
    }

    async save(order) {
        await this.ready;

        await this.pool.query(
            `
            INSERT INTO orders (
                id,
                "clientId",
                "masterId",
                "serviceId",
                "scheduledAt",
                status,
                "createdAt",
                "updatedAt"
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (id) DO UPDATE SET
                "scheduledAt" = EXCLUDED."scheduledAt",
                status = EXCLUDED.status,
                "updatedAt" = EXCLUDED."updatedAt"
            `,
            [
                order.id,
                order.clientId,
                order.masterId,
                order.serviceId,
                order.scheduledAt,
                order.status,
                order.createdAt,
                order.updatedAt,
            ]
        );

        return order;
    }

    async findById(id) {
        await this.ready;

        const result = await this.pool.query(
            `SELECT * FROM orders WHERE id = $1`,
            [id]
        );

        return result.rows[0] ? this.toOrder(result.rows[0]) : null;
    }

    async findAll() {
        await this.ready;

        const result = await this.pool.query(`
            SELECT *
            FROM orders
            ORDER BY "createdAt" DESC
        `);

        return result.rows.map((row) => this.toOrder(row));
    }

    async delete(id) {
        await this.ready;

        const result = await this.pool.query(
            `DELETE FROM orders WHERE id = $1`,
            [id]
        );

        return result.rowCount > 0;
    }

    toOrder(row) {
        const order = new Order(
            row.id,
            row.clientId,
            row.masterId,
            row.serviceId,
            row.scheduledAt
        );

        order.status = row.status;
        order.createdAt = row.createdAt;
        order.updatedAt = row.updatedAt;

        return order;
    }

    async close() {
        await this.pool.end();
    }
}

module.exports = PostgresOrdersRepository;