const TelegramBot =
require('node-telegram-bot-api')

const fs = require('fs')

const config = require('./config')

const bot =
new TelegramBot(
  config.BOT_TOKEN,
  { polling: true }
)

const GROUP_ID =
config.GROUP_ID

const FILE = './users.json'

// buat users.json
if (!fs.existsSync(FILE)) {
  fs.writeFileSync(FILE, '{}')
}

function loadUsers() {
  return JSON.parse(
    fs.readFileSync(FILE)
  )
}

function saveUsers(data) {
  fs.writeFileSync(
    FILE,
    JSON.stringify(data, null, 2)
  )
}

// START
bot.onText(/\/start/, async (msg) => {

  bot.sendMessage(
    msg.chat.id,
    'iyaa, kirim pesannya ya, nanti dibales secepatnya.'
  )

})

// SEMUA PESAN USER
bot.on('message', async (msg) => {

  // PRIVATE CHAT
  if (msg.chat.type === 'private') {

    // skip command
    if (
      msg.text &&
      msg.text.startsWith('/')
    ) return

    const users = loadUsers()

    let user =
      users[msg.from.id]

    let topicId

    // bikin topic baru
    if (!user) {

      const topic =
      await bot.createForumTopic(
        GROUP_ID,
        msg.from.first_name
      )

      topicId =
      topic.message_thread_id

      users[msg.from.id] = {

        user_id:
        String(msg.from.id),

        topic_id:
        String(topicId),

        fullname:
        msg.from.first_name,

        username:
        msg.from.username || '-'

      }

      saveUsers(users)

      // info user
      await bot.sendMessage(
        GROUP_ID,

`🫂 INFO USER

Nama User:
${msg.from.first_name}

Username:
@${msg.from.username || '-'}

ID TELE:
${msg.from.id}`,

{
  message_thread_id:
  topicId
}
)

    }

    else {

      topicId =
      user.topic_id

    }

    // TEXT
    if (msg.text) {

      await bot.sendMessage(
        GROUP_ID,
        msg.text,
        {
          message_thread_id:
          topicId
        }
      )

    }

    // PHOTO
    else if (msg.photo) {

      const photo =
      msg.photo.pop()

      await bot.sendPhoto(
        GROUP_ID,
        photo.file_id,
        {
          message_thread_id:
          topicId,

          caption:
          msg.caption || ''
        }
      )

    }

    // VIDEO
    else if (msg.video) {

      await bot.sendVideo(
        GROUP_ID,
        msg.video.file_id,
        {
          message_thread_id:
          topicId,

          caption:
          msg.caption || ''
        }
      )

    }

    // STICKER
    else if (msg.sticker) {

      await bot.sendSticker(
        GROUP_ID,
        msg.sticker.file_id,
        {
          message_thread_id:
          topicId
        }
      )

    }

    // VOICE
    else if (msg.voice) {
      await bot.sendVoice(
        GROUP_ID,
        msg.voice.file_id,
        {
          message_thread_id:
          topicId
        }
      )

    }

  // GROUP TOPIC → USER
  else if (
    msg.chat.type === 'supergroup'
  ) {

    if (
      !msg.message_thread_id
    ) return

    const users = loadUsers()

    let foundUser = null

    for (const id in users) {

      if (
        String(
          users[id].topic_id
        )

        ===

        String(
          msg.message_thread_id
        )

      ) {

        foundUser =
        users[id]

      }
         
       // VOICE
      else if (msg.voice) {
        await bot.sendVoice(
         userId,
         msg.voice.file_id
       )
      }

    }

    if (!foundUser) return

    const userId =
    foundUser.user_id

    // jangan baca bot
    if (msg.from.is_bot)
    return

    // TEXT
    if (
      msg.text &&
      !msg.text.startsWith('/')
    ) {

      await bot.sendChatAction(
        userId,
        'typing'
      )

      await bot.sendMessage(
        userId,
        msg.text
      )

    }

    // PHOTO
    else if (msg.photo) {

      const photo =
      msg.photo.pop()

      await bot.sendChatAction(
       userId,
       'upload_photo'
      )

      await bot.sendPhoto(
        userId,
        photo.file_id,
        {
          caption:
          msg.caption || ''
        }
      )

    }

    // VIDEO
    else if (msg.video) {

      await bot.sendVideo(
        userId,
        msg.video.file_id,
        {
          caption:
          msg.caption || ''
        }
      )

    }

    // STICKER
    else if (msg.sticker) {

      await bot.sendSticker(
        userId,
        msg.sticker.file_id
      )

    }

  }

})

console.log(
'BOT AKTIF 😶‍🌫️'
)
