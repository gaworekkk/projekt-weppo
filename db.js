const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'sklep_db',
  password: 'haslo',
  port: 5432,
});

/* ================= USERS ================= */

async function getUsers() {
    const { rows } = await pool.query(`
        SELECT 
            id,
            username,
            display_name,
            password,
            role
        FROM users
    `);
    return rows;
}

async function saveUser({ username, displayName, password, role }) {
    await pool.query(`
        INSERT INTO users (username, display_name, password, role)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (username) DO NOTHING
    `, [username, displayName, password, role]);
}

/* ================= PRODUCTS ================= */

async function getProducts() {
    const { rows } = await pool.query(`
        SELECT 
            p.id,
            p.producer,
            p.name,
            p.description,
            p.price,
            p.quantity,
            p.category_id,
            p.image_url,
            p.created_at
        FROM products p
        ORDER BY p.created_at DESC
    `);
    return rows;
}


async function saveProduct({producer, name, description, price, quantity, category, image_url }) {
    await pool.query(`
        INSERT INTO products (producer, name, description, price, quantity, category_id, image_url)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [producer, name, description, price, quantity, category, image_url]);
}


async function deleteProduct(id) {
    await pool.query(`DELETE FROM products WHERE id = $1`, [id]);
}

async function updateProductQuantity(id, quantity) {
    await pool.query(`
        UPDATE products
        SET quantity = $1
        WHERE id = $2
    `, [quantity, id]);
}


/* ================= CATEGORIES ================= */

async function getCategories() {
    const { rows } = await pool.query(`SELECT * FROM categories ORDER BY name`);
    return rows;
}

/* ================= PROMO CODES ================= */

async function getPromoCodes() {
    const { rows } = await pool.query(`
        SELECT 
            code,
            discount,
            active
        FROM promo_codes
    `);
    return rows;
}

async function savePromoCode({ code, discount, active = true }) {
    await pool.query(`
        INSERT INTO promo_codes (code, discount, active)
        VALUES ($1, $2, $3)
        ON CONFLICT (code) DO NOTHING
    `, [code, discount, active]);
}

async function deletePromoCode(code) {
    await pool.query(`
        DELETE FROM promo_codes WHERE code = $1
    `, [code]);
}

/* ================= ORDERS ================= */

async function saveOrder({ userId, items, total }) {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Sprawdzenie i rezerwacja stocku (LOCK)
        for (const item of items) {
            const { rows } = await client.query(
                `SELECT quantity
                 FROM products
                 WHERE id = $1
                 FOR UPDATE`,
                [item.productId]
            );

            if (rows.length === 0) {
                throw new Error(`Product ${item.productId} not found`);
            }

            if (rows[0].quantity < item.quantity) {
                throw new Error(`Insufficient stock for product ${item.productId}`);
            }

            await client.query(
                `UPDATE products
                 SET quantity = quantity - $1
                 WHERE id = $2`,
                [item.quantity, item.productId]
            );
        }

        // 2. Zapis zamówienia
        const { rows } = await client.query(
            `INSERT INTO orders (user_id, total)
             VALUES ($1, $2)
             RETURNING id`,
            [userId, total]
        );

        const orderId = rows[0].id;

        // 3. Zapis pozycji zamówienia
        for (const item of items) {
            await client.query(
                `INSERT INTO order_items (order_id, product_id, quantity, price)
                 VALUES ($1, $2, $3, $4)`,
                [orderId, item.productId, item.quantity, item.price]
            );
        }

        await client.query('COMMIT');
        return orderId;

    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

async function getOrders(userId) {
    const client = await pool.connect();

    try {
        // 1️⃣ Pobranie wszystkich zamówień użytkownika
        const { rows: orders } = await client.query(
            `SELECT id, total, created_at
             FROM orders
             WHERE user_id = $1
             ORDER BY created_at DESC`,
            [userId]
        );

        if (orders.length === 0) return [];

        // 2️⃣ Pobranie wszystkich pozycji zamówień wraz z nazwami produktów
        const orderIds = orders.map(o => o.id);
        const { rows: items } = await client.query(
            `SELECT 
                 oi.order_id, 
                 oi.product_id, 
                 oi.quantity, 
                 oi.price, 
                 p.name AS product_name
             FROM order_items oi
             JOIN products p ON oi.product_id = p.id
             WHERE oi.order_id = ANY($1::int[])`,
            [orderIds]
        );

        // 3️⃣ Grupowanie pozycji pod zamówieniami
        const ordersWithItems = orders.map(order => {
            const orderItems = items
                .filter(i => i.order_id === order.id)
                .map(i => ({
                    productId: i.product_id,
                    name: i.product_name,
                    quantity: i.quantity,
                    price: parseFloat(i.price) // konwersja na liczbę
                }));

            const itemsCount = orderItems.reduce((sum, i) => sum + i.quantity, 0);

            return {
                id: order.id,
                date: order.created_at,
                total: parseFloat(order.total), // konwersja na liczbę
                itemsCount,
                items: orderItems
            };
        });

        return ordersWithItems;

    } finally {
        client.release();
    }
}



module.exports = {
    getUsers,
    saveUser,
    getProducts,
    saveProduct,
    deleteProduct,
    updateProductQuantity,
    getCategories,
    getPromoCodes,
    savePromoCode,
    deletePromoCode,
    saveOrder,
    getOrders
};
