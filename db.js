const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'sklep_db',
  password: 'haslo123',
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

        const { rows } = await client.query(`
            INSERT INTO orders (user_id, total)
            VALUES ($1, $2)
            RETURNING id
        `, [userId, total]);

        const orderId = rows[0].id;

        for (const item of items) {
            await client.query(`
                INSERT INTO order_items (id, product_id, quantity, price)
                VALUES ($1, $2, $3, $4)
            `, [orderId, item.productId, item.quantity, item.price]);
        }

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
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
    saveOrder
};
