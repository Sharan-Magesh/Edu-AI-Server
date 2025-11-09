import React, { useEffect, useRef, useState } from "react";

/* ---------- config ---------- */
const API_URL = "http://localhost:5179/chat";

const SYSTEM_PROMPT = `You are LearnPlay, a playful tutor. Teach with (1) analogy first,
(2) concise core idea in 3 bullets, (3) one worked example,
(4) a 1-question check. Keep answers under 180 words unless user asks for more.
Never dump definitions before the analogy. Ask exactly one check question.`;

/* ---------- helpers ---------- */
async function postStream(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res;
}

async function uploadFile(file) {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("http://localhost:5179/upload", {
    method: "POST",
    body: fd,
  });
  return res.json();
}

function maskAnswersForDisplay(text) {
  // strip possible markdown fences and hide answers in any JSON the model prints
  return text
    .replace(/```json|```/gi, "")
    .replace(/("answer"\s*:\s*")([^"]*)(")/gi, '$1(hidden)$3')
    .replace(/("correct_answer"\s*:\s*")([^"]*)(")/gi, '$1(hidden)$3');
}

function evaluateAnswer(question, userAnswer) {
  if (!question || !userAnswer) return false;
  if (question.type === "mcq") {
    return userAnswer.trim().toUpperCase() === String(question.answer).trim().toUpperCase();
  }
  if (question.type === "short") {
    return userAnswer.trim().toLowerCase() === String(question.answer).trim().toLowerCase();
  }
  if (question.type === "explain") {
    const text = userAnswer.toLowerCase();
    const rub = Array.isArray(question.rubric) ? question.rubric : [];
    return rub.some((k) => text.includes(String(k).toLowerCase()));
  }
  return false;
}

/* ---------- small UI pieces ---------- */
function Bubble({ role, children }) {
  const isUser = role === "user";
  return (
    <div
      style={{
        maxWidth: "85%",
        padding: "12px 14px",
        borderRadius: 16,
        margin: isUser ? "8px 0 8px auto" : "8px 0",
        background: isUser ? "rgba(99,102,241,0.25)" : "rgba(255,255,255,0.08)",
        border: isUser ? "1px solid rgba(99,102,241,0.45)" : "1px solid rgba(255,255,255,0.08)",
        whiteSpace: "pre-wrap",
      }}
    >
      <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 6 }}>
        {isUser ? "You" : "LearnPlay"}
      </div>
      {children}
    </div>
  );
}

function QuizQuestion({ q, index, onScored }) {
  const [userAns, setUserAns] = useState("");
  const [result, setResult] = useState(null);

  function check() {
    const correct = evaluateAnswer(q, userAns);
    setResult(correct);

    // update progress in localStorage
    const progress = JSON.parse(localStorage.getItem("progress") || "{}");
    progress.total = (progress.total || 0) + 1;
    progress.correct = (progress.correct || 0) + (correct ? 1 : 0);
    localStorage.setItem("progress", JSON.stringify(progress));
    onScored?.(); // ask parent to re-render
  }

  return (
    <div style={{ marginBottom: 12, padding: 10, borderRadius: 10, background: "rgba(255,255,255,0.05)" }}>
      <b>Q{index + 1}:</b> {q.q || q.question}
      {q.type === "mcq" && Array.isArray(q.options) && (
        <ul style={{ listStyle: "none", paddingLeft: 0, marginTop: 6 }}>
          {q.options.map((o, j) => (
            <li key={j}>{o}</li>
          ))}
        </ul>
      )}
      <input
        value={userAns}
        onChange={(e) => setUserAns(e.target.value)}
        placeholder="Your answer (e.g., A, 22, or a sentence)"
        style={{ marginTop: 8, width: "100%", padding: 8, borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.08)", color: "white" }}
      />
      <button onClick={check} style={{ marginTop: 8, padding: "8px 12px", borderRadius: 10, fontWeight: 700, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(99,102,241,0.9)" }}>
        Check
      </button>
      {result !== null && (
        <div style={{ marginTop: 6, color: result ? "lightgreen" : "salmon" }}>
          {result ? "✅ Correct!" : `❌ Wrong! (Answer: ${q.answer ?? q.correct_answer})`}
        </div>
      )}
    </div>
  );
}

/* ---------- main app ---------- */
export default function App() {
  const [topic, setTopic] = useState("");
  const [messages, setMessages] = useState([{ role: "system", content: SYSTEM_PROMPT }]);
  const [userInput, setUserInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [quiz, setQuiz] = useState(() => {
    const s = localStorage.getItem("quiz");
    return s ? JSON.parse(s) : null;
  });
  const [tick, setTick] = useState(0); // force re-render when progress changes
  const viewRef = useRef(null);

  useEffect(() => {
    viewRef.current?.scrollTo({ top: viewRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function send(content) {
    const next = [...messages, { role: "user", content }];
    setMessages(next);
    setLoading(true);

    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: next, stream: true }),
    });

    // placeholder for streaming assistant message
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
    const assistantIndex = next.length;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    let accRaw = ""; // real text (with answers)
    let accMasked = ""; // UI-masked version

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      const lines = chunk.split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const j = JSON.parse(line);
          if (j?.message?.content) {
            accRaw += j.message.content;
            accMasked = maskAnswersForDisplay(accRaw);
            setMessages((prev) => {
              const copy = [...prev];
              copy[assistantIndex] = { role: "assistant", content: accMasked };
              return copy;
            });
          }
        } catch {
          // ignore partial lines
        }
      }
    }

    // Try to parse quiz JSON from RAW text (not the masked one)
    try {
      const raw = accRaw.trim();
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      if (start !== -1 && end !== -1 && end > start) {
        const jsonText = raw.slice(start, end + 1);
        const parsed = JSON.parse(jsonText);
        if (parsed?.questions?.length) {
          localStorage.setItem("quiz", JSON.stringify(parsed.questions));
          setQuiz(parsed.questions);
        }
      }
    } catch {
      // ignore non-JSON replies
    }

    setLoading(false);
  }

  // ---------- Document teaching functions ----------

// helper to stream results into messages
  async function streamToMessages(res) {
   setMessages(prev => [...prev, { role: "assistant", content: "" }]);
   const assistantIndex = messages.length;

   const reader = res.body.getReader();
   const decoder = new TextDecoder();
   let accRaw = "", accMasked = "";

   while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value);
    const lines = chunk.split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const j = JSON.parse(line);
        if (j?.message?.content) {
          accRaw += j.message.content;
          accMasked = maskAnswersForDisplay(accRaw);
          setMessages(prev => {
            const copy = [...prev];
            copy[assistantIndex] = { role: "assistant", content: accMasked };
            return copy;
          });
        }
      } catch {}
    }
  }

  // try parsing JSON quiz data
   try {
    const raw = accRaw.trim();
    const s = raw.indexOf("{"), e = raw.lastIndexOf("}");
    if (s !== -1 && e !== -1 && e > s) {
      const jsonText = raw.slice(s, e + 1);
      const parsed = JSON.parse(jsonText);
      if (parsed?.questions?.length) {
        localStorage.setItem("quiz", JSON.stringify(parsed.questions));
        setQuiz(parsed.questions);
      }
    }
  } catch {}
}

