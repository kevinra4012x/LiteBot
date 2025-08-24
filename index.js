const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  downloadContentFromMessage
} = require('@whiskeysockets/baileys')
const qrcode = require('qrcode-terminal')
const pino = require('pino')
const fs = require('fs-extra')
const axios = require('axios')
const moment = require('moment')
const { evaluate, sqrt } = require('mathjs')
const translate = require('translate-google-api')
const Jimp = require('jimp')
const path = require('path')
const { exec } = require('child_process')
const chalk = require('chalk')
const symbols = require('log-symbols')


// === AJUSTES BÁSICOS ===
const PREFIX = '6'
fs.ensureDirSync('./notas') // carpeta para las notas

// Mapa de usuarios muteados por grupo
// key: groupJid => value: Set(userJid)
const mutedUsers = {}

const sendText = async (sock, jid, text, opts = {}) => sock.sendMessage(jid, { text, ...opts })

;(async () => {
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info')
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    auth: state,
    // \u2705 Para que en "Dispositivos vinculados" se vea como *LiteBot*
    browser: ['LiteBot', 'Lite', '1.0']
  })

  sock.ev.on('creds.update', saveCreds)
  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      qrcode.generate(qr, { small: true })
      console.log(symbols.info, chalk.blue('Escaneá el QR para conectar LiteBot'))
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode
      console.log(symbols.error, chalk.red(`Conexión cerrada. Código: ${code}`))
      if (code !== DisconnectReason.loggedOut) {
        console.log(symbols.info, chalk.yellow('Reconectando...'))
        require('child_process').exec('node index.js')
      }
    }
    if (connection === 'open') {
      console.log(symbols.success, chalk.green('✅ Conectado como LiteBot'))
    }
  })

  // === MANEJO DE MENSAJES ===
  sock.ev.on('messages.upsert', async (m) => {
    const msg = m.messages?.[0]
    if (!msg || !msg.message) return

    const from = msg.key.remoteJid
    const isGroup = from?.endsWith('@g.us')
    const sender = isGroup ? (msg.key.participant || msg.participant) : from
    const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || ''

    // Mostrar todo en la terminal
    console.log(
      symbols.info,
      chalk.yellow(`[${moment().format('HH:mm:ss')}]`),
      chalk.cyan(sender), ':', chalk.white(text)
    )

    // Si está muteado, borrar el mensaje
    if (isGroup && mutedUsers[from]?.has(sender)) {
      try {
        await sock.sendMessage(from, {
          delete: { remoteJid: from, fromMe: false, id: msg.key.id, participant: sender }
        })
      } catch (e) {
        console.log(symbols.error, chalk.red('❌ Error borrando mensaje de usuario muteado'))
      }
      return
    }

    // Prefijo 6: el bot responde a todo lo que empiece con "6"
    if (!text.startsWith(PREFIX)) return

    const [rawCmd, ...rest] = text.slice(PREFIX.length).trim().split(/\s+/)
    const cmd = (rawCmd || '').toLowerCase()
    const arg = rest.join(' ')

    // Solo admins para ciertos comandos
    const adminOnly = new Set(['abrir', 'cerrar', 'tagall', 'echar', 'promote', 'demote', 'mute', 'unmute'])
    const mustBeAdmin = async () => {
      if (!isGroup) {
        await sendText(sock, from, '📌 Este comando solo funciona en grupos.')
        return false
      }
      try {
        const meta = await sock.groupMetadata(from)
        const isAdmin = meta.participants.find((p) => p.id === sender)?.admin
        if (!isAdmin) {
          await sendText(sock, from, '⛔ Este comando es solo para administradores del grupo.')
          return false
        }
        return true
      } catch {
        await sendText(sock, from, '⚠️ No se pudo verificar si sos admin.')
        return false
      }
    }

    if (adminOnly.has(cmd)) {
      const ok = await mustBeAdmin()
      if (!ok) return
    }

    try {
      switch (cmd) {
        // === MENÚ ===
        case 'menu': {
  const path = './banner/banner.png'
  const menu = `
📋 *litebot comandos*
_Prefijo:_ ${PREFIX}
━━━━━━━━━━━━━━━━
🛡️ *Administración de grupos*
• ${PREFIX}abrir – Todos pueden escribir
• ${PREFIX}cerrar – Solo admins escriben
• ${PREFIX}tagall – Mencionar a todos
• ${PREFIX}echar @usuario – Expulsar
• ${PREFIX}promote @usuario – Dar admin
• ${PREFIX}demote @usuario – Sacar admin
• ${PREFIX}mute @usuario – Silenciar (borra sus mensajes)
• ${PREFIX}unmute @usuario – Quitar silencio

🖼️ *Multimedia*
• ${PREFIX}sticker – Imagen ➜ sticker
• ${PREFIX}toimg – Sticker ➜ imagen
• ${PREFIX}pfp [@] – Ver foto de perfil
• ${PREFIX}fotogrupo – Ver foto del grupo

SER BOT: 6tutoserbot (ESPERA MENOS DE 2 MINUTOTES DESPUES DE USAR EL COMANDO JEJEJE)

🔎 *Utilidades*
• ${PREFIX}buscar <tema> – Wikipedia
• ${PREFIX}traducir Texto > es – Traducir
• ${PREFIX}calcular (5+7)*2 – Cálculo
• ${PREFIX}raiz 81 – Raíz cuadrada
• ${PREFIX}fraccion 1/3 + 1/6 – Operar fracciones

📝 *Notas*
• ${PREFIX}guardar clave contenido
• ${PREFIX}leer clave
• ${PREFIX}borrararchivo clave
• ${PREFIX}notaslist

NUM DEL CREADOR: +54 9 11 3941-4209
GRUPO OFICIAL: https://chat.whatsapp.com/FuGck66uQf1JtF372z18FC?mode=ems_copy_t
`.trim()

  if (fs.existsSync(path)) {
    await sock.sendMessage(from, { image: { url: path }, caption: menu })
  } else {
    await sendText(sock, from, menu)
  }
  break
}

        

        // === ADMIN GRUPOS ===
        case 'abrir':
          await sock.groupSettingUpdate(from, 'not_announcement')
          await sendText(sock, from, '🔓 Grupo abierto: todos pueden escribir.')
          break
        case 'cerrar':
          await sock.groupSettingUpdate(from, 'announcement')
          await sendText(sock, from, '🔒 Grupo cerrado: solo admins pueden escribir.')
          break
        case 'tagall': {
          const meta = await sock.groupMetadata(from)
          const mentions = meta.participants.map((p) => p.id)
          await sock.sendMessage(from, { text: '🔔 Atención @todos', mentions })
          break
        }
        case 'echar': {
          const mention = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
          if (!mention) return sendText(sock, from, '📌 Mencioná a la persona que querés echar con @')
          // Evitar expulsar al bot
          if (mention === sock.user?.id) return sendText(sock, from, '❌ No podés expulsar al bot.')
          // Evitar expulsar admins
          try {
            const meta = await sock.groupMetadata(from)
            const targetInfo = meta.participants.find((p) => p.id === mention)
            if (targetInfo?.admin) return sendText(sock, from, '⚠️ No se puede expulsar a otro administrador.')
          } catch {}
          await sock.groupParticipantsUpdate(from, [mention], 'remove')
          await sendText(sock, from, '🚪 Usuario expulsado.')
          break
        }
        case 'promote': {
          const mention = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
          if (!mention) return sendText(sock, from, '📌 Mencioná a la persona que querés promover con @')
          await sock.groupParticipantsUpdate(from, [mention], 'promote')
          await sendText(sock, from, '🧑‍💼 Usuario promovido a admin.')
          break
        }
        case 'demote': {
          const mention = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
          if (!mention) return sendText(sock, from, '📌 Mencioná a la persona que querés degradar con @')
          await sock.groupParticipantsUpdate(from, [mention], 'demote')
          await sendText(sock, from, '👤 Usuario degradado a miembro.')
          break
        }
        case 'mute': {
          const mention = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
          if (!mention) return sendText(sock, from, '📌 Mencioná a la persona que querés silenciar con @')
          if (!mutedUsers[from]) mutedUsers[from] = new Set()
          mutedUsers[from].add(mention)
          await sendText(sock, from, '🔇 Usuario silenciado. El bot borrará sus mensajes.')
          break
        }
        case 'unmute': {
          const mention = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
          if (!mention) return sendText(sock, from, '📌 Mencioná a la persona que querés desmutear con @')
          mutedUsers[from]?.delete(mention)
          await sendText(sock, from, '🔊 Usuario desmuteado.')
          break
        }

        // === MULTIMEDIA ===
        case 'sticker': {
          const ctx = msg.message?.extendedTextMessage?.contextInfo
          const mediaMsg = msg.message.imageMessage || ctx?.quotedMessage?.imageMessage
          if (!mediaMsg) return sendText(sock, from, '📌 Enviá una imagen o respondé a una imagen con *6sticker*.')
          const stream = await downloadContentFromMessage(mediaMsg, 'image')
          let buffer = Buffer.from([])
          for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk])
          // Redimensionar 512x512 y convertir a webp con sharp (sin binarios externos)
          // Leer y redimensionar con Jimp
const image = await Jimp.read(buffer)
image.resize(512, Jimp.AUTO)

// Rutas temporales para PNG y WebP
const tempPngPath = path.join(__dirname, `temp_${Date.now()}.png`)
const tempWebpPath = path.join(__dirname, `temp_${Date.now()}.webp`)

// Guardar PNG temporal
await image.writeAsync(tempPngPath)

// Convertir PNG a WebP con cwebp
await new Promise((resolve, reject) => {
  exec(`cwebp -q 80 "${tempPngPath}" -o "${tempWebpPath}"`, (error) => {
    if (error) reject(error)
    else resolve()
  })
})

// Leer WebP generado
const webpBuffer = await fs.readFile(tempWebpPath)

// Eliminar archivos temporales
await fs.unlink(tempPngPath)
await fs.unlink(tempWebpPath)

// Enviar sticker
await sock.sendMessage(from, { sticker: webpBuffer }, { quoted: msg })

        }
        case 'toimg': {
          const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage
          const stickerMsg = quoted?.stickerMessage
          if (!stickerMsg) return sendText(sock, from, '⚠️ Citá un *sticker* para convertirlo a imagen con 6toimg.')
          const stream = await downloadContentFromMessage(stickerMsg, 'image')
          let buffer = Buffer.from([])
          for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk])
          // Rutas temporales
const tempWebpPath = path.join(__dirname, `temp_${Date.now()}.webp`)
const tempPngPath = path.join(__dirname, `temp_${Date.now()}.png`)

// Guardar el buffer WebP en archivo temporal
await fs.writeFile(tempWebpPath, buffer)

// Convertir WebP a PNG con dwebp
await new Promise((resolve, reject) => {
  exec(`dwebp "${tempWebpPath}" -o "${tempPngPath}"`, (error) => {
    if (error) reject(error)
    else resolve()
  })
})

// Leer PNG generado
const pngBuffer = await fs.readFile(tempPngPath)

// Eliminar temporales
await fs.unlink(tempWebpPath)
await fs.unlink(tempPngPath)

// Enviar imagen
await sock.sendMessage(from, { image: pngBuffer }, { quoted: msg })

          break
        }
        case 'pfp': {
          const target =
            msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] ||
            msg.message?.extendedTextMessage?.contextInfo?.participant ||
            sender
          try {
            const url = await sock.profilePictureUrl(target, 'image')
            await sock.sendMessage(from, { image: { url }, caption: `🖼️ Foto de perfil de @${target.split('@')[0]}`, mentions: [target] })
          } catch {
            await sendText(sock, from, '❌ No se pudo obtener la foto de perfil.')
          }
          break
        }
        case 'fotogrupo': {
          if (!isGroup) return sendText(sock, from, '📌 Este comando solo funciona en grupos.')
          try {
            const url = await sock.profilePictureUrl(from, 'image')
            await sock.sendMessage(from, { image: { url }, caption: '🖼️ Foto del grupo' })
          } catch {
            await sendText(sock, from, '❌ No se pudo obtener la foto del grupo (¿tiene imagen?).')
          }
          break
        }

        case 'tutousarbot': {
          try {
            const filePath = path.join(__dirname, 'tutousarbot', 'usarbot.mp4') // ajusta el nombre del archivo dentro de la carpeta
            if (!fs.existsSync(filePath)) {
              return sendText(sock, from, '❌ No se encontró el archivo en ./tutousarbot/')
            }

            await sock.sendMessage(from, {
              video: { url: filePath },
              caption: '🎉 Disfruta el bot'
            }, { quoted: msg })

          } catch (e) {
            console.log(symbols.error, chalk.red('❌ Error enviando tutousarbot:'), e)
            await sendText(sock, from, '⚠️ Error enviando el video del bot.')
          }
          break
        }


        case 'tutoserbot': {
          try {
            const filePath = path.join(__dirname, 'tutoserbot', 'tutorial.mp4') // ajusta nombre del archivo dentro de la carpeta
            if (!fs.existsSync(filePath)) {
              return sendText(sock, from, '❌ No se encontró el archivo del tutorial en ./tutoserbot/')
            }

            const caption = `
TUTORIAL REALISTA:

PON 6adquerir para tener el enlace de descarga

ENTRA A ESTE GRUPO PARA PODER USAR EL COMANDO 6adquerir: https://chat.whatsapp.com/FuGck66uQf1JtF372z18FC?mode=ems_copy_t

texto del video:

pkg update && pkg upgrade -y
pkg install nodejs -y

AUXILIAR: npm install protobufjs

INSTALACION DE BAILEYS: npm install @whiskeysockets/baileys
INSTALACION DE GIT: pkg install git -y

DESPLAZAMIENTOS: (COPIAR TODO ESO COMPLETO)

# 1️⃣ Crear carpeta interna para el bot
mkdir -p ~/litebot

# 2️⃣ Copiar todo el contenido de la carpeta actual (externa) a la carpeta interna
cp -r . ~/litebot/

# 3️⃣ Entrar a la nueva carpeta interna
cd ~/litebot

# 4️⃣ Verificar que los archivos se copiaron
ls

INSTALACION DEL QR: npm install qr-terminal

INSTALACION DEPENDENCIAS RESTANTES: npm install @whiskeysockets/baileys qrcode-terminal pino fs-extra axios moment mathjs translate-google-api chalk log-symbols

INSTALACION DE JIMP: npm install jimp

arreglo de chalk: npm uninstall chalk
npm install chalk@4

*VE EL VIDEO, SIGUE LAS INDICACIONES Y OBTEN TU BOT*

*USA EL COMANDO 6tutousarbot para saber como manejarlo. (espera medio minuto despues de usarlo)*
            `.trim()

            await sock.sendMessage(from, {
              video: { url: filePath },
              caption
            }, { quoted: msg })

          } catch (e) {
            console.log(symbols.error, chalk.red('❌ Error enviando tutorial:'), e)
            await sendText(sock, from, '⚠️ Error enviando el tutorial.')
          }
          break
        }


        // === UTILIDADES ===
        case 'traducir': {
          if (!arg.includes('>')) return sendText(sock, from, 'Uso: 6traducir Texto > es')
          const [toText, toLang] = arg.split('>').map((v) => v.trim())
          const res = await translate(toText, { to: toLang })
          await sendText(sock, from, `📘 ${res}`)
          break
        }
        case 'calcular': {
          try {
            const ans = evaluate(arg)
            await sendText(sock, from, `🧮 ${ans}`)
          } catch {
            await sendText(sock, from, '❌ Error en la expresión')
          }
          break
        }
        case 'raiz': {
          try {
            const ans = sqrt(parseFloat(arg))
            await sendText(sock, from, `√${arg} = ${ans}`)
          } catch {
            await sendText(sock, from, '❌ Error en la raíz')
          }
          break
        }
        case 'fraccion': {
          try {
            const ans = evaluate(arg)
            await sendText(sock, from, `🔢 ${ans}`)
          } catch {
            await sendText(sock, from, '❌ Error en la fracción')
          }
          break
        }
        case 'buscar':
        case 'definicion': {
          try {
            const response = await axios.get(
              `https://es.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(arg)}`
            )
            const extract = response.data.extract || 'Sin resultados.'
            await sendText(sock, from, `📖 Resultado para "${arg}":\n\n${extract.slice(0, 1000)}`)
          } catch {
            await sendText(sock, from, '❌ No se pudo buscar en Wikipedia.')
          }
          break
        }

        // === NOTAS ===
        case 'guardar': {
          const [key, ...noteArr] = rest
          if (!key || noteArr.length === 0) return sendText(sock, from, 'Uso: 6guardar clave contenido')
          const content = noteArr.join(' ')
          fs.writeJsonSync(`./notas/${key}.json`, { note: content, date: moment().format() })
          await sendText(sock, from, `✅ Nota "${key}" guardada.`)
          break
        }
        case 'leer': {
          const key = rest[0]
          if (!key) return sendText(sock, from, 'Uso: 6leer clave')
          const p = `./notas/${key}.json`
          if (fs.existsSync(p)) {
            const data = fs.readJsonSync(p)
            await sendText(sock, from, `📖 Nota "${key}":\n${data.note}`)
          } else {
            await sendText(sock, from, '❌ Nota no encontrada.')
          }
          break
        }
        case 'borrararchivo': {
          const key = rest[0]
          if (!key) return sendText(sock, from, 'Uso: 6borrararchivo clave')
          const p = `./notas/${key}.json`
          if (fs.existsSync(p)) {
            fs.removeSync(p)
            await sendText(sock, from, `🗑️ Nota "${key}" eliminada.`)
          } else {
            await sendText(sock, from, '❌ Nota no encontrada.')
          }
          break
        }
        case 'notaslist': {
          const files = fs.readdirSync('./notas').filter((f) => f.endsWith('.json'))
          if (files.length === 0) return sendText(sock, from, '📂 No hay notas guardadas.')
          const list = files.map((f) => `• ${f.replace('.json', '')}`).join('\n')
          await sendText(sock, from, `📒 Notas guardadas:\n\n${list}`)
          break
        }

        default:
          await sendText(sock, from, '❓ Comando no reconocido. Usá 6menu para ver opciones.')
      }
    } catch (err) {
      console.log(symbols.error, chalk.red('❌ Error en comando:'), err)
      await sendText(sock, from, '⚠️ Ocurrió un error procesando el comando.')
    }
  })
})()
