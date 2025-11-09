import React, { useEffect, useRef, useState } from "react";
import "./app.css";

/* ---------- endpoints ---------- */
const CHAT_URL = "http://localhost:5179/chat";
const TEACH_URL = "http://localhost:5179/teach";
const UPLOAD_URL = "http://localhost:5179/upload";
const CLEAR_DOC_URL = "http://localhost:5179/clear-doc";

/* ---------- tutor system prompt ---------- */
const SYSTEM_PROMPT = `You are LearnPlay, a playful tutor. Teach with (1) analogy first,
(2) concise core idea in 3 bullets, (3) one worked example,
(4) a 1-question check. Keep answers under 180 words unless user asks for more.
Never dump definitions before the analogy. Ask exactly one check question.`;

/* ---------- helpers ---------- */
function maskAnswersForDisplay(text) {
  return text
    .replace(/```json|```/gi, "")
    .replace(/("answer"\\s*:\\s*")([^"]*)(")/gi, '$1(hidden)$3')
    .replace(/("correct_answer"\\s*:\\s*")([^"]*)(")/gi, '$1(hidden)$3');
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
  const res = await fetch(UPLOAD_URL, { method: "POST", body: fd });
  return res.json();
}

/* ---------- UI Components ---------- */
function Bubble({ role, children }) {
  const isUser = role === "user";
  return (
    <div className={`message-bubble ${isUser ? "user-message" : "assistant-message"}`}>
      <div className="avatar-container">
        <div className={`avatar ${isUser ? "user-avatar" : "assistant-avatar"}`}>
          {isUser ? "🧑" : "🤖"}
        </div>
      </div>
      <div className="message-content">{children}</div>
    </div>
  );
}

function QuizQuestion({ q, index, onScored }) {
  const [userAns, setUserAns] = useState("");
  const [result, setResult] = useState(null);

  function check() {
    const correct = evaluateAnswer(q, userAns);
    setResult(correct);

    const progress = JSON.parse(localStorage.getItem("progress") || "{}");
    progress.total = (progress.total || 0) + 1;
    progress.correct = (progress.correct || 0) + (correct ? 1 : 0);
    localStorage.setItem("progress", JSON.stringify(progress));
    onScored?.();
  }

  return (
    <div className="quiz-question">
      <div className="question-header">
        <span className="question-number">Q{index + 1}</span>
      </div>
      <p className="question-text">{q.q || q.question}</p>
      {q.type === "mcq" && Array.isArray(q.options) && (
        <ul className="quiz-options">
          {q.options.map((o, j) => (
            <li key={j} className="quiz-option-item">
              <div className="option-marker"></div> {o}
            </li>
          ))}
        </ul>
      )}
      <input
        value={userAns}
        onChange={(e) => setUserAns(e.target.value)}
        placeholder="Your answer (e.g., A, 22, or a sentence)"
        className="quiz-input"
      />
      <button onClick={check} className="btn-check">
        Check Answer
      </button>
      {result !== null && (
        <div className={`result ${result ? "correct" : "incorrect"}`}>
          <span className="result-icon">{result ? "✅" : "❌"}</span>
          <span className="result-text">
            {result
              ? "Correct! Great job!"
              : `Not quite. The answer is: ${q.answer ?? q.correct_answer}`}
          </span>
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
  const [quiz, setQuiz] = useState(() => JSON.parse(localStorage.getItem("quiz") || "null"));
  const [tick, setTick] = useState(0);
  const [docReady, setDocReady] = useState(false);
  const [docName, setDocName] = useState("");
  const viewRef = useRef(null);

  useEffect(() => {
    viewRef.current?.scrollTo({ top: viewRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const progress = JSON.parse(localStorage.getItem("progress") || "{}");

  async function send(content) {
    const next = [...messages, { role: "user", content }];
    setMessages(next);
    setLoading(true);

    const res = await fetch(CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: next, stream: true }),
    });

    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
    const assistantIndex = next.length;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let accRaw = "";
    let accMasked = "";

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
        } catch {}
      }
    }

    try {
      const raw = accRaw.trim();
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      if (start !== -1 && end > start) {
        const parsed = JSON.parse(raw.slice(start, end + 1));
        if (parsed?.questions?.length) {
          localStorage.setItem("quiz", JSON.stringify(parsed.questions));
          setQuiz(parsed.questions);
        }
      }
    } catch {}

    setLoading(false);
  }

  async function teachFromDoc(query, mode = "lesson") {
    setMessages((prev) => [...prev, { role: "user", content: query }]);
    setLoading(true);
    const res = await postStream(TEACH_URL, { query, mode });
    await streamToMessages(res);
    setLoading(false);
  }

  async function streamToMessages(res) {
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
    const assistantIndex = messages.length;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let accRaw = "";
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
            setMessages((prev) => {
              const copy = [...prev];
              copy[assistantIndex] = { role: "assistant", content: accRaw };
              return copy;
            });
          }
        } catch {}
      }
    }
  }

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const r = await uploadFile(file);
    if (r.ok) {
      setDocReady(true);
      setDocName(file.name);
      alert(`✅ Document processed (${r.chunks} chunks).`);
    } else {
      alert("Upload failed: " + (r.error || "unknown error"));
    }
    e.target.value = "";
  }

  async function clearDoc() {
    await fetch(CLEAR_DOC_URL, { method: "POST" });
    setDocReady(false);
    setDocName("");
    localStorage.removeItem("quiz");
    setQuiz(null);
    alert("🧹 Cleared document context.");
  }

  return (
    <div className="app-container">
      {/* floating background orbs */}
      <div className="bg-orb orb-1"></div>
      <div className="bg-orb orb-2"></div>
      <div className="bg-orb orb-3"></div>

      <div className="app-wrapper">
        {/* Header */}
        <header className="app-header">
          <div className="header-left">
            <div className="logo-circle">
              <div className="logo-shine"></div>
              <div className="logo-text">LP</div>
            </div>
            <div>
              <h1 className="app-title">LearnPlay</h1>
              <p className="app-subtitle">Playful learning powered by AI</p>
            </div>
          </div>

          <div className="header-right">
            <div className="progress-display">
              <div className="progress-icon">🏅</div>
              <div className="progress-stats">
                <div className="progress-label">Score</div>
                <div className="progress-value">
                  <strong>{progress.correct || 0}</strong>
                  <span className="progress-divider">/</span>
                  {progress.total || 0}
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Layout */}
        <div className="main-layout">
          {/* Sidebar */}
          <aside className="sidebar">
            <div className="sidebar-section">
              <label className="input-label">Topic</label>
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder='e.g., "Backpropagation"'
                className="topic-input"
              />
              <input
                id="topicFile"
                type="file"
                accept=".pdf,.docx,.txt"
                style={{ display: "none" }}
                onChange={handleUpload}
              />
              <div className="button-group">
                <button
                  className="btn-primary"
                  onClick={() => document.getElementById("topicFile").click()}
                >
                  📎 Upload Doc
                </button>
                <button className="btn-primary" onClick={clearDoc} disabled={!docReady}>
                  🧹 Clear Doc
                </button>
                <button className="btn-primary" onClick={() => teachFromDoc(`Teach ${topic}`)}>
                  🎓 Teach Me
                </button>
                <button className="btn-tool" onClick={() => send(`Co-relate ${topic} with cooking`)}>
                  🔗 Co-Relate
                </button>
                <button className="btn-tool" onClick={() => send(`Create quiz for ${topic}`)}>
                  📝 Quiz Me
                </button>
                <button className="btn-tool" onClick={() => send(`Make ${topic} fun!`)}>
                  🎮 Make It Fun
                </button>
              </div>
              {docReady && <p style={{ marginTop: 8 }}>Using document: {docName}</p>}
            </div>
          </aside>

          {/* Main Content */}
          <main className="main-content">
            <div className="chat-container">
              <div ref={viewRef} className="chat-messages">
                {messages
                  .filter((m) => m.role !== "system")
                  .map((m, i) => (
                    <Bubble key={i} role={m.role}>
                      {m.content}
                    </Bubble>
                  ))}
                {loading && (
                  <div className="typing-indicator">
                    <div className="typing-dots">
                      <span></span>
                      <span></span>
                      <span></span>
                    </div>
                    <div className="typing-text">Thinking…</div>
                  </div>
                )}
              </div>

              {/* Chat Input */}
              <div className="chat-input-wrapper">
                <div className="chat-input-container">
                  <input
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                    placeholder="Type your question..."
                    className="chat-input"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        send(userInput);
                        setUserInput("");
                      }
                    }}
                  />
                  <button
                    onClick={() => {
                      send(userInput);
                      setUserInput("");
                    }}
                    className="btn-send"
                    disabled={!userInput.trim()}
                  >
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                      <path d="M2 10L18 2L10 18L8 11L2 10Z" fill="currentColor" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Quiz Section */}
              {Array.isArray(quiz) && quiz.length > 0 && (
                <div className="quiz-section">
                  <div className="quiz-header">
                    <h3 className="quiz-title">
                      <span className="quiz-icon">📘</span> Quiz Time
                    </h3>
                    <button
                      className="btn-clear-quiz"
                      onClick={() => {
                        localStorage.removeItem("quiz");
                        setQuiz(null);
                      }}
                    >
                      Clear Quiz
                    </button>
                  </div>
                  <div className="quiz-grid">
                    {quiz.map((q, i) => (
                      <QuizQuestion
                        key={i}
                        index={i}
                        q={q}
                        onScored={() => setTick((t) => t + 1)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}