// ============================================
// TICKETFLOW - MAIN JAVASCRIPT
// ============================================

const userId = document.querySelector('[data-user-id]')?.dataset?.userId;

// ============ SOCKET.IO ============
let socket;
try {
  socket = io();
  if (userId) {
    socket.emit('join-room', userId);
  }

  socket.on('sla:breached', (data) => {
    showToast('danger', '🚨 SLA Violado!', `${data.ticketNumber}: ${data.title}`, data.ticketId);
    updateSLACounter();
    addNotification('danger', `SLA violado: ${data.ticketNumber}`, data.title, data.ticketId);
  });

  socket.on('sla:warning', (data) => {
    showToast('warning', '⚠️ Alerta de SLA', `${data.ticketNumber} — ${data.timeLeft}min restantes`, data.ticketId);
    addNotification('warning', `Alerta SLA: ${data.ticketNumber}`, `${data.timeLeft}min restantes`, data.ticketId);
  });

  socket.on('ticket:assigned', (data) => {
    showToast('info', '📋 Chamado atribuído', `${data.ticketNumber}: ${data.title}`, data.ticketId);
    addNotification('info', `Atribuído: ${data.ticketNumber}`, data.title, data.ticketId);
  });

  socket.on('ticket:new', (data) => {
    showToast('info', '🆕 Novo chamado', `${data.ticketNumber}: ${data.title}`, data.ticketId);
    updateOpenBadge();
  });

  socket.on('ticket:status_changed', (data) => {
    showToast('success', '✅ Status atualizado', `${data.ticketNumber} → ${data.newStatus}`);
    addNotification('success', `Status: ${data.ticketNumber}`, data.newStatus);
  });

  socket.on('ticket:comment', (data) => {
    showToast('info', '💬 Nova resposta', `${data.ticketNumber} por ${data.author}`);
    addNotification('info', `Resposta em: ${data.ticketNumber}`, `por ${data.author}`);
  });

  socket.on('ticket:escalated', (data) => {
    showToast('warning', '⬆️ Chamado escalado', `${data.ticketNumber}: ${data.title}`, data.ticketId);
    addNotification('warning', `Escalado: ${data.ticketNumber}`, data.title, data.ticketId);
  });
} catch (e) {
  console.log('Socket.io not available');
}

// ============ TOAST NOTIFICATIONS ============
function showToast(type, title, message, ticketId = null) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const icons = { danger: 'fa-exclamation-circle', warning: 'fa-exclamation-triangle', success: 'fa-check-circle', info: 'fa-info-circle' };

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <i class="fas ${icons[type] || 'fa-bell'} toast-icon"></i>
    <div class="toast-body">
      <div class="toast-title">${title}</div>
      ${message ? `<div class="toast-msg">${message}</div>` : ''}
    </div>
  `;

  if (ticketId) {
    toast.style.cursor = 'pointer';
    toast.addEventListener('click', () => window.location.href = `/tickets/${ticketId}`);
  }

  container.appendChild(toast);

  // Play notification sound (optional)
  try { new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAA').play(); } catch(e) {}

  setTimeout(() => {
    toast.classList.add('toast-out');
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}

// ============ NOTIFICATION PANEL ============
let notifications = JSON.parse(localStorage.getItem('tf_notifications') || '[]');

function addNotification(type, title, message, ticketId = null) {
  const n = { type, title, message, ticketId, time: new Date().toISOString(), read: false };
  notifications.unshift(n);
  if (notifications.length > 20) notifications.pop();
  localStorage.setItem('tf_notifications', JSON.stringify(notifications));
  renderNotifications();
  updateNotifDot();
}

function renderNotifications() {
  const list = document.getElementById('notifList');
  if (!list) return;

  if (notifications.length === 0) {
    list.innerHTML = '<div class="notif-empty">Nenhuma notificação</div>';
    return;
  }

  list.innerHTML = notifications.slice(0, 10).map((n, i) => `
    <div class="notif-item ni-${n.type}" onclick="goToNotif(${i})" style="cursor:pointer">
      <div class="ni-title">${n.title}</div>
      ${n.message ? `<div style="font-size:11px;color:var(--text-3)">${n.message}</div>` : ''}
      <div class="ni-time">${formatTimeAgo(n.time)}</div>
    </div>
  `).join('');
}

function goToNotif(i) {
  const n = notifications[i];
  if (n.ticketId) window.location.href = `/tickets/${n.ticketId}`;
  notifications[i].read = true;
  localStorage.setItem('tf_notifications', JSON.stringify(notifications));
  updateNotifDot();
}

function clearNotifications() {
  notifications = [];
  localStorage.removeItem('tf_notifications');
  renderNotifications();
  updateNotifDot();
}

function updateNotifDot() {
  const dot = document.getElementById('notifDot');
  const unread = notifications.filter(n => !n.read).length;
  if (dot) dot.style.display = unread > 0 ? 'block' : 'none';
}

function formatTimeAgo(iso) {
  const diff = Date.now() - new Date(iso);
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'agora mesmo';
  if (m < 60) return `há ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
}

