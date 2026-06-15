require("dotenv").config();

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const path = require("path");

const app = express();

// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: "1mb" }));          // FIX: guard against huge payloads
app.use(express.static(path.join(__dirname)));      // FIX: use absolute path for static files

// ─── API Key Validation ───────────────────────────────────────────────────────
if (!process.env.OPENAI_API_KEY) {
    console.error("❌  OPENAI_API_KEY missing in .env file");
    process.exit(1);
}

// ─── Client Configuration ─────────────────────────────────────────────────────
// Detect if using OpenRouter key (sk-or-v1-…) and configure accordingly
const isOpenRouter = process.env.OPENAI_API_KEY.startsWith("sk-or-");

const clientConfig = {
    apiKey: process.env.OPENAI_API_KEY,
};

if (isOpenRouter) {
    clientConfig.baseURL = "https://openrouter.ai/api/v1";
    clientConfig.defaultHeaders = {
        "HTTP-Referer": process.env.SITE_URL  || "http://localhost:3000",
        "X-Title":      process.env.SITE_NAME || "CareerPath AI",
    };
}

const client = new OpenAI(clientConfig);

// ─── Chat Endpoint ────────────────────────────────────────────────────────────
app.post("/api/chat", async (req, res) => {
    try {
        const { messages } = req.body;

        // Input validation
        if (!Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({
                error: "Invalid request: 'messages' must be a non-empty array."
            });
        }

        // FIX: validate each message object so the upstream call never receives garbage
        for (const msg of messages) {
            if (!msg || typeof msg.role !== "string" || typeof msg.content !== "string") {
                return res.status(400).json({
                    error: "Each message must have a 'role' (string) and 'content' (string)."
                });
            }
            // FIX: only allow known roles to prevent prompt-injection via role spoofing
            if (!["system", "user", "assistant"].includes(msg.role)) {
                return res.status(400).json({
                    error: `Unknown role '${msg.role}'. Allowed: system, user, assistant.`
                });
            }
        }

        // FIX: cap conversation to last 30 messages (system prompt + 29 turns)
        //      to avoid exceeding model context limits and runaway token costs.
        const systemMessages = messages.filter(m => m.role === "system");
        const nonSystemMessages = messages.filter(m => m.role !== "system");
        const trimmedMessages = [
            ...systemMessages,
            ...nonSystemMessages.slice(-29),
        ];

        const completion = await client.chat.completions.create({
            model:       isOpenRouter ? "openai/gpt-4o-mini" : "gpt-4o-mini",
            messages:    trimmedMessages,
            max_tokens:  1024,          // FIX: always set a max_tokens ceiling
            temperature: 0.7,
        });

        const reply = completion.choices?.[0]?.message?.content;

        // FIX: handle edge-case where API returns an empty choice list
        if (!reply) {
            return res.status(502).json({ error: "The AI returned an empty response. Please try again." });
        }

        res.json({ reply });

    } catch (err) {
        console.error("API Error:", err);

        // FIX: distinguish auth errors from generic 500s
        const status = err.status || err.statusCode || 500;
        const message =
            status === 401 ? "Invalid API key. Check your .env file." :
            status === 429 ? "Rate limit reached. Please wait a moment and try again." :
            status === 503 ? "The AI service is temporarily unavailable. Please try again shortly." :
            (err.message || "An unexpected error occurred.");

        res.status(status).json({ error: message });
    }
});

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
    res.json({
        status:   "ok",
        provider: isOpenRouter ? "OpenRouter" : "OpenAI",
        model:    isOpenRouter ? "openai/gpt-4o-mini" : "gpt-4o-mini",
    });
});

// ─── 404 Fallback (SPA) ───────────────────────────────────────────────────────
// FIX: send index.html for any unmatched route so the app works as a proper SPA
app.use((_req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT, 10) || 3000;   // FIX: parseInt prevents string PORT issues
app.listen(PORT, () => {
    console.log(`✅  Server running  →  http://localhost:${PORT}`);
    if (isOpenRouter) {
        console.log("🔀  Using OpenRouter as API provider");
    }
});
