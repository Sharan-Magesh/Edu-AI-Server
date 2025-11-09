🎮 LearnPlay AI — Full Installation & Usage Guide
Make Hard Concepts Feel Like Play

📘 Introduction
LearnPlay AI is a local, privacy-friendly learning assistant powered by Ollama and built with Node.js + React. This guide will walk you through EVERYTHING you need — installing dependencies, downloading models, running backend, running frontend, uploading documents, generating quizzes, and more.
✅ Prerequisites
Before you begin, ensure you have the following installed:
• Node.js (v18 or higher recommended)
• NPM (comes with Node.js)
• Ollama (for local LLMs)
• Git (optional but recommended)
🧠 Step 1 — Install Ollama
Ollama is required to run local LLMs. Download from:
https://ollama.com/download

After installation, open your terminal and verify:
    ollama --version

📥 Step 2 — Download Required Models
LearnPlay requires 2 models:
1. LLM model → llama3.2:3b
2. Embedding model → nomic-embed-text

Run these commands:
    ollama pull llama3.2:3b
    ollama pull nomic-embed-text

📁 Project Folder Structure
learnplay/
 ├── client/        (React frontend)
 ├── server/        (Node.js backend)
 ├── README.md

🟦 Step 3 — Install Server Dependencies
Navigate into the server folder:
    cd server

Install all required dependencies:
    npm install

This installs packages like:
• express
• cors
• multer
• pdf-parse
• mammoth
• dotenv

⚙️ Step 4 — Create .env File
Inside /server create a file named .env with:
PORT=5179
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2:3b

▶️ Step 5 — Start the Backend Server
Run the backend:
    node server.js

You should see:
    Server running → http://localhost:5179

⚛️ Step 6 — Install Frontend Dependencies
Navigate to the client folder:
    cd client

Install packages:
    npm install

This installs React, Vite, and all UI dependencies.

🚀 Step 7 — Start the LearnPlay Frontend
Run the frontend UI:
    npm run dev

You should now see LearnPlay running at:
    http://localhost:5173

🎓 Step 8 — Using LearnPlay AI
✅ Type a topic in the Topic box (e.g., 'Eigenvalues')
✅ Click:
  • Teach Me — explanation with analogy + example + check question
  • Co-Relate — relate to badminton/cooking
  • Quiz Me — generates quiz (JSON hidden) as UI
  • Make It Fun — story-mode explanation

📄 Step 9 — Uploading Documents (PDF/DOCX/TXT)
Click the Upload button in the Topic panel and upload:
• PDF file
• DOCX file
• TXT file

LearnPlay will:
✅ Extract text
✅ Chunk it
✅ Embed it using nomic-embed-text
✅ Enable document mode
Now all buttons use ONLY the uploaded document content.

🎯 Step 10 — Quiz Mode (Document or Topic)
When clicking 'Quiz Me':
✅ LearnPlay generates 3 questions
✅ JSON is parsed silently (NOT shown to user)
✅ Quiz UI appears below chat
✅ Answers are auto-graded
✅ Score is tracked persistently

🧹 Step 11 — Clear Document Context
Click the Clear button to switch back to topic mode.
This resets:
• Document chunks
• Embeddings
• Quiz data

🛠️ Troubleshooting
✅ If Vite throws HTML parse errors → remove React syntax from index.html
✅ If Node crashes with memory error → update Node to v20+
✅ If Ollama model errors → re-run:
    ollama pull llama3.2:3b
    ollama pull nomic-embed-text

✨ You Are Ready!
Your LearnPlay AI setup is complete. Enjoy fun, interactive, document-powered learning!
