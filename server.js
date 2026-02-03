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
const ADMIN_USERS = ['admin'];

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

app.use(async (req, res, next) => {
    // Jeśli mamy cookie, spróbujmy znaleźć użytkownika
    if (req.signedCookies.user) {
        const users = await db.getUsers();
        const username = req.signedCookies.user;
        const user = users.find(u => u.username === username);
        res.locals.user = user || null; // res.locals sprawia, że zmienna 'user' jest dostępna we wszystkich widokach
    } else {
        res.locals.user = null;
    }
    next();
});

// --- Routing ---

app.get('/', (req, res) => {
    res.render('home'); // renderuje views/home.ejs
});

app.get('/shop', async (req, res) => {
    const products = await db.getProducts();
    // if (products.length > 0) {
    //     console.log("PRZYKŁADOWY PRODUKT Z BAZY:", products[0]);
    // }
    products.forEach(p => {
        if (p.image_url === null) {
            p.image_url = 'http://localhost:3000/images/laptop.jpeg';
        }
    });
    const showSuccessMessage = req.query.added === 'true';
    res.render('shop', { products, showSuccessMessage });
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
    res.redirect('/shop?added=true');
});

// Wyświetlanie koszyka
app.get('/cart', async (req, res) => {
    const cartIds = req.signedCookies.cart || [];
    const allProducts = await db.getProducts();

    const cartItems = [];

    // obsługa grupowania wielu wystąpień jednego przedmiotu
    const counts = {};
    cartIds.forEach(id => {
        counts[id] = (counts[id] || 0) + 1;
    });

    // 2. Tworzymy listę obiektów produktów z dodanym polem 'qty'
    let totalGrosze = 0;
    for (const [idStr, qty] of Object.entries(counts)) {
        const id = parseInt(idStr);
        const product = allProducts.find(p => p.id === id);
        if (product) {
            const priceGrosze = Math.round(parseFloat(product.price) * 100);
            const rowTotalGrosze = priceGrosze * qty;
            cartItems.push({
                ...product,
                qty: qty,
                rowTotal: rowTotalGrosze / 100
            });
            totalGrosze += rowTotalGrosze;
        }
    }

    // Obsługa kodów promocyjnych
    let discountGrosze = 0;
    let appliedPromo = null;

    if (req.signedCookies.promoCode) {
        const codes = await db.getPromoCodes();
        const promo = codes.find(c => c.code === req.signedCookies.promoCode);
        if (promo) {
            appliedPromo = promo;
            discountGrosze = Math.round(totalGrosze * (promo.discount / 100));
        }
    }
    const finalTotalGrosze = totalGrosze - discountGrosze;

    // obsługa wpisania błędnego kodu promocyjnego
    const promoError = req.signedCookies.promoError || null;
    if (promoError) res.clearCookie('promoError')

    const isEmpty = cartItems.length === 0;

    const total = totalGrosze / 100;
    const finalTotal = finalTotalGrosze / 100;

    let deliveryCost = 0;
    let totalToPay = 0;

    if (!isEmpty) {
        deliveryCost = (total > 500) ? 0 : 20;
        totalToPay = finalTotal + deliveryCost;
    }

    res.render('cart', {
        cartItems,
        total,
        appliedPromo,
        discount: discountGrosze / 100,
        finalTotal,
        deliveryCost,
        totalToPay,
        promoError,
        isEmpty,
        message: null // Dodajemy, aby widok koszyka nie wyrzucał błędu przy wejściu
    });
});
// --- NOWE ENDPOINTY: Obsługa ilości i usuwania ---

// Zwiększ ilość (+1)
app.post('/cart/increase/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    const cart = req.signedCookies.cart || [];

    const products = await db.getProducts();
    const product = products.find(p => p.id === id);

    const currentQty = cart.filter(itemId => itemId === id).length;

    if (product && currentQty < product.quantity) {
        cart.push(id);
        res.cookie('cart', cart, { signed: true, httpOnly: true });
    }

    res.redirect('/cart');
});

// Zmniejsz ilość (-1)
app.post('/cart/decrease/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    let cart = req.signedCookies.cart || [];

    // Znajdź indeks pierwszego wystąpienia tego produktu
    const index = cart.indexOf(id);
    if (index > -1) {
        cart.splice(index, 1); // Usuń jeden element
    }

    res.cookie('cart', cart, { signed: true, httpOnly: true });
    res.redirect('/cart');
});

