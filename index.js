const TelegramBot = require('node-telegram-bot-api')
const fs = require('fs')
const config = require('./config')

const bot = new TelegramBot(config.BOT_TOKEN, { polling: true })
const GROUP_ID = config.GROUP_ID

const USERS_FILE = './users.json'
const MESSAGES_FILE = './messages.json'

// buat users.json & messages.json kalau belum ada (sekali doang pas start, jadi sync gapapa)
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '{}')
if (!fs.existsSync(MESSAGES_FILE)) fs.writeFileSync(MESSAGES_FILE, '{}')

// ================== FILE I/O (ASYNC + LOCK) ==================
// Kenapa perlu "lock": walaupun udah pakai fs.promises (non-blocking),
// kalau 10 pesan masuk bersamaan, semuanya bisa baca file di kondisi
// yang sama lalu saling timpa pas nulis balik (lost update / corrupt).
// createLock() bikin antrian sederhana biar tiap read-modify-write
// jalan satu-satu (atomic) per file, tanpa nge-block Event Loop.
function createLock() {
  let chain = Promise.resolve()
  return (task) => {
    const result = chain.then(task, task)
    chain = result.then(() => {}, () => {})
    return result
  }
}

const usersLock = createLock()
const messagesLock = createLock()

async function readJSON(path) {
  const raw = await fs.promises.readFile(path, 'utf8')
  return JSON.parse(raw)
}

async function writeJSON(path, data) {
  await fs.promises.writeFile(path, JSON.stringify(data, null, 2))
}

function getUsers() {
  return usersLock(() => readJSON(USERS_FILE))
}

// mutator: function(users) { ...ubah langsung objeknya... }
function updateUsers(mutator) {
  return usersLock(async () => {
    const users = await readJSON(USERS_FILE)
    const result = await mutator(users)
    await writeJSON(USERS_FILE, users)
    return result
  })
}

function getMessages() {
  return messagesLock(() => readJSON(MESSAGES_FILE))
}

function updateMessages(mutator) {
  return messagesLock(async () => {
    const messages = await readJSON(MESSAGES_FILE)
    const result = await mutator(messages)
    await writeJSON(MESSAGES_FILE, messages)
    return result
  })
}

// simpan pasangan pesan biar reply & edit bisa saling lacak
// key:
//   user_<userId>_<msgIdDiChatUser>  -> pesan yg diteruskan ke topic (group)
//   group_<msgIdDiGroup>             -> pesan yg diteruskan ke user
async function saveMessageLink(userId, userMsgId, groupMsgId) {
  await updateMessages((messages) => {
    messages[`user_${userId}_${userMsgId}`] = { chatId: GROUP_ID, messageId: groupMsgId }
    messages[`group_${groupMsgId}`] = { chatId: userId, messageId: userMsgId }
  })
}

// ================== HELPER ==================

// bungkus semua panggilan API biar 1 pesan gagal ga bikin bot mati
async function safeCall(fn, label) {
  try {
    return await fn()
  } catch (err) {
    console.error(`❌ Error [${label}]:`, err.message)
    return null
  }
}

// tampilin status "sedang mengetik / upload foto / dst" di sisi lawan bicara
// sebelum pesan diteruskan, biar berasa lagi ngetik beneran
const CHAT_ACTIONS = {
  text: 'typing',
  photo: 'upload_photo',
  video: 'upload_video',
  document: 'upload_document',
  voice: 'upload_voice',
  audio: 'upload_document',
  sticker: 'choose_sticker'
}

async function showTyping(chatId, kind, threadId) {
  const action = CHAT_ACTIONS[kind] || 'typing'
  await safeCall(
    () => bot.sendChatAction(chatId, action, threadId ? { message_thread_id: threadId } : {}),
    'send-chat-action'
  )
}

// START
bot.onText(/\/start/, async (msg) => {
  await safeCall(
    () => bot.sendMessage(msg.chat.id, 'iyaa, kirim pesannya ya, nanti dibales secepatnya.'),
    'start'
  )
})

// ================== BROADCAST (ADMIN ONLY) ==================
bot.onText(/^\/broadcast(?:\s+([\s\S]+))?/, async (msg, match) => {

  const threadOpts = msg.message_thread_id ? { message_thread_id: msg.message_thread_id } : {}

  // pastikan yang manggil admin/creator grup
  const member = await safeCall(
    () => bot.getChatMember(GROUP_ID, msg.from.id),
    'check-admin-status'
  )
  const isAdmin = member && (member.status === 'administrator' || member.status === 'creator')

  if (!isAdmin) {
    await safeCall(
      () => bot.sendMessage(GROUP_ID, '⛔ Cuma admin yang bisa pakai /broadcast.', threadOpts),
      'broadcast-denied'
    )
    return
  }

  const text = match[1]
  if (!text) {
    await safeCall(
      () => bot.sendMessage(GROUP_ID, 'Format: /broadcast <pesan>', threadOpts),
      'broadcast-usage'
    )
    return
  }

  const users = await getUsers()
  const userIds = Object.keys(users)
  const total = userIds.length

  await safeCall(
    () => bot.sendMessage(GROUP_ID, `📢 Memulai broadcast ke ${total} user...`, threadOpts),
    'broadcast-start-notice'
  )

  let success = 0
  let failed = 0

  for (const id of userIds) {
    const result = await safeCall(
      () => bot.sendMessage(id, text),
      `broadcast-to-${id}`
    )

    if (result) success++
    else failed++

    // jeda kecil biar ga kena rate limit Telegram
    await new Promise((resolve) => setTimeout(resolve, 40))
  }

  await safeCall(
    () => bot.sendMessage(
      GROUP_ID,
      `✅ Broadcast selesai.\nTotal target: ${total}\nBerhasil: ${success}\nGagal: ${failed} (kemungkinan user blokir bot)`,
      threadOpts
    ),
    'broadcast-done-notice'
  )
})

