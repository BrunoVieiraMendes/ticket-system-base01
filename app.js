require('dotenv').config();
const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const passport = require('passport');
const flash = require('connect-flash');
const methodOverride = require('method-override');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const http = require('http');
const socketIo = require('socket.io');
const cron = require('node-cron');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Database
require('./config/database');

// Passport config
require('./config/passport')(passport);

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layouts/main');

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Body parsing
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(methodOverride('_method'));

// Logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Session
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI,
    touchAfter: 24 * 3600
  }),
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7 // 7 days
  }
}));

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());
app.use(flash());

// Global variables middleware
app.use((req, res, next) => {
  res.locals.user = req.user || null;
  res.locals.success_msg = req.flash('success_msg');
  res.locals.error_msg = req.flash('error_msg');
  res.locals.error = req.flash('error');
  res.locals.io = io;
  next();
});

// Socket.io
io.on('connection', (socket) => {
  socket.on('join-room', (userId) => {
    socket.join(userId);
  });
  socket.on('disconnect', () => {});
});

app.use((req, res, next) => {
  req.io = io;
  next();
});

// Routes
app.use('/', require('./routes/auth'));
app.use('/dashboard', require('./routes/dashboard'));
app.use('/tickets', require('./routes/tickets'));
app.use('/queues', require('./routes/queues'));
app.use('/users', require('./routes/users'));
app.use('/admin', require('./routes/admin'));
app.use('/api', require('./routes/api'));

// SLA Cron Job - Checks every minute
cron.schedule('* * * * *', async () => {
  const slaChecker = require('./utils/slaChecker');
  await slaChecker.checkSLABreaches(io);
});

// 404 handler
app.use((req, res) => {
  res.status(404).render('errors/404', { layout: 'layouts/error', title: 'Página não encontrada' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('errors/500', { layout: 'layouts/error', title: 'Erro interno', error: err });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 Servidor rodando em http://localhost:${PORT}`);
  console.log(`📋 Sistema de Fila de Chamados iniciado`);
  console.log(`🌍 Ambiente: ${process.env.NODE_ENV}\n`);
});

module.exports = { app, io };
