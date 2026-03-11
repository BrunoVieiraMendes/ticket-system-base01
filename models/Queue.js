const mongoose = require('mongoose');

const queueSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Nome da fila é obrigatório'],
    trim: true,
    unique: true
  },
  description: {
    type: String,
    trim: true
  },
  slug: {
    type: String,
    unique: true,
    lowercase: true
  },
  sla: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SLA',
    required: [true, 'SLA é obrigatório']
  },
  agents: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  categories: [{
    type: String,
    trim: true
  }],
  autoAssign: {
    enabled: { type: Boolean, default: false },
    method: {
      type: String,
      enum: ['round-robin', 'least-busy', 'random'],
      default: 'round-robin'
    },
    currentIndex: { type: Number, default: 0 }
  },
  escalation: {
    enabled: { type: Boolean, default: false },
    afterHours: { type: Number, default: 4 },
    escalateTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  color: {
    type: String,
    default: '#6366f1'
  },
  icon: {
    type: String,
    default: '📋'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  stats: {
    totalTickets: { type: Number, default: 0 },
    openTickets: { type: Number, default: 0 },
    resolvedTickets: { type: Number, default: 0 },
    avgResolutionTime: { type: Number, default: 0 }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Auto-generate slug
queueSchema.pre('save', function(next) {
  if (!this.slug || this.isModified('name')) {
    this.slug = this.name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
  }
  next();
});

// Virtual: tickets in this queue
queueSchema.virtual('tickets', {
  ref: 'Ticket',
  localField: '_id',
  foreignField: 'queue'
});

// Get next agent for round-robin
queueSchema.methods.getNextAgent = function() {
  if (!this.agents || this.agents.length === 0) return null;
  
  if (this.autoAssign.method === 'round-robin') {
    const agent = this.agents[this.autoAssign.currentIndex % this.agents.length];
    this.autoAssign.currentIndex += 1;
    this.save();
    return agent;
  }
  
  return this.agents[Math.floor(Math.random() * this.agents.length)];
};

module.exports = mongoose.model('Queue', queueSchema);
