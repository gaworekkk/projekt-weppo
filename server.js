require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const { AuthorizationCode } = require('simple-oauth2');
const axios = require('axios');
const crypto = require('crypto');

const db = require('./db'); // teraz SQL

const app = express();
const port = 3000;

// --- Konfiguracja aplikacji ---
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser('sekretny_klucz_do_podpisu'));
app.use(express.static('public'));

app.set('view engine', 'ejs');
app.set('views', './views');

// --- Lista Administratorów (Whitelist) ---
const ADMIN_USERS = ['admin@example.com'];

// --- Konfiguracja OAuth2 (Google) ---
const oauth2 = new AuthorizationCode({
    client: {
        id: '85388333108-tmos90hl7b3pii0ah3c0fov1kublhm9d.apps.googleusercontent.com',
        secret: process.env.GOOGLE_CLIENT_SECRET,
    },
    auth: {
        tokenHost: 'https://www.googleapis.com',
        tokenPath: '/oauth2/v4/token',
        authorizeHost: 'https://accounts.google.com',
        authorizePath: '/o/oauth2/v2/auth'
    },
});

const authorizationUri = oauth2.authorizeURL({
    redirect_uri: 'http://localhost:3000/callback',
    scope: 'openid profile email'
});

// --- Funkcje pomocnicze ---
function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

function isUserInRole(user, role) {
    return user.role === role;
}

// Middleware autoryzacji
function authorize(...roles) {
    return async function (req, res, next) {
        if (req.signedCookies.user) {
            const users = await db.getUsers();
            const username = req.signedCookies.user;
            const user = users.find(u => u.username === username);

            if (user) {
                if (roles.length === 0 || roles.some(role => isUserInRole(user, role))) {
                    req.user = user;
                    return next();
                }
            }
        }
        res.redirect('/login?returnUrl=' + encodeURIComponent(req.originalUrl));
    };
}

// Udostępnianie usera we wszystkich widokach
app.use(async (req, res, next) => {
    if (req.signedCookies.user) {
        const users = await db.getUsers();
        const username = req.signedCookies.user;
        const user = users.find(u => u.username === username);
        res.locals.user = user || null;
    } else {
        res.locals.user = null;
    }
    next();
});

// --- Routing ---
app.get('/', (req, res) => {
    res.render('home');
});

app.get('/shop', async (req, res) => {
    const products = await db.getProducts();
    res.render('shop', { products });
});

app.get('/about', (req, res) => {
    res.render('about');
});

// Dodawanie do koszyka
app.post('/cart/add/:id', (req, res) => {
    const productId = parseInt(req.params.id);
    const cart = req.signedCookies.cart || [];
    cart.push(productId);
    res.cookie('cart', cart, { signed: true, httpOnly: true });
    res.redirect('/shop');
});

// Wyświetlanie koszyka
app.get('/cart', async (req, res) => {
    const cartIds = req.signedCookies.cart || [];
    const allProducts = await db.getProducts();

    const cartItems = [];
    let total = 0;

    cartIds.forEach(id => {
        const product = allProducts.find(p => p.id === id);
        if (product) {
            cartItems.push(product);
            total += product.price;
        }
    });

    // Obsługa kodów promocyjnych
    let discount = 0;
    let finalTotal = total;
    let appliedPromo = null;

    if (req.signedCookies.promoCode) {
        const codes = await db.getPromoCodes();
        const promo = codes.find(c => c.code === req.signedCookies.promoCode);
        if (promo) {
            appliedPromo = promo;
            discount = promo.discount_type === 'percent' ? Math.round(total * (promo.discount_value / 100)) : promo.discount_value;
            finalTotal = total - discount;
        }
    }

    res.render('cart', { cartItems, total, appliedPromo, discount, finalTotal });
});

