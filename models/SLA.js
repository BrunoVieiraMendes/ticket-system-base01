const mongoose = require('mongoose');

const slaSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Nome do SLA é obrigatório'],
    trim: true,
    unique: true
  },
  description: {
    type: String,
    trim: true
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    required: true,
    unique: true
  },
  responseTime: {
    hours: { type: Number, required: true, min: 0 },
    minutes: { type: Number, default: 0, min: 0, max: 59 }
  },
  resolutionTime: {
    hours: { type: Number, required: true, min: 0 },
    minutes: { type: Number, default: 0, min: 0, max: 59 }
  },
  warningThreshold: {
    type: Number,
    default: 80,
    min: 1,
    max: 99,
    comment: 'Percentage of time elapsed before warning'
  },
  businessHours: {
    enabled: { type: Boolean, default: false },
    start: { type: String, default: '08:00' },
    end: { type: String, default: '18:00' },
    workDays: {
      type: [Number],
      default: [1, 2, 3, 4, 5],
      comment: '0=Sunday, 1=Monday...'
    }
  },
  color: {
    type: String,
    default: '#6366f1'
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual: total response time in minutes
slaSchema.virtual('responseTimeMinutes').get(function() {
  return (this.responseTime.hours * 60) + this.responseTime.minutes;
});

// Virtual: total resolution time in minutes
slaSchema.virtual('resolutionTimeMinutes').get(function() {
  return (this.resolutionTime.hours * 60) + this.resolutionTime.minutes;
});

// Virtual: priority display
slaSchema.virtual('priorityDisplay').get(function() {
  const map = {
    low: 'Baixa',
    medium: 'Média',
    high: 'Alta',
    critical: 'Crítica'
  };
  return map[this.priority];
});

// Virtual: priority badge
slaSchema.virtual('priorityBadge').get(function() {
  const map = {
    low: 'success',
    medium: 'warning',
    high: 'danger',
    critical: 'dark'
  };
  return map[this.priority];
});

// Virtual: priority icon
slaSchema.virtual('priorityIcon').get(function() {
  const map = {
    low: '🟢',
    medium: '🟡',
    high: '🔴',
    critical: '⚫'
  };
  return map[this.priority];
});

module.exports = mongoose.model('SLA', slaSchema);
