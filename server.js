require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const { AuthorizationCode } = require('simple-oauth2');
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const port = 3000;

// --- Konfiguracja aplikacji ---
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser('sekretny_klucz_do_podpisu'));
app.use(express.static('public'));

app.set('view engine', 'ejs');
app.set('views', './views');

// --- Baza użytkowników  ---
const USERS_FILE = path.join(__dirname, 'users.json'); // zmienić na prawdziwą bazę danych

function getUsers() {
    if (!fs.existsSync(USERS_FILE)) return [];
    try {
        return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    } catch (e) { return []; }
}

function saveUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// --- Baza zamówień (plikowa JSON) ---
const ORDERS_FILE = path.join(__dirname, 'orders.json'); // zmienić na prawdziwą bazę danych

function getOrders() {
    if (!fs.existsSync(ORDERS_FILE)) return [];
    try {
        return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8'));
    } catch (e) { return []; }
}

function saveOrders(orders) {
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
}

// --- Lista Administratorów (Whitelist) ---
const ADMIN_USERS = ['admin', 'wojciech@example.com', 'szef']; // zmienić na prawdziwą bazę danych

// --- Baza produktów (plikowa JSON) ---
const PRODUCTS_FILE = path.join(__dirname, 'products.json'); // zmienić na prawdziwą bazę danych

function getProducts() {
    if (!fs.existsSync(PRODUCTS_FILE)) return [];
    try {
        return JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8'));
    } catch (e) { return []; }
}

function saveProducts(products) {
    fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(products, null, 2));
}

// --- Baza kodów promocyjnych ---
const PROMOCODES_FILE = path.join(__dirname, 'promocodes.json'); // zmienić na prawdziwą bazę danych

function getPromoCodes() {
    if (!fs.existsSync(PROMOCODES_FILE)) return [];
    try {
        return JSON.parse(fs.readFileSync(PROMOCODES_FILE, 'utf8'));
    } catch (e) { return []; }
}

function savePromoCodes(codes) {
    fs.writeFileSync(PROMOCODES_FILE, JSON.stringify(codes, null, 2));
}

// --- Baza kategorii ---
const CATEGORIES_FILE = path.join(__dirname, 'categories.json'); // zmienić na prawdziwą bazę danych

function getCategories() {
    if (!fs.existsSync(CATEGORIES_FILE)) return [];
    try {
        return JSON.parse(fs.readFileSync(CATEGORIES_FILE, 'utf8'));
    } catch (e) { return []; }
}

function saveCategories(categories) {
    fs.writeFileSync(CATEGORIES_FILE, JSON.stringify(categories, null, 2));
}

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
    return function (req, res, next) {
        if (req.signedCookies.user) {
            const users = getUsers();
            const username = req.signedCookies.user;
            const user = users.find(u => u.username === username);

            if (user) {
                // Sprawdź rolę tylko jeśli jakieś zostały podane
                if (roles.length === 0 || roles.some(role => isUserInRole(user, role))) {
                    req.user = user;
                    return next();
                }
            }
        }
        // Jeśli brak dostępu, przekieruj do logowania
        res.redirect('/login?returnUrl=' + encodeURIComponent(req.originalUrl));
    };
}

app.use((req, res, next) => {
    // Jeśli mamy cookie, spróbujmy znaleźć użytkownika
    if (req.signedCookies.user) {
        const users = getUsers();
        const username = req.signedCookies.user;
        const user = users.find(u => u.username === username);
        res.locals.user = user; // res.locals sprawia, że zmienna 'user' jest dostępna we wszystkich widokach
    } else {
        res.locals.user = null;
    }
    next();
});

// --- Routing ---

app.get('/', (req, res) => {
    res.render('home'); // renderuje views/home.ejs
});

app.get('/shop', (req, res) => {
    res.render('shop', { products: getProducts() });
});

app.get('/about', (req, res) => {
    res.render('about');
});

// Dodawanie do koszyka
app.post('/cart/add/:id', (req, res) => {
    const productId = parseInt(req.params.id);
    const products = getProducts();
    const product = products.find(p => p.id === productId);

    if (product) {
        const cart = req.signedCookies.cart || [];
        cart.push(productId);
        res.cookie('cart', cart, { signed: true, httpOnly: true });
    }
    res.redirect('/shop');
});

// Wyświetlanie koszyka
app.get('/cart', (req, res) => {
    const cartIds = req.signedCookies.cart || [];
    const allProducts = getProducts();
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
        const codes = getPromoCodes();
        const promo = codes.find(c => c.code === req.signedCookies.promoCode);
        if (promo) {
            appliedPromo = promo;
            discount = Math.round(total * (promo.discount / 100));
            finalTotal = total - discount;
        }
    }

    res.render('cart', { cartItems, total, appliedPromo, discount, finalTotal });
});

