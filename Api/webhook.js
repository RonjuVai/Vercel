// ==================== CONFIGURATION ====================

const TELEGRAM_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_USERNAME = '@ronjumodz'; // Users must join this channel
const ADMIN_IDS = ['7755338110']; // Your Telegram user ID
const BOT_USERNAME = '@osintallinbot';

  API_BASE_URL: "https://allinone-api.freegm290.workers.dev",
  
  // Premium settings
  FREE_PREMIUM_HOURS: 24,
  PAID_PREMIUM_DAYS: 30,
  FREE_API_LIMIT: 5,
  
  // KV Storage keys
  KV_USERS: "users",
  KV_STATS: "bot_stats"
};

// ==================== KV STORAGE SIMULATION ====================
// Cloudflare Workers KV ki jagah in-memory storage (production mein KV use hoga)
let kvStore = new Map();

class SimpleKV {
  static async get(key) {
    return kvStore.get(key);
  }
  
  static async put(key, value) {
    kvStore.set(key, JSON.stringify(value));
  }
  
  static async delete(key) {
    kvStore.delete(key);
  }
  
  static async list() {
    return { keys: Array.from(kvStore.keys()).map(k => ({ name: k })) };
  }
}

// ==================== MAIN WORKER HANDLER ====================
export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      
      // Webhook setup endpoint
      if (url.pathname === '/setup' && request.method === 'GET') {
        return await setupWebhook();
      }
      
      // Webhook removal endpoint
      if (url.pathname === '/remove' && request.method === 'GET') {
        return await removeWebhook();
      }
      
      // Bot webhook handler
      if (url.pathname === '/webhook' && request.method === 'POST') {
        return await handleWebhook(await request.json());
      }
      
      // Health check
      if (url.pathname === '/health' && request.method === 'GET') {
        return new Response(JSON.stringify({ status: 'ok', users: kvStore.size }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // Bot status page
      if (url.pathname === '/status' && request.method === 'GET') {
        return new Response(`
          <html>
            <head><title>OSINT Bot Status</title></head>
            <body>
              <h1>🤖 OSINT Telegram Bot</h1>
              <p>Status: <strong>Running</strong></p>
              <p>Total Users: ${kvStore.size}</p>
              <p>Bot Token: ${CONFIG.BOT_TOKEN ? '✅ Set' : '❌ Not Set'}</p>
              <p>Channel: ${CONFIG.CHANNEL_USERNAME}</p>
              <p>Admin ID: ${CONFIG.ADMIN_ID}</p>
              <br>
              <p>Webhook: <a href="/setup">/setup</a></p>
              <p>Remove: <a href="/remove">/remove</a></p>
              <p>Health: <a href="/health">/health</a></p>
            </body>
          </html>
        `, { headers: { 'Content-Type': 'text/html' } });
      }
      
      // Default response
      return new Response(`
        OSINT Bot Worker is Running! 📡
        Use /setup to configure webhook
        Use /status to check bot status
      `, { status: 200 });
      
    } catch (error) {
      console.error('Worker Error:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  }
};

// ==================== TELEGRAM API FUNCTIONS ====================
async function callTelegramAPI(method, data = {}) {
  const url = `https://api.telegram.org/bot${CONFIG.BOT_TOKEN}/${method}`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    
    return await response.json();
  } catch (error) {
    console.error(`Telegram API Error (${method}):`, error);
    return { ok: false, error: error.message };
  }
}

async function sendMessage(chatId, text, replyMarkup = null, parseMode = 'HTML') {
  const data = {
    chat_id: chatId,
    text: text,
    parse_mode: parseMode
  };
  
  if (replyMarkup) {
    data.reply_markup = replyMarkup;
  }
  
  return await callTelegramAPI('sendMessage', data);
}

async function answerCallbackQuery(callbackQueryId, text = '', showAlert = false) {
  return await callTelegramAPI('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text: text,
    show_alert: showAlert
  });
}

// ==================== WEBHOOK MANAGEMENT ====================
async function setupWebhook() {
  const webhookUrl = `${new URL(request.url).origin}/webhook`;
  const result = await callTelegramAPI('setWebhook', { url: webhookUrl });
  
  return new Response(JSON.stringify({
    success: result.ok,
    message: result.ok ? 'Webhook set successfully!' : 'Failed to set webhook',
    webhookUrl: webhookUrl,
    details: result
  }, null, 2), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function removeWebhook() {
  const result = await callTelegramAPI('deleteWebhook');
  
  return new Response(JSON.stringify({
    success: result.ok,
    message: result.ok ? 'Webhook removed successfully!' : 'Failed to remove webhook',
    details: result
  }, null, 2), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// ==================== USER MANAGEMENT ====================
async function getUser(userId) {
  const userData = await SimpleKV.get(`user_${userId}`);
  return userData ? JSON.parse(userData) : null;
}

async function saveUser(user) {
  // Auto cleanup for expired premium
  if (user.is_premium && user.premium_expiry) {
    const expiryDate = new Date(user.premium_expiry);
    const now = new Date();
    
    if (expiryDate < now) {
      user.is_premium = false;
      user.premium_expiry = null;
    }
  }
  
  await SimpleKV.put(`user_${user.id}`, user);
  return user;
}

async function createNewUser(telegramUser) {
  const newUser = {
    id: telegramUser.id,
    username: telegramUser.username || '',
    first_name: telegramUser.first_name || '',
    last_name: telegramUser.last_name || '',
    is_premium: true, // 24h free premium for new users
    premium_expiry: new Date(Date.now() + CONFIG.FREE_PREMIUM_HOURS * 60 * 60 * 1000).toISOString(),
    is_verified: false,
    force_join_checked: false,
    api_usage_count: 0,
    join_date: new Date().toISOString(),
    last_active: new Date().toISOString()
  };
  
  return await saveUser(newUser);
}

// ==================== FORCE JOIN SYSTEM ====================
async function checkChannelMembership(userId) {
  try {
    // Get chat member status from Telegram
    const response = await fetch(
      `https://api.telegram.org/bot${CONFIG.BOT_TOKEN}/getChatMember?chat_id=${CONFIG.CHANNEL_USERNAME}&user_id=${userId}`
    );
    
    const data = await response.json();
    const status = data.result?.status;
    
    return ['member', 'administrator', 'creator'].includes(status);
  } catch (error) {
    console.error('Channel check error:', error);
    return false;
  }
}

async function handleForceJoin(chatId, userId, user) {
  const hasJoined = await checkChannelMembership(userId);
  
  if (hasJoined) {
    // User has joined, mark as verified
    user.is_verified = true;
    user.force_join_checked = true;
    await saveUser(user);
    
    await sendMessage(
      chatId,
      `✅ <b>Verification Successful!</b>\n\n` +
      `Welcome to <b>${CONFIG.CHANNEL_USERNAME}</b>\n` +
      `You can now use all bot features!\n\n` +
      `🎁 <i>You have received ${CONFIG.FREE_PREMIUM_HOURS} hours of premium access!</i>\n` +
      `Use <code>/help</code> to see available commands.`
    );
    
    return true;
  } else {
    // Show join button
    const keyboard = {
      inline_keyboard: [
        [
          {
            text: "✅ Join Channel",
            url: `https://t.me/${CONFIG.CHANNEL_USERNAME.replace('@', '')}`
          }
        ],
        [
          {
            text: "🔁 Check Membership",
            callback_data: `verify_join_${userId}`
          }
        ]
      ]
    };
    
    await sendMessage(
      chatId,
      `🔒 <b>Channel Membership Required</b>\n\n` +
      `To use this bot, you must join our channel:\n` +
      `<b>${CONFIG.CHANNEL_USERNAME}</b>\n\n` +
      `1. Click "Join Channel" below\n` +
      `2. After joining, click "Check Membership"\n\n` +
      `<i>This helps us keep the bot free and updated!</i>`,
      keyboard
    );
    
    return false;
  }
}

// ==================== OSINT API FUNCTIONS ====================
async function fetchIndianNumber(number) {
  const response = await fetch(`${CONFIG.API_BASE_URL}/indian-number?num=${number}`);
  return await response.json();
}

async function fetchVehicleDetails(rc) {
  const response = await fetch(`${CONFIG.API_BASE_URL}/vehicle?rc=${rc}`);
  return await response.json();
}

async function fetchFampayDetails(id) {
  const response = await fetch(`${CONFIG.API_BASE_URL}/fampay?id=${id}`);
  return await response.json();
}

async function fetchPincodeDetails(pin) {
  const response = await fetch(`${CONFIG.API_BASE_URL}/pincode?pin=${pin}`);
  return await response.json();
}

async function fetchAadhaarDetails(num) {
  const response = await fetch(`${CONFIG.API_BASE_URL}/aadhaar?num=${num}`);
  return await response.json();
}

// ==================== COMMAND HANDLERS ====================
async function handleStartCommand(chatId, userId, message) {
  let user = await getUser(userId);
  
  if (!user) {
    // New user
    user = await createNewUser(message.from);
    
    await sendMessage(
      chatId,
      `👋 <b>Welcome to OSINT Bot!</b>\n\n` +
      `I can help you with various information lookups:\n` +
      `• 📱 Indian Number Details\n` +
      `• 🚗 Vehicle RC Details\n` +
      `• 📮 Pincode Information\n` +
      `• 💳 FamPay Account Details\n` +
      `• 🪪 Aadhaar Information\n\n` +
      `🎁 <b>You've received ${CONFIG.FREE_PREMIUM_HOURS} hours of premium access!</b>\n` +
      `Use <code>/help</code> to see all commands.`
    );
  } else {
    // Existing user
    user.last_active = new Date().toISOString();
    await saveUser(user);
    
    const premiumStatus = user.is_premium ? 
      `✅ <b>Premium Active</b> (Expires: ${new Date(user.premium_expiry).toLocaleDateString()})` : 
      `❌ <b>Premium Expired</b>\nContact @Ronju360 to upgrade`;
    
    await sendMessage(
      chatId,
      `👋 <b>Welcome back, ${user.first_name || 'User'}!</b>\n\n` +
      `${premiumStatus}\n` +
      `📊 API Usage: ${user.api_usage_count || 0} requests\n` +
      `👤 Verification: ${user.is_verified ? '✅ Verified' : '❌ Not Verified'}\n\n` +
      `Use <code>/help</code> to see available commands.`
    );
  }
  
  // Check force join for unverified users
  if (!user.is_verified) {
    await handleForceJoin(chatId, userId, user);
  }
}

async function handleHelpCommand(chatId, user) {
  const isPremium = user?.is_premium || false;
  
  let helpText = `🤖 <b>OSINT Bot Help Menu</b>\n\n`;
  
  helpText += `<b>🔍 Information Lookup Commands:</b>\n`;
  helpText += `<code>/number 9876543210</code> - Indian number details\n`;
  helpText += `<code>/vehicle UP26R4007</code> - Vehicle RC details\n`;
  helpText += `<code>/pincode 560001</code> - Pincode information\n`;
  
  if (isPremium) {
    helpText += `<code>/fampay loverajoriya@fam</code> - FamPay details\n`;
    helpText += `<code>/aadhaar 413129678885</code> - Aadhaar details\n`;
  } else {
    helpText += `\n<b>⭐ Premium Features (Contact @Ronju360):</b>\n`;
    helpText += `• FamPay account lookup\n`;
    helpText += `• Aadhaar information\n`;
    helpText += `• Unlimited API requests\n`;
    helpText += `• No ads\n`;
  }
  
  helpText += `\n<b>👤 User Commands:</b>\n`;
  helpText += `<code>/start</code> - Start the bot\n`;
  helpText += `<code>/help</code> - Show this menu\n`;
  helpText += `<code>/status</code> - Your account status\n`;
  
  const isAdmin = user?.id.toString() === CONFIG.ADMIN_ID;
  if (isAdmin) {
    helpText += `\n<b>👑 Admin Commands:</b>\n`;
    helpText += `<code>/premium user_id</code> - Grant 30 days premium\n`;
    helpText += `<code>/broadcast message</code> - Send message to all users\n`;
    helpText += `<code>/stats</code> - Bot statistics\n`;
  }
  
  helpText += `\n📞 <i>Support: @Ronju360</i>`;
  
  await sendMessage(chatId, helpText);
}

async function handleNumberCommand(chatId, userId, args) {
  const user = await getUser(userId);
  
  // Check verification
  if (!user?.is_verified) {
    await handleForceJoin(chatId, userId, user);
    return;
  }
  
  // Check API limit for free users
  if (!user.is_premium && (user.api_usage_count || 0) >= CONFIG.FREE_API_LIMIT) {
    await sendMessage(
      chatId,
      `❌ <b>Free Limit Exceeded!</b>\n\n` +
      `You've used ${user.api_usage_count || 0}/${CONFIG.FREE_API_LIMIT} free requests.\n` +
      `Premium users get unlimited access!\n\n` +
      `Contact @Ronju360 to upgrade.`
    );
    return;
  }
  
  if (!args || !args.match(/^\d{10}$/)) {
    await sendMessage(
      chatId,
      `📱 <b>Usage:</b> <code>/number 9876543210</code>\n\n` +
      `<i>Enter a valid 10-digit Indian phone number</i>`
    );
    return;
  }
  
  // Send processing message
  await sendMessage(chatId, `🔍 Searching details for ${args}...`);
  
  try {
    const data = await fetchIndianNumber(args);
    
    let result = `📱 <b>Indian Number Details</b>\n\n`;
    result += `<b>Number:</b> ${args}\n`;
    
    if (data.data) {
      // Format based on actual API response
      result += `<b>Operator:</b> ${data.data.operator || 'N/A'}\n`;
      result += `<b>Circle:</b> ${data.data.circle || 'N/A'}\n`;
      result += `<b>State:</b> ${data.data.state || 'N/A'}\n`;
      result += `<b>Type:</b> ${data.data.type || 'N/A'}\n`;
    } else {
      result += `<i>Information not available</i>\n`;
    }
    
    result += `\n🕒 ${data.timestamp || new Date().toLocaleTimeString()}`;
    
    // Update usage count
    user.api_usage_count = (user.api_usage_count || 0) + 1;
    await saveUser(user);
    
    await sendMessage(chatId, result);
    
  } catch (error) {
    await sendMessage(chatId, `❌ <b>Error fetching number details</b>\n\n<i>Please try again later</i>`);
  }
}

async function handleVehicleCommand(chatId, userId, args) {
  const user = await getUser(userId);
  
  if (!user?.is_verified) {
    await handleForceJoin(chatId, userId, user);
    return;
  }
  
  if (!user.is_premium && (user.api_usage_count || 0) >= CONFIG.FREE_API_LIMIT) {
    await sendMessage(
      chatId,
      `❌ <b>Free Limit Exceeded!</b>\n\n` +
      `Upgrade to premium for unlimited access!\n` +
      `Contact @Ronju360`
    );
    return;
  }
  
  if (!args) {
    await sendMessage(
      chatId,
      `🚗 <b>Usage:</b> <code>/vehicle UP26R4007</code>\n\n` +
      `<i>Enter a valid vehicle RC number</i>`
    );
    return;
  }
  
  await sendMessage(chatId, `🔍 Searching vehicle details...`);
  
  try {
    const data = await fetchVehicleDetails(args);
    
    let result = `🚗 <b>Vehicle Details</b>\n\n`;
    result += `<b>RC Number:</b> ${args}\n`;
    
    if (data.data && data.data["Ownership Details"]) {
      const owner = data.data["Ownership Details"];
      const vehicle = data.data["Vehicle Details"];
      const dates = data.data["Important Dates & Validity"];
      
      result += `\n👤 <b>Owner Information</b>\n`;
      result += `<b>• Name:</b> ${owner["Owner Name"] || 'N/A'}\n`;
      result += `<b>• Father:</b> ${owner["Father's Name"] || 'N/A'}\n`;
      result += `<b>• RTO:</b> ${owner["Registered RTO"] || 'N/A'}\n`;
      
      result += `\n🚘 <b>Vehicle Information</b>\n`;
      result += `<b>• Model:</b> ${vehicle["Model Name"] || 'N/A'}\n`;
      result += `<b>• Type:</b> ${vehicle["Vehicle Class"] || 'N/A'}\n`;
      result += `<b>• Fuel:</b> ${vehicle["Fuel Type"] || 'N/A'}\n`;
      result += `<b>• Engine:</b> ${vehicle["Engine Number"] ? vehicle["Engine Number"].substring(0, 10) + '...' : 'N/A'}\n`;
      
      result += `\n📅 <b>Validity Information</b>\n`;
      result += `<b>• Registration:</b> ${owner["Registration Date"] || 'N/A'}\n`;
      result += `<b>• Fitness Upto:</b> ${dates["Fitness Upto"] || 'N/A'}\n`;
      result += `<b>• Insurance Upto:</b> ${dates["Insurance Upto"] || 'N/A'}\n`;
      result += `<b>• PUC Upto:</b> ${dates["PUC Upto"] || 'N/A'}\n`;
    }
    
    result += `\n🕒 ${data.timestamp || new Date().toLocaleTimeString()}`;
    
    user.api_usage_count = (user.api_usage_count || 0) + 1;
    await saveUser(user);
    
    await sendMessage(chatId, result);
    
  } catch (error) {
    await sendMessage(chatId, `❌ <b>Error fetching vehicle details</b>`);
  }
}

async function handlePincodeCommand(chatId, userId, args) {
  const user = await getUser(userId);
  
  if (!user?.is_verified) {
    await handleForceJoin(chatId, userId, user);
    return;
  }
  
  if (!args || !args.match(/^\d{6}$/)) {
    await sendMessage(
      chatId,
      `📮 <b>Usage:</b> <code>/pincode 560001</code>\n\n` +
      `<i>Enter a valid 6-digit pincode</i>`
    );
    return;
  }
  
  await sendMessage(chatId, `🔍 Searching pincode details...`);
  
  try {
    const data = await fetchPincodeDetails(args);
    
    let result = `📮 <b>Pincode Details</b>\n\n`;
    result += `<b>Pincode:</b> ${args}\n`;
    
    if (data.data && data.data.offices && data.data.offices.length > 0) {
      const office = data.data.offices[0];
      result += `<b>• City:</b> ${office.district || 'N/A'}\n`;
      result += `<b>• State:</b> ${office.state || 'N/A'}\n`;
      result += `<b>• Post Office:</b> ${office.name || 'N/A'}\n`;
      result += `<b>• Delivery:</b> ${office.deliveryStatus || 'N/A'}\n`;
      result += `<b>• Branch Type:</b> ${office.branchType || 'N/A'}\n`;
      
      if (data.data.count > 1) {
        result += `\n📊 <i>Total ${data.data.count} post offices found</i>`;
      }
    }
    
    result += `\n🕒 ${data.timestamp || new Date().toLocaleTimeString()}`;
    
    await sendMessage(chatId, result);
    
  } catch (error) {
    await sendMessage(chatId, `❌ <b>Error fetching pincode details</b>`);
  }
}

async function handleFampayCommand(chatId, userId, args) {
  const user = await getUser(userId);
  
  if (!user?.is_verified) {
    await handleForceJoin(chatId, userId, user);
    return;
  }
  
  // Premium feature check
  if (!user.is_premium) {
    await sendMessage(
      chatId,
      `⭐ <b>Premium Feature!</b>\n\n` +
      `FamPay lookup is available only for premium users.\n\n` +
      `Contact @Ronju360 to upgrade and get:\n` +
      `• FamPay account lookup\n` +
      `• Aadhaar information\n` +
      `• Unlimited API requests\n` +
      `• Priority support`
    );
    return;
  }
  
  if (!args || !args.includes('@fam')) {
    await sendMessage(
      chatId,
      `💳 <b>Usage:</b> <code>/fampay loverajoriya@fam</code>\n\n` +
      `<i>Enter a valid FamPay ID (ends with @fam)</i>`
    );
    return;
  }
  
  await sendMessage(chatId, `🔍 Searching FamPay details...`);
  
  try {
    const data = await fetchFampayDetails(args);
    
    let result = `💳 <b>FamPay Details</b>\n\n`;
    
    if (data.data && data.data.status) {
      result += `<b>• Fam ID:</b> ${data.data.fam_id}\n`;
      result += `<b>• Name:</b> ${data.data.name}\n`;
      result += `<b>• Type:</b> ${data.data.type}\n`;
      result += `<b>• Status:</b> ✅ Active\n`;
      
      // Mask phone number
      if (data.data.phone && data.data.phone.includes('@')) {
        result += `<b>• Phone:</b> ${data.data.phone.split('@')[0]}...\n`;
      }
    } else {
      result += `<b>Status:</b> ❌ Not found or inactive\n`;
    }
    
    result += `\n🕒 ${data.timestamp || new Date().toLocaleTimeString()}`;
    
    await sendMessage(chatId, result);
    
  } catch (error) {
    await sendMessage(chatId, `❌ <b>Error fetching FamPay details</b>`);
  }
}

async function handleAadhaarCommand(chatId, userId, args) {
  const user = await getUser(userId);
  
  if (!user?.is_verified) {
    await handleForceJoin(chatId, userId, user);
    return;
  }
  
    // Premium feature check
  if (!user.is_premium) {
    await sendMessage(
      chatId,
      `⭐ <b>Premium Feature!</b>\n\n` +
      `FamPay lookup is available only for premium users.\n\n` +
      `Contact @Ronju360 to upgrade and get:\n` +
      `• FamPay account lookup\n` +
      `• Aadhaar information\n` +
      `• Unlimited API requests\n` +
      `• Priority support`
    );
    return;
  }
  
  if (!args || !args.includes('@fam')) {
    await sendMessage(
      chatId,
      `💳 <b>Usage:</b> <code>/fampay loverajoriya@fam</code>\n\n` +
      `<i>Enter a valid FamPay ID (ends with @fam)</i>`
    );
    return;
  }
  
  await sendMessage(chatId, `🔍 Searching FamPay details...`);
  
  try {
    const data = await fetchFampayDetails(args);
    
    let result = `💳 <b>FamPay Details</b>\n\n`;
    
    if (data.data && data.data.status) {
      result += `<b>• Fam ID:</b> ${data.data.fam_id}\n`;
      result += `<b>• Name:</b> ${data.data.name}\n`;
      result += `<b>• Type:</b> ${data.data.type}\n`;
      result += `<b>• Status:</b> ✅ Active\n`;
      
      // Mask phone number
      if (data.data.phone && data.data.phone.includes('@')) {
        result += `<b>• Phone:</b> ${data.data.phone.split('@')[0]}...\n`;
      }
    } else {
      result += `<b>Status:</b> ❌ Not found or inactive\n`;
    }
    
    result += `\n🕒 ${data.timestamp || new Date().toLocaleTimeString()}`;
    
    await sendMessage(chatId, result);
    
  } catch (error) {
    await sendMessage(chatId, `❌ <b>Error fetching FamPay details</b>`);
  }
}

async function handleAadhaarCommand(chatId, userId, args) {
  const user = await getUser(userId);
  
  if (!user?.is_verified) {
    await handleForceJoin(chatId, userId, user);
    return;
  }
  
  if (!user.is_premium) {
    await sendMessage(
      chatId,
      `⭐ <b>Premium Feature!</b>\n\n` +
      `Aadhaar lookup requires premium access.\n\n` +
      `Contact @Ronju360 to upgrade!`
    );
    return;
  }
  
  if (!args || !args.match(/^\d{12}$/)) {
    await sendMessage(
      chatId,
      `🪪 <b>Usage:</b> <code>/aadhaar 413129678885</code>\n\n` +
      `<i>Enter a valid 12-digit Aadhaar number</i>`
    );
    return;
  }
  
  await sendMessage(chatId, `🔍 Searching Aadhaar details...`);
  
  try {
    const data = await fetchAadhaarDetails(args);
    
    let result = `🪪 <b>Aadhaar Details</b>\n\n`;
    result += `<b>Aadhaar:</b> ${args}\n`;
    
    if (data.name !== "N/A") {
      result += `<b>• Name:</b> ${data.name || 'N/A'}\n`;
      result += `<b>• Gender:</b> ${data.gender || 'N/A'}\n`;
      result += `<b>• DOB:</b> ${data.dob || 'N/A'}\n`;
      result += `<b>• Phone:</b> ${data.phone || 'N/A'}\n`;
      result += `<b>• Email:</b> ${data.email || 'N/A'}\n`;
      result += `<b>• Address:</b> ${data.address || 'N/A'}\n`;
    } else {
      result += `<i>Information not publicly available</i>\n`;
    }
    
    result += `\n⚠️ <b>Authorized use only</b>\n`;
    result += `\n🕒 ${data.timestamp || new Date().toLocaleTimeString()}`;
    
    await sendMessage(chatId, result);
    
  } catch (error) {
    await sendMessage(chatId, `❌ <b>Error fetching Aadhaar details</b>`);
  }
}

async function handleStatusCommand(chatId, userId) {
  const user = await getUser(userId);
  
  if (!user) {
    await sendMessage(chatId, `❌ <b>User not found!</b>\nUse <code>/start</code> to begin.`);
    return;
  }
  
  const premiumStatus = user.is_premium ? 
    `✅ <b>Premium Active</b>\nExpires: ${new Date(user.premium_expiry).toLocaleString()}` : 
    `❌ <b>Premium Expired</b>\nContact @Ronju360 to upgrade`;
  
  const statusText = `👤 <b>Account Status</b>\n\n` +
    `<b>User ID:</b> ${user.id}\n` +
    `<b>Name:</b> ${user.first_name || ''} ${user.last_name || ''}\n` +
    `<b>Username:</b> @${user.username || 'N/A'}\n\n` +
    `<b>Premium Status:</b>\n${premiumStatus}\n\n` +
    `<b>API Usage:</b> ${user.api_usage_count || 0} requests\n` +
    `<b>Joined:</b> ${new Date(user.join_date).toLocaleDateString()}\n` +
    `<b>Last Active:</b> ${new Date(user.last_active).toLocaleString()}\n\n` +
    `<b>Verification:</b> ${user.is_verified ? '✅ Verified' : '❌ Not Verified'}`;
  
  await sendMessage(chatId, statusText);
}

// ==================== ADMIN COMMANDS ====================
async function handlePremiumCommand(chatId, userId, args) {
  const user = await getUser(userId);
  const isAdmin = user?.id.toString() === CONFIG.ADMIN_ID;
  
  if (!isAdmin) {
    await sendMessage(chatId, `❌ <b>Admin only command!</b>`);
    return;
  }
  
  if (!args) {
    await sendMessage(
      chatId,
      `👑 <b>Usage:</b> <code>/premium 123456789</code>\n\n` +
      `<i>Grant 30 days premium to a user</i>`
    );
    return;
  }
  
  const targetUserId = parseInt(args);
  const targetUser = await getUser(targetUserId);
  
  if (!targetUser) {
    await sendMessage(chatId, `❌ <b>User ${targetUserId} not found!</b>`);
    return;
  }
  
  // Set premium for 30 days
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + CONFIG.PAID_PREMIUM_DAYS);
  
  targetUser.is_premium = true;
  targetUser.premium_expiry = expiryDate.toISOString();
  await saveUser(targetUser);
  
  // Notify admin
  await sendMessage(
    chatId,
    `✅ <b>Premium Granted!</b>\n\n` +
    `User: ${targetUser.first_name || 'ID: ' + targetUserId}\n` +
    `Premium until: ${expiryDate.toLocaleDateString()}\n` +
    `Granted by: ${user.first_name || 'Admin'}`
  );
  
  // Notify user
  await sendMessage(
    targetUserId,
    `🎉 <b>Premium Activated!</b>\n\n` +
    `You have been granted ${CONFIG.PAID_PREMIUM_DAYS} days of premium access!\n` +
    `Valid until: <b>${expiryDate.toLocaleDateString()}</b>\n\n` +
    `Enjoy unlimited access to all features! 🚀`
  );
}

async function handleBroadcastCommand(chatId, userId, args) {
  const user = await getUser(userId);
  const isAdmin = user?.id.toString() === CONFIG.ADMIN_ID;
  
  if (!isAdmin) {
    await sendMessage(chatId, `❌ <b>Admin only command!</b>`);
    return;
  }
  
  if (!args) {
    await sendMessage(
      chatId,
      `📢 <b>Usage:</b> <code>/broadcast Your message here</code>\n\n` +
      `<i>Send message to all users</i>`
    );
    return;
  }
  
  await sendMessage(chatId, `📢 <b>Broadcasting message...</b>\n\n<i>This may take a moment</i>`);
  
  let sentCount = 0;
  const allKeys = Array.from(kvStore.keys());
  
  for (const key of allKeys) {
    if (key.startsWith('user_')) {
      try {
        const userData = JSON.parse(kvStore.get(key));
        if (userData.id) {
          await sendMessage(
            userData.id,
            `📢 <b>Announcement</b>\n\n${args}\n\n` +
            `<i>From: ${user.first_name || 'Bot Admin'}</i>`
          );
          sentCount++;
          
          // Rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (error) {
        console.error(`Failed to send to ${key}:`, error);
      }
    }
  }
  
  await sendMessage(
    chatId,
    `✅ <b>Broadcast Complete!</b>\n\n` +
    `Message sent to ${sentCount} users\n` +
    `Message: "${args.substring(0, 50)}${args.length > 50 ? '...' : ''}"`
  );
}

async function handleStatsCommand(chatId, userId) {
  const user = await getUser(userId);
  const isAdmin = user?.id.toString() === CONFIG.ADMIN_ID;
  
  if (!isAdmin) {
    await sendMessage(chatId, `❌ <b>Admin only command!</b>`);
    return;
  }
  
  const allKeys = Array.from(kvStore.keys());
  let totalUsers = 0;
  let premiumUsers = 0;
  let verifiedUsers = 0;
  let totalApiCalls = 0;
  
  for (const key of allKeys) {
    if (key.startsWith('user_')) {
      try {
        const userData = JSON.parse(kvStore.get(key));
        totalUsers++;
        
        if (userData.is_premium) premiumUsers++;
        if (userData.is_verified) verifiedUsers++;
        if (userData.api_usage_count) totalApiCalls += userData.api_usage_count;
      } catch (error) {
        console.error(`Error processing ${key}:`, error);
      }
    }
  }
  
  const statsText = `📊 <b>Bot Statistics</b>\n\n` +
    `<b>Total Users:</b> ${totalUsers}\n` +
    `<b>Premium Users:</b> ${premiumUsers} (${Math.round((premiumUsers / totalUsers) * 100) || 0}%)\n` +
    `<b>Verified Users:</b> ${verifiedUsers}\n` +
    `<b>Total API Calls:</b> ${totalApiCalls}\n` +
    `<b>Average per User:</b> ${totalUsers > 0 ? Math.round(totalApiCalls / totalUsers) : 0}\n\n` +
    `<b>Memory Usage:</b> ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB\n` +
    `<b>Uptime:</b> ${process.uptime().toFixed(0)} seconds\n\n` +
    `<b>Last Updated:</b> ${new Date().toLocaleString()}`;
  
  await sendMessage(chatId, statsText);
}

// ==================== MAIN WEBHOOK HANDLER ====================
async function handleWebhook(update) {
  console.log('Received update:', JSON.stringify(update, null, 2));
  
  // Handle callback queries (button clicks)
  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query);
    return new Response('OK', { status: 200 });
  }
  
  // Handle messages
  if (update.message) {
    const message = update.message;
    const chatId = message.chat.id;
    const userId = message.from.id;
    const text = message.text || '';
    
    // Get user
    let user = await getUser(userId);
    if (!user && text.startsWith('/start')) {
      // Allow /start without verification
    } else if (!user || !user.is_verified) {
      // Force join check for other commands
      if (!text.startsWith('/start')) {
        await handleForceJoin(chatId, userId, user || { id: userId });
        return new Response('OK', { status: 200 });
      }
    }
    
    // Update last active
    if (user) {
      user.last_active = new Date().toISOString();
      await saveUser(user);
    }
    
    // Route commands
    if (text.startsWith('/start')) {
      await handleStartCommand(chatId, userId, message);
    }
    else if (text.startsWith('/help')) {
      await handleHelpCommand(chatId, user);
    }
    else if (text.startsWith('/status')) {
      await handleStatusCommand(chatId, userId);
    }
    else if (text.startsWith('/number ')) {
      await handleNumberCommand(chatId, userId, text.split(' ')[1]);
    }
    else if (text.startsWith('/vehicle ')) {
      await handleVehicleCommand(chatId, userId, text.split(' ')[1]);
    }
    else if (text.startsWith('/pincode ')) {
      await handlePincodeCommand(chatId, userId, text.split(' ')[1]);
    }
    else if (text.startsWith('/fampay ')) {
      await handleFampayCommand(chatId, userId, text.split(' ')[1]);
    }
    else if (text.startsWith('/aadhaar ')) {
      await handleAadhaarCommand(chatId, userId, text.split(' ')[1]);
    }
    else if (text.startsWith('/premium ')) {
      await handlePremiumCommand(chatId, userId, text.split(' ')[1]);
    }
    else if (text.startsWith('/broadcast ')) {
      await handleBroadcastCommand(chatId, userId, text.substring(11));
    }
    else if (text.startsWith('/stats')) {
      await handleStatsCommand(chatId, userId);
    }
    else if (text.startsWith('/')) {
      await sendMessage(chatId, `❌ <b>Unknown command!</b>\nUse <code>/help</code> to see available commands.`);
    }
    else if (!user?.is_verified) {
      await handleForceJoin(chatId, userId, user);
    }
    else {
      await sendMessage(
        chatId,
        `🤖 <b>OSINT Bot</b>\n\n` +
        `I can help you lookup information.\n` +
        `Use <code>/help</code> to see all commands.\n\n` +
        `📞 <i>Support: @Ronju360</i>`
      );
    }
    
    return new Response('OK', { status: 200 });
  }
  
  return new Response('OK', { status: 200 });
}

async function handleCallbackQuery(callbackQuery) {
  const data = callbackQuery.data;
  const userId = callbackQuery.from.id;
  const chatId = callbackQuery.message.chat.id;
  
  // Answer callback query
  await answerCallbackQuery(callbackQuery.id, "Processing...", false);
  
  if (data.startsWith('verify_join_')) {
    const targetUserId = data.split('_')[2];
    
    if (parseInt(targetUserId) !== userId) {
      await sendMessage(chatId, `❌ <b>This button is not for you!</b>`);
      return;
    }
    
    const user = await getUser(userId);
    const hasJoined = await checkChannelMembership(userId);
    
    if (hasJoined) {
      user.is_verified = true;
      user.force_join_checked = true;
      await saveUser(user);
      
      await sendMessage(
        chatId,
        `✅ <b>Verification Successful!</b>\n\n` +
        `Welcome to the channel! You can now use all bot features.\n\n` +
        `Use <code>/help</code> to see available commands.`
      );
    } else {
      await sendMessage(
        chatId,
        `❌ <b>Not Joined Yet!</b>\n\n` +
        `I don't see you in the channel. Please:\n` +
        `1. Click the "Join Channel" button\n` +
        `2. Wait a few seconds\n` +
        `3. Click "Check Membership" again`
      );
    }
  }
}

// ==================== UTILITY FUNCTIONS ====================
// Global request object for webhook setup
let request = null;

// Process initialization
if (typeof addEventListener === 'function') {
  addEventListener('fetch', event => {
    request = event.request;
    event.respondWith(handleRequest(event.request));
  });
  }
