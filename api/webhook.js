// ================= CONFIG =================
const CONFIG = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  API_BASE: "https://allinone-api.freegm290.workers.dev",
  ADMIN_ID: "7755338110",
  DAILY_CREDIT: 5,
  PREMIUM_DAILY_CREDIT: 999
};

// ================= IN-MEMORY STORE =================
const users = new Map();
const sessions = new Map(); // button -> awaiting input

// ================= TELEGRAM API =================
async function tg(method, data) {
  const res = await fetch(
    `https://api.telegram.org/bot${CONFIG.BOT_TOKEN}/${method}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }
  );
  return res.json();
}
async function send(chatId, text, keyboard = null) {
  const payload = { chat_id: chatId, text, parse_mode: "HTML" };
  if (keyboard) payload.reply_markup = keyboard;
  return tg("sendMessage", payload);
}

// ================= OSINT API (SAFE) =================
async function callAPI(endpoint) {
  const r = await fetch(`${CONFIG.API_BASE}/${endpoint}`);
  const txt = await r.text();
  // try to parse json error
  try {
    const j = JSON.parse(txt);
    if (j?.error) return `❌ API Error: ${j.error}`;
  } catch (_) {}
  return txt || "❌ Empty response from API";
}

// ================= USER =================
function getUser(id) {
  if (!users.has(id)) users.set(id, { credits: CONFIG.DAILY_CREDIT, premium: false });
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

// ================= CREDIT =================
async function useCredit(chatId, user) {
  if (user.premium) return true;
  if (user.credits <= 0) {
    await send(chatId, "❌ Daily credit limit reached.");
    return false;
  }
  user.credits--;
  return true;
}

// ================= HANDLER =================
async function handleMessage(text, chatId, userId) {
  const user = getUser(userId);
  const parts = text.split(" ");

  // START / MENU
  if (text === "/start" || text === "Menu") {
    sessions.delete(chatId);
    return send(chatId, "🔴 <b>OSINT Bot – Main Menu</b>\n\nSelect a service below:", mainMenu());
  }

  // HELP
  if (text === "❓ Help" || text === "/help") {
    return send(chatId,
`❓ <b>Help</b>
Commands:
/number 9876543210
/vehicle UP26R4007
/fampay user@fam
/pincode 560001
/aadhaar 413129678885
/stats

Admin:
/addcredit userId amount
/premium userId
/broadcast message`);
  }

  // BUTTON → PROMPT
  if (text.includes("Indian Number")) {
    sessions.set(chatId, { type: "number" });
    return send(chatId, "📱 Enter Indian number:\nExample: 9876543210");
  }
  if (text.includes("Vehicle")) {
    sessions.set(chatId, { type: "vehicle" });
    return send(chatId, "🚗 Enter vehicle RC:\nExample: UP26R4007");
  }
  if (text.includes("Fampay")) {
    sessions.set(chatId, { type: "fampay" });
    return send(chatId, "💳 Enter Fampay ID:\nExample: user@fam");
  }
  if (text.includes("Pincode")) {
    sessions.set(chatId, { type: "pincode" });
    return send(chatId, "📍 Enter pincode:\nExample: 560001");
  }
  if (text.includes("Aadhaar")) {
    sessions.set(chatId, { type: "aadhaar" });
    return send(chatId, "🆔 Enter Aadhaar number:\nExample: 413129678885");
  }

  // SESSION INPUT
  if (sessions.has(chatId)) {
    const s = sessions.get(chatId);
    sessions.delete(chatId);
    if (!(await useCredit(chatId, user))) return;

    if (s.type === "number") return send(chatId, await callAPI(`indian-number?num=${text}`));
    if (s.type === "vehicle") return send(chatId, await callAPI(`vehicle?rc=${text}`));
    if (s.type === "fampay")  return send(chatId, await callAPI(`fampay?id=${text}`));
    if (s.type === "pincode") return send(chatId, await callAPI(`pincode?pin=${text}`));
    if (s.type === "aadhaar") return send(chatId, await callAPI(`aadhaar?num=${text}`));
  }

  // DIRECT COMMANDS
  if (text.startsWith("/number"))  { if (!parts[1]) return send(chatId,"❌ Usage: /number 9876543210"); if (!(await useCredit(chatId,user))) return; return send(chatId, await callAPI(`indian-number?num=${parts[1]}`)); }
  if (text.startsWith("/vehicle")) { if (!parts[1]) return send(chatId,"❌ Usage: /vehicle UP26R4007"); if (!(await useCredit(chatId,user))) return; return send(chatId, await callAPI(`vehicle?rc=${parts[1]}`)); }
  if (text.startsWith("/fampay"))  { if (!parts[1]) return send(chatId,"❌ Usage: /fampay user@fam");     if (!(await useCredit(chatId,user))) return; return send(chatId, await callAPI(`fampay?id=${parts[1]}`)); }
  if (text.startsWith("/pincode")) { if (!parts[1]) return send(chatId,"❌ Usage: /pincode 560001");        if (!(await useCredit(chatId,user))) return; return send(chatId, await callAPI(`pincode?pin=${parts[1]}`)); }
  if (text.startsWith("/aadhaar")) { if (!parts[1]) return send(chatId,"❌ Usage: /aadhaar 413129678885");  if (!(await useCredit(chatId,user))) return; return send(chatId, await callAPI(`aadhaar?num=${parts[1]}`)); }

  // STATS
  if (text === "/stats") {
    const premiumCount = [...users.values()].filter(u=>u.premium).length;
    return send(chatId, `📊 <b>Stats</b>\nUsers: ${users.size}\nPremium: ${premiumCount}`);
  }

  // ADMIN
  if (text.startsWith("/addcredit")) {
    if (String(userId) !== CONFIG.ADMIN_ID) return send(chatId,"❌ Admin only");
    const uid = parts[1]; const amt = parseInt(parts[2],10);
    if (!uid || isNaN(amt)) return send(chatId,"❌ Usage: /addcredit userId amount");
    getUser(uid).credits += amt;
    return send(chatId, `✅ Added ${amt} credits to ${uid}`);
  }
  if (text.startsWith("/premium")) {
    if (String(userId) !== CONFIG.ADMIN_ID) return send(chatId,"❌ Admin only");
    const uid = parts[1]; if (!uid) return send(chatId,"❌ Usage: /premium userId");
    const t = getUser(uid); t.premium = true; t.credits = CONFIG.PREMIUM_DAILY_CREDIT;
    return send(chatId, `⭐ ${uid} is PREMIUM`);
  }
  if (text.startsWith("/broadcast")) {
    if (String(userId) !== CONFIG.ADMIN_ID) return send(chatId,"❌ Admin only");
    const msg = parts.slice(1).join(" "); if (!msg) return send(chatId,"❌ Usage: /broadcast message");
    let c=0; for (const uid of users.keys()) { await send(uid, `📢 <b>Broadcast</b>\n\n${msg}`); c++; }
    return send(chatId, `✅ Broadcast sent to ${c} users`);
  }

  return send(chatId, "❓ Unknown option. Use Menu.");
}

// ================= VERCEL HANDLER =================
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).send("OK");
  try {
    const update = req.body;
    if (update.message) {
      await handleMessage(update.message.text || "", update.message.chat.id, update.message.from.id);
    }
    return res.status(200).send("OK");
  } catch (e) {
    console.error(e);
    return res.status(500).send("ERROR");
  }
}
