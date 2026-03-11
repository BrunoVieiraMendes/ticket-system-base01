const express = require('express');
const router = express.Router();
const SLA = require('../models/SLA');
const Ticket = require('../models/Ticket');
const User = require('../models/User');
const Queue = require('../models/Queue');
const { ensureAuthenticated } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/roles');

// Apply admin middleware to all routes
router.use(ensureAuthenticated, requireAdmin);

// GET: Admin dashboard
router.get('/', async (req, res) => {
  try {
    const [
      totalUsers, totalTickets, totalQueues, totalSLAs,
      clientCount, agentCount, adminCount,
      openTickets, slaBreached,
      recentUsers, slas
    ] = await Promise.all([
      User.countDocuments(),
      Ticket.countDocuments(),
      Queue.countDocuments({ isActive: true }),
      SLA.countDocuments({ isActive: true }),
      User.countDocuments({ role: 'client' }),
      User.countDocuments({ role: 'agent' }),
      User.countDocuments({ role: 'admin' }),
      Ticket.countDocuments({ status: { $nin: ['resolved', 'closed', 'cancelled'] } }),
      Ticket.countDocuments({ slaStatus: 'breached', status: { $nin: ['resolved', 'closed'] } }),
      User.find().sort({ createdAt: -1 }).limit(5).lean({ virtuals: true }),
      SLA.find().lean({ virtuals: true })
    ]);

    res.render('admin/index', {
      title: 'Administração',
      totalUsers, totalTickets, totalQueues, totalSLAs,
      clientCount, agentCount, adminCount,
      openTickets, slaBreached,
      recentUsers, slas
    });
  } catch (err) {
    req.flash('error_msg', 'Erro ao carregar painel admin');
    res.redirect('/dashboard');
  }
});

// === SLA Routes ===

// GET: List SLAs
router.get('/slas', async (req, res) => {
  try {
    const slas = await SLA.find().sort({ priority: 1 }).lean({ virtuals: true });
    res.render('admin/slas/index', { title: 'Gerenciar SLAs', slas });
  } catch (err) {
    req.flash('error_msg', 'Erro ao carregar SLAs');
    res.redirect('/admin');
  }
});

// GET: Create SLA form
router.get('/slas/create', async (req, res) => {
  const priorities = ['low', 'medium', 'high', 'critical'];
  const existingSLAs = await SLA.find().distinct('priority');
  const availablePriorities = priorities.filter(p => !existingSLAs.includes(p));

  res.render('admin/slas/form', {
    title: 'Novo SLA',
    sla: null,
    availablePriorities
  });
});

// POST: Create SLA
router.post('/slas', async (req, res) => {
  try {
    const {
      name, description, priority,
      responseHours, responseMinutes,
      resolutionHours, resolutionMinutes,
      warningThreshold, color,
      businessHoursEnabled, businessStart, businessEnd
    } = req.body;

    const sla = new SLA({
      name, description, priority,
      responseTime: {
        hours: parseInt(responseHours) || 0,
        minutes: parseInt(responseMinutes) || 0
      },
      resolutionTime: {
        hours: parseInt(resolutionHours) || 0,
        minutes: parseInt(resolutionMinutes) || 0
      },
      warningThreshold: parseInt(warningThreshold) || 80,
      color: color || '#6366f1',
      businessHours: {
        enabled: businessHoursEnabled === 'on',
        start: businessStart || '08:00',
        end: businessEnd || '18:00'
      }
    });

    await sla.save();
    req.flash('success_msg', `SLA "${name}" criado com sucesso!`);
    res.redirect('/admin/slas');

  } catch (err) {
    console.error(err);
    req.flash('error_msg', err.code === 11000 ? 'Já existe um SLA para esta prioridade' : 'Erro ao criar SLA');
    res.redirect('/admin/slas/create');
  }
});

// GET: Edit SLA form
router.get('/slas/:id/edit', async (req, res) => {
  try {
    const sla = await SLA.findById(req.params.id).lean({ virtuals: true });
    if (!sla) {
      req.flash('error_msg', 'SLA não encontrado');
      return res.redirect('/admin/slas');
    }

    const priorities = ['low', 'medium', 'high', 'critical'];
    const existingSLAs = await SLA.find({ _id: { $ne: req.params.id } }).distinct('priority');
    const availablePriorities = priorities.filter(p => !existingSLAs.includes(p) || p === sla.priority);

    res.render('admin/slas/form', { title: 'Editar SLA', sla, availablePriorities });
  } catch (err) {
    req.flash('error_msg', 'Erro ao carregar SLA');
    res.redirect('/admin/slas');
  }
});

