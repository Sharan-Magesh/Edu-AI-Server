🎮 LearnPlay AI — Make Hard Concepts Feel Like Play

LearnPlay AI is a local, privacy-friendly AI learning assistant that turns complex topics into fun, interactive lessons. It works from both a typed topic or a PDF/DOCX/TXT document you upload.

Features:
- Analogy‑first explanations
- Bullet‑point clarity
- Worked examples
- Interactive quizzes (MCQ, short, explain)
- JSON‑free quiz UI
- Fun storytelling mode
- Co‑relation mode (badminton/cooking)
- Fully local LLM (Ollama) – your data never leaves your device

Installation:
1. Install Ollama and pull required models
   ollama pull llama3.2:3b
   ollama pull nomic-embed-text

2. Run backend:
   cd server
   npm install
   node server.js

3. Run frontend:
   cd client
   npm install
   npm run dev

Environment Variables (server/.env):
PORT=5179
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2:3b

Project Structure:
learnplay/
 ├── client/
 ├── server/
 ├── README.md

API Endpoints:
- POST /chat
- POST /upload
- POST /teach
- POST /clear-doc
- GET /health

Future Enhancements:
- Flashcards
- Notes export
- Voice teaching
- Offline packaging