// SEMUA PESAN BARU
bot.on('message', async (msg) => {
  try {
    if (msg.chat.type === 'private') {
      await handlePrivateMessage(msg)
    } else if (msg.chat.type === 'supergroup') {
      await handleGroupMessage(msg)
    }
  } catch (err) {
    console.error('❌ Error tak terduga di message handler:', err)
  }
})

// PESAN YANG DIEDIT
bot.on('edited_message', async (msg) => {
  try {
    if (msg.chat.type === 'private') {
      await handleEditedPrivateMessage(msg)
    } else if (msg.chat.type === 'supergroup') {
      await handleEditedGroupMessage(msg)
    }
  } catch (err) {
    console.error('❌ Error tak terduga di edited_message handler:', err)
  }
})

// ================== PRIVATE CHAT -> GROUP ==================
async function handlePrivateMessage(msg) {

  // skip command (termasuk /broadcast kalo nyasar ke private)
  if (msg.text && msg.text.startsWith('/')) return

  const users = await getUsers()
  let user = users[msg.from.id]
  let topicId

  // bikin topic baru kalau user baru
  if (!user) {

    const topic = await safeCall(
      () => bot.createForumTopic(GROUP_ID, msg.from.first_name),
      'createForumTopic'
    )

    if (!topic) {
      await safeCall(
        () => bot.sendMessage(msg.chat.id, 'Maaf, lagi ada gangguan. Coba kirim ulang beberapa saat lagi ya.'),
        'notify-topic-fail'
      )
      return
    }

    topicId = topic.message_thread_id

    await updateUsers((users) => {
      users[msg.from.id] = {
        user_id: String(msg.from.id),
        topic_id: String(topicId),
        fullname: msg.from.first_name,
        username: msg.from.username || '-'
      }
    })

    // info user
    await safeCall(
      () => bot.sendMessage(
        GROUP_ID,
`🫂 INFORMASI USER

Nama User:
${msg.from.first_name}
Username:
@${msg.from.username || '-'}
ID USER:
${msg.from.id}`,
        { message_thread_id: topicId }
      ),
      'send-user-info'
    )

  } else {
    topicId = user.topic_id
  }

  // kalau user reply pesan admin, teruskan sebagai reply juga
  let options = { message_thread_id: topicId }

  if (msg.reply_to_message) {
    const messages = await getMessages()
    const link = messages[`user_${msg.from.id}_${msg.reply_to_message.message_id}`]
    if (link) options.reply_to_message_id = link.messageId
  }

  let sent = null

  // TEXT
  if (msg.text) {
    await showTyping(GROUP_ID, 'text', topicId)
    sent = await safeCall(
      () => bot.sendMessage(GROUP_ID, msg.text, options),
      'forward-text-to-group'
    )
  }

  // PHOTO
  else if (msg.photo) {
    await showTyping(GROUP_ID, 'photo', topicId)
    const photo = msg.photo[msg.photo.length - 1]
    sent = await safeCall(
      () => bot.sendPhoto(GROUP_ID, photo.file_id, { ...options, caption: msg.caption || '' }),
      'forward-photo-to-group'
    )
  }

  // VIDEO
  else if (msg.video) {
    await showTyping(GROUP_ID, 'video', topicId)
    sent = await safeCall(
      () => bot.sendVideo(GROUP_ID, msg.video.file_id, { ...options, caption: msg.caption || '' }),
      'forward-video-to-group'
    )
  }

  // STICKER
  else if (msg.sticker) {
    await showTyping(GROUP_ID, 'sticker', topicId)
    sent = await safeCall(
      () => bot.sendSticker(GROUP_ID, msg.sticker.file_id, options),
      'forward-sticker-to-group'
    )
  }

  // DOCUMENT / FILE
  else if (msg.document) {
    await showTyping(GROUP_ID, 'document', topicId)
    sent = await safeCall(
      () => bot.sendDocument(GROUP_ID, msg.document.file_id, { ...options, caption: msg.caption || '' }),
      'forward-document-to-group'
    )
  }

  // VOICE NOTE
  else if (msg.voice) {
    await showTyping(GROUP_ID, 'voice', topicId)
    sent = await safeCall(
      () => bot.sendVoice(GROUP_ID, msg.voice.file_id, options),
      'forward-voice-to-group'
    )
  }

  // AUDIO
  else if (msg.audio) {
    await showTyping(GROUP_ID, 'audio', topicId)
    sent = await safeCall(
      () => bot.sendAudio(GROUP_ID, msg.audio.file_id, { ...options, caption: msg.caption || '' }),
      'forward-audio-to-group'
    )
  }

  if (sent) {
    await saveMessageLink(msg.from.id, msg.message_id, sent.message_id)
  }
}

