const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Ensure user is authenticated (session-based)
exports.ensureAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  req.flash('error_msg', 'Por favor, faça login para acessar esta página');
  res.redirect('/login');
};

// Ensure user is NOT authenticated (for login/register pages)
exports.ensureGuest = (req, res, next) => {
  if (!req.isAuthenticated()) {
    return next();
  }
  res.redirect('/dashboard');
};

// JWT middleware for API routes
exports.authenticateJWT = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Token não fornecido' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');

    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: 'Token inválido' });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Token inválido ou expirado' });
  }
};

// Generate JWT token
exports.generateToken = (user) => {
  return jwt.sign(
    {
      id: user._id,
      email: user.email,
      role: user.role
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
};

// Check if user is active
exports.ensureActive = async (req, res, next) => {
  if (req.user && !req.user.isActive) {
    req.logout(() => {});
    req.flash('error_msg', 'Sua conta foi desativada');
    return res.redirect('/login');
  }
  next();
};
