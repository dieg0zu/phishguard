// server.js - Backend Node.js + Express + MongoDB
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public')); // Para servir archivos estáticos

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

// Configuración de Nodemailer (modo real con SMTP)
let transporter;

// Inicializar transporter con configuración SMTP real
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true', // true para 465, false para otros puertos
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    },
    tls: {
      rejectUnauthorized: process.env.SMTP_TLS_REJECT === 'true'
    }
  });
  
  console.log('✅ Nodemailer configurado con SMTP real');
  console.log(`   Host: ${process.env.SMTP_HOST}`);
  console.log(`   Usuario: ${process.env.SMTP_USER}`);
} else {
  // Fallback a modo simulado si no hay configuración
  console.warn('⚠️  No se encontró configuración SMTP. Usando modo simulado.');
  console.warn('   Configura las variables SMTP_HOST, SMTP_USER, SMTP_PASS en .env');
  transporter = {
    sendMail: async (options) => {
      console.log('[SIMULADO] Email que se enviaría:');
      console.log('   Para:', options.to);
      console.log('   Asunto:', options.subject);
      return { messageId: 'fake-id-' + Date.now() };
    }
  };
}

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
    
    // Obtener URL base del servidor (configurable o por defecto)
    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
    const fromEmail = process.env.FROM_EMAIL || 'phishing@test.com';
    const fromName = process.env.FROM_NAME || 'PhishGuard Test';
    
    for (const user of users) {
      try {
        const token = crypto.randomBytes(16).toString('hex');
        const trackingUrl = `${baseUrl}/track/${campaign._id}/${user._id}/${token}`;
        
        const emailBody = req.body.customBody.replace('[LINK]', trackingUrl);
        
        // Enviar email real
        try {
          await transporter.sendMail({
            from: `"${fromName}" <${fromEmail}>`,
            to: user.email,
            subject: req.body.customSubject,
            text: emailBody,
            html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              ${emailBody.replace(/\n/g, '<br>')}
            </div>`
          });
          console.log(`✅ Email enviado a ${user.email} con token: ${token}`);
          emailsSent++;
        } catch (emailError) {
          console.error(`❌ Error al enviar email a ${user.email}:`, emailError.message);
          console.log(`   Token generado para ${user.email}: ${token}`);
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
      : `Campaña creada. ${emailsFailed} email(s) fallaron. Verifica tu configuración SMTP en el archivo .env`;

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
// Endpoint GET para tracking real de clics desde links en emails
app.get('/track/:campaignId/:userId/:token', async (req, res) => {
  try {
    const { campaignId, userId, token } = req.params;
    
    // Obtener IP y User-Agent del request
    const ipAddress = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    
    // Verificar que la campaña y el usuario existen
    const campaign = await Campaign.findById(campaignId);
    const user = await User.findById(userId);
    
    if (!campaign || !user) {
      return res.status(404).send('Página no encontrada');
    }
    
    // Registrar el clic
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
    
    console.log(`✅ Clic registrado: Campaña ${campaignId}, Usuario ${user.email}, IP: ${ipAddress}`);
    
    // Redirigir a la página de phishing simulada
    res.redirect(`/phishing/${campaignId}/${userId}`);
  } catch (error) {
    console.error('Error en tracking de clic:', error);
    res.status(500).send('Error interno del servidor');
  }
});

// Endpoint POST para recibir credenciales desde la página de phishing
app.post('/track/phishing', async (req, res) => {
  try {
    const { campaignId, userId, email, password } = req.body;
    
    if (!campaignId || !userId) {
      return res.status(400).json({ error: 'Faltan parámetros requeridos' });
    }
    
    // Verificar que la campaña y el usuario existen
    const campaign = await Campaign.findById(campaignId);
    const user = await User.findById(userId);
    
    if (!campaign || !user) {
      return res.status(404).json({ error: 'Campaña o usuario no encontrado' });
    }
    
    // Registrar el intento de credenciales
    const credential = new Credential({
      campaignId,
      userId,
      attempted: true
    });
    await credential.save();

    // Actualizar contador de credenciales en campaña
    await Campaign.findByIdAndUpdate(campaignId, { $inc: { credentials: 1 } });
    
    console.log(`⚠️  Credenciales capturadas: Campaña ${campaignId}, Usuario ${user.email}`);
    console.log(`   Email intentado: ${email || 'N/A'}`);
    
    // Responder con éxito (la página mostrará un mensaje)
    res.json({ 
      success: true, 
      message: 'Credenciales registradas',
      redirect: '/phishing/success'
    });
  } catch (error) {
    console.error('Error en tracking de credenciales:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Endpoint POST para tracking manual (mantener compatibilidad con frontend)
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

// Endpoint POST para tracking manual de credenciales (mantener compatibilidad con frontend)
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

app.get('/api/certificates/download/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const progress = await EducationProgress.findOne({ userId });
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    if (!progress || progress.completedModules.length < 3) {
      return res.status(400).json({ error: 'No se han completado todos los módulos' });
    }

    // Generar ID del certificado
    const certificateId = crypto.randomBytes(8).toString('hex').toUpperCase();
    const date = new Date().toLocaleDateString('es-ES', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    // Crear PDF
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margins: { top: 50, bottom: 50, left: 50, right: 50 }
    });

    // Configurar headers para descarga
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="certificado-${user.name.replace(/\s+/g, '-')}.pdf"`);

    // Pipe del PDF a la respuesta
    doc.pipe(res);

    // Fondo decorativo
    doc.rect(0, 0, doc.page.width, doc.page.height)
       .fillColor('#f8f9fa')
       .fill();

    // Borde decorativo
    doc.strokeColor('#3b82f6')
       .lineWidth(10)
       .rect(20, 20, doc.page.width - 40, doc.page.height - 40)
       .stroke();

    // Título principal
    doc.fillColor('#1e40af')
       .fontSize(48)
       .font('Helvetica-Bold')
       .text('CERTIFICADO DE CAPACITACIÓN', {
         align: 'center',
         y: 150
       });

    // Subtítulo
    doc.fillColor('#3b82f6')
       .fontSize(24)
       .font('Helvetica')
       .text('PhishGuard', {
         align: 'center',
         y: 220
       });

    // Texto de certificación
    doc.fillColor('#1f2937')
       .fontSize(20)
       .font('Helvetica')
       .text('Se certifica que', {
         align: 'center',
         y: 300
       });

    // Nombre del usuario
    doc.fillColor('#1e40af')
       .fontSize(36)
       .font('Helvetica-Bold')
       .text(user.name.toUpperCase(), {
         align: 'center',
         y: 340
       });

    // Descripción
    doc.fillColor('#4b5563')
       .fontSize(18)
       .font('Helvetica')
       .text('ha completado exitosamente el programa de capacitación', {
         align: 'center',
         y: 400
       });

    doc.text('en Seguridad Informática y Prevención de Phishing', {
      align: 'center',
      y: 430
    });

    // Módulos completados
    doc.fillColor('#059669')
       .fontSize(16)
       .font('Helvetica-Bold')
       .text(`Módulos completados: ${progress.completedModules.length}`, {
         align: 'center',
         y: 480
       });

    // Fecha
    doc.fillColor('#6b7280')
       .fontSize(14)
       .font('Helvetica')
       .text(`Fecha de emisión: ${date}`, {
         align: 'center',
         y: 520
       });

    // ID del certificado
    doc.fillColor('#9ca3af')
       .fontSize(12)
       .font('Helvetica-Oblique')
       .text(`ID del Certificado: ${certificateId}`, {
         align: 'center',
         y: 550
       });

    // Línea de firma
    doc.moveTo(150, doc.page.height - 120)
       .lineTo(350, doc.page.height - 120)
       .strokeColor('#1f2937')
       .lineWidth(1)
       .stroke();

    doc.fillColor('#4b5563')
       .fontSize(12)
       .font('Helvetica')
       .text('Firma Autorizada', {
         align: 'left',
         x: 150,
         y: doc.page.height - 100
       });

    // Finalizar PDF
    doc.end();

    // Marcar certificado como generado si no lo estaba
    if (!progress.certificateGenerated) {
      progress.certificateGenerated = true;
      await progress.save();
    }

  } catch (error) {
    console.error('Error generando certificado:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
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
      { name: 'Diego Gaaaa', email: 'diego123ali@gmail.com', department: 'Ventas' },
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

// === PÁGINAS DE PHISHING SIMULADAS ===
// Página de phishing que captura credenciales
app.get('/phishing/:campaignId/:userId', async (req, res) => {
  try {
    const { campaignId, userId } = req.params;
    
    // Verificar que la campaña y el usuario existen
    const campaign = await Campaign.findById(campaignId);
    const user = await User.findById(userId);
    
    if (!campaign || !user) {
      return res.status(404).send('Página no encontrada');
    }
    
    // Servir página HTML de phishing
    const phishingPage = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Verificación de Cuenta</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .container {
            background: white;
            border-radius: 10px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
            padding: 40px;
            max-width: 400px;
            width: 100%;
        }
        .logo {
            text-align: center;
            margin-bottom: 30px;
        }
        .logo h1 {
            color: #333;
            font-size: 28px;
            margin-bottom: 10px;
        }
        .logo p {
            color: #666;
            font-size: 14px;
        }
        .form-group {
            margin-bottom: 20px;
        }
        .form-group label {
            display: block;
            margin-bottom: 8px;
            color: #333;
            font-weight: 500;
            font-size: 14px;
        }
        .form-group input {
            width: 100%;
            padding: 12px;
            border: 2px solid #e0e0e0;
            border-radius: 6px;
            font-size: 16px;
            transition: border-color 0.3s;
        }
        .form-group input:focus {
            outline: none;
            border-color: #667eea;
        }
        .btn {
            width: 100%;
            padding: 14px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 6px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(102, 126, 234, 0.4);
        }
        .btn:active {
            transform: translateY(0);
        }
        .error {
            color: #e74c3c;
            font-size: 14px;
            margin-top: 10px;
            display: none;
        }
        .loading {
            display: none;
            text-align: center;
            margin-top: 10px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo">
            <h1>🔒 Verificación Requerida</h1>
            <p>Por favor, verifica tu identidad para continuar</p>
        </div>
        <form id="phishingForm">
            <div class="form-group">
                <label for="email">Correo Electrónico</label>
                <input type="email" id="email" name="email" required autocomplete="email">
            </div>
            <div class="form-group">
                <label for="password">Contraseña</label>
                <input type="password" id="password" name="password" required autocomplete="current-password">
            </div>
            <button type="submit" class="btn" id="submitBtn">Verificar Cuenta</button>
            <div class="error" id="errorMsg"></div>
            <div class="loading" id="loading">Procesando...</div>
        </form>
    </div>
    <script>
        document.getElementById('phishingForm').addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            const submitBtn = document.getElementById('submitBtn');
            const errorMsg = document.getElementById('errorMsg');
            const loading = document.getElementById('loading');
            
            // Deshabilitar botón y mostrar loading
            submitBtn.disabled = true;
            loading.style.display = 'block';
            errorMsg.style.display = 'none';
            
            try {
                const response = await fetch('/track/phishing', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        campaignId: '${campaignId}',
                        userId: '${userId}',
                        email: email,
                        password: password
                    })
                });
                
                const data = await response.json();
                
                if (data.success) {
                    // Redirigir a página de éxito
                    window.location.href = '/phishing/success';
                } else {
                    throw new Error(data.error || 'Error al procesar');
                }
            } catch (error) {
                errorMsg.textContent = 'Error: ' + error.message;
                errorMsg.style.display = 'block';
                submitBtn.disabled = false;
                loading.style.display = 'none';
            }
        });
    </script>
</body>
</html>
    `;
    
    res.send(phishingPage);
  } catch (error) {
    console.error('Error sirviendo página de phishing:', error);
    res.status(500).send('Error interno del servidor');
  }
});

// Página de éxito después de capturar credenciales
app.get('/phishing/success', (req, res) => {
  const successPage = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Verificación Exitosa</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .container {
            background: white;
            border-radius: 10px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
            padding: 40px;
            max-width: 500px;
            width: 100%;
            text-align: center;
        }
        .success-icon {
            font-size: 64px;
            margin-bottom: 20px;
        }
        h1 {
            color: #333;
            font-size: 28px;
            margin-bottom: 15px;
        }
        p {
            color: #666;
            font-size: 16px;
            line-height: 1.6;
            margin-bottom: 20px;
        }
        .warning {
            background: #fff3cd;
            border: 1px solid #ffc107;
            border-radius: 6px;
            padding: 15px;
            margin-top: 20px;
        }
        .warning p {
            color: #856404;
            font-size: 14px;
            margin: 0;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="success-icon">✅</div>
        <h1>Verificación Completada</h1>
        <p>Gracias por verificar tu cuenta. Tu sesión ha sido actualizada correctamente.</p>
        <div class="warning">
            <p><strong>⚠️ Nota de Seguridad:</strong> Esta fue una simulación de phishing como parte de un programa de capacitación en seguridad. En un escenario real, nunca debes ingresar tus credenciales en enlaces recibidos por email sin verificar primero la autenticidad del remitente.</p>
        </div>
    </div>
</body>
</html>
  `;
  
  res.send(successPage);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Servidor ejecutándose en puerto ${PORT}`);
  console.log('PhishGuard Backend iniciado correctamente');
  console.log(`URL base: ${process.env.BASE_URL || `http://localhost:${PORT}`}`);
});