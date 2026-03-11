const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Ticket = require('../models/Ticket');
const Queue = require('../models/Queue');
const User = require('../models/User');
const SLA = require('../models/SLA');
const Comment = require('../models/Comment');
const { ensureAuthenticated } = require('../middleware/auth');
const { requireAgent, requireAdmin } = require('../middleware/roles');

// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'public/uploads/tickets';
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|pdf|doc|docx|txt|zip/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    if (ext) return cb(null, true);
    cb(new Error('Tipo de arquivo não permitido'));
  }
});

// Helper: build ticket query based on role
const buildQuery = (user, filters = {}) => {
  let baseQuery = {};
  if (user.role === 'client') {
    baseQuery.createdBy = user._id;
  } else if (user.role === 'agent') {
    baseQuery.$or = [
      { assignedTo: user._id },
      { queue: { $in: user.queues || [] } }
    ];
  }
  return { ...baseQuery, ...filters };
};

// GET: List tickets
router.get('/', ensureAuthenticated, async (req, res) => {
  try {
    const { status, priority, queue, slaStatus, search, page = 1, limit = 15 } = req.query;
    const query = buildQuery(req.user);

    if (status && status !== 'all') query.status = status;
    if (priority && priority !== 'all') query.priority = priority;
    if (queue && queue !== 'all') query.queue = queue;
    if (slaStatus && slaStatus !== 'all') query.slaStatus = slaStatus;
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { ticketNumber: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [tickets, total] = await Promise.all([
      Ticket.find(query)
        .populate('createdBy', 'name email avatar')
        .populate('assignedTo', 'name email avatar')
        .populate('queue', 'name color icon')
        .populate('sla', 'name priority color')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean({ virtuals: true }),
      Ticket.countDocuments(query)
    ]);

    const queues = req.user.role === 'admin'
      ? await Queue.find({ isActive: true }).lean()
      : await Queue.find({ _id: { $in: req.user.queues }, isActive: true }).lean();

    const totalPages = Math.ceil(total / parseInt(limit));

    res.render('tickets/index', {
      title: 'Chamados',
      tickets,
      queues,
      total,
      page: parseInt(page),
      totalPages,
      limit: parseInt(limit),
      filters: { status, priority, queue, slaStatus, search }
    });
  } catch (err) {
    console.error(err);
    req.flash('error_msg', 'Erro ao carregar chamados');
    res.redirect('/dashboard');
  }
});

// GET: Create ticket form
router.get('/create', ensureAuthenticated, async (req, res) => {
  try {
    const queues = req.user.role === 'admin'
      ? await Queue.find({ isActive: true }).populate('sla').lean()
      : await Queue.find({ isActive: true }).populate('sla').lean();

    res.render('tickets/create', {
      title: 'Novo Chamado',
      queues
    });
  } catch (err) {
    req.flash('error_msg', 'Erro ao carregar formulário');
    res.redirect('/tickets');
  }
});

// POST: Create ticket
router.post('/', ensureAuthenticated, upload.array('attachments', 5), async (req, res) => {
  try {
    const { title, description, priority, queueId, category, tags, dueDate } = req.body;

    if (!title || !description || !queueId) {
      req.flash('error_msg', 'Preencha todos os campos obrigatórios');
      return res.redirect('/tickets/create');
    }

    const queue = await Queue.findById(queueId).populate('sla');
    if (!queue) {
      req.flash('error_msg', 'Fila não encontrada');
      return res.redirect('/tickets/create');
    }

    // Calculate SLA deadlines
    let slaDeadlines = {};
    let slaId = null;
    if (queue.sla) {
      const sla = queue.sla;
      slaId = sla._id;
      const now = new Date();
      slaDeadlines = {
        responseDeadline: new Date(now.getTime() + sla.responseTimeMinutes * 60000),
        resolutionDeadline: new Date(now.getTime() + sla.resolutionTimeMinutes * 60000),
        responseAchieved: false,
        resolutionAchieved: false
      };
    }

    // Process attachments
    const attachments = (req.files || []).map(file => ({
      filename: file.filename,
      originalName: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      uploadedBy: req.user._id
    }));

    // Auto-assign if enabled
    let assignedTo = null;
    if (queue.autoAssign.enabled && queue.agents.length > 0) {
      assignedTo = await queue.getNextAgent();
    }

    const ticket = new Ticket({
      title,
      description,
      priority: priority || 'medium',
      queue: queueId,
      sla: slaId,
      slaDeadlines,
      category,
      tags: tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      createdBy: req.user._id,
      assignedTo,
      dueDate: dueDate || null,
      attachments,
      history: [{
        action: 'created',
        performedBy: req.user._id,
        note: 'Chamado criado'
      }]
    });

    await ticket.save();

    // Update queue stats
    await Queue.findByIdAndUpdate(queueId, { $inc: { 'stats.totalTickets': 1, 'stats.openTickets': 1 } });

    // Notify agent if assigned
    if (assignedTo && req.io) {
      req.io.to(assignedTo.toString()).emit('ticket:assigned', {
        ticketNumber: ticket.ticketNumber,
        title: ticket.title,
        ticketId: ticket._id
      });
    }

    // Notify all agents in queue
    if (queue.agents && queue.agents.length > 0 && req.io) {
      queue.agents.forEach(agentId => {
        req.io.to(agentId.toString()).emit('ticket:new', {
          ticketNumber: ticket.ticketNumber,
          title: ticket.title,
          priority: ticket.priority
        });
      });
    }

    req.flash('success_msg', `Chamado ${ticket.ticketNumber} criado com sucesso!`);
    res.redirect(`/tickets/${ticket._id}`);

  } catch (err) {
    console.error(err);
    req.flash('error_msg', 'Erro ao criar chamado');
    res.redirect('/tickets/create');
  }
});

// GET: View ticket
router.get('/:id', ensureAuthenticated, async (req, res) => {
  try {
    const ticket = await Ticket.findById(req.params.id)
      .populate('createdBy', 'name email avatar phone company role')
      .populate('assignedTo', 'name email avatar')
      .populate('queue', 'name color icon sla agents')
      .populate('sla')
      .populate('history.performedBy', 'name avatar')
      .populate('internalNotes.createdBy', 'name avatar')
      .lean({ virtuals: true });

    if (!ticket) {
      req.flash('error_msg', 'Chamado não encontrado');
      return res.redirect('/tickets');
    }

    // Access control
    const user = req.user;
    if (user.role === 'client' && ticket.createdBy._id.toString() !== user._id.toString()) {
      req.flash('error_msg', 'Acesso negado');
      return res.redirect('/tickets');
    }

    const comments = await Comment.find({ ticket: ticket._id })
      .populate('author', 'name email avatar role')
      .sort({ createdAt: 1 })
      .lean({ virtuals: true });

    // Filter internal comments for clients
    const filteredComments = user.role === 'client'
      ? comments.filter(c => c.type === 'public')
      : comments;

    // Available agents for assignment
    let availableAgents = [];
    if (['admin', 'agent'].includes(user.role)) {
      const queueDoc = await Queue.findById(ticket.queue._id).populate('agents', 'name email avatar');
      availableAgents = queueDoc ? queueDoc.agents : [];
    }

    // SLA progress
    let slaProgress = 0;
    let slaTimeLeft = null;
    if (ticket.slaDeadlines && ticket.slaDeadlines.resolutionDeadline) {
      const now = new Date();
      const created = new Date(ticket.createdAt);
      const deadline = new Date(ticket.slaDeadlines.resolutionDeadline);
      const total = deadline - created;
      const elapsed = now - created;
      slaProgress = Math.min(100, Math.round((elapsed / total) * 100));

      const timeLeftMs = deadline - now;
      if (timeLeftMs > 0) {
        const hours = Math.floor(timeLeftMs / 3600000);
        const mins = Math.floor((timeLeftMs % 3600000) / 60000);
        slaTimeLeft = { hours, minutes: mins };
      } else {
        slaTimeLeft = { expired: true };
      }
    }

    res.render('tickets/show', {
      title: `${ticket.ticketNumber} - ${ticket.title}`,
      ticket,
      comments: filteredComments,
      availableAgents,
      slaProgress,
      slaTimeLeft
    });

  } catch (err) {
    console.error(err);
    req.flash('error_msg', 'Erro ao carregar chamado');
    res.redirect('/tickets');
  }
});

// POST: Add comment
router.post('/:id/comments', ensureAuthenticated, async (req, res) => {
  try {
    const { content, type } = req.body;
    const ticket = await Ticket.findById(req.params.id).populate('sla');

    if (!ticket) {
      req.flash('error_msg', 'Chamado não encontrado');
      return res.redirect('/tickets');
    }

    const commentType = req.user.role === 'client' ? 'public' : (type || 'public');

    const comment = new Comment({
      ticket: ticket._id,
      content,
      author: req.user._id,
      type: commentType
    });

    await comment.save();

    // Mark first response if not set
    if (!ticket.firstResponseAt && req.user.role !== 'client') {
      ticket.firstResponseAt = new Date();
      if (ticket.slaDeadlines) ticket.slaDeadlines.responseAchieved = true;
    }

    // Update status to in_progress if still open and agent is responding
    if (ticket.status === 'open' && req.user.role !== 'client') {
      ticket.status = 'in_progress';
    }

    ticket.history.push({
      action: 'comment_added',
      performedBy: req.user._id,
      note: commentType === 'internal' ? 'Nota interna adicionada' : 'Resposta adicionada'
    });

    await ticket.save();

    // Notify ticket creator
    if (req.io && commentType === 'public') {
      req.io.to(ticket.createdBy.toString()).emit('ticket:comment', {
        ticketNumber: ticket.ticketNumber,
        author: req.user.name
      });
    }

    req.flash('success_msg', 'Resposta adicionada com sucesso');
    res.redirect(`/tickets/${ticket._id}`);

  } catch (err) {
    console.error(err);
    req.flash('error_msg', 'Erro ao adicionar comentário');
    res.redirect(`/tickets/${req.params.id}`);
  }
});

// PUT: Update ticket status
router.put('/:id/status', ensureAuthenticated, async (req, res) => {
  try {
    const { status } = req.body;
    const ticket = await Ticket.findById(req.params.id).populate('queue');

    if (!ticket) {
      req.flash('error_msg', 'Chamado não encontrado');
      return res.redirect('/tickets');
    }

    // Clients can only reopen
    if (req.user.role === 'client' && !['waiting', 'closed'].includes(status)) {
      req.flash('error_msg', 'Operação não permitida');
      return res.redirect(`/tickets/${ticket._id}`);
    }

    const oldStatus = ticket.status;
    ticket.status = status;

    if (status === 'resolved') {
      ticket.resolvedAt = new Date();
      if (ticket.slaDeadlines) ticket.slaDeadlines.resolutionAchieved = true;
      await Queue.findByIdAndUpdate(ticket.queue._id, {
        $inc: { 'stats.openTickets': -1, 'stats.resolvedTickets': 1 }
      });
    }

    if (status === 'closed') {
      ticket.closedAt = new Date();
    }

    ticket.history.push({
      action: 'status_changed',
      field: 'status',
      oldValue: oldStatus,
      newValue: status,
      performedBy: req.user._id
    });

    await ticket.save();

    // Notify creator
    if (req.io) {
      req.io.to(ticket.createdBy.toString()).emit('ticket:status_changed', {
        ticketNumber: ticket.ticketNumber,
        newStatus: status
      });
    }

    req.flash('success_msg', 'Status atualizado com sucesso');
    res.redirect(`/tickets/${ticket._id}`);

  } catch (err) {
    console.error(err);
    req.flash('error_msg', 'Erro ao atualizar status');
    res.redirect(`/tickets/${req.params.id}`);
  }
});

// PUT: Assign ticket
router.put('/:id/assign', ensureAuthenticated, requireAgent, async (req, res) => {
  try {
    const { agentId } = req.body;
    const ticket = await Ticket.findById(req.params.id);

    if (!ticket) {
      req.flash('error_msg', 'Chamado não encontrado');
      return res.redirect('/tickets');
    }

    const oldAgent = ticket.assignedTo;
    ticket.assignedTo = agentId || null;

    if (ticket.status === 'open' && agentId) {
      ticket.status = 'in_progress';
    }

    ticket.history.push({
      action: 'assigned',
      field: 'assignedTo',
      oldValue: oldAgent ? oldAgent.toString() : 'Não atribuído',
      newValue: agentId || 'Não atribuído',
      performedBy: req.user._id
    });

    await ticket.save();

    if (agentId && req.io) {
      req.io.to(agentId).emit('ticket:assigned', {
        ticketNumber: ticket.ticketNumber,
        title: ticket.title
      });
    }

    req.flash('success_msg', 'Chamado atribuído com sucesso');
    res.redirect(`/tickets/${ticket._id}`);

  } catch (err) {
    console.error(err);
    req.flash('error_msg', 'Erro ao atribuir chamado');
    res.redirect(`/tickets/${req.params.id}`);
  }
});

// PUT: Update priority
router.put('/:id/priority', ensureAuthenticated, requireAgent, async (req, res) => {
  try {
    const { priority } = req.body;
    const ticket = await Ticket.findById(req.params.id).populate('queue');

    if (!ticket) {
      req.flash('error_msg', 'Chamado não encontrado');
      return res.redirect('/tickets');
    }

    const oldPriority = ticket.priority;
    ticket.priority = priority;

    // Recalculate SLA if needed
    if (ticket.queue && ticket.queue.sla) {
      const sla = await SLA.findOne({ priority });
      if (sla) {
        const now = new Date();
        ticket.sla = sla._id;
        ticket.slaDeadlines = {
          responseDeadline: new Date(now.getTime() + ((sla.responseTime.hours * 60) + sla.responseTime.minutes) * 60000),
          resolutionDeadline: new Date(now.getTime() + ((sla.resolutionTime.hours * 60) + sla.resolutionTime.minutes) * 60000),
          responseAchieved: ticket.slaDeadlines?.responseAchieved || false,
          resolutionAchieved: ticket.slaDeadlines?.resolutionAchieved || false
        };
        ticket.slaStatus = 'ok';
      }
    }

    ticket.history.push({
      action: 'priority_changed',
      field: 'priority',
      oldValue: oldPriority,
      newValue: priority,
      performedBy: req.user._id
    });

    await ticket.save();

    req.flash('success_msg', 'Prioridade atualizada com sucesso');
    res.redirect(`/tickets/${ticket._id}`);

  } catch (err) {
    console.error(err);
    req.flash('error_msg', 'Erro ao atualizar prioridade');
    res.redirect(`/tickets/${req.params.id}`);
  }
});

// POST: Rate ticket
router.post('/:id/rate', ensureAuthenticated, async (req, res) => {
  try {
    const { score, comment } = req.body;
    const ticket = await Ticket.findById(req.params.id);

    if (!ticket || ticket.createdBy.toString() !== req.user._id.toString()) {
      req.flash('error_msg', 'Operação não permitida');
      return res.redirect('/tickets');
    }

    if (!['resolved', 'closed'].includes(ticket.status)) {
      req.flash('error_msg', 'Só é possível avaliar chamados resolvidos');
      return res.redirect(`/tickets/${ticket._id}`);
    }

    ticket.rating = { score: parseInt(score), comment, ratedAt: new Date() };
    await ticket.save();

    req.flash('success_msg', 'Avaliação registrada com sucesso!');
    res.redirect(`/tickets/${ticket._id}`);

  } catch (err) {
    console.error(err);
    req.flash('error_msg', 'Erro ao registrar avaliação');
    res.redirect(`/tickets/${req.params.id}`);
  }
});

module.exports = router;
