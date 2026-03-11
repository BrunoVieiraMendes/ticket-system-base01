const express = require('express');
const router = express.Router();
const Ticket = require('../models/Ticket');
const Queue = require('../models/Queue');
const User = require('../models/User');
const SLA = require('../models/SLA');
const { ensureAuthenticated } = require('../middleware/auth');

router.get('/', ensureAuthenticated, async (req, res) => {
  try {
    const user = req.user;
    const now = new Date();
    const last30Days = new Date(now - 30 * 24 * 60 * 60 * 1000);
    const last7Days = new Date(now - 7 * 24 * 60 * 60 * 1000);

    let ticketQuery = {};
    let agentQuery = {};

    if (user.role === 'client') {
      ticketQuery = { createdBy: user._id };
    } else if (user.role === 'agent') {
      ticketQuery = {
        $or: [
          { assignedTo: user._id },
          { queue: { $in: user.queues || [] } }
        ]
      };
    }

    // Main stats
    const [
      totalTickets,
      openTickets,
      inProgressTickets,
      resolvedTickets,
      criticalTickets,
      slaBreachedTickets,
      slaWarningTickets,
      recentTickets,
      totalUsers,
      totalQueues,
      totalAgents
    ] = await Promise.all([
      Ticket.countDocuments(ticketQuery),
      Ticket.countDocuments({ ...ticketQuery, status: 'open' }),
      Ticket.countDocuments({ ...ticketQuery, status: 'in_progress' }),
      Ticket.countDocuments({ ...ticketQuery, status: { $in: ['resolved', 'closed'] } }),
      Ticket.countDocuments({ ...ticketQuery, priority: 'critical', status: { $nin: ['resolved', 'closed', 'cancelled'] } }),
      Ticket.countDocuments({ ...ticketQuery, slaStatus: 'breached', status: { $nin: ['resolved', 'closed', 'cancelled'] } }),
      Ticket.countDocuments({ ...ticketQuery, slaStatus: 'warning', status: { $nin: ['resolved', 'closed', 'cancelled'] } }),
      Ticket.find(ticketQuery)
        .populate('createdBy', 'name email avatar')
        .populate('assignedTo', 'name email avatar')
        .populate('queue', 'name color')
        .sort({ createdAt: -1 })
        .limit(8)
        .lean(),
      user.role === 'admin' ? User.countDocuments() : 0,
      user.role === 'admin' ? Queue.countDocuments({ isActive: true }) : 0,
      user.role === 'admin' ? User.countDocuments({ role: 'agent' }) : 0
    ]);

    // Tickets by status (chart data)
    const statusData = await Ticket.aggregate([
      { $match: ticketQuery },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    // Tickets by priority (chart data)
    const priorityData = await Ticket.aggregate([
      { $match: { ...ticketQuery, status: { $nin: ['resolved', 'closed', 'cancelled'] } } },
      { $group: { _id: '$priority', count: { $sum: 1 } } }
    ]);

    // Tickets last 7 days (chart data)
    const last7DaysData = await Ticket.aggregate([
      { $match: { ...ticketQuery, createdAt: { $gte: last7Days } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Fill missing days
    const dailyTickets = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date(now - i * 24 * 60 * 60 * 1000);
      const dateStr = date.toISOString().split('T')[0];
      const found = last7DaysData.find(d => d._id === dateStr);
      dailyTickets.push({
        date: dateStr,
        label: date.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric' }),
        count: found ? found.count : 0
      });
    }

    // Queue stats (for admin/agent)
    let queueStats = [];
    if (user.role !== 'client') {
      const queues = user.role === 'admin'
        ? await Queue.find({ isActive: true }).populate('sla').lean()
        : await Queue.find({ _id: { $in: user.queues }, isActive: true }).populate('sla').lean();

      for (const queue of queues) {
        const [open, inProg, slaBreached] = await Promise.all([
          Ticket.countDocuments({ queue: queue._id, status: 'open' }),
          Ticket.countDocuments({ queue: queue._id, status: 'in_progress' }),
          Ticket.countDocuments({ queue: queue._id, slaStatus: 'breached', status: { $nin: ['resolved', 'closed'] } })
        ]);
        queueStats.push({ ...queue, open, inProgress: inProg, slaBreached });
      }
    }

    // Top agents performance (admin only)
    let topAgents = [];
    if (user.role === 'admin') {
      const agentStats = await Ticket.aggregate([
        {
          $match: {
            status: { $in: ['resolved', 'closed'] },
            assignedTo: { $ne: null },
            resolvedAt: { $gte: last30Days }
          }
        },
        {
          $group: {
            _id: '$assignedTo',
            resolved: { $sum: 1 },
            avgTime: {
              $avg: { $subtract: ['$resolvedAt', '$createdAt'] }
            }
          }
        },
        { $sort: { resolved: -1 } },
        { $limit: 5 }
      ]);

      topAgents = await User.populate(agentStats, { path: '_id', select: 'name email avatar' });
    }

    res.render('dashboard/index', {
      title: 'Dashboard',
      totalTickets,
      openTickets,
      inProgressTickets,
      resolvedTickets,
      criticalTickets,
      slaBreachedTickets,
      slaWarningTickets,
      recentTickets,
      totalUsers,
      totalQueues,
      totalAgents,
      statusData: JSON.stringify(statusData),
      priorityData: JSON.stringify(priorityData),
      dailyTickets: JSON.stringify(dailyTickets),
      queueStats,
      topAgents
    });

  } catch (err) {
    console.error(err);
    res.render('errors/500', { layout: 'layouts/error', title: 'Erro', error: err });
  }
});

module.exports = router;
