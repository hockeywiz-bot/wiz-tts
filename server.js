// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { preprocessArticleText } from "./preprocess.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

// ---- Persistent audio cache -------------------------------------------------
// Same article text + voice = same audio, so we only pay ElevenLabs once per
// unique article, not once per listener. Audio is written to disk so it
// survives the process restarting (Render's free tier spins down after
// inactivity and restarts on the next request) — an in-memory-only cache
// would silently re-bill ElevenLabs after every spin-down.
//
// Honest limitation: this is still local disk, not a remote store. Render's
// free/starter disk persists across restarts but is wiped on a fresh
// deploy (pushing new code). For a real paying client, swap CACHE_DIR reads/
// writes below for S3-compatible storage or Render's persistent disk add-on
// so cached audio survives deploys too — worth doing before onboarding an
// actual client, not urgent for solo testing.
const CACHE_DIR = path.join(process.cwd(), "audio-cache");
const memoryCache = new Map(); // hot in-process cache layer, avoids a disk read on every repeat play within the same session

async function ensureCacheDir() {
  await fs.mkdir(CACHE_DIR, { recursive: true });
}

function cacheKeyFor(text, voiceId) {
  return createHash("sha256").update(voiceId + "::" + text).digest("hex");
}

function cachePathFor(key) {
  return path.join(CACHE_DIR, `${key}.mp3`);
}

async function readFromCache(key) {
  if (memoryCache.has(key)) return memoryCache.get(key);
  try {
    const buffer = await fs.readFile(cachePathFor(key));
    memoryCache.set(key, buffer); // promote to memory for next time
    return buffer;
  } catch {
    return null; // not cached yet — ENOENT is the expected/normal case here
  }
}

async function writeToCache(key, buffer) {
  memoryCache.set(key, buffer);
  try {
    await fs.writeFile(cachePathFor(key), buffer);
  } catch (err) {
    // Disk write failing shouldn't break the response — the listener still
    // gets their audio, we just won't have a persistent copy for next time.
    console.error("Cache write failed (non-fatal):", err.message);
  }
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

  const cached = await readFromCache(cacheKey);
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

    await writeToCache(cacheKey, audioBuffer);

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("X-HockeyWiz-Cache", "miss");
    res.send(audioBuffer);
  } catch (err) {
    console.error("Server error calling ElevenLabs:", err);
    res.status(500).json({ error: "Unexpected server error." });
  }
});

app.listen(PORT, async () => {
  await ensureCacheDir();
  console.log(`\n🏒 HockeyWiz TTS PoC running at http://localhost:${PORT}\n`);
});
