// Check if user has required role
exports.requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      req.flash('error_msg', 'Acesso negado');
      return res.redirect('/login');
    }

    if (!roles.includes(req.user.role)) {
      req.flash('error_msg', `Acesso negado. Você precisa ser: ${roles.join(' ou ')}`);
      return res.redirect('/dashboard');
    }

    next();
  };
};

// Check if user is admin
exports.requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    if (req.xhr || req.path.startsWith('/api')) {
      return res.status(403).json({ success: false, message: 'Acesso negado' });
    }
    req.flash('error_msg', 'Acesso restrito a administradores');
    return res.redirect('/dashboard');
  }
  next();
};

// Check if user is agent or admin
exports.requireAgent = (req, res, next) => {
  if (!req.user || !['admin', 'agent'].includes(req.user.role)) {
    if (req.xhr || req.path.startsWith('/api')) {
      return res.status(403).json({ success: false, message: 'Acesso negado' });
    }
    req.flash('error_msg', 'Acesso restrito a agentes');
    return res.redirect('/dashboard');
  }
  next();
};

// Check if user can access ticket
exports.canAccessTicket = (req, res, next) => {
  const ticket = req.ticket;
  if (!ticket) return next();

  const user = req.user;

  if (user.role === 'admin') return next();
  if (user.role === 'agent') {
    // Agent can access tickets in their queues
    if (ticket.assignedTo && ticket.assignedTo.toString() === user._id.toString()) return next();
    if (user.queues && user.queues.some(q => q.toString() === ticket.queue.toString())) return next();
  }
  if (user.role === 'client') {
    if (ticket.createdBy.toString() === user._id.toString()) return next();
  }

  req.flash('error_msg', 'Você não tem permissão para acessar este chamado');
  res.redirect('/tickets');
};

// Check if user can modify ticket
exports.canModifyTicket = (req, res, next) => {
  const ticket = req.ticket;
  if (!ticket) return next();

  const user = req.user;

  if (user.role === 'admin') return next();
  if (user.role === 'agent') {
    if (ticket.assignedTo && ticket.assignedTo.toString() === user._id.toString()) return next();
  }

  req.flash('error_msg', 'Você não tem permissão para modificar este chamado');
  res.redirect(`/tickets/${ticket._id}`);
};
