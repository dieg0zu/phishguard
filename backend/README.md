# PhishGuard Backend - Configuración

## Configuración de Envío Real de Correos

Para habilitar el envío real de correos electrónicos, necesitas configurar las variables de entorno en un archivo `.env` en la carpeta `backend/`.

### Crear archivo .env

Crea un archivo `.env` en la carpeta `backend/` con el siguiente contenido:

```env
# Configuración SMTP para envío real de correos
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=tu-email@gmail.com
SMTP_PASS=tu-contraseña-de-aplicación
SMTP_TLS_REJECT=false

# Configuración del remitente
FROM_EMAIL=phishing@tudominio.com
FROM_NAME=PhishGuard

# URL base del servidor (para links de tracking)
BASE_URL=http://localhost:5000

# Puerto del servidor (opcional, por defecto 5000)
PORT=5000
```

### Configuración para Gmail

1. Habilita la verificación en 2 pasos en tu cuenta de Google
2. Genera una "Contraseña de aplicación":
   - Ve a: https://myaccount.google.com/apppasswords
   - Selecciona "Correo" y "Otro (nombre personalizado)"
   - Ingresa "PhishGuard" y genera la contraseña
   - Usa esa contraseña en `SMTP_PASS`

### Configuración para otros proveedores

**Outlook/Hotmail:**
```env
SMTP_HOST=smtp-mail.outlook.com
SMTP_PORT=587
SMTP_SECURE=false
```

**SendGrid:**
```env
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=tu-api-key-de-sendgrid
```

**Mailgun:**
```env
SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_USER=tu-usuario
SMTP_PASS=tu-contraseña
```

## Instalación

```bash
cd backend
npm install
```

## Ejecución

```bash
npm start
```

## Sistema de Tracking

El sistema ahora incluye:

1. **Tracking de Clics**: Cuando un usuario hace clic en un link del email, se registra automáticamente
2. **Tracking de Credenciales**: Cuando un usuario ingresa credenciales en la página de phishing simulada, se registra

### Flujo de Tracking

1. Se envía un email con un link único: `/track/:campaignId/:userId/:token`
2. Al hacer clic, se registra el clic y se redirige a `/phishing/:campaignId/:userId`
3. El usuario ingresa credenciales en la página de phishing
4. Las credenciales se envían a `/track/phishing` y se registran
5. El usuario es redirigido a una página de éxito

## Notas de Seguridad

⚠️ **IMPORTANTE**: Este sistema está diseñado para simulaciones de phishing legítimas y educativas. Asegúrate de:
- Tener autorización para realizar estas simulaciones
- Informar a los usuarios que es parte de un programa de capacitación
- No usar credenciales reales en producción
- Cumplir con todas las regulaciones locales sobre seguridad de datos


