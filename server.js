require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const { AuthorizationCode } = require('simple-oauth2');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
const port = 3000;

// --- Konfiguracja aplikacji ---
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser('sekretny_klucz_do_podpisu'));
app.use(express.static('public')); // Serwowanie plików statycznych (CSS)

app.set('view engine', 'ejs');
app.set('views', './views');

// --- Baza danych (tymczasowa w pamięci) ---
const users = [];

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
    res.render('shop');
});

app.get('/about', (req, res) => {
    res.render('about');
});

app.get('/cart', (req, res) => {
    res.render('cart');
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

    if (users.find(u => u.username === username)) {
        return res.render('register', { message: 'Użytkownik już istnieje' });
    }

    users.push({
        username: username,
        password: hashPassword(password),
        displayName: displayName,
        role: 'user'
    });

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

        let user = users.find(u => u.username === data.email);
        if (!user) {
            user = {
                username: data.email,
                password: null, // Logowanie przez Google nie ma hasła
                displayName: data.name,
                role: 'user'
            };
            users.push(user);
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
    res.render('admin');
});

// Obsługa logowania standardowego
app.post('/login', (req, res) => {
    var username = req.body.txtUser;
    var pwd = req.body.txtPwd;

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