const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Nome é obrigatório'],
    trim: true,
    maxlength: [100, 'Nome não pode ter mais de 100 caracteres']
  },
  email: {
    type: String,
    required: [true, 'Email é obrigatório'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Email inválido']
  },
  password: {
    type: String,
    required: [true, 'Senha é obrigatória'],
    minlength: [6, 'Senha deve ter pelo menos 6 caracteres'],
    select: false
  },
  role: {
    type: String,
    enum: ['admin', 'agent', 'client'],
    default: 'client'
  },
  avatar: {
    type: String,
    default: null
  },
  phone: {
    type: String,
    trim: true
  },
  department: {
    type: String,
    trim: true
  },
  company: {
    type: String,
    trim: true
  },
  bio: {
    type: String,
    maxlength: [500, 'Bio não pode ter mais de 500 caracteres']
  },
  queues: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Queue'
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  lastLogin: {
    type: Date
  },
  notifications: {
    email: { type: Boolean, default: true },
    slaWarning: { type: Boolean, default: true },
    newTicket: { type: Boolean, default: true },
    ticketUpdate: { type: Boolean, default: true }
  },
  stats: {
    totalTickets: { type: Number, default: 0 },
    resolvedTickets: { type: Number, default: 0 },
    avgResolutionTime: { type: Number, default: 0 }
  },
  resetPasswordToken: String,
  resetPasswordExpire: Date
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for tickets assigned
userSchema.virtual('assignedTickets', {
  ref: 'Ticket',
  localField: '_id',
  foreignField: 'assignedTo'
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Get initials for avatar
userSchema.virtual('initials').get(function() {
  return this.name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
});

// Role display name
userSchema.virtual('roleDisplay').get(function() {
  const roles = { admin: 'Administrador', agent: 'Agente', client: 'Cliente' };
  return roles[this.role] || this.role;
});

// Role badge color
userSchema.virtual('roleBadgeColor').get(function() {
  const colors = { admin: 'danger', agent: 'primary', client: 'success' };
  return colors[this.role] || 'secondary';
});

// Don't return password in JSON
userSchema.methods.toJSON = function() {
  const user = this.toObject();
  delete user.password;
  return user;
};

module.exports = mongoose.model('User', userSchema);