// send doc -> teach mode
  async function sendDocTeach(prompt) {
  setMessages(prev => [...prev, { role: "user", content: prompt }]);
  setLoading(true);
  const res = await postStream("http://localhost:5179/teach", { query: prompt, mode: "lesson" });
  await streamToMessages(res);
  setLoading(false);
}

// send doc -> quiz mode
async function sendDocQuiz(prompt) {
  setMessages(prev => [...prev, { role: "user", content: prompt }]);
  setLoading(true);
  const res = await postStream("http://localhost:5179/teach", { query: prompt, mode: "quiz" });
  await streamToMessages(res);
  setLoading(false);
}


  function startExplain() {
    if (!topic.trim()) return;
    send(`Explain "${topic}" with analogy-first teaching and include one check question at the end.`);
    localStorage.setItem("learnplay_topic", topic);
  }

  const progress = JSON.parse(localStorage.getItem("progress") || "{}");

  return (
    <div
      style={{
        minHeight: "100vh",
        color: "white",
        background: "linear-gradient(135deg, #7c3aed 0%, #4338ca 40%, #0f172a 100%)",
      }}
    >
      <div style={{ maxWidth: 960, margin: "0 auto", padding: 16 }}>
        {/* header */}
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 12,
          }}
        >
          <h1 style={{ fontWeight: 800, letterSpacing: 0.5 }}>
            Learn<span style={{ color: "#f0abfc" }}>Play</span>
          </h1>
          <div
            style={{
              padding: "6px 10px",
              borderRadius: 999,
              fontSize: 12,
              background: loading ? "rgba(16,185,129,0.35)" : "rgba(16,185,129,0.15)",
              border: "1px solid rgba(16,185,129,0.45)",
            }}
          >
            {loading ? "Thinking…" : "Ready"}
          </div>
        </header>

        {/* progress tracker */}
        <p style={{ fontSize: 12, opacity: 0.8, marginBottom: 8 }}>
          🏅 Score: {progress.correct || 0}/{progress.total || 0}
        </p>

        {/* two-column layout */}
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "320px 1fr" }}>
          {/* left controls */}
          <aside
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 16,
              padding: 14,
              backdropFilter: "blur(6px)",
            }}
          >
            <label style={{ fontSize: 12, opacity: 0.8 }}>Topic</label>
            {/* ---- Document Upload ---- */}
<label style={{ fontSize: 12, opacity: 0.8 }}>Upload PDF/DOCX/TXT</label>
<input
  type="file"
  accept=".pdf,.docx,.txt"
  onChange={async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = await uploadFile(f);       // uses the helper function
    if (r.ok) {
      alert(`✅ Document processed (${r.chunks} chunks). Now use “Teach Doc” or “Quiz from Doc”.`);
    } else {
      alert("Upload failed: " + (r.error || "unknown error"));
    }
  }}
  style={{
    width: "100%",
    marginTop: 6,
    marginBottom: 10,
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.15)",
    background: "rgba(255,255,255,0.08)",
    color: "white",
  }}
