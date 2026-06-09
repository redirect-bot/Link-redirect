import express from 'express';
import useragent from 'express-useragent';
import axios from 'axios';

const app = express();
app.use(useragent.express())
const PORT = 3000;


const urlDatabase = {};

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
        // If the link exists, forward them instantly
        res.redirect(realUrl);
        sendTelegramAlert(slug, req.useragent); // Triggers in the background
    } else {
        // If it doesn't exist, send an error message
        res.status(404).send('Link not found!');
    }
});

// Turn on the server 🔌
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});













async function sendTelegramAlert(slug, ua) {
    const token = process.env.TELEGRAM_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    
    // Construct a clean, readable text message 📝
    const message = `🚨 *Link Clicked!*\n\n` +
                    `🔗 *Slug:* /${slug}\n` +
                    `📱 *Device:* ${ua.isMobile ? 'Mobile' : ua.isTablet ? 'Tablet' : 'Desktop'}\n` +
                    `🌐 *Browser:* ${ua.browser}\n` +
                    `💻 *OS:* ${ua.os}`;

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