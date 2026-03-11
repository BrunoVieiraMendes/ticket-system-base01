# 🎫 TicketFlow — Sistema de Gestão de Chamados

Sistema completo de fila de chamados com SLA, agentes, filas e autenticação.

## ✨ Funcionalidades

- **Autenticação completa** com bcrypt + JWT + Passport (local + JWT strategies)
- **3 perfis de usuário**: Admin, Agente e Cliente
- **Filas de atendimento** com SLA, cores e ícones configuráveis
- **SLA automático** com verificação a cada minuto via cron job
- **Escalação automática** de chamados não atribuídos
- **Auto-atribuição** com Round Robin, aleatório ou menos ocupado
- **Dashboard** com gráficos Chart.js em tempo real
- **Notificações em tempo real** via Socket.io
- **Sistema de comentários** com notas internas
- **Avaliação de atendimento** com estrelas
- **Relatórios** por período, fila, prioridade e agente
- **Busca global** de chamados
- **Upload de anexos** com multer
- **Filtros avançados** por status, prioridade, fila e SLA

## 🚀 Instalação

### Pré-requisitos
- Node.js 18+
- MongoDB 6+

### Passos

```bash
# 1. Instalar dependências
npm install

# 2. Configurar variáveis de ambiente
cp .env.example .env
# Edite o .env com seus dados

# 3. Iniciar MongoDB
mongod

# 4. Popular banco com dados de exemplo (opcional)
npm run seed

# 5. Iniciar aplicação
npm start
# ou em desenvolvimento:
npm run dev
```

### Acesso após seed:
| Perfil  | Email                | Senha     |
|---------|----------------------|-----------|
| Admin   | admin@ticket.com     | admin123  |
| Agente  | carlos@ticket.com    | agent123  |
| Cliente | joao@cliente.com     | client123 |

## 📋 Variáveis de Ambiente (.env)

```env
PORT=3000
MONGODB_URI=mongodb://localhost:27017/ticket_system
JWT_SECRET=seu_jwt_secret_super_seguro
SESSION_SECRET=seu_session_secret_super_seguro
NODE_ENV=development
```

## 🏗️ Estrutura

```
ticket-system/
├── app.js                    # Entry point
├── config/
│   ├── database.js           # Conexão MongoDB
│   └── passport.js           # Local + JWT strategies
├── middleware/
│   ├── auth.js               # Autenticação
│   └── roles.js              # Controle de acesso
├── models/
│   ├── User.js               # Usuário (bcrypt, virtual fields)
│   ├── Ticket.js             # Chamado (SLA, histórico, anexos)
│   ├── Queue.js              # Fila (auto-assign, escalação)
│   ├── SLA.js                # Contrato de nível de serviço
│   └── Comment.js            # Comentários e notas internas
├── routes/
│   ├── auth.js               # Login, registro, logout
│   ├── dashboard.js          # Dashboard com agregações
│   ├── tickets.js            # CRUD completo de chamados
│   ├── queues.js             # Gerenciamento de filas
│   ├── users.js              # Perfis e gerenciamento
│   ├── admin.js              # SLAs, relatórios
│   └── api.js                # API REST com JWT
├── utils/
│   ├── slaChecker.js         # Cron job de verificação SLA
│   └── seed.js               # Dados de exemplo
├── views/                    # Templates EJS
└── public/                   # CSS, JS, uploads
```

## 🔐 Segurança

- Senhas com bcrypt (salt 12)
- Sessões com express-session + MongoStore
- JWT para API REST
- Controle de acesso por role
- Method override para PUT/DELETE
- Validação de formulários com express-validator
- Proteção XSS com escape automático do EJS

## 📡 API REST (JWT)

```
POST   /api/auth/login       → Obter token JWT
GET    /api/tickets          → Listar chamados
GET    /api/tickets/search   → Buscar chamados
GET    /api/stats            → Estatísticas gerais
GET    /api/queues/:id/categories → Categorias da fila
```

## ⚡ Socket.io Events

| Evento             | Descrição                        |
|--------------------|----------------------------------|
| `sla:breached`     | SLA violado                      |
| `sla:warning`      | SLA em zona de alerta            |
| `ticket:new`       | Novo chamado na fila             |
| `ticket:assigned`  | Chamado atribuído ao agente      |
| `ticket:status_changed` | Mudança de status           |
| `ticket:comment`   | Nova resposta no chamado         |
| `ticket:escalated` | Chamado escalado automaticamente |
