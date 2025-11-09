import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const MODEL = process.env.OLLAMA_MODEL || "qwen2.5:3b";

app.get("/health", async (_req, res) => {
  res.json({ ok: true, model: MODEL });
});

// POST /chat  body: { messages: [{role, content}], stream?: true }
app.post("/chat", async (req, res) => {
  try {
    const { messages } = req.body || {};
    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: "messages must be an array" });
    }

    // prepare streaming response
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Transfer-Encoding", "chunked");

    const r = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages,
        stream: true,
      }),
    });

    if (!r.ok || !r.body) {
      res.write(JSON.stringify({ error: "ollama request failed" }) + "\n");
      return res.end();
    }

    const reader = r.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const txt = decoder.decode(value, { stream: true });

      // Ollama sends JSON lines; forward them line-by-line
      txt.split("\n").filter(Boolean).forEach((line) => {
        res.write(line + "\n");
      });
    }
    res.end();
  } catch (e) {
    res.write(JSON.stringify({ error: e?.message || "server error" }) + "\n");
    res.end();
  }
});

const port = Number(process.env.PORT || 5179);
app.listen(port, () =>
  console.log(`Server running → http://localhost:${port}`)
);
