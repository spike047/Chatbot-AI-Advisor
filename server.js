require("dotenv").config();

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// Check API Key
if (!process.env.OPENAI_API_KEY) {
    console.log("❌ OPENAI_API_KEY missing in .env file");
    process.exit(1);
}

// Detect if using OpenRouter key (sk-or-v1-...) and configure accordingly
const isOpenRouter = process.env.OPENAI_API_KEY.startsWith("sk-or-");

const clientConfig = {
    apiKey: process.env.OPENAI_API_KEY,
};

if (isOpenRouter) {
    clientConfig.baseURL = "https://openrouter.ai/api/v1";
    clientConfig.defaultHeaders = {
        "HTTP-Referer": process.env.SITE_URL || "http://localhost:3000",
        "X-Title": process.env.SITE_NAME || "CareerPath AI",
    };
}

const client = new OpenAI(clientConfig);

// Chat API
app.post("/api/chat", async (req, res) => {
    try {
        const { messages } = req.body;

        // Input validation
        if (!messages || !Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({
                error: "Invalid request: 'messages' must be a non-empty array."
            });
        }

        const completion = await client.chat.completions.create({
            model: isOpenRouter ? "openai/gpt-4o-mini" : "gpt-4o-mini",
            messages: messages,
        });

        res.json({
            reply: completion.choices[0].message.content,
        });

    } catch (err) {
        console.error("OpenAI Error:", err);

        // Return a meaningful error status code
        const status = err.status || err.statusCode || 500;
        res.status(status).json({
            error: err.message || "An unexpected error occurred.",
        });
    }
});

// Health check endpoint
app.get("/api/health", (req, res) => {
    res.json({ status: "ok", provider: isOpenRouter ? "OpenRouter" : "OpenAI" });
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
    if (isOpenRouter) {
        console.log("🔀 Using OpenRouter as API provider");
    }
});