// PUT: Update SLA
router.put('/slas/:id', async (req, res) => {
  try {
    const {
      name, description, priority,
      responseHours, responseMinutes,
      resolutionHours, resolutionMinutes,
      warningThreshold, color, isActive,
      businessHoursEnabled, businessStart, businessEnd
    } = req.body;

    await SLA.findByIdAndUpdate(req.params.id, {
      name, description, priority,
      responseTime: { hours: parseInt(responseHours) || 0, minutes: parseInt(responseMinutes) || 0 },
      resolutionTime: { hours: parseInt(resolutionHours) || 0, minutes: parseInt(resolutionMinutes) || 0 },
      warningThreshold: parseInt(warningThreshold) || 80,
      color: color || '#6366f1',
      isActive: isActive === 'on',
      businessHours: {
        enabled: businessHoursEnabled === 'on',
        start: businessStart || '08:00',
        end: businessEnd || '18:00'
      }
    });

    req.flash('success_msg', 'SLA atualizado com sucesso!');
    res.redirect('/admin/slas');

  } catch (err) {
    req.flash('error_msg', 'Erro ao atualizar SLA');
    res.redirect(`/admin/slas/${req.params.id}/edit`);
  }
});

// DELETE: Delete SLA
router.delete('/slas/:id', async (req, res) => {
  try {
    const queueCount = await Queue.countDocuments({ sla: req.params.id });
    if (queueCount > 0) {
      req.flash('error_msg', `Não é possível excluir: ${queueCount} filas usam este SLA`);
      return res.redirect('/admin/slas');
    }

    await SLA.findByIdAndDelete(req.params.id);
    req.flash('success_msg', 'SLA excluído com sucesso');
    res.redirect('/admin/slas');

  } catch (err) {
    req.flash('error_msg', 'Erro ao excluir SLA');
    res.redirect('/admin/slas');
  }
});

// GET: Reports
router.get('/reports', async (req, res) => {
  try {
    const { from, to } = req.query;
    const dateFrom = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const dateTo = to ? new Date(to) : new Date();

    const [
      totalCreated, totalResolved, totalBreached,
      byPriority, byQueue, byAgent,
      avgResolutionTime
    ] = await Promise.all([
      Ticket.countDocuments({ createdAt: { $gte: dateFrom, $lte: dateTo } }),
      Ticket.countDocuments({ resolvedAt: { $gte: dateFrom, $lte: dateTo } }),
      Ticket.countDocuments({ slaStatus: 'breached', createdAt: { $gte: dateFrom, $lte: dateTo } }),
      Ticket.aggregate([
        { $match: { createdAt: { $gte: dateFrom, $lte: dateTo } } },
        { $group: { _id: '$priority', count: { $sum: 1 } } }
      ]),
      Ticket.aggregate([
        { $match: { createdAt: { $gte: dateFrom, $lte: dateTo } } },
        { $group: { _id: '$queue', count: { $sum: 1 } } },
        { $lookup: { from: 'queues', localField: '_id', foreignField: '_id', as: 'queue' } },
        { $unwind: '$queue' },
        { $project: { name: '$queue.name', count: 1, color: '$queue.color' } },
        { $sort: { count: -1 } }
      ]),
      Ticket.aggregate([
        { $match: { status: { $in: ['resolved', 'closed'] }, assignedTo: { $ne: null }, resolvedAt: { $gte: dateFrom, $lte: dateTo } } },
        { $group: { _id: '$assignedTo', resolved: { $sum: 1 }, avgTime: { $avg: { $subtract: ['$resolvedAt', '$createdAt'] } } } },
        { $sort: { resolved: -1 } },
        { $limit: 10 }
      ]),
      Ticket.aggregate([
        { $match: { status: { $in: ['resolved', 'closed'] }, resolvedAt: { $exists: true }, resolvedAt: { $gte: dateFrom, $lte: dateTo } } },
        { $group: { _id: null, avg: { $avg: { $subtract: ['$resolvedAt', '$createdAt'] } } } }
      ])
    ]);

    const populatedAgents = await User.populate(byAgent, { path: '_id', select: 'name email avatar' });
    const avgHours = avgResolutionTime[0] ? Math.round(avgResolutionTime[0].avg / 3600000) : 0;

    res.render('admin/reports', {
      title: 'Relatórios',
      totalCreated, totalResolved, totalBreached,
      byPriority: JSON.stringify(byPriority),
      byQueue: JSON.stringify(byQueue),
      byAgent: populatedAgents,
      avgHours,
      dateFrom: dateFrom.toISOString().split('T')[0],
      dateTo: dateTo.toISOString().split('T')[0],
      slaRate: totalCreated > 0 ? Math.round(((totalCreated - totalBreached) / totalCreated) * 100) : 100
    });
  } catch (err) {
    console.error(err);
    req.flash('error_msg', 'Erro ao gerar relatório');
    res.redirect('/admin');
  }
});

module.exports = router;