// ================== GROUP TOPIC -> USER ==================
async function handleGroupMessage(msg) {

  if (!msg.message_thread_id) return
  if (msg.from.is_bot) return
  if (msg.text && msg.text.startsWith('/')) return

  const users = await getUsers()
  let foundUser = null

  for (const id in users) {
    if (String(users[id].topic_id) === String(msg.message_thread_id)) {
      foundUser = users[id]
    }
  }

  if (!foundUser) return
  const userId = foundUser.user_id

  // kalau admin reply pesan tertentu, teruskan sebagai reply juga
  let options = {}

  if (msg.reply_to_message) {
    const messages = await getMessages()
    const link = messages[`group_${msg.reply_to_message.message_id}`]
    if (link) options.reply_to_message_id = link.messageId
  }

  let sent = null

  // TEXT
  if (msg.text) {
    await showTyping(userId, 'text')
    sent = await safeCall(
      () => bot.sendMessage(userId, msg.text, options),
      'forward-text-to-user'
    )
  }

  // PHOTO
  else if (msg.photo) {
    await showTyping(userId, 'photo')
    const photo = msg.photo[msg.photo.length - 1]
    sent = await safeCall(
      () => bot.sendPhoto(userId, photo.file_id, { ...options, caption: msg.caption || '' }),
      'forward-photo-to-user'
    )
  }

  // VIDEO
  else if (msg.video) {
    await showTyping(userId, 'video')
    sent = await safeCall(
      () => bot.sendVideo(userId, msg.video.file_id, { ...options, caption: msg.caption || '' }),
      'forward-video-to-user'
    )
  }

  // STICKER
  else if (msg.sticker) {
    await showTyping(userId, 'sticker')
    sent = await safeCall(
      () => bot.sendSticker(userId, msg.sticker.file_id, options),
      'forward-sticker-to-user'
    )
  }

  // DOCUMENT / FILE
  else if (msg.document) {
    await showTyping(userId, 'document')
    sent = await safeCall(
      () => bot.sendDocument(userId, msg.document.file_id, { ...options, caption: msg.caption || '' }),
      'forward-document-to-user'
    )
  }

  // VOICE NOTE
  else if (msg.voice) {
    await showTyping(userId, 'voice')
    sent = await safeCall(
      () => bot.sendVoice(userId, msg.voice.file_id, options),
      'forward-voice-to-user'
    )
  }

  // AUDIO
  else if (msg.audio) {
    await showTyping(userId, 'audio')
    sent = await safeCall(
      () => bot.sendAudio(userId, msg.audio.file_id, { ...options, caption: msg.caption || '' }),
      'forward-audio-to-user'
    )
  }

  if (sent) {
    // simpan dgn arah yg sama (userId, msgIdDiChatUser, msgIdDiGroup)
    await saveMessageLink(userId, sent.message_id, msg.message_id)
  }
}

// ================== EDIT: PRIVATE -> GROUP ==================
async function handleEditedPrivateMessage(msg) {

  const messages = await getMessages()
  const link = messages[`user_${msg.from.id}_${msg.message_id}`]
  if (!link) return

  // TEXT diedit
  if (msg.text) {
    await safeCall(
      () => bot.editMessageText(msg.text, {
        chat_id: link.chatId,
        message_id: link.messageId
      }),
      'edit-text-in-group'
    )
  }

  // CAPTION foto/video/document/audio diedit
  else if (msg.photo || msg.video || msg.document || msg.audio) {
    await safeCall(
      () => bot.editMessageCaption(msg.caption || '', {
        chat_id: link.chatId,
        message_id: link.messageId
      }),
      'edit-caption-in-group'
    )
  }
}

// ================== EDIT: GROUP -> PRIVATE ==================
async function handleEditedGroupMessage(msg) {

  const messages = await getMessages()
  const link = messages[`group_${msg.message_id}`]
  if (!link) return

  // TEXT diedit
  if (msg.text) {
    await safeCall(
      () => bot.editMessageText(msg.text, {
        chat_id: link.chatId,
        message_id: link.messageId
      }),
      'edit-text-in-user'
    )
  }

  // CAPTION foto/video/document/audio diedit
  else if (msg.photo || msg.video || msg.document || msg.audio) {
    await safeCall(
      () => bot.editMessageCaption(msg.caption || '', {
        chat_id: link.chatId,
        message_id: link.messageId
      }),
      'edit-caption-in-user'
    )
  }
}

console.log('BOT AKTIF YA 😶‍🌫️')
