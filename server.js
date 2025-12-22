require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const { AuthorizationCode } = require('simple-oauth2');
const axios = require('axios');
const crypto = require('crypto');
const app = express();
const port = 3000;

app.use(express.urlencoded({ extended: true }));
app.use(cookieParser('sekretny_klucz_do_podpisu'));
const users = []; //to zostanie zastapione baza danych

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

function authorize(...roles) {
  return function(req, res, next) {
    if ( req.signedCookies.user ) {
      const username = req.signedCookies.user;
      const user = users.find(u => u.username === username);
      if ( user && (roles.length == 0 || roles.some( role => isUserInRole( user, role ) ))) {
        req.user = user;
        return next();
      }
    }
    res.redirect('/login?returnUrl='+req.url);
  }
}

function isUserInRole(user, role) {
  return user.role === role;
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

app.set('view engine', 'ejs');
app.set('views', './views');

app.use(express.static('public'));

app.get( '/', authorize(), (req, res) => {
  res.render('app', { user : req.user } );
});

app.get( '/register', (req, res) => {
  res.render('register');
});

app.post('/register', (req, res) => {
  const username = req.body.txtUser;
  const password = req.body.txtPwd;
  const displayName = req.body.txtName;

  if (users.find(u => u.username === username)) {
    return res.render('register', { message: 'Użytkownik już istnieje' });
  }

  users.push({ username: username, password: hashPassword(password), displayName: displayName, role: 'user' });
  res.redirect('/login');
});

app.get( '/logout', authorize(), (req, res) => {
  res.cookie('user', '', { maxAge: -1 } );
  res.redirect('/')
});

app.get( '/login', (req, res) => {
  res.render('login', { google: authorizationUri });
});

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
        password: null,
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

app.get( '/admin', authorize('admin'), (req, res) => {
  res.render('admin');
});

app.post( '/login', (req, res) => {
  var username = req.body.txtUser;
  var pwd = req.body.txtPwd;

  const user = users.find(u => u.username === username && u.password === hashPassword(pwd));

  if ( user ) {
    res.cookie('user', username, { signed: true });
    var returnUrl = req.query.returnUrl || '/';
    res.redirect(returnUrl);
  } else {
    res.render( 'login', { message : "Wrong username or password", google: authorizationUri }
    );
  }
});

app.listen(port, () => {
  console.log(`http://localhost:${port}`);
});