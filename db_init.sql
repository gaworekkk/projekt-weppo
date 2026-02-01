-- =====================================================
-- BAZA DANYCH SKLEPU (PostgreSQL)
-- =====================================================

-- (opcjonalnie)
-- CREATE DATABASE shop_db;
-- \c shop_db;

-- =====================================================
-- USERS
-- =====================================================
DROP TABLE IF EXISTS order_items CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS promo_codes CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS categories CASCADE;
DROP TABLE IF EXISTS users CASCADE;

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255),
    display_name VARCHAR(255),
    role VARCHAR(50) NOT NULL DEFAULT 'user',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_username ON users(username);

-- =====================================================
-- CATEGORIES
-- =====================================================
CREATE TABLE categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL
);

-- =====================================================
-- PRODUCTS
-- =====================================================
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    producer VARCHAR(255),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
    quantity INT NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    category_id INT REFERENCES categories(id) ON DELETE SET NULL,
	image_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_products_category ON products(category_id);

-- =====================================================
-- PROMO CODES
-- =====================================================
CREATE TABLE promo_codes (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    discount INT NOT NULL CHECK (discount > 0 AND discount <= 100),
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- ORDERS
-- =====================================================
CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE SET NULL,
    total NUMERIC(10,2) NOT NULL CHECK (total >= 0),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_orders_user ON orders(user_id);

-- =====================================================
-- ORDER ITEMS
-- =====================================================
CREATE TABLE order_items (
    id SERIAL PRIMARY KEY,
    order_id INT REFERENCES orders(id) ON DELETE CASCADE,
    product_id INT REFERENCES products(id),
    quantity INT NOT NULL CHECK (quantity > 0),
    price NUMERIC(10,2) NOT NULL CHECK (price >= 0)
);

-- =====================================================
-- DANE STARTOWE (opcjonalne)
-- =====================================================

-- Kategorie
INSERT INTO categories (name) VALUES
('Elektronika'),
('Gaming'),
('Akcesoria');

-- Produkty
INSERT INTO products (producer, name, description, price, quantity, category_id)
VALUES
('Sony', 'PlayStation 5', 'Konsola PS5', 2999.99, 10, 2),
('Microsoft', 'Xbox Series X', 'Konsola Xbox', 2799.99, 8, 2),
('Logitech', 'G Pro X', 'Słuchawki gamingowe', 699.99, 15, 3);

-- Kody promocyjne
INSERT INTO promo_codes (code, discount)
VALUES
('PROMO10', 10),
('PROMO20', 20);

-- =====================================================
-- KONIEC
-- =====================================================