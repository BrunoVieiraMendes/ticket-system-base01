const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Ticket = require('../models/Ticket');
const Queue = require('../models/Queue');
const { ensureAuthenticated } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/roles');

// GET: Profile
router.get('/profile', ensureAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate('queues', 'name color icon').lean({ virtuals: true });

    const [myTickets, resolvedTickets] = await Promise.all([
      Ticket.countDocuments({ createdBy: user._id }),
      Ticket.countDocuments({ createdBy: user._id, status: { $in: ['resolved', 'closed'] } })
    ]);

    let agentStats = null;
    if (user.role === 'agent' || user.role === 'admin') {
      const [assigned, resolvedByMe, slaBreached] = await Promise.all([
        Ticket.countDocuments({ assignedTo: user._id, status: { $nin: ['resolved', 'closed'] } }),
        Ticket.countDocuments({ assignedTo: user._id, status: { $in: ['resolved', 'closed'] } }),
        Ticket.countDocuments({ assignedTo: user._id, slaStatus: 'breached' })
      ]);
      agentStats = { assigned, resolvedByMe, slaBreached };
    }

    res.render('users/profile', {
      title: 'Meu Perfil',
      profileUser: user,
      myTickets,
      resolvedTickets,
      agentStats
    });
  } catch (err) {
    req.flash('error_msg', 'Erro ao carregar perfil');
    res.redirect('/dashboard');
  }
});

// PUT: Update profile
router.put('/profile', ensureAuthenticated, async (req, res) => {
  try {
    const { name, phone, company, department, bio,
            notifEmail, notifSla, notifNewTicket, notifUpdate } = req.body;

    await User.findByIdAndUpdate(req.user._id, {
      name,
      phone,
      company,
      department,
      bio,
      notifications: {
        email: notifEmail === 'on',
        slaWarning: notifSla === 'on',
        newTicket: notifNewTicket === 'on',
        ticketUpdate: notifUpdate === 'on'
      }
    });

    req.flash('success_msg', 'Perfil atualizado com sucesso!');
    res.redirect('/users/profile');

  } catch (err) {
    req.flash('error_msg', 'Erro ao atualizar perfil');
    res.redirect('/users/profile');
  }
});

// PUT: Change password
router.put('/profile/password', ensureAuthenticated, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (newPassword !== confirmPassword) {
      req.flash('error_msg', 'Nova senha e confirmação não conferem');
      return res.redirect('/users/profile');
    }

    if (newPassword.length < 6) {
      req.flash('error_msg', 'A nova senha deve ter pelo menos 6 caracteres');
      return res.redirect('/users/profile');
    }

    const user = await User.findById(req.user._id).select('+password');
    const isMatch = await bcrypt.compare(currentPassword, user.password);

    if (!isMatch) {
      req.flash('error_msg', 'Senha atual incorreta');
      return res.redirect('/users/profile');
    }

    user.password = newPassword;
    await user.save();

    req.flash('success_msg', 'Senha alterada com sucesso!');
    res.redirect('/users/profile');

  } catch (err) {
    req.flash('error_msg', 'Erro ao alterar senha');
    res.redirect('/users/profile');
  }
});

// GET: List users (admin)
router.get('/', ensureAuthenticated, requireAdmin, async (req, res) => {
  try {
    const { role, status, search, page = 1 } = req.query;
    const query = {};
    const limit = 12;

    if (role && role !== 'all') query.role = role;
    if (status === 'active') query.isActive = true;
    if (status === 'inactive') query.isActive = false;
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (parseInt(page) - 1) * limit;
    const [users, total] = await Promise.all([
      User.find(query).populate('queues', 'name').sort({ createdAt: -1 }).skip(skip).limit(limit).lean({ virtuals: true }),
      User.countDocuments(query)
    ]);

    const totalPages = Math.ceil(total / limit);

    res.render('users/index', {
      title: 'Usuários',
      users,
      total,
      page: parseInt(page),
      totalPages,
      filters: { role, status, search }
    });
  } catch (err) {
    req.flash('error_msg', 'Erro ao carregar usuários');
    res.redirect('/dashboard');
  }
});

