const express = require('express');
const router = express.Router();
const passport = require('passport');
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { ensureGuest, ensureAuthenticated, generateToken } = require('../middleware/auth');

// GET: Login page
router.get('/login', ensureGuest, (req, res) => {
  res.render('auth/login', {
    layout: 'layouts/auth',
    title: 'Login - Ticket System'
  });
});

// POST: Login
router.post('/login', ensureGuest, (req, res, next) => {
  passport.authenticate('local', {
    successRedirect: '/dashboard',
    failureRedirect: '/login',
    failureFlash: true
  })(req, res, next);
});

// GET: Register page
router.get('/register', ensureGuest, (req, res) => {
  res.render('auth/register', {
    layout: 'layouts/auth',
    title: 'Criar Conta - Ticket System'
  });
});

// POST: Register
router.post('/register', ensureGuest, [
  body('name').trim().notEmpty().withMessage('Nome é obrigatório').isLength({ min: 2 }).withMessage('Nome muito curto'),
  body('email').isEmail().withMessage('Email inválido').normalizeEmail(),
  body('password').isLength({ min: 6 }).withMessage('Senha deve ter no mínimo 6 caracteres'),
  body('password2').custom((value, { req }) => {
    if (value !== req.body.password) throw new Error('Senhas não conferem');
    return true;
  }),
  body('phone').optional().trim(),
  body('company').optional().trim()
], async (req, res) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    return res.render('auth/register', {
      layout: 'layouts/auth',
      title: 'Criar Conta',
      errors: errors.array(),
      formData: req.body
    });
  }

  try {
    const { name, email, password, phone, company, department } = req.body;

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.render('auth/register', {
        layout: 'layouts/auth',
        title: 'Criar Conta',
        errors: [{ msg: 'Este email já está cadastrado' }],
        formData: req.body
      });
    }

    const isFirstUser = (await User.countDocuments()) === 0;

    const user = new User({
      name,
      email,
      password,
      phone,
      company,
      department,
      role: isFirstUser ? 'admin' : 'client'
    });

    await user.save();

    // Log in after register
    req.login(user, (err) => {
      if (err) return next(err);
      req.flash('success_msg', `Bem-vindo, ${user.name}! Sua conta foi criada com sucesso.`);
      res.redirect('/dashboard');
    });

  } catch (err) {
    console.error(err);
    res.render('auth/register', {
      layout: 'layouts/auth',
      title: 'Criar Conta',
      errors: [{ msg: 'Erro ao criar conta. Tente novamente.' }],
      formData: req.body
    });
  }
});

// GET: Logout
router.get('/logout', ensureAuthenticated, (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.flash('success_msg', 'Você foi desconectado com sucesso');
    res.redirect('/login');
  });
});

// GET: Landing page
router.get('/', (req, res) => {
  if (req.isAuthenticated()) return res.redirect('/dashboard');
  res.redirect('/login');
});

module.exports = router;
