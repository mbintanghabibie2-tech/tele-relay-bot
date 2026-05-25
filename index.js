const TelegramBot = require('node-telegram-bot-api')
const fs = require('fs')

const BOT_TOKEN = process.env.BOT_TOKEN
const GROUP_ID = process.env.GROUP_ID

const bot = new TelegramBot(BOT_TOKEN, {
  polling: true
})

const FILE = './users.json'

if (!fs.existsSync(FILE)) {
  fs.writeFileSync(FILE, '{}')
}

function loadUsers() {
  return JSON.parse(fs.readFileSync(FILE))
}

function saveUsers(data) {
  fs.writeFileSync(
    FILE,
    JSON.stringify(data, null, 2)
  )
}

bot.on('message', async (msg) => {

  // =========================
  // USER → GROUP
  // =========================
  if (msg.chat.type === 'private') {

    const users = loadUsers()

    let userData =
      users[msg.from.id]

    let topicId

    // bikin topic baru
    if (!userData) {

      const topic =
        await bot.createForumTopic(
          GROUP_ID,
          msg.from.first_name
        )

      topicId =
        topic.message_thread_id

      users[msg.from.id] = {
        user_id: msg.from.id,
        topic_id: topicId,
        name: msg.from.first_name
      }

      saveUsers(users)

      // info user
      await bot.sendMessage(
        GROUP_ID,

`👤 USER BARU

Nama:
${msg.from.first_name}

Username:
@${msg.from.username || '-'}

ID:
${msg.from.id}`,

        {
          message_thread_id:
            topicId
        }
      )

    } else {

      topicId =
        userData.topic_id

      // rename topic otomatis
      try {

        await bot.editForumTopic(
          GROUP_ID,
          topicId,
          {
            name:
              msg.from.first_name
          }
        )

      } catch {}

    }

    // auto typing
    await bot.sendChatAction(
      GROUP_ID,
      'typing',
      {
        message_thread_id:
          topicId
      }
    )

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
          caption:
            msg.caption || '',

          message_thread_id:
            topicId
        }
      )

    }

    // VIDEO
    else if (msg.video) {

      await bot.sendVideo(
        GROUP_ID,
        msg.video.file_id,
        {
          caption:
            msg.caption || '',

          message_thread_id:
            topicId
        }
      )

    }

    // VOICE NOTE
    else if (msg.voice) {

      await bot.sendVoice(
        GROUP_ID,
        msg.voice.file_id,
        {
          caption:
            msg.caption || '',

          message_thread_id:
            topicId
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

  }

  // =========================
  // GROUP → USER
  // =========================
  else if (
    msg.chat.type ===
    'supergroup'
  ) {

    if (!msg.message_thread_id)
      return

    const users = loadUsers()

    let foundUser = null

    for (const id in users) {

      if (
        String(
          users[id].topic_id
        ) ===
        String(
          msg.message_thread_id
        )
      ) {

        foundUser =
          users[id]

        break

      }

    }

    if (!foundUser) return

    const userId =
      foundUser.user_id

    // auto typing
    await bot.sendChatAction(
      userId,
      'typing'
    )

    let replyOptions = {}

    // reply sync asli
    if (
      msg.reply_to_message &&
      msg.reply_to_message.from &&
      msg.reply_to_message.from.is_bot
    ) {

      try {

        replyOptions.reply_to_message_id =
          foundUser.last_msg_id

      } catch {}

    }

    let sentMsg

    // TEXT
    if (
      msg.text &&
      !msg.text.startsWith('/')
    ) {

      sentMsg =
        await bot.sendMessage(
          userId,
          msg.text,
          replyOptions
        )

    }

    // PHOTO
    else if (msg.photo) {

      const photo =
        msg.photo.pop()

      sentMsg =
        await bot.sendPhoto(
          userId,
          photo.file_id,
          {
            caption:
              msg.caption || '',

            ...replyOptions
          }
        )

    }

    // VIDEO
    else if (msg.video) {

      sentMsg =
        await bot.sendVideo(
          userId,
          msg.video.file_id,
          {
            caption:
              msg.caption || '',

            ...replyOptions
          }
        )

    }

    // VOICE
    else if (msg.voice) {

      sentMsg =
        await bot.sendVoice(
          userId,
          msg.voice.file_id,
          {
            caption:
              msg.caption || '',

            ...replyOptions
          }
        )

    }

    // STICKER
    else if (msg.sticker) {

      sentMsg =
        await bot.sendSticker(
          userId,
          msg.sticker.file_id,
          replyOptions
        )

    }

    // simpan last msg id
    if (sentMsg) {

      users[userId]
        .last_msg_id =
        sentMsg.message_id

      saveUsers(users)

    }

  }

})

console.log('Bot aktif 🔥')
