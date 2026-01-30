// ================= CONFIG =================
const CONFIG = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  API_BASE: "https://allinone-api.freegm290.workers.dev",
  ADMIN_ID: "7755338110",
  DAILY_CREDIT: 5,
  PREMIUM_DAILY_CREDIT: 999
};

// ================= IN-MEMORY STORE =================
// ⚠️ Vercel serverless – restart হলে reset হবে
const users = new Map();

// ================= TELEGRAM API =================
async function tg(method, data) {
  const res = await fetch(
    `https://api.telegram.org/bot${CONFIG.BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    }
  );
  return res.json();
}

async function send(chatId, text, keyboard = null) {
  const payload = { chat_id: chatId, text, parse_mode: "HTML" };
  if (keyboard) payload.reply_markup = keyboard;
  return tg("sendMessage", payload);
}

// ================= OSINT API =================
async function callAPI(endpoint) {
  const r = await fetch(`${CONFIG.API_BASE}/${endpoint}`);
  return r.text();
}

// ================= USER =================
function getUser(id) {
  if (!users.has(id)) {
    users.set(id, {
      credits: CONFIG.DAILY_CREDIT,
      premium: false,
      referrals: 0
    });
  }
  return users.get(id);
}

// ================= MAIN MENU =================
function mainMenu() {
  return {
    keyboard: [
      [{ text: "🇮🇳 Indian Number Details" }],
      [{ text: "🚗 Vehicle Details" }],
      [{ text: "💳 Fampay Details" }],
      [{ text: "📍 Pincode to Village" }],
      [{ text: "🆔 Aadhaar Details" }],
      [{ text: "👥 Referral" }, { text: "❓ Help" }],
      [{ text: "💰 My Credits / Quota" }]
    ],
    resize_keyboard: true
  };
}

// ================= HANDLER =================
async function handleMessage(text, chatId, userId) {
  const user = getUser(userId);
  const parts = text.split(" ");

  // START / MENU
  if (text === "/start" || text === "Menu") {
    return send(
      chatId,
      "🔴 <b>OSINT Bot – Main Menu</b>\n\nSelect a service below:",
      mainMenu()
    );
  }

  // HELP
  if (text === "❓ Help" || text === "/help") {
    return send(
      chatId,
      `❓ <b>Help</b>

User Commands:
/number 9876543210
/vehicle UP26R4007
/fampay user@fam
/pincode 560001
/aadhaar 413129678885
/stats

Admin Commands:
/addcredit userId amount
/premium userId
/broadcast message`
    );
  }

  // REFERRAL
  if (text === "👥 Referral") {
    return send(
      chatId,
      `👥 <b>Referral</b>

Invite friends using your bot link.
(Current referrals: ${user.referrals})`
    );
  }

  // CREDITS
  if (text === "💰 My Credits / Quota") {
    return send(
      chatId,
      `💰 <b>Your Credits</b>

Credits: <b>${user.credits}</b>
Premium: ${user.premium ? "✅ Yes" : "❌ No"}`
    );
  }

  // ================= ADMIN COMMANDS =================
  if (text.startsWith("/addcredit")) {
    if (String(userId) !== CONFIG.ADMIN_ID)
      return send(chatId, "❌ Admin only");

    const uid = parts[1];
    const amount = parseInt(parts[2], 10);
    if (!uid || isNaN(amount))
      return send(chatId, "❌ Usage: /addcredit userId amount");

    const target = getUser(uid);
    target.credits += amount;
    return send(chatId, `✅ Added ${amount} credits to user ${uid}`);
  }

  if (text.startsWith("/premium")) {
    if (String(userId) !== CONFIG.ADMIN_ID)
      return send(chatId, "❌ Admin only");

    const uid = parts[1];
    if (!uid) return send(chatId, "❌ Usage: /premium userId");

    const target = getUser(uid);
    target.premium = true;
    target.credits = CONFIG.PREMIUM_DAILY_CREDIT;
    return send(chatId, `⭐ User ${uid} is now PREMIUM`);
  }

  // ================= STATS =================
  if (text === "/stats") {
    return send(
      chatId,
      `📊 <b>Bot Statistics</b>

Total users: ${users.size}
Premium users: ${[...users.values()].filter(u => u.premium).length}`
    );
  }

  // ================= BROADCAST =================
  if (text.startsWith("/broadcast")) {
    if (String(userId) !== CONFIG.ADMIN_ID)
      return send(chatId, "❌ Admin only");

    const msg = parts.slice(1).join(" ");
    if (!msg) return send(chatId, "❌ Usage: /broadcast message");

    let count = 0;
    for (const [uid] of users) {
      await send(uid, `📢 <b>Broadcast</b>\n\n${msg}`);
      count++;
    }
    return send(chatId, `✅ Broadcast sent to ${count} users`);
  }

  // ===== CREDIT CHECK =====
  async function useCredit() {
    if (user.premium) return true;
    if (user.credits <= 0) {
      await send(chatId, "❌ Daily credit limit reached.");
      return false;
    }
    user.credits--;
    return true;
  }

  // ================= SERVICES =================
  if (text.startsWith("/number")) {
    if (!parts[1]) return send(chatId, "❌ Usage: /number 9876543210");
    if (!(await useCredit())) return;
    return send(chatId, await callAPI(`indian-number?num=${parts[1]}`));
  }

  if (text.startsWith("/vehicle")) {
    if (!parts[1]) return send(chatId, "❌ Usage: /vehicle UP26R4007");
    if (!(await useCredit())) return;
    return send(chatId, await callAPI(`vehicle?rc=${parts[1]}`));
  }

  if (text.startsWith("/fampay")) {
    if (!parts[1]) return send(chatId, "❌ Usage: /fampay user@fam");
    if (!(await useCredit())) return;
    return send(chatId, await callAPI(`fampay?id=${parts[1]}`));
  }

  if (text.startsWith("/pincode")) {
    if (!parts[1]) return send(chatId, "❌ Usage: /pincode 560001");
    if (!(await useCredit())) return;
    return send(chatId, await callAPI(`pincode?pin=${parts[1]}`));
  }

  if (text.startsWith("/aadhaar")) {
    if (!parts[1]) return send(chatId, "❌ Usage: /aadhaar 413129678885");
    if (!(await useCredit())) return;
    return send(chatId, await callAPI(`aadhaar?num=${parts[1]}`));
  }

  return send(chatId, "❓ Unknown option. Use Menu.");
}

// ================= VERCEL HANDLER =================
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).send("OK");
  try {
    const update = req.body;
    if (update.message) {
      const chatId = update.message.chat.id;
      const userId = update.message.from.id;
      const text = update.message.text || "";
      await handleMessage(text, chatId, userId);
    }
    return res.status(200).send("OK");
  } catch (e) {
    console.error(e);
    return res.status(500).send("ERROR");
  }
}