// Składanie zamówienia (czyszczenie koszyka)
app.post('/cart/checkout', (req, res) => {
    const cartIds = req.signedCookies.cart || [];
    if (cartIds.length === 0) {
        return res.redirect('/cart');
    }

    let products = getProducts();
    let total = 0;
    let validStock = true;

    // Weryfikacja stanów magazynowych
    // Zliczamy ilość wystąpień każdego produktu w koszyku
    const cartCounts = {};
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

    if (!validStock) {
        return res.redirect('/cart'); 
    }

    // Zapis zmian w produktach (zmniejszenie stanów)
    saveProducts(products);

    // Zapis zamówienia
    const orders = getOrders();
    orders.push({
        id: Date.now(),
        user: req.signedCookies.user || 'guest',
        date: new Date().toISOString(),
        items: cartCounts, // Zapisujemy ID i ilość
        total: total
    });
    saveOrders(orders);

    res.clearCookie('cart');
    res.clearCookie('promoCode');
    res.render('cart', { cartItems: [], total: 0, message: 'Dziękujemy za złożenie zamówienia!' });
});

// Aplikowanie kodu promocyjnego
app.post('/cart/apply-promo', (req, res) => {
    const { code } = req.body;
    const codes = getPromoCodes();
    if (codes.find(c => c.code === code)) {
        res.cookie('promoCode', code, { signed: true, httpOnly: true });
    }
    res.redirect('/cart');
});

// Usuwanie kodu promocyjnego
app.post('/cart/remove-promo', (req, res) => {
    res.clearCookie('promoCode');
    res.redirect('/cart');
});

// Formularz rejestracji
app.get('/register', (req, res) => {
    res.render('register');
});

// Obsługa rejestracji
app.post('/register', (req, res) => {
    const username = req.body.txtUser;
    const password = req.body.txtPwd;
    const displayName = req.body.txtName;

    const users = getUsers();

    if (users.find(u => u.username === username)) {
        return res.render('register', { message: 'Użytkownik już istnieje' });
    }

    users.push({
        username: username,
        password: hashPassword(password),
        displayName: displayName,
        role: ADMIN_USERS.includes(username) ? 'admin' : 'user'
    });
    saveUsers(users);

    res.redirect('/login');
});

// Wylogowanie
app.get('/logout', authorize(), (req, res) => {
    res.cookie('user', '', { maxAge: -1 });
    res.redirect('/');
});

// Formularz logowania
app.get('/login', (req, res) => {
    res.render('login', {
        google: authorizationUri,
        message: null // Dodałem to, żeby nie było błędu "undefined" w EJS
    });
});

// Callback od Google
app.get('/callback', async (req, res) => {
    const code = req.query.code;
    const options = {
        code,
        redirect_uri: 'http://localhost:3000/callback'
    };

    try {
        const result = await oauth2.getToken(options);
        const accessToken = result.token.access_token;

        const { data } = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        const users = getUsers();
        let user = users.find(u => u.username === data.email);
        if (!user) {
            user = {
                username: data.email,
                password: null, // Logowanie przez Google nie ma hasła
                displayName: data.name,
                role: ADMIN_USERS.includes(data.email) ? 'admin' : 'user'
            };
            users.push(user);
            saveUsers(users);
        }

        res.cookie('user', user.username, { signed: true });
        res.redirect('/');
    } catch (error) {
        console.error('Błąd logowania Google:', error.message);
        res.redirect('/login');
    }
});

// Panel Admina (tylko dla roli 'admin')
app.get('/admin', authorize('admin'), (req, res) => {
    res.render('admin', { products: getProducts(), promoCodes: getPromoCodes(), categories: getCategories() });
});

// Dodawanie produktu
app.post('/admin/add-product', authorize('admin'), (req, res) => {
    const { producer, name, price, quantity, description, category } = req.body;
    const products = getProducts();
    
    products.push({
        id: Date.now(),
        producer,
        name,
        price: parseFloat(price),
        quantity: parseInt(quantity),
        description,
        category
    });
    saveProducts(products);

    res.redirect('/admin');
});

// Usuwanie produktu
app.post('/admin/delete-product', authorize('admin'), (req, res) => {
    const id = parseInt(req.body.id);
    let products = getProducts();
    products = products.filter(p => p.id !== id);
    saveProducts(products);
    res.redirect('/admin');
});

// Dodawanie kodu promocyjnego
app.post('/admin/add-promo', authorize('admin'), (req, res) => {
    const { code, discount } = req.body;
    const codes = getPromoCodes();
    codes.push({ code, discount: parseInt(discount) });
    savePromoCodes(codes);
    res.redirect('/admin');
});

// Usuwanie kodu promocyjnego
app.post('/admin/delete-promo', authorize('admin'), (req, res) => {
    const { code } = req.body;
    let codes = getPromoCodes();
    codes = codes.filter(c => c.code !== code);
    savePromoCodes(codes);
    res.redirect('/admin');
});

// Obsługa logowania standardowego
app.post('/login', (req, res) => {
    var username = req.body.txtUser;
    var pwd = req.body.txtPwd;

    const users = getUsers();
    const user = users.find(u => u.username === username && u.password === hashPassword(pwd));

    if (user) {
        res.cookie('user', username, { signed: true });
        var returnUrl = req.query.returnUrl || '/';
        res.redirect(returnUrl);
    } else {
        res.render('login', {
            message: "Wrong username or password",
            google: authorizationUri
        });
    }
});

// Uruchomienie serwera
app.listen(port, () => {
    console.log(`Serwer działa pod adresem: http://localhost:${port}`);
});


app.get('/account', authorize(), (req, res) => {
    res.render('account'); // user jest przekazywany przez res.locals lub authorize
});