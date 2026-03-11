const express = require('express');
const router = express.Router();
const Queue = require('../models/Queue');
const SLA = require('../models/SLA');
const User = require('../models/User');
const Ticket = require('../models/Ticket');
const { ensureAuthenticated } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/roles');

// GET: List queues
router.get('/', ensureAuthenticated, requireAdmin, async (req, res) => {
  try {
    const queues = await Queue.find()
      .populate('sla', 'name priority color priorityDisplay priorityBadge')
      .populate('agents', 'name email avatar role')
      .lean({ virtuals: true });

    // Get ticket counts for each queue
    for (const queue of queues) {
      const [open, inProgress, resolved, breached] = await Promise.all([
        Ticket.countDocuments({ queue: queue._id, status: 'open' }),
        Ticket.countDocuments({ queue: queue._id, status: 'in_progress' }),
        Ticket.countDocuments({ queue: queue._id, status: { $in: ['resolved', 'closed'] } }),
        Ticket.countDocuments({ queue: queue._id, slaStatus: 'breached', status: { $nin: ['resolved', 'closed'] } })
      ]);
      queue.ticketCounts = { open, inProgress, resolved, breached };
    }

    res.render('queues/index', {
      title: 'Gerenciar Filas',
      queues
    });
  } catch (err) {
    console.error(err);
    req.flash('error_msg', 'Erro ao carregar filas');
    res.redirect('/dashboard');
  }
});

// GET: Create queue form
router.get('/create', ensureAuthenticated, requireAdmin, async (req, res) => {
  try {
    const [slas, agents] = await Promise.all([
      SLA.find({ isActive: true }).lean({ virtuals: true }),
      User.find({ role: 'agent', isActive: true }).select('name email avatar').lean()
    ]);

    res.render('queues/form', {
      title: 'Nova Fila',
      queue: null,
      slas,
      agents
    });
  } catch (err) {
    req.flash('error_msg', 'Erro ao carregar formulário');
    res.redirect('/queues');
  }
});

// POST: Create queue
router.post('/', ensureAuthenticated, requireAdmin, async (req, res) => {
  try {
    const { name, description, slaId, agentIds, color, icon, categories,
            autoAssignEnabled, autoAssignMethod, escalationEnabled, escalationHours } = req.body;

    const queue = new Queue({
      name,
      description,
      sla: slaId,
      agents: Array.isArray(agentIds) ? agentIds : agentIds ? [agentIds] : [],
      color: color || '#6366f1',
      icon: icon || '📋',
      categories: categories ? categories.split(',').map(c => c.trim()).filter(Boolean) : [],
      autoAssign: {
        enabled: autoAssignEnabled === 'on',
        method: autoAssignMethod || 'round-robin'
      },
      escalation: {
        enabled: escalationEnabled === 'on',
        afterHours: parseInt(escalationHours) || 4
      }
    });

    await queue.save();

    // Update agents' queue references
    if (queue.agents.length > 0) {
      await User.updateMany(
        { _id: { $in: queue.agents } },
        { $addToSet: { queues: queue._id } }
      );
    }

    req.flash('success_msg', `Fila "${name}" criada com sucesso!`);
    res.redirect('/queues');

  } catch (err) {
    console.error(err);
    req.flash('error_msg', err.code === 11000 ? 'Já existe uma fila com este nome' : 'Erro ao criar fila');
    res.redirect('/queues/create');
  }
});

// GET: Edit queue form
router.get('/:id/edit', ensureAuthenticated, requireAdmin, async (req, res) => {
  try {
    const [queue, slas, agents] = await Promise.all([
      Queue.findById(req.params.id).populate('agents', 'name email').lean(),
      SLA.find({ isActive: true }).lean({ virtuals: true }),
      User.find({ role: 'agent', isActive: true }).select('name email avatar').lean()
    ]);

    if (!queue) {
      req.flash('error_msg', 'Fila não encontrada');
      return res.redirect('/queues');
    }

    res.render('queues/form', {
      title: 'Editar Fila',
      queue,
      slas,
      agents
    });
  } catch (err) {
    req.flash('error_msg', 'Erro ao carregar fila');
    res.redirect('/queues');
  }
});

// PUT: Update queue
router.put('/:id', ensureAuthenticated, requireAdmin, async (req, res) => {
  try {
    const { name, description, slaId, agentIds, color, icon, categories,
            autoAssignEnabled, autoAssignMethod, isActive, escalationEnabled, escalationHours } = req.body;

    const queue = await Queue.findById(req.params.id);
    if (!queue) {
      req.flash('error_msg', 'Fila não encontrada');
      return res.redirect('/queues');
    }

    const newAgents = Array.isArray(agentIds) ? agentIds : agentIds ? [agentIds] : [];
    const removedAgents = queue.agents.filter(a => !newAgents.includes(a.toString()));
    const addedAgents = newAgents.filter(a => !queue.agents.map(ag => ag.toString()).includes(a));

    queue.name = name;
    queue.description = description;
    queue.sla = slaId;
    queue.agents = newAgents;
    queue.color = color || '#6366f1';
    queue.icon = icon || '📋';
    queue.categories = categories ? categories.split(',').map(c => c.trim()).filter(Boolean) : [];
    queue.isActive = isActive === 'on';
    queue.autoAssign = {
      enabled: autoAssignEnabled === 'on',
      method: autoAssignMethod || 'round-robin',
      currentIndex: queue.autoAssign.currentIndex
    };
    queue.escalation = {
      enabled: escalationEnabled === 'on',
      afterHours: parseInt(escalationHours) || 4
    };

    await queue.save();

    // Update agent references
    if (removedAgents.length > 0) {
      await User.updateMany({ _id: { $in: removedAgents } }, { $pull: { queues: queue._id } });
    }
    if (addedAgents.length > 0) {
      await User.updateMany({ _id: { $in: addedAgents } }, { $addToSet: { queues: queue._id } });
    }

    req.flash('success_msg', 'Fila atualizada com sucesso!');
    res.redirect('/queues');

  } catch (err) {
    console.error(err);
    req.flash('error_msg', 'Erro ao atualizar fila');
    res.redirect(`/queues/${req.params.id}/edit`);
  }
});

// DELETE: Delete queue
router.delete('/:id', ensureAuthenticated, requireAdmin, async (req, res) => {
  try {
    const ticketCount = await Ticket.countDocuments({ queue: req.params.id });
    if (ticketCount > 0) {
      req.flash('error_msg', `Não é possível excluir: existem ${ticketCount} chamados nesta fila`);
      return res.redirect('/queues');
    }

    const queue = await Queue.findByIdAndDelete(req.params.id);
    if (queue) {
      await User.updateMany({ queues: queue._id }, { $pull: { queues: queue._id } });
    }

    req.flash('success_msg', 'Fila excluída com sucesso');
    res.redirect('/queues');

  } catch (err) {
    req.flash('error_msg', 'Erro ao excluir fila');
    res.redirect('/queues');
  }
});

module.exports = router;
