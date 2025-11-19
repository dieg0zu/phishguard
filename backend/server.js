// server.js - Backend Node.js + Express + MongoDB
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

// Conexión a MongoDB
mongoose.connect('mongodb://localhost:27017/phishguard', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

// Schemas de MongoDB
const UserSchema = new mongoose.Schema({
  name: String,
  email: String,
  department: String,
  createdAt: { type: Date, default: Date.now }
});

const TemplateSchema = new mongoose.Schema({
  name: String,
  subject: String,
  body: String,
  createdAt: { type: Date, default: Date.now }
});

const CampaignSchema = new mongoose.Schema({
  name: String,
  templateId: mongoose.Schema.Types.ObjectId,
  customSubject: String,
  customBody: String,
  targetUsers: [mongoose.Schema.Types.ObjectId],
  status: { type: String, default: 'active' },
  clicks: { type: Number, default: 0 },
  credentials: { type: Number, default: 0 },
  sentAt: { type: Date, default: Date.now }
});

const ClickSchema = new mongoose.Schema({
  campaignId: mongoose.Schema.Types.ObjectId,
  userId: mongoose.Schema.Types.ObjectId,
  token: String,
  ipAddress: String,
  userAgent: String,
  timestamp: { type: Date, default: Date.now }
});

const CredentialSchema = new mongoose.Schema({
  campaignId: mongoose.Schema.Types.ObjectId,
  userId: mongoose.Schema.Types.ObjectId,
  attempted: { type: Boolean, default: true },
  timestamp: { type: Date, default: Date.now }
});

const EducationProgressSchema = new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId,
  completedModules: [Number],
  certificateGenerated: { type: Boolean, default: false },
  lastUpdated: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Template = mongoose.model('Template', TemplateSchema);
const Campaign = mongoose.model('Campaign', CampaignSchema);
const Click = mongoose.model('Click', ClickSchema);
const Credential = mongoose.model('Credential', CredentialSchema);
const EducationProgress = mongoose.model('EducationProgress', EducationProgressSchema);

// Configuración de Nodemailer (modo sandbox con Ethereal)
let transporter = {
  sendMail: async (options) => {
    console.log('[SIMULADO] Email que se enviaría:');
    console.log('   Para:', options.to);
    console.log('   Asunto:', options.subject);
    return { messageId: 'fake-id-' + Date.now() };
  }
};

// RUTAS API

// === USUARIOS ===
app.get('/api/users', async (req, res) => {
  try {
    const users = await User.find();
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/users', async (req, res) => {
  try {
    const user = new User(req.body);
    await user.save();
    res.status(201).json(user);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// === PLANTILLAS ===
app.get('/api/templates', async (req, res) => {
  try {
    const templates = await Template.find();
    res.json(templates);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/templates', async (req, res) => {
  try {
    const template = new Template(req.body);
    await template.save();
    res.status(201).json(template);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// === CAMPAÑAS ===
app.get('/api/campaigns', async (req, res) => {
  try {
    const campaigns = await Campaign.find().populate('targetUsers');
    res.json(campaigns);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/campaigns', async (req, res) => {
  try {
    // Validaciones básicas
    if (!req.body.name || !req.body.name.trim()) {
      return res.status(400).json({ error: 'El nombre de la campaña es requerido' });
    }
    if (!req.body.customSubject || !req.body.customSubject.trim()) {
      return res.status(400).json({ error: 'El asunto del email es requerido' });
    }
    if (!req.body.customBody || !req.body.customBody.trim()) {
      return res.status(400).json({ error: 'El cuerpo del email es requerido' });
    }
    if (!req.body.targetUsers || req.body.targetUsers.length === 0) {
      return res.status(400).json({ error: 'Debes seleccionar al menos un usuario objetivo' });
    }

    const campaign = new Campaign(req.body);
    await campaign.save();

    // Generar tokens únicos y enviar emails
    const users = await User.find({ _id: { $in: req.body.targetUsers } });
    
    let emailsSent = 0;
    let emailsFailed = 0;
    
    for (const user of users) {
      try {
        const token = crypto.randomBytes(16).toString('hex');
        const trackingUrl = `http://localhost:3000/track/${campaign._id}/${user._id}/${token}`;
        
        const emailBody = req.body.customBody.replace('[LINK]', trackingUrl);
        
        // Intentar enviar email en modo sandbox (no crítico si falla)
        try {
          await transporter.sendMail({
            from: '"PhishGuard Test" <phishing@test.com>',
            to: user.email,
            subject: req.body.customSubject,
            text: emailBody,
            html: `<p>${emailBody.replace(/\n/g, '<br>')}</p>`
          });
          console.log(`Email enviado a ${user.email} con token: ${token}`);
          emailsSent++;
        } catch (emailError) {
          console.log(`Error al enviar email a ${user.email}: ${emailError.message}`);
          console.log(`Token generado para ${user.email}: ${token}`);
          emailsFailed++;
          // Continuar con el siguiente usuario aunque falle el email
        }
      } catch (error) {
        console.error(`Error procesando usuario ${user.email}:`, error);
        emailsFailed++;
      }
    }

    const message = emailsSent > 0 
      ? `Campaña creada. ${emailsSent} email(s) enviado(s)${emailsFailed > 0 ? `, ${emailsFailed} fallido(s)` : ''}`
      : `Campaña creada. ${emailsFailed} email(s) fallaron (modo sandbox - esto es normal si no hay configuración de email)`;

    res.status(201).json({ campaign, message, emailsSent, emailsFailed });
  } catch (error) {
    console.error('Error creando campaña:', error);
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/campaigns/:id', async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id).populate('targetUsers');
    res.json(campaign);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// === TRACKING ===
app.post('/api/track/click', async (req, res) => {
  try {
    const { campaignId, userId, token, ipAddress, userAgent } = req.body;
    
    const click = new Click({
      campaignId,
      userId,
      token,
      ipAddress,
      userAgent
    });
    await click.save();

    // Actualizar contador de clicks en campaña
    await Campaign.findByIdAndUpdate(campaignId, { $inc: { clicks: 1 } });

    res.json({ success: true, message: 'Click registrado' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/track/credentials', async (req, res) => {
  try {
    const { campaignId, userId } = req.body;
    
    const credential = new Credential({
      campaignId,
      userId,
      attempted: true
    });
    await credential.save();

    // Actualizar contador de credenciales en campaña
    await Campaign.findByIdAndUpdate(campaignId, { $inc: { credentials: 1 } });

    res.json({ success: true, message: 'Intento de credenciales registrado' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/track/clicks', async (req, res) => {
  try {
    const clicks = await Click.find().populate('userId campaignId');
    res.json(clicks);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/track/credentials', async (req, res) => {
  try {
    const credentials = await Credential.find().populate('userId campaignId');
    res.json(credentials);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// === ESTADÍSTICAS ===
app.get('/api/statistics/departments', async (req, res) => {
  try {
    const users = await User.find();
    const clicks = await Click.find().populate('userId');
    
    console.log('Total clicks encontrados:', clicks.length);
    if (clicks.length > 0) {
      console.log('Ejemplo de click:', JSON.stringify(clicks[0], null, 2));
      console.log('userId del click:', clicks[0].userId);
      console.log('Tipo de userId:', typeof clicks[0].userId);
    }
    
    const departments = {};
    
    // Inicializar departamentos con usuarios
    users.forEach(user => {
      if (!departments[user.department]) {
        departments[user.department] = { total: 0, clicked: 0 };
      }
      departments[user.department].total++;
    });

    // Contar clics por departamento
    clicks.forEach(click => {
      if (click.userId) {
        // Verificar si userId es un objeto (populado) o un ObjectId
        const userId = click.userId._id ? click.userId._id : click.userId;
        const user = click.userId.department ? click.userId : users.find(u => u._id.toString() === userId.toString());
        
        if (user && user.department && departments[user.department]) {
          departments[user.department].clicked++;
        }
      }
    });

    const result = Object.keys(departments).map(dept => ({
      department: dept,
      total: departments[dept].total,
      clicked: departments[dept].clicked,
      rate: departments[dept].total > 0 
        ? ((departments[dept].clicked / departments[dept].total) * 100).toFixed(1)
        : '0.0'
    }));

    console.log('Resultado estadísticas:', result);
    res.json(result);
  } catch (error) {
    console.error('Error en estadísticas:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/statistics/users', async (req, res) => {
  try {
    const users = await User.find();
    const clicks = await Click.find();
    const credentials = await Credential.find();

    const userStats = users.map(user => {
      const userClicks = clicks.filter(c => c.userId.toString() === user._id.toString()).length;
      const userCreds = credentials.filter(c => c.userId.toString() === user._id.toString()).length;
      
      return {
        userId: user._id,
        name: user.name,
        email: user.email,
        department: user.department,
        clicks: userClicks,
        credentials: userCreds,
        risk: userCreds > 1 ? 'Alto' : userClicks > 2 ? 'Medio' : 'Bajo'
      };
    });

    res.json(userStats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// === EDUCACIÓN ===
app.get('/api/education/:userId', async (req, res) => {
  try {
    let progress = await EducationProgress.findOne({ userId: req.params.userId });
    if (!progress) {
      progress = new EducationProgress({ userId: req.params.userId, completedModules: [] });
      await progress.save();
    }
    res.json(progress);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/education/:userId/complete', async (req, res) => {
  try {
    const { moduleId } = req.body;
    let progress = await EducationProgress.findOne({ userId: req.params.userId });
    
    if (!progress) {
      progress = new EducationProgress({ userId: req.params.userId, completedModules: [] });
    }

    if (!progress.completedModules.includes(moduleId)) {
      progress.completedModules.push(moduleId);
      progress.lastUpdated = new Date();
      await progress.save();
    }

    res.json(progress);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// === CERTIFICADOS ===
app.post('/api/certificates/generate', async (req, res) => {
  try {
    const { userId } = req.body;
    const progress = await EducationProgress.findOne({ userId });
    const user = await User.findById(userId);

    if (!progress || progress.completedModules.length < 3) {
      return res.status(400).json({ error: 'No se han completado todos los módulos' });
    }

    progress.certificateGenerated = true;
    await progress.save();

    const certificate = {
      userName: user.name,
      email: user.email,
      completedModules: progress.completedModules.length,
      date: new Date().toLocaleDateString('es-ES'),
      certificateId: crypto.randomBytes(8).toString('hex').toUpperCase()
    };

    res.json({ success: true, certificate });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// === REPORTES ===
app.get('/api/reports/vulnerability', async (req, res) => {
  try {
    const users = await User.find();
    const campaigns = await Campaign.find();
    const clicks = await Click.find();
    const credentials = await Credential.find();

    const totalClicks = clicks.length;
    const totalCredentials = credentials.length;
    const totalEmails = campaigns.reduce((sum, c) => sum + c.targetUsers.length, 0);

    const userStats = await Promise.all(users.map(async user => {
      const userClicks = clicks.filter(c => c.userId.toString() === user._id.toString()).length;
      const userCreds = credentials.filter(c => c.userId.toString() === user._id.toString()).length;
      return {
        userId: user._id,
        risk: userCreds > 1 ? 'high' : userClicks > 2 ? 'medium' : 'low'
      };
    }));

    const highRisk = userStats.filter(u => u.risk === 'high').length;
    const mediumRisk = userStats.filter(u => u.risk === 'medium').length;
    const lowRisk = userStats.filter(u => u.risk === 'low').length;

    const report = {
      totalUsers: users.length,
      totalCampaigns: campaigns.length,
      highRisk,
      mediumRisk,
      lowRisk,
      avgClickRate: totalEmails > 0 ? ((totalClicks / totalEmails) * 100).toFixed(1) : 0,
      avgCredentialRate: totalEmails > 0 ? ((totalCredentials / totalEmails) * 100).toFixed(1) : 0,
      recommendations: [
        'Reforzar capacitación en departamentos de alto riesgo',
        'Implementar autenticación de dos factores',
        'Realizar simulaciones mensuales',
        'Crear política de verificación de emails'
      ]
    };

    res.json(report);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Inicializar datos de prueba
app.post('/api/init', async (req, res) => {
  try {
    // Limpiar base de datos
    await User.deleteMany({});
    await Template.deleteMany({});
    await Campaign.deleteMany({});
    await Click.deleteMany({});
    await Credential.deleteMany({});
    await EducationProgress.deleteMany({});

    // Crear usuarios de prueba
    const users = await User.insertMany([
      { name: 'Juan Pérez', email: 'juan@empresa.com', department: 'Ventas' },
      { name: 'María García', email: 'maria@empresa.com', department: 'IT' },
      { name: 'Carlos López', email: 'carlos@empresa.com', department: 'Finanzas' },
      { name: 'Ana Martínez', email: 'ana@empresa.com', department: 'RRHH' },
      { name: 'Pedro Sánchez', email: 'pedro@empresa.com', department: 'Ventas' },
    ]);

    // Crear plantillas
    await Template.insertMany([
      {
        name: 'Email Bancario',
        subject: 'Acción requerida: Verifica tu cuenta',
        body: 'Estimado cliente,\n\nHemos detectado actividad inusual en tu cuenta. Por favor verifica tu identidad haciendo clic aquí: [LINK]\n\nEquipo de Seguridad'
      },
      {
        name: 'Microsoft 365',
        subject: 'Tu sesión expirará pronto',
        body: 'Tu sesión de Microsoft 365 expirará en 24 horas. Renueva tu acceso aquí: [LINK]'
      },
      {
        name: 'LinkedIn',
        subject: 'Alguien vio tu perfil',
        body: '¡Hola! Tienes nuevas visitas en tu perfil profesional. Ver quién: [LINK]'
      },
    ]);

    res.json({ success: true, message: 'Datos inicializados', usersCreated: users.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Servidor ejecutándose en puerto ${PORT}`);
  console.log('PhishGuard Backend iniciado correctamente');
});