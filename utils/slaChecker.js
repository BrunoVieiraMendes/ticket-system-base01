const Ticket = require('../models/Ticket');
const Queue = require('../models/Queue');

const checkSLABreaches = async (io) => {
  try {
    const now = new Date();

    // Find active tickets with SLA deadlines
    const tickets = await Ticket.find({
      status: { $nin: ['resolved', 'closed', 'cancelled'] },
      'slaDeadlines.resolutionDeadline': { $exists: true },
      slaStatus: { $ne: 'breached' }
    }).populate('sla').populate('queue', 'agents').populate('assignedTo', 'name').populate('createdBy', 'name');

    for (const ticket of tickets) {
      if (!ticket.slaDeadlines || !ticket.sla) continue;

      const resolutionDeadline = ticket.slaDeadlines.resolutionDeadline;
      const responseDeadline = ticket.slaDeadlines.responseDeadline;
      const warningThreshold = ticket.sla.warningThreshold || 80;

      const totalTime = resolutionDeadline - ticket.createdAt;
      const elapsed = now - ticket.createdAt;
      const percentage = (elapsed / totalTime) * 100;

      let newSlaStatus = ticket.slaStatus;

      // Check breach
      if (now > resolutionDeadline) {
        newSlaStatus = 'breached';
      } else if (percentage >= warningThreshold) {
        newSlaStatus = 'warning';
      }

      if (newSlaStatus !== ticket.slaStatus) {
        ticket.slaStatus = newSlaStatus;

        if (newSlaStatus === 'breached') {
          ticket.history.push({
            action: 'sla_breached',
            note: `SLA violado: prazo de resolução era ${resolutionDeadline.toLocaleString('pt-BR')}`
          });

          // Notify via socket
          if (io) {
            // Notify assigned agent
            if (ticket.assignedTo) {
              io.to(ticket.assignedTo._id.toString()).emit('sla:breached', {
                ticketNumber: ticket.ticketNumber,
                title: ticket.title,
                ticketId: ticket._id
              });
            }

            // Notify queue agents
            if (ticket.queue && ticket.queue.agents) {
              ticket.queue.agents.forEach(agentId => {
                io.to(agentId.toString()).emit('sla:breached', {
                  ticketNumber: ticket.ticketNumber,
                  title: ticket.title,
                  ticketId: ticket._id
                });
              });
            }
          }
        } else if (newSlaStatus === 'warning') {
          const timeLeft = Math.round((resolutionDeadline - now) / 60000);

          if (io) {
            if (ticket.assignedTo) {
              io.to(ticket.assignedTo._id.toString()).emit('sla:warning', {
                ticketNumber: ticket.ticketNumber,
                title: ticket.title,
                timeLeft,
                ticketId: ticket._id
              });
            }
          }
        }

        await ticket.save();
      }

      // Check response SLA
      if (responseDeadline && !ticket.slaDeadlines.responseAchieved && now > responseDeadline) {
        ticket.slaDeadlines.responseAchieved = false;
        await ticket.save();
      }
    }

    // Check escalation
    const escalationQueues = await Queue.find({
      'escalation.enabled': true,
      isActive: true
    });

    for (const queue of escalationQueues) {
      const escalationMs = queue.escalation.afterHours * 3600000;
      const escalationThreshold = new Date(now - escalationMs);

      const unassignedTickets = await Ticket.find({
        queue: queue._id,
        status: 'open',
        assignedTo: null,
        isEscalated: false,
        createdAt: { $lte: escalationThreshold }
      });

      for (const ticket of unassignedTickets) {
        ticket.isEscalated = true;
        ticket.escalatedAt = now;

        if (queue.escalation.escalateTo) {
          ticket.escalatedTo = queue.escalation.escalateTo;
          ticket.assignedTo = queue.escalation.escalateTo;

          if (io) {
            io.to(queue.escalation.escalateTo.toString()).emit('ticket:escalated', {
              ticketNumber: ticket.ticketNumber,
              title: ticket.title,
              ticketId: ticket._id
            });
          }
        }

        ticket.history.push({
          action: 'assigned',
          note: `Chamado escalado automaticamente após ${queue.escalation.afterHours}h sem atribuição`
        });

        await ticket.save();
      }
    }

  } catch (err) {
    console.error('SLA Checker Error:', err);
  }
};

module.exports = { checkSLABreaches };
