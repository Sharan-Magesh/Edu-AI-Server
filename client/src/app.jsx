import React, { useEffect, useRef, useState } from "react";
import "./app.css";

/* ---------- config ---------- */
const API_URL = "http://localhost:5179/chat";

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

/* ---------- small UI pieces ---------- */
function Bubble({ role, children }) {
  const isUser = role === "user";
  return (
    <div className={`message-bubble ${isUser ? "user-message" : "assistant-message"}`}>
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
        <span className="question-number">Question {index + 1}</span>
      </div>
      <p className="question-text">{q.q || q.question}</p>
      {q.type === "mcq" && Array.isArray(q.options) && (
        <ul className="quiz-options">
          {q.options.map((o, j) => (
            <li key={j}>{o}</li>
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
          {result ? "✅ Correct! Great job!" : `❌ Not quite. The answer is: ${q.answer ?? q.correct_answer}`}
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
  const [isStreaming, setIsStreaming] = useState(false);
  const [quiz, setQuiz] = useState(() => {
    const s = localStorage.getItem("quiz");
    return s ? JSON.parse(s) : null;
  });
  const [tick, setTick] = useState(0);
  const viewRef = useRef(null);

  useEffect(() => {
    viewRef.current?.scrollTo({ top: viewRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading, isStreaming]);

  async function send(content) {
    const next = [...messages, { role: "user", content }];
    setMessages(next);
    setLoading(true);
    setIsStreaming(false);

    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: next, stream: true }),
    });

    setLoading(false);
    setIsStreaming(true);
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
        } catch {
          // ignore partial lines
        }
      }
    }

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

    setIsStreaming(false);
  }

  function startExplain() {
    if (!topic.trim()) return;
    send(`Explain "${topic}" with analogy-first teaching and include one check question at the end.`);
    localStorage.setItem("learnplay_topic", topic);
  }

  const progress = JSON.parse(localStorage.getItem("progress") || "{}");

  return (
    <div className="app-container">
      <div className="app-wrapper">
        {/* Header */}
        <header className="app-header">
          <div className="header-left">
            <div className="logo-circle">LP</div>
            <h1 className="app-title">LearnPlay</h1>
          </div>
          <div className="header-right">
            <div className="progress-display">
              🏅 <strong>{progress.correct || 0}</strong> / {progress.total || 0}
            </div>
          </div>
        </header>

        {/* Main Layout */}
        <div className="main-layout">
          {/* Sidebar */}
          <aside className="sidebar">
            <div className="sidebar-section">
              <label className="input-label">What do you want to learn?</label>
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder='e.g., "Backpropagation"'
                className="topic-input"
              />
              <button onClick={startExplain} className="btn-primary">
                🎓 Teach Me
              </button>
            </div>

            <div className="sidebar-section">
              <h3 className="section-title">Learning Tools</h3>
              <div className="button-group">
                <button
                  onClick={() =>
                    send(
                      `Create a short co-relation mapping for "${topic || "my topic"}" to badminton or cooking, include a 2-row table and ask one reflection question.`
                    )
                  }
                  className="btn-tool"
                >
                  🔗 Co-Relate
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
                  className="btn-tool"
                >
                  📝 Quiz Me
                </button>
                <button
                  onClick={() =>
                    send(
                      `Make it fun: turn "${topic || "my topic"}" into a 120-word playful scene with one micro-challenge at the end.`
                    )
                  }
                  className="btn-tool"
                >
                  🎮 Make It Fun
                </button>
              </div>
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
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                )}
              </div>

              {/* Input Form */}
              <div className="chat-input-container">
                <input
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (!userInput.trim()) return;
                      send(userInput);
                      setUserInput("");
                    }
                  }}
                  placeholder="Type your magic spell..."
                  className="chat-input"
                />
                <button
                  onClick={() => {
                    if (!userInput.trim()) return;
                    send(userInput);
                    setUserInput("");
                  }}
                  className="btn-send"
                >
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <path d="M2 10L18 2L10 18L8 11L2 10Z" fill="currentColor" />
                  </svg>
                </button>
              </div>

              {/* Quiz Section */}
              {Array.isArray(quiz) && quiz.length > 0 && (
                <div className="quiz-section">
                  <h3 className="quiz-title">📘 Quiz Time</h3>
                  {quiz.map((q, i) => (
                    <QuizQuestion key={i} index={i} q={q} onScored={() => setTick((t) => t + 1)} />
                  ))}
                </div>
              )}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