// GET: User detail (admin)
router.get('/:id', ensureAuthenticated, requireAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).populate('queues', 'name color icon').lean({ virtuals: true });
    if (!user) {
      req.flash('error_msg', 'Usuário não encontrado');
      return res.redirect('/users');
    }

    const [createdTickets, assignedTickets] = await Promise.all([
      Ticket.find({ createdBy: user._id }).populate('queue', 'name').sort({ createdAt: -1 }).limit(10).lean({ virtuals: true }),
      Ticket.find({ assignedTo: user._id }).populate('queue', 'name').sort({ createdAt: -1 }).limit(10).lean({ virtuals: true })
    ]);

    const queues = await Queue.find({ isActive: true }).lean();

    res.render('users/detail', {
      title: user.name,
      profileUser: user,
      createdTickets,
      assignedTickets,
      queues
    });
  } catch (err) {
    req.flash('error_msg', 'Erro ao carregar usuário');
    res.redirect('/users');
  }
});

// PUT: Update user (admin)
router.put('/:id', ensureAuthenticated, requireAdmin, async (req, res) => {
  try {
    const { name, email, role, department, company, isActive, queueIds } = req.body;

    const user = await User.findById(req.params.id).populate('queues');
    if (!user) {
      req.flash('error_msg', 'Usuário não encontrado');
      return res.redirect('/users');
    }

    // Prevent removing last admin
    if (user.role === 'admin' && role !== 'admin') {
      const adminCount = await User.countDocuments({ role: 'admin' });
      if (adminCount <= 1) {
        req.flash('error_msg', 'Não é possível remover o último administrador');
        return res.redirect(`/users/${user._id}`);
      }
    }

    const newQueues = Array.isArray(queueIds) ? queueIds : queueIds ? [queueIds] : [];
    const oldQueues = user.queues.map(q => q._id.toString());

    // Remove user from old queues not in new list
    const removedQueues = oldQueues.filter(q => !newQueues.includes(q));
    const addedQueues = newQueues.filter(q => !oldQueues.includes(q));

    if (removedQueues.length > 0) {
      await Queue.updateMany({ _id: { $in: removedQueues } }, { $pull: { agents: user._id } });
    }
    if (addedQueues.length > 0) {
      await Queue.updateMany({ _id: { $in: addedQueues } }, { $addToSet: { agents: user._id } });
    }

    user.name = name;
    user.email = email;
    user.role = role;
    user.department = department;
    user.company = company;
    user.isActive = isActive === 'on';
    user.queues = newQueues;

    await user.save();

    req.flash('success_msg', 'Usuário atualizado com sucesso!');
    res.redirect(`/users/${user._id}`);

  } catch (err) {
    console.error(err);
    req.flash('error_msg', 'Erro ao atualizar usuário');
    res.redirect(`/users/${req.params.id}`);
  }
});

// DELETE: Delete user (admin)
router.delete('/:id', ensureAuthenticated, requireAdmin, async (req, res) => {
  try {
    if (req.params.id === req.user._id.toString()) {
      req.flash('error_msg', 'Você não pode excluir sua própria conta');
      return res.redirect('/users');
    }

    const openTickets = await Ticket.countDocuments({
      $or: [{ createdBy: req.params.id }, { assignedTo: req.params.id }],
      status: { $nin: ['resolved', 'closed', 'cancelled'] }
    });

    if (openTickets > 0) {
      req.flash('error_msg', `Não é possível excluir: usuário tem ${openTickets} chamados ativos`);
      return res.redirect('/users');
    }

    await User.findByIdAndDelete(req.params.id);
    req.flash('success_msg', 'Usuário excluído com sucesso');
    res.redirect('/users');

  } catch (err) {
    req.flash('error_msg', 'Erro ao excluir usuário');
    res.redirect('/users');
  }
});

module.exports = router;
