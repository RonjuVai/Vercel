// ================= CONFIG =================
const CONFIG = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  ADMIN_ID: "7755338110",
  API_BASE: "https://allinone-api.freegm290.workers.dev"
};

// ================= TELEGRAM API =================
async function tg(method, data) {
  return fetch(`https://api.telegram.org/bot${CONFIG.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  }).then(r => r.json());
}

async function send(chatId, text) {
  return tg("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML"
  });
}

// ================= OSINT API =================
async function osint(endpoint) {
  const res = await fetch(`${CONFIG.API_BASE}/${endpoint}`);
  return res.text();
}

// ================= COMMAND HANDLER =================
async function handleCommand(text, chatId, userId) {
  const args = text.split(" ");
  const cmd = args[0].toLowerCase();

  switch (cmd) {

    case "/start":
      return send(
        chatId,
        "👋 <b>Welcome to OSINT Bot</b>\n\nUse /help to see commands"
      );

    case "/help":
      return send(
        chatId,
`📌 <b>Available Commands</b>

/number <num>
/vehicle <rc>
/aadhaar <num>
/pincode <pin>
/fampay <id>

/stats
/broadcast (admin)`
      );

    case "/number":
      if (!args[1]) return send(chatId, "❌ Usage: /number 9876543210");
      return send(chatId, await osint(`indian-number?num=${args[1]}`));

    case "/vehicle":
      if (!args[1]) return send(chatId, "❌ Usage: /vehicle UP32AB1234");
      return send(chatId, await osint(`vehicle?rc=${args[1]}`));

    case "/aadhaar":
      if (!args[1]) return send(chatId, "❌ Usage: /aadhaar 123456789012");
      return send(chatId, await osint(`aadhaar?num=${args[1]}`));

    case "/pincode":
      if (!args[1]) return send(chatId, "❌ Usage: /pincode 110001");
      return send(chatId, await osint(`pincode?pin=${args[1]}`));

    case "/fampay":
      if (!args[1]) return send(chatId, "❌ Usage: /fampay user@fam");
      return send(chatId, await osint(`fampay?id=${args[1]}`));

    case "/stats":
      return send(chatId, "📊 <b>Stats</b>\nUsers: demo\nRequests: demo");

    case "/broadcast":
      if (String(userId) !== CONFIG.ADMIN_ID)
        return send(chatId, "❌ Admin only");

      const msg = args.slice(1).join(" ");
      if (!msg) return send(chatId, "❌ Usage: /broadcast message");
      return send(chatId, "✅ Broadcast sent (demo)");

    default:
      return send(chatId, "❓ Unknown command. Use /help");
  }
}

// ================= VERCEL HANDLER =================
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  try {
    const update = req.body;

    if (update.message) {
      const chatId = update.message.chat.id;
      const userId = update.message.from.id;
      const text = update.message.text || "";

      await handleCommand(text, chatId, userId);
    }

    return res.status(200).send("OK");

  } catch (err) {
    console.error(err);
    return res.status(500).send("ERROR");
  }
}