// ============ DROPDOWN / PANEL TOGGLES ============
document.addEventListener('DOMContentLoaded', () => {
  renderNotifications();
  updateNotifDot();

  // User dropdown
  const userBtn = document.getElementById('userMenuBtn');
  const dropdown = document.getElementById('userDropdown');
  if (userBtn && dropdown) {
    userBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.toggle('show');
      document.getElementById('notifPanel')?.classList.remove('show');
    });
  }

  // Notification panel
  const notifBtn = document.getElementById('notifBtn');
  const notifPanel = document.getElementById('notifPanel');
  if (notifBtn && notifPanel) {
    notifBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      notifPanel.classList.toggle('show');
      dropdown?.classList.remove('show');
      // Mark all as read when opened
      notifications.forEach(n => n.read = true);
      localStorage.setItem('tf_notifications', JSON.stringify(notifications));
      updateNotifDot();
    });
  }

  // Close dropdowns on outside click
  document.addEventListener('click', () => {
    dropdown?.classList.remove('show');
    notifPanel?.classList.remove('show');
    document.getElementById('searchResults')?.classList.remove('show');
  });

  // ============ SIDEBAR TOGGLE ============
  const sidebarToggle = document.getElementById('sidebarToggle');
  const sidebar = document.getElementById('sidebar');
  if (sidebarToggle && sidebar) {
    sidebarToggle.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      localStorage.setItem('sidebar_collapsed', sidebar.classList.contains('collapsed'));
    });

    // Restore state
    if (localStorage.getItem('sidebar_collapsed') === 'true') {
      sidebar.classList.add('collapsed');
    }
  }

  // Mobile sidebar
  const mobileToggle = document.getElementById('mobileSidebarToggle');
  if (mobileToggle && sidebar) {
    mobileToggle.addEventListener('click', () => sidebar.classList.toggle('mobile-open'));
  }

  // ============ GLOBAL SEARCH ============
  const searchInput = document.getElementById('globalSearch');
  const searchResults = document.getElementById('searchResults');
  let searchTimeout;

  if (searchInput && searchResults) {
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      const q = e.target.value.trim();
      if (q.length < 2) {
        searchResults.classList.remove('show');
        return;
      }
      searchTimeout = setTimeout(async () => {
        try {
          const res = await fetch(`/api/tickets/search?q=${encodeURIComponent(q)}`);
          const data = await res.json();
          if (data.tickets && data.tickets.length > 0) {
            searchResults.innerHTML = data.tickets.map(t => `
              <a href="/tickets/${t._id}" class="search-result-item">
                <span style="font-size:11px;color:var(--text-3);font-family:monospace">${t.ticketNumber}</span>
                <span style="flex:1;font-size:13px">${t.title.substring(0, 45)}</span>
                <span class="badge badge-${t.statusBadge || 'secondary'}" style="font-size:10px">${t.statusDisplay || t.status}</span>
              </a>
            `).join('');
          } else {
            searchResults.innerHTML = '<div class="notif-empty">Nenhum resultado</div>';
          }
          searchResults.classList.add('show');
        } catch (e) {}
      }, 300);
    });

    searchInput.addEventListener('focus', (e) => {
      if (e.target.value.length >= 2) searchResults.classList.add('show');
    });

    searchInput.addEventListener('click', (e) => e.stopPropagation());
    searchResults.addEventListener('click', (e) => e.stopPropagation());
  }

  // ============ SLA COUNTER UPDATE ============
  updateSLACounter();
  setInterval(updateSLACounter, 60000);

  // ============ AUTO-DISMISS ALERTS ============
  document.querySelectorAll('.alert-dismissible').forEach(alert => {
    setTimeout(() => {
      if (alert.parentElement) {
        alert.style.opacity = '0';
        alert.style.transition = 'opacity 0.3s';
        setTimeout(() => alert.remove(), 300);
      }
    }, 6000);
  });
});

async function updateSLACounter() {
  try {
    const res = await fetch('/api/stats');
    const data = await res.json();
    if (data.success) {
      const counter = document.getElementById('slaBreachCount');
      if (counter) {
        counter.textContent = data.stats.breached;
        const pill = document.getElementById('slaBreachCounter');
        if (pill) pill.style.display = data.stats.breached > 0 ? 'flex' : 'none';
      }

      const badge = document.getElementById('openTicketsBadge');
      if (badge) {
        badge.textContent = data.stats.open > 0 ? data.stats.open : '';
        badge.style.display = data.stats.open > 0 ? 'inline-block' : 'none';
      }
    }
  } catch (e) {}
}

function updateOpenBadge() {
  const badge = document.getElementById('openTicketsBadge');
  if (badge) {
    const current = parseInt(badge.textContent) || 0;
    badge.textContent = current + 1;
    badge.style.display = 'inline-block';
  }
}

// ============ CONFIRM DELETE UTIL ============
function confirmDelete(form, msg) {
  if (confirm(msg || 'Confirmar exclusão?')) form.submit();
}