/>

    <div style={{ display: "grid", gap: 8, marginTop: 6 }}>
    <button
    onClick={() =>
      sendDocTeach(
        "Teach this document in analogy-first style with one worked example and a check question."
      )
     }
     style={{
      width: "100%",
      padding: "10px 12px",
      borderRadius: 12,
      border: "1px solid rgba(255,255,255,0.15)",
      background: "rgba(255,255,255,0.08)",
     }}
  >
     Teach Doc
    </button>
    <button
     onClick={() =>
      sendDocQuiz("Generate a 3-question quiz from this document (strict JSON).")
    }
    style={{
      width: "100%",
      padding: "10px 12px",
      borderRadius: 12,
      border: "1px solid rgba(255,255,255,0.15)",
      background: "rgba(255,255,255,0.08)",
    }}
   >
     Quiz from Doc
    </button>
    </div>

    <hr style={{ margin: "12px 0", opacity: 0.2 }} />

            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder='e.g., "Backpropagation" or "Eigenvalues"'
              style={{
                width: "100%",
                marginTop: 6,
                marginBottom: 10,
                padding: "10px 12px",
                borderRadius: 10,
                outline: "none",
                border: "1px solid rgba(255,255,255,0.15)",
                background: "rgba(255,255,255,0.08)",
                color: "white",
              }}
            />
            <button
              onClick={startExplain}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 12,
                fontWeight: 700,
                border: "1px solid rgba(255,255,255,0.15)",
                background: "linear-gradient(90deg, rgba(217,70,239,0.9), rgba(244,63,94,0.9))",
              }}
            >
              Teach Me
            </button>

            <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
              <button
                onClick={() =>
                  send(
                    `Create a short co-relation mapping for "${topic || "my topic"}" to badminton or cooking, include a 2-row table and ask one reflection question.`
                  )
                }
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.15)",
                  background: "rgba(255,255,255,0.08)",
                }}
              >
                Co-Relate
              </button>
              <button
                onClick={() =>
                  send(
                    `Create 3 questions for "${topic || "my topic"}".
Return STRICT JSON ONLY (no markdown fences).
Schema:
{"questions":[
 {"type":"mcq","q":"...", "options":["A) ...","B) ...","C) ...","D) ..."], "answer":"B"},
 {"type":"short","q":"...", "answer":"..."},
 {"type":"explain","q":"...", "rubric":["keyword1","keyword2"]}
]}
Do not add commentary. Do not include any text outside the JSON.`
                  )
                }
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.15)",
                  background: "rgba(255,255,255,0.08)",
                }}
              >
                Quiz Me
              </button>
              <button
                onClick={() =>
                  send(
                    `Make it fun: turn "${topic || "my topic"}" into a 120-word playful scene with one micro-challenge at the end.`
                  )
                }
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.15)",
                  background: "rgba(255,255,255,0.08)",
                }}
              >
                Make It Fun
              </button>
            </div>

            <p style={{ fontSize: 12, opacity: 0.7, marginTop: 12 }}>
              Model: local Ollama • Streams in real-time
            </p>
          </aside>

          {/* right chat + quiz */}
          <main
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 16,
              padding: 14,
              display: "flex",
              flexDirection: "column",
              backdropFilter: "blur(6px)",
            }}
          >
            {/* chat window */}
            <div ref={viewRef} style={{ flex: 1, overflowY: "auto", paddingRight: 4 }}>
              {messages
                .filter((m) => m.role !== "system")
                .map((m, i) => (
                  <Bubble key={i} role={m.role}>
                    {m.content}
                  </Bubble>
                ))}
              {loading && <div style={{ opacity: 0.7, fontSize: 14 }}>…streaming</div>}
            </div>

            {/* input row */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!userInput.trim()) return;
                send(userInput);
                setUserInput("");
              }}
              style={{ display: "flex", gap: 8, marginTop: 8 }}
            >
              <input
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                placeholder="Ask or answer the check question…"
                style={{
                  flex: 1,
                  padding: "10px 12px",
                  borderRadius: 12,
                  outline: "none",
                  border: "1px solid rgba(255,255,255,0.15)",
                  background: "rgba(255,255,255,0.08)",
                  color: "white",
                }}
              />
              <button
                style={{
                  padding: "10px 16px",
                  borderRadius: 12,
                  fontWeight: 700,
                  border: "1px solid rgba(255,255,255,0.15)",
                  background: "rgba(99,102,241,0.9)",
                }}
              >
                Send
              </button>
            </form>

            {/* quiz section */}
            {Array.isArray(quiz) && quiz.length > 0 && (
              <div
                style={{
                  marginTop: 16,
                  borderTop: "1px solid rgba(255,255,255,0.1)",
                  paddingTop: 12,
                }}
              >
                <h3 style={{ fontSize: 16, marginBottom: 8 }}>📘 Quiz Time</h3>
                {quiz.map((q, i) => (
                  <QuizQuestion key={i} index={i} q={q} onScored={() => setTick((t) => t + 1)} />
                ))}
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
