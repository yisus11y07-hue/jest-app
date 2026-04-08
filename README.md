# JEST — Mensajería con peso

Plataforma de mensajería original con mensajes de "peso visual", tiempo real y análisis de conversaciones.

## Requisitos

- **Node.js** versión 18 o superior
- `npm` (viene con Node.js)

## Instalación y uso

```bash
# 1. Entra a la carpeta
cd jest

# 2. Instala dependencias
npm install

# 3. Inicia el servidor
npm start
```

Luego abre tu navegador en: **http://localhost:3000**

## Cómo probarlo

1. Abre **dos pestañas** del navegador en `http://localhost:3000`
2. Crea una cuenta en cada pestaña (usuarios diferentes)
3. ¡Empieza a chatear en tiempo real!

## Características

- ⚡ **Tiempo real** — Socket.io, sin recargar la página
- 🪨 **Peso de mensajes** — Los mensajes cortos se ven ligeros, los reflexivos se ven más grandes y prominentes
- 🎭 **Tonos** — Normal, Profundo, Urgente, Suave — cambia el estilo visual del mensaje
- 😮 **Reacciones** — Haz click en cualquier mensaje para reaccionar con emojis
- ✍️ **Indicador de escritura** — Ves cuando alguien está escribiendo
- 📊 **Panel de resonancia** — Estadísticas únicas de la conversación: profundidad, frecuencia, reactividad
- 🟢 **Estado en línea** — Presencia en tiempo real
- 🔐 **Autenticación** — Registro y login con contraseñas cifradas (bcrypt + JWT)
- 💾 **Base de datos** — SQLite local, sin configuración externa

## Estructura del proyecto

```
jest/
├── server.js        # Backend Express + Socket.io
├── database.js      # Capa de datos SQLite
├── jest.db          # Base de datos (se crea automáticamente)
├── package.json
└── public/
    └── index.html   # Frontend SPA completo
```

## Variables de entorno (opcional)

```bash
PORT=3000            # Puerto (default: 3000)
JWT_SECRET=...       # Secreto para tokens (default: incluido)
```
