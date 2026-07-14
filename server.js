// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createHash } from "node:crypto";
import { preprocessArticleText } from "./preprocess.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

// In-memory audio cache: same article text + voice = same audio, so we only
// pay ElevenLabs once per unique article rather than once per listener.
// Swap this for a persistent store (Redis, disk, S3) once this moves past
// a local prototype — the process restarting clears it.
const audioCache = new Map();

function cacheKeyFor(text, voiceId) {
  return createHash("sha256").update(voiceId + "::" + text).digest("hex");
}

const {
  ELEVENLABS_API_KEY,
  ELEVENLABS_VOICE_ID = "21m00Tcm4TlvDq8ikWAM",
  PORT = 3001,
} = process.env;

if (!ELEVENLABS_API_KEY) {
  console.warn(
    "\n⚠️  No ELEVENLABS_API_KEY found. Copy .env.example to .env and add your key.\n"
  );
}

// Preview endpoint: see the cleaned text without spending API credits.
app.post("/api/preprocess", (req, res) => {
  const { text } = req.body;
  if (!text || typeof text !== "string") {
    return res.status(400).json({ error: "Missing 'text' string in request body." });
  }
  res.json({ cleaned: preprocessArticleText(text) });
});

// Main endpoint: clean the text, send it to ElevenLabs, stream audio back.
app.post("/api/speak", async (req, res) => {
  const { text } = req.body;
  if (!text || typeof text !== "string") {
    return res.status(400).json({ error: "Missing 'text' string in request body." });
  }
  if (!ELEVENLABS_API_KEY) {
    return res.status(500).json({ error: "Server is missing ELEVENLABS_API_KEY." });
  }

  const cleaned = preprocessArticleText(text);
  const cacheKey = cacheKeyFor(cleaned, ELEVENLABS_VOICE_ID);

  const cached = audioCache.get(cacheKey);
  if (cached) {
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("X-HockeyWiz-Cache", "hit");
    return res.send(cached);
  }

  try {
    const elResponse = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}/stream`,
      {
        method: "POST",
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text: cleaned,
          model_id: "eleven_multilingual_v2",
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      }
    );

    if (!elResponse.ok || !elResponse.body) {
      const errText = await elResponse.text();
      console.error("ElevenLabs error:", elResponse.status, errText);
      return res.status(502).json({ error: "ElevenLabs request failed.", detail: errText });
    }

    // Buffer the full response so we can cache it, then serve it.
    const chunks = [];
    for await (const chunk of elResponse.body) chunks.push(chunk);
    const audioBuffer = Buffer.concat(chunks);

    audioCache.set(cacheKey, audioBuffer);

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("X-HockeyWiz-Cache", "miss");
    res.send(audioBuffer);
  } catch (err) {
    console.error("Server error calling ElevenLabs:", err);
    res.status(500).json({ error: "Unexpected server error." });
  }
});

app.listen(PORT, () => {
  console.log(`\n🏒 HockeyWiz TTS PoC running at http://localhost:${PORT}\n`);
});
