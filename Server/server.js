import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import fs from "fs";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const MODEL = process.env.OLLAMA_MODEL || "llama3.2:3b"; // or qwen2.5:3b etc.

app.get("/health", (_req, res) => res.json({ ok: true, model: MODEL }));

// ---- chat proxy (existing)
app.post("/chat", async (req, res) => {
  try {
    const { messages } = req.body || {};
    if (!Array.isArray(messages)) return res.status(400).json({ error: "messages must be an array" });

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Transfer-Encoding", "chunked");

    const r = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, messages, stream: true }),
    });

    if (!r.ok || !r.body) {
      const txt = await r.text().catch(() => "");
      res.write(txt || JSON.stringify({ error: "ollama request failed" }) + "\n");
      return res.end();
    }

    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const txt = decoder.decode(value, { stream: true });
      txt.split("\n").filter(Boolean).forEach((line) => res.write(line + "\n"));
    }
    res.end();
  } catch (e) {
    res.write(JSON.stringify({ error: e?.message || "server error" }) + "\n");
    res.end();
  }
});

/* ---------------- document learning ---------------- */

const upload = multer({ storage: multer.memoryStorage() });

// In-memory store of the most recent doc
let DOC = { chunks: [], embeds: [], embedModel: "nomic-embed-text" };

// chunk helper
function chunkText(text, chunkSize = 1300, overlap = 200) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const end = Math.min(i + chunkSize, text.length);
    out.push(text.slice(i, end));
    i = end - overlap;
    if (i < 0) i = 0;
  }
  return out.filter((s) => s.trim().length > 0);
}

// cosine similarity
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8);
}

// embed texts with Ollama
async function embedBatch(texts) {
  const res = [];
  for (const t of texts) {
    const r = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: DOC.embedModel, prompt: t }),
    });
    if (!r.ok) throw new Error("embedding request failed");
    const j = await r.json();
    res.push(j.embedding);
  }
  return res;
}

// Upload: extract -> chunk -> embed
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "no file" });

    let text = "";
    if (req.file.mimetype === "application/pdf") {
      const parsed = await pdfParse(req.file.buffer);
      text = parsed.text || "";
    } else if (
      req.file.mimetype ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      const { value } = await mammoth.extractRawText({ buffer: req.file.buffer });
      text = value || "";
    } else if (req.file.mimetype.startsWith("text/")) {
      text = req.file.buffer.toString("utf8");
    } else {
      return res.status(415).json({ error: "unsupported file type" });
    }

    const chunks = chunkText(text);
    DOC.chunks = chunks;
    DOC.embeds = await embedBatch(chunks);
    fs.writeFileSync("./latest_doc.json", JSON.stringify({ chunksCount: chunks.length }, null, 2));

    res.json({ ok: true, chunks: chunks.length });
  } catch (e) {
    res.status(500).json({ error: e.message || "upload failed" });
  }
});

// Teach or Quiz using retrieval on uploaded doc
// body: { query: string, mode?: "lesson" | "quiz" }
app.post("/teach", async (req, res) => {
  try {
    const { query, mode = "lesson" } = req.body || {};
    if (!query) return res.status(400).json({ error: "missing query" });
    if (!DOC.chunks.length) return res.status(400).json({ error: "no document uploaded" });

    // embed the query
    const er = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: DOC.embedModel, prompt: query }),
    });
    if (!er.ok) throw new Error("embedding query failed");
    const ej = await er.json();
    const qvec = ej.embedding;

    // top 5 chunks
    const scored = DOC.embeds.map((v, i) => ({ i, score: cosine(qvec, v) }))
      .sort((a,b)=>b.score-a.score).slice(0,5);
    const context = scored.map(s => DOC.chunks[s.i]).join("\n---\n");

    const system = `You are LearnPlay, a playful tutor. Always:
1) Start with an analogy.
2) Give 3 bullet core ideas.
3) Provide one worked example from the provided context.
4) Ask exactly one check question.
Use ONLY the provided "Source Excerpts". Simplify aggressively.`;

    const lessonUser = `User query: ${query}

Source Excerpts (use these to teach):
${context}`;

    const quizUser = `From the Source Excerpts, generate STRICT JSON ONLY with 3 questions:
{"questions":[
 {"type":"mcq","q":"...", "options":["A) ...","B) ...","C) ...","D) ..."], "answer":"B"},
 {"type":"short","q":"...", "answer":"..."},
 {"type":"explain","q":"...", "rubric":["keyword1","keyword2"]}
]}
No text outside JSON.

Source Excerpts:
${context}`;

    const messages = [
      { role: "system", content: system },
      { role: "user", content: mode === "quiz" ? quizUser : lessonUser },
    ];

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Transfer-Encoding", "chunked");

    const r = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, messages, stream: true }),
    });

    if (!r.ok || !r.body) {
      const txt = await r.text().catch(() => "");
      res.write(txt || JSON.stringify({ error: "ollama request failed" }) + "\n");
      return res.end();
    }

    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const txt = decoder.decode(value, { stream: true });
      txt.split("\n").filter(Boolean).forEach((line) => res.write(line + "\n"));
    }
    res.end();
  } catch (e) {
    res.status(500).json({ error: e.message || "teach failed" });
  }
});

const port = Number(process.env.PORT || 5179);
app.listen(port, () => console.log(`Server running → http://localhost:${port}`));