// Usuń całkowicie produkt z koszyka (Kosz)
app.post('/cart/remove/:id', (req, res) => {
    const id = parseInt(req.params.id);
    let cart = req.signedCookies.cart || [];

    // Filtrujemy koszyk, zostawiając tylko ID inne niż usuwane
    cart = cart.filter(itemId => itemId !== id);

    res.cookie('cart', cart, { signed: true, httpOnly: true });
    res.redirect('/cart');
});

// --- PROCES ZAMÓWIENIA (CHECKOUT) ---

// 1. Przekierowanie ze starego przycisku w koszyku do strony płatności
app.post('/cart/checkout', (req, res) => {
    res.redirect('/checkout');
});

// 2. Wyświetlenie strony płatności (GET)
app.get('/checkout', authorize(), async (req, res) => {
    const cartIds = req.signedCookies.cart || [];
    if (cartIds.length === 0) {
        return res.redirect('/cart');
    }

    const allProducts = await db.getProducts();
    const cartItems = [];

    // Zliczanie produktów
    const counts = {};
    cartIds.forEach(id => { counts[id] = (counts[id] || 0) + 1; });

    let totalGrosze = 0;
    for (const [idStr, qty] of Object.entries(counts)) {
        const id = parseInt(idStr);
        const product = allProducts.find(p => p.id === id);
        if (product) {
            const priceGrosze = Math.round(parseFloat(product.price) * 100);
            const rowTotalGrosze = priceGrosze * qty;
            cartItems.push({
                ...product,
                qty: qty,
                rowTotal: rowTotalGrosze / 100
            });
            totalGrosze += rowTotalGrosze;
        }
    }


    // Obliczanie zniżek
    let discountGrosze = 0;
    let appliedPromo = null;
    if (req.signedCookies.promoCode) {
        const codes = await db.getPromoCodes();
        const promo = codes.find(c => c.code === req.signedCookies.promoCode);
        if (promo) {
            appliedPromo = promo;
            discountGrosze = Math.round(totalGrosze * (promo.discount / 100));
        }
    }
    const finalTotalGrosze = totalGrosze - discountGrosze;

    const total = totalGrosze / 100;
    const finalTotal = finalTotalGrosze / 100;

    let deliveryCost = (total > 500) ? 0 : 20;
    let totalToPay = finalTotal + deliveryCost;

    res.render('checkout', {
        cartItems,
        total,
        discount: discountGrosze / 100,
        finalTotal,
        deliveryCost,
        totalToPay,
        appliedPromo
    });
});

// 3. Finalizacja płatności i zapis zamówienia (POST)
app.post('/checkout', authorize(), async (req, res) => {
    const cartIds = req.signedCookies.cart || [];
    if (cartIds.length === 0) {
        return res.redirect('/cart');
    }

    const products = await db.getProducts();
    let total = 0;
    let validStock = true;

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
        product.quantity -= count; // Tymczasowa aktualizacja w pamięci
    }

    if (!validStock) {
        return res.redirect('/cart');
    }

    // Uwzględnienie kodu promocyjnego w cenie końcowej zamówienia
    if (req.signedCookies.promoCode) {
        const codes = await db.getPromoCodes();
        const promo = codes.find(c => c.code === req.signedCookies.promoCode);
        if (promo) {
            total = total * (1 - promo.discount / 100);
        }
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

    // Wyświetlenie potwierdzenia (możesz tu przekierować na dedykowaną stronę sukcesu)
    res.render('cart', {
        cartItems: [],
        total: 0,
        message: 'Thank you for your payment! Order placed successfully.',
        appliedPromo: null,
        discount: 0,
        finalTotal: 0,
        promoError: null,
        isEmpty: true
    });
});

// Aplikowanie kodu promocyjnego
app.post('/cart/apply-promo', async (req, res) => {
    const { code } = req.body;
    const codes = await db.getPromoCodes();
    if (codes.find(c => c.code === code)) {
        res.cookie('promoCode', code, { signed: true, httpOnly: true });
    } else {
        // błędny kod
        res.cookie('promoError', 'Inactive code', { signed: true, httpOnly: true });
    }
    res.redirect('/cart');
});