// Składanie zamówienia
app.post('/cart/checkout', async (req, res) => {
    const cartIds = req.signedCookies.cart || [];
    if (cartIds.length === 0) return res.redirect('/cart');

    const products = await db.getProducts();
    const cartCounts = {};
    let total = 0;
    let validStock = true;

    cartIds.forEach(id => { cartCounts[id] = (cartCounts[id] || 0) + 1; });

    for (const [idStr, count] of Object.entries(cartCounts)) {
        const id = parseInt(idStr);
        const product = products.find(p => p.id === id);
        if (!product || product.quantity < count) {
            validStock = false;
            break;
        }
        total += product.price * count;
        product.quantity -= count;
    }

    if (!validStock) return res.redirect('/cart');

    // Zapis zmian produktów
    for (const p of products) {
        await db.saveProduct({
            name: p.name,
            description: p.description,
            price: p.price,
            quantity: p.quantity,
            categoryId: p.category_id || 1
        });
    }

    // Zapis zamówienia
    const user = await db.getUsers().then(users => users.find(u => u.username === req.signedCookies.user));
    const items = Object.entries(cartCounts).map(([id, quantity]) => {
        const product = products.find(p => p.id === parseInt(id));
        return { productId: parseInt(id), quantity, price: product.price };
    });

    await db.saveOrder({
        userId: user?.id || null,
        items,
        total
    });

    res.clearCookie('cart');
    res.clearCookie('promoCode');
    res.render('cart', { cartItems: [], total: 0, message: 'Dziękujemy za złożenie zamówienia!' });
});

// Aplikowanie kodu promocyjnego
app.post('/cart/apply-promo', async (req, res) => {
    const { code } = req.body;
    const codes = await db.getPromoCodes();
    if (codes.find(c => c.code === code)) {
        res.cookie('promoCode', code, { signed: true, httpOnly: true });
    }
    res.redirect('/cart');
});

// Rejestracja
app.get('/register', (req, res) => res.render('register'));

app.post('/register', async (req, res) => {
    const { txtUser: username, txtPwd: password, txtName: displayName } = req.body;
    const users = await db.getUsers();

    if (users.find(u => u.username === username)) {
        return res.render('register', { message: 'Użytkownik już istnieje' });
    }

    await db.saveUser({
        email: username,
        displayName,
        passwordHash: hashPassword(password),
        role: ADMIN_USERS.includes(username) ? 'admin' : 'user'
    });

    res.redirect('/login');
});

// Logowanie
app.get('/login', (req, res) => res.render('login', { google: authorizationUri, message: null }));

app.post('/login', async (req, res) => {
    const { txtUser: username, txtPwd: pwd } = req.body;
    const users = await db.getUsers();
    const user = users.find(u => u.username === username && u.password === hashPassword(pwd));

    if (user) {
        res.cookie('user', username, { signed: true });
        const returnUrl = req.query.returnUrl || '/';
        res.redirect(returnUrl);
    } else {
        res.render('login', { message: "Wrong username or password", google: authorizationUri });
    }
});

// Google OAuth callback
app.get('/callback', async (req, res) => {
    const code = req.query.code;
    const options = { code, redirect_uri: 'http://localhost:3000/callback' };

    try {
        const result = await oauth2.getToken(options);
        const accessToken = result.token.access_token;

        const { data } = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        const users = await db.getUsers();
        let user = users.find(u => u.username === data.email);
        if (!user) {
            await db.saveUser({
                email: data.email,
                displayName: data.name,
                passwordHash: null,
                role: ADMIN_USERS.includes(data.email) ? 'admin' : 'user'
            });
            user = { username: data.email };
        }

        res.cookie('user', user.username, { signed: true });
        res.redirect('/');
    } catch (err) {
        console.error('Błąd logowania Google:', err.message);
        res.redirect('/login');
    }
});

// Wylogowanie
app.get('/logout', authorize(), (req, res) => {
    res.cookie('user', '', { maxAge: -1 });
    res.redirect('/');
});

// Panel admina
app.get('/admin', authorize('admin'), async (req, res) => {
    const products = await db.getProducts();
    const promoCodes = await db.getPromoCodes();
    const categories = await db.getCategories();
    res.render('admin', { products, promoCodes, categories });
});

// Uruchomienie serwera
app.listen(port, () => console.log(`Serwer działa pod adresem http://localhost:${port}`));
