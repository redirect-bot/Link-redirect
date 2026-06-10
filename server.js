import express from 'express';
import useragent from 'express-useragent';
import axios from 'axios';

const app = express();
app.use(useragent.express())
const PORT = 3000;


import mongoose from 'mongoose';

// Connect to MongoDB using the environment variable
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('📁 Connected to MongoDB successfully!'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// 📝 Define the blueprint for our link data
const linkSchema = new mongoose.Schema({
    slug: { type: String, required: true, unique: true },
    realUrl: { type: String, required: true },
    clicks: { type: Number, default: 0 }
});

// Create the data model based on the schema
const Link = mongoose.model('Link', linkSchema);


app.get('/shorten', async (req, res) => {
    const slug = req.query.slug;
    const url = req.query.url;

    // Safety check: Make sure both pieces of info exist
    if (!slug || !url) {
        return res.status(400).send('Error: Please provide both ?slug= and ?url=');
    }

    try {
        // 💾 Save or update the link pair in MongoDB
        // upsert: true creates a new document if the slug doesn't exist yet
        await Link.findOneAndUpdate(
            { slug: slug }, 
            { realUrl: url, clicks: 0 }, // Reset clicks to 0 if updating/creating
            { upsert: true, new: true }
        );

        // 🌐 Dynamically get the current host (works for both localhost and Render)
        const host = req.get('host');
        const protocol = req.protocol; // http or https
        
        res.send(`Success! Short link created: ${protocol}://${host}/${slug}`);
    } catch (error) {
        console.error('❌ Error saving link to database:', error);
        res.status(500).send('Internal Server Error');
    }
});

// The redirect route 🧭
app.get('/:slug', async (req, res) => {
    const slug = req.params.slug;

    try {
        // 🔍 Look for the slug in the MongoDB database
        const linkData = await Link.findOne({ slug: slug });

        if (linkData) {
            // 🕵️‍♂️ Extract ONLY the first IP address from the chain
            const forwardedIps = req.headers['x-forwarded-for'];
            const visitorIp = forwardedIps ? forwardedIps.split(',')[0].trim() : req.socket.remoteAddress;
            const visitorAgent = req.headers['user-agent'];

            // 🔢 Increment the click counter in the database and save it
            linkData.clicks++;
            await linkData.save();

            // 🚀 Forward the user instantly
            res.redirect(linkData.realUrl);

            // 📢 Send clean data to your Telegram alert function
            sendTelegramAlert(slug, visitorIp, visitorAgent, linkData.clicks); 
        } else {
            res.status(404).send('Link not found!');
        }
    } catch (error) {
        console.error('Error handling redirect:', error);
        res.status(500).send('Internal Server Error');
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