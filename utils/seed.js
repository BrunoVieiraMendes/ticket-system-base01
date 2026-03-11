require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const SLA = require('../models/SLA');
const Queue = require('../models/Queue');
const Ticket = require('../models/Ticket');

const seed = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Conectado ao MongoDB');

    // Clear collections
    await Promise.all([
      User.deleteMany({}),
      SLA.deleteMany({}),
      Queue.deleteMany({}),
      Ticket.deleteMany({})
    ]);
    console.log('🗑️  Coleções limpas');

    // Create SLAs
    const slas = await SLA.insertMany([
      {
        name: 'SLA Baixa Prioridade',
        description: 'Chamados de baixa prioridade',
        priority: 'low',
        responseTime: { hours: 24, minutes: 0 },
        resolutionTime: { hours: 72, minutes: 0 },
        warningThreshold: 80,
        color: '#22c55e'
      },
      {
        name: 'SLA Média Prioridade',
        description: 'Chamados de média prioridade',
        priority: 'medium',
        responseTime: { hours: 8, minutes: 0 },
        resolutionTime: { hours: 24, minutes: 0 },
        warningThreshold: 75,
        color: '#f59e0b'
      },
      {
        name: 'SLA Alta Prioridade',
        description: 'Chamados de alta prioridade',
        priority: 'high',
        responseTime: { hours: 2, minutes: 0 },
        resolutionTime: { hours: 8, minutes: 0 },
        warningThreshold: 70,
        color: '#ef4444'
      },
      {
        name: 'SLA Crítico',
        description: 'Chamados críticos - resposta imediata',
        priority: 'critical',
        responseTime: { hours: 0, minutes: 30 },
        resolutionTime: { hours: 4, minutes: 0 },
        warningThreshold: 60,
        color: '#1f2937'
      }
    ]);
    console.log('✅ SLAs criados');

    // Create Admin
    const admin = new User({
      name: 'Admin Sistema',
      email: 'admin@ticket.com',
      password: 'admin123',
      role: 'admin',
      phone: '(11) 99999-0000',
      company: 'Tech Corp',
      department: 'TI'
    });
    await admin.save();

    // Create Agents
    const agents = [];
    const agentData = [
      { name: 'Carlos Silva', email: 'carlos@ticket.com', department: 'Suporte' },
      { name: 'Ana Santos', email: 'ana@ticket.com', department: 'Desenvolvimento' },
      { name: 'Marcos Costa', email: 'marcos@ticket.com', department: 'Infraestrutura' }
    ];

    for (const data of agentData) {
      const agent = new User({
        ...data,
        password: 'agent123',
        role: 'agent',
        company: 'Tech Corp'
      });
      await agent.save();
      agents.push(agent);
    }

    // Create Clients
    const clients = [];
    const clientData = [
      { name: 'João Oliveira', email: 'joao@cliente.com', company: 'Cliente A' },
      { name: 'Maria Lima', email: 'maria@cliente.com', company: 'Cliente B' },
      { name: 'Pedro Alves', email: 'pedro@cliente.com', company: 'Cliente C' }
    ];

    for (const data of clientData) {
      const client = new User({
        ...data,
        password: 'client123',
        role: 'client'
      });
      await client.save();
      clients.push(client);
    }
    console.log('✅ Usuários criados');

    // Create Queues
    const queues = await Queue.insertMany([
      {
        name: 'Suporte Técnico',
        description: 'Fila para problemas técnicos gerais',
        sla: slas[1]._id,
        agents: [agents[0]._id, agents[2]._id],
        color: '#6366f1',
        icon: '🛠️',
        categories: ['Hardware', 'Software', 'Rede', 'Email'],
        autoAssign: { enabled: true, method: 'round-robin' }
      },
      {
        name: 'Desenvolvimento',
        description: 'Fila para bugs e novas funcionalidades',
        sla: slas[2]._id,
        agents: [agents[1]._id],
        color: '#8b5cf6',
        icon: '💻',
        categories: ['Bug', 'Feature', 'Performance', 'Segurança'],
        autoAssign: { enabled: false }
      },
      {
        name: 'Infraestrutura',
        description: 'Servidores, rede e segurança',
        sla: slas[3]._id,
        agents: [agents[2]._id, agents[0]._id],
        color: '#ef4444',
        icon: '🖥️',
        categories: ['Servidor', 'Banco de Dados', 'Backup', 'Segurança'],
        autoAssign: { enabled: true, method: 'round-robin' }
      }
    ]);
    console.log('✅ Filas criadas');

    // Update agents with queues
    await User.findByIdAndUpdate(agents[0]._id, { queues: [queues[0]._id, queues[2]._id] });
    await User.findByIdAndUpdate(agents[1]._id, { queues: [queues[1]._id] });
    await User.findByIdAndUpdate(agents[2]._id, { queues: [queues[0]._id, queues[2]._id] });

    // Create sample tickets
    const priorities = ['low', 'medium', 'high', 'critical'];
    const statuses = ['open', 'in_progress', 'waiting', 'resolved'];
    const slaStatuses = ['ok', 'warning', 'breached'];

    for (let i = 0; i < 15; i++) {
      const priority = priorities[i % 4];
      const sla = slas.find(s => s.priority === priority);
      const queue = queues[i % 3];
      const client = clients[i % 3];
      const now = new Date();

      const ticket = new Ticket({
        title: `Chamado de teste #${i + 1} - ${queue.name}`,
        description: `Descrição detalhada do chamado ${i + 1}. Este é um chamado de exemplo para demonstrar o sistema.`,
        priority,
        status: statuses[i % 4],
        queue: queue._id,
        sla: sla._id,
        createdBy: client._id,
        assignedTo: i % 3 !== 0 ? agents[i % 3]._id : null,
        slaStatus: slaStatuses[i % 3],
        category: queue.categories[i % queue.categories.length],
        tags: ['exemplo', priority],
        slaDeadlines: {
          responseDeadline: new Date(now.getTime() + ((sla.responseTime.hours * 60) + sla.responseTime.minutes) * 60000),
          resolutionDeadline: new Date(now.getTime() + ((sla.resolutionTime.hours * 60) + sla.resolutionTime.minutes) * 60000)
        },
        history: [{ action: 'created', note: 'Chamado criado (seed)' }]
      });

      if (statuses[i % 4] === 'resolved') {
        ticket.resolvedAt = new Date(now - Math.random() * 86400000);
      }

      await ticket.save();
    }
    console.log('✅ Chamados de exemplo criados');

    console.log('\n🎉 Seed concluído!\n');
    console.log('📧 Credenciais de acesso:');
    console.log('   Admin:  admin@ticket.com / admin123');
    console.log('   Agente: carlos@ticket.com / agent123');
    console.log('   Cliente: joao@cliente.com / client123\n');

    process.exit(0);
  } catch (err) {
    console.error('❌ Erro no seed:', err);
    process.exit(1);
  }
};

seed();