// Remove promo code endpoint
app.post('/cart/remove-promo', (req, res) => {
    res.clearCookie('promoCode');

    const returnUrl = req.body.returnUrl || '/cart';
    res.redirect(returnUrl);
});

// Formularz rejestracji
app.get('/register', (req, res) => {
    res.render('register');
});

// Obsługa rejestracji

app.post('/register', async (req, res) => {
    const { txtUser: username, txtPwd: password, txtName: displayName } = req.body;

    const users = await db.getUsers();

    if (users.find(u => u.username === username)) {
        return res.render('register', { message: 'Użytkownik już istnieje' });
    }

    await db.saveUser({
        username: username,
        password: hashPassword(password),
        displayName: displayName,
        role: ADMIN_USERS.includes(username) ? 'admin' : 'user'
    });

    res.redirect('/login');
});

// Wylogowanie
app.get('/logout', authorize(), (req, res) => {
    res.clearCookie('user');
    res.clearCookie('cart');
    res.clearCookie('promoCode');
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

        const users = await db.getUsers();
        let user = users.find(u => u.username === data.email);
        if (!user) {
            await db.saveUser({
                username: data.email,
                password: null, // Logowanie przez Google nie ma hasła
                displayName: data.name,
                role: ADMIN_USERS.includes(data.email) ? 'admin' : 'user'
            });
        }

        res.cookie('user', user.username, { signed: true });
        res.redirect('/');
    } catch (error) {
        console.error('Błąd logowania Google:', error.message);
        res.redirect('/login');
    }
});

// Panel Admina (tylko dla roli 'admin')
app.get('/admin', authorize('admin'), async (req, res) => {
    try {
        const products = await db.getProducts();
        //console.log("Admin Panel - Products:", products);
        const promoCodes = await db.getPromoCodes();
        const categories = await db.getCategories();
        res.render('admin', { products, promoCodes, categories });
    } catch (err) {
        console.error("Admin Panel Error:", err);
        res.status(500).send("Server Error");
    }
});

// Dodawanie produktu
app.post('/admin/add-product', authorize('admin'), async (req, res) => {
    try {
        const { producer, name, price, quantity, description, image_url, category } = req.body;
        //console.log("Adding product:", req.body);

        await db.saveProduct({
            // id: Date.now(),
            producer,
            name,
            price: parseFloat(price),
            quantity: parseInt(quantity),
            description,
            image_url,
            category: parseInt(category)
        });
        res.redirect('/admin');
    } catch (err) {
        console.error("Error adding product:", err);
        res.redirect('/admin');
    }
});

// Usuwanie produktu
app.post('/admin/delete-product', authorize('admin'), async (req, res) => {
    //console.log("Received delete request");
    //console.log("Request body:", req.body);
    //console.log("Deleting product with ID:", req.body.id);
    try {
        const id = parseInt(req.body.id);
        await db.deleteProduct(id);
        res.redirect('/admin');
    } catch (err) {
        console.error("Error deleting product:", err);
        res.redirect('/admin');
    }
});

// Dodawanie kodu promocyjnego
app.post('/admin/add-promo', authorize('admin'), async (req, res) => {
    try {
        const { code, discount } = req.body;
        await db.savePromoCode({ code, discount: parseInt(discount) });
        res.redirect('/admin');
    } catch (err) {
        console.error("Error adding promo:", err);
        res.redirect('/admin');
    }
});

// Usuwanie kodu promocyjnego
app.post('/admin/delete-promo', authorize('admin'), async (req, res) => {
    try {
        const { code } = req.body;
        await db.deletePromoCode(code);
        res.redirect('/admin');
    } catch (err) {
        console.error("Error deleting promo:", err);
        res.redirect('/admin');
    }
});

// Obsługa logowania standardowego
app.post('/login', async (req, res) => {
    var username = req.body.txtUser;
    var pwd = req.body.txtPwd;

    const users = await db.getUsers();
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


app.get('/account', authorize(), async (req, res) => {
    try {
        const orders = await db.getOrders(req.user.id);
        res.render('account', { orders, user: req.user });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error loading account data');
    }
});