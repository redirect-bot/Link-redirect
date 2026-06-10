import express from 'express';
import useragent from 'express-useragent';
import axios from 'axios';

const app = express();
app.use(useragent.express())
const PORT = 3000;


const urlDatabase = {};
const clickDatabase = {};

app.get('/shorten', (req, res) => {
    const slug = req.query.slug;
    const url = req.query.url;

    // Safety check: Make sure both pieces of info exist
    if (!slug || !url) {
        return res.status(400).send('Error: Please provide both ?slug= and ?url=');
    }

    // Save the link pair to our dictionary
    urlDatabase[slug] = url;

    res.send(`Success! Short link created: http://localhost:3000/${slug}`);
});

// The redirect route 🧭
app.get('/:slug', (req, res) => {
    const slug = req.params.slug;
    const realUrl = urlDatabase[slug];

    if (realUrl) {
        // 🌐 Extract visitor details
        const forwardedIps = req.headers['x-forwarded-for'];
        const visitorIp = forwardedIps ? forwardedIps.split(',')[0].trim() : req.socket.remoteAddress;
        const visitorAgent = req.headers['user-agent'];

        // 🔢 Update the click counter
        if (clickDatabase[slug]) {
            clickDatabase[slug]++;
        } else {
            clickDatabase[slug] = 1;
        }

        // 🚀 Forward the user instantly
        res.redirect(realUrl);

        // 📢 Send all data to the alert function
        sendTelegramAlert(slug, visitorIp, visitorAgent, clickDatabase[slug]); 
    } else {
        res.status(404).send('Link not found!');
    }
});

// Turn on the server 🔌
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});













async function sendTelegramAlert(slug, visitorIp, visitorAgent, clickCount) {
    const token = process.env.TELEGRAM_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    
    // Construct a clean, readable text message 📝
    const message = `🚨 *Link Clicked!*\n\n` +
                    `🔗 *Link:* /${slug}\n` +
                    `🔢 *Total Clicks:* ${clickCount}\n` +
                    `🌐 *IP Address:* ${visitorIp}\n` +
                    `📱 *User Agent:* \`${visitorAgent}\``;

    const telegramUrl = `https://api.telegram.org/bot${token}/sendMessage`;
    
    try {
        // Send the request to Telegram via Axios 🛰️
        await axios.post(telegramUrl, {
            chat_id: chatId,
            text: message,
            parse_mode: 'Markdown'
        });
    } catch (error) {
        console.error('Telegram notification failed:', error.message);
    }
}