const mongoose = require('mongoose');

const ticketSchema = new mongoose.Schema({
  ticketNumber: {
    type: String,
    unique: true
  },
  title: {
    type: String,
    required: [true, 'Título é obrigatório'],
    trim: true,
    maxlength: [200, 'Título não pode ter mais de 200 caracteres']
  },
  description: {
    type: String,
    required: [true, 'Descrição é obrigatória'],
    trim: true
  },
  status: {
    type: String,
    enum: ['open', 'in_progress', 'waiting', 'resolved', 'closed', 'cancelled'],
    default: 'open'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium'
  },
  category: {
    type: String,
    trim: true
  },
  tags: [{
    type: String,
    trim: true
  }],
  queue: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Queue',
    required: [true, 'Fila é obrigatória']
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  sla: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SLA'
  },
  slaStatus: {
    type: String,
    enum: ['ok', 'warning', 'breached', 'paused'],
    default: 'ok'
  },
  slaDeadlines: {
    responseDeadline: { type: Date },
    resolutionDeadline: { type: Date },
    responseAchieved: { type: Boolean, default: false },
    responseAchievedAt: { type: Date },
    resolutionAchieved: { type: Boolean, default: false },
    resolutionAchievedAt: { type: Date }
  },
  attachments: [{
    filename: String,
    originalName: String,
    mimetype: String,
    size: Number,
    uploadedAt: { type: Date, default: Date.now },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  }],
  firstResponseAt: { type: Date },
  resolvedAt: { type: Date },
  closedAt: { type: Date },
  dueDate: { type: Date },
  history: [{
    action: {
      type: String,
      enum: ['created', 'updated', 'status_changed', 'assigned', 'comment_added',
             'priority_changed', 'queue_changed', 'sla_breached', 'resolved', 'closed', 'reopened']
    },
    field: String,
    oldValue: String,
    newValue: String,
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    note: String,
    createdAt: { type: Date, default: Date.now }
  }],
  rating: {
    score: { type: Number, min: 1, max: 5 },
    comment: String,
    ratedAt: Date
  },
  isEscalated: { type: Boolean, default: false },
  escalatedAt: { type: Date },
  escalatedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  internalNotes: [{
    content: String,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now }
  }]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Generate ticket number
ticketSchema.pre('save', async function(next) {
  if (!this.ticketNumber) {
    const count = await mongoose.model('Ticket').countDocuments();
    const year = new Date().getFullYear();
    this.ticketNumber = `TKT-${year}-${String(count + 1).padStart(5, '0')}`;
  }
  next();
});

// Status display
ticketSchema.virtual('statusDisplay').get(function() {
  const map = {
    open: 'Aberto',
    in_progress: 'Em Progresso',
    waiting: 'Aguardando',
    resolved: 'Resolvido',
    closed: 'Fechado',
    cancelled: 'Cancelado'
  };
  return map[this.status];
});

// Status badge color
ticketSchema.virtual('statusBadge').get(function() {
  const map = {
    open: 'primary',
    in_progress: 'warning',
    waiting: 'info',
    resolved: 'success',
    closed: 'secondary',
    cancelled: 'dark'
  };
  return map[this.status];
});

// Priority display
ticketSchema.virtual('priorityDisplay').get(function() {
  const map = { low: 'Baixa', medium: 'Média', high: 'Alta', critical: 'Crítica' };
  return map[this.priority];
});

// Priority badge
ticketSchema.virtual('priorityBadge').get(function() {
  const map = { low: 'success', medium: 'warning', high: 'danger', critical: 'dark' };
  return map[this.priority];
});

// Priority icon
ticketSchema.virtual('priorityIcon').get(function() {
  const map = { low: '🟢', medium: '🟡', high: '🔴', critical: '⚫' };
  return map[this.priority];
});

// SLA status display
ticketSchema.virtual('slaStatusDisplay').get(function() {
  const map = { ok: 'No Prazo', warning: 'Atenção', breached: 'Violado', paused: 'Pausado' };
  return map[this.slaStatus];
});

// SLA status badge
ticketSchema.virtual('slaStatusBadge').get(function() {
  const map = { ok: 'success', warning: 'warning', breached: 'danger', paused: 'secondary' };
  return map[this.slaStatus];
});

// Time elapsed since creation
ticketSchema.virtual('timeElapsed').get(function() {
  const now = new Date();
  const created = this.createdAt;
  const diff = now - created;
  const hours = Math.floor(diff / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
});

// Resolution time
ticketSchema.virtual('resolutionTime').get(function() {
  if (!this.resolvedAt) return null;
  const diff = this.resolvedAt - this.createdAt;
  const hours = Math.floor(diff / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  return `${hours}h ${minutes}m`;
});

// Comments
ticketSchema.virtual('comments', {
  ref: 'Comment',
  localField: '_id',
  foreignField: 'ticket'
});

// SLA percentage used
ticketSchema.virtual('slaPercentage').get(function() {
  if (!this.slaDeadlines || !this.slaDeadlines.resolutionDeadline) return 0;
  const now = new Date();
  const created = this.createdAt;
  const deadline = this.slaDeadlines.resolutionDeadline;
  const total = deadline - created;
  const elapsed = now - created;
  return Math.min(100, Math.round((elapsed / total) * 100));
});

// Indexes
ticketSchema.index({ ticketNumber: 1 });
ticketSchema.index({ status: 1 });
ticketSchema.index({ priority: 1 });
ticketSchema.index({ queue: 1 });
ticketSchema.index({ createdBy: 1 });
ticketSchema.index({ assignedTo: 1 });
ticketSchema.index({ slaStatus: 1 });
ticketSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Ticket', ticketSchema);
