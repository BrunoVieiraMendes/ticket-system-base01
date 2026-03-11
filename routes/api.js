const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Ticket = require('../models/Ticket');
const Queue = require('../models/Queue');
const SLA = require('../models/SLA');
const { authenticateJWT, generateToken } = require('../middleware/auth');

// POST: API Login (returns JWT)
router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');

    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: 'Credenciais inválidas' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Credenciais inválidas' });
    }

    const token = generateToken(user);
    res.json({
      success: true,
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro interno' });
  }
});

// GET: Tickets API
router.get('/tickets', authenticateJWT, async (req, res) => {
  try {
    const { status, priority, limit = 20, page = 1 } = req.query;
    const query = {};

    if (req.user.role === 'client') query.createdBy = req.user._id;
    if (status) query.status = status;
    if (priority) query.priority = priority;

    const tickets = await Ticket.find(query)
      .populate('queue', 'name')
      .populate('assignedTo', 'name')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .lean({ virtuals: true });

    const total = await Ticket.countDocuments(query);

    res.json({ success: true, tickets, total, page: parseInt(page) });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao buscar chamados' });
  }
});

// GET: Queue categories (for dynamic form)
router.get('/queues/:id/categories', async (req, res) => {
  try {
    const queue = await Queue.findById(req.params.id).select('categories sla').populate('sla');
    if (!queue) return res.status(404).json({ success: false });
    res.json({ success: true, categories: queue.categories, sla: queue.sla });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// GET: Stats API
router.get('/stats', authenticateJWT, async (req, res) => {
  try {
    const [open, inProgress, resolved, breached] = await Promise.all([
      Ticket.countDocuments({ status: 'open' }),
      Ticket.countDocuments({ status: 'in_progress' }),
      Ticket.countDocuments({ status: { $in: ['resolved', 'closed'] } }),
      Ticket.countDocuments({ slaStatus: 'breached', status: { $nin: ['resolved', 'closed'] } })
    ]);
    res.json({ success: true, stats: { open, inProgress, resolved, breached } });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// GET: Search tickets
router.get('/tickets/search', authenticateJWT, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return res.json({ success: true, tickets: [] });

    const tickets = await Ticket.find({
      $or: [
        { title: { $regex: q, $options: 'i' } },
        { ticketNumber: { $regex: q, $options: 'i' } }
      ]
    }).select('ticketNumber title status priority').limit(10).lean({ virtuals: true });

    res.json({ success: true, tickets });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

module.exports = router;
