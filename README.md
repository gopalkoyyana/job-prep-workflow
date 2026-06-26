# Job Prep Intelligence — Secure Node.js Backend

Secure Express server that proxies all API calls so your credentials **never touch the browser**.

## Key Features
- **Flexible LLM Backend**: Use Anthropic Claude, Google Gemini, or OpenAI GPT-4o.
- **Advanced Job Filtering**: Filter job listings by duration/recency (e.g. 24 hours, 2 days, 7 days, all matching postings) and placement country.
- **Single Job Selection**: Displays all matching job postings in the specified period and allows you to select one specific job position to build the preparation plan against.
- **Back to Job List**: Easy navigation to go back to the matching job list and prepare for a different position without querying from scratch.
- **Optional ATS Resume Tailoring**: Upload a `.txt` resume or paste resume text to automatically analyze, adapt, and highlight key target skills to pass ATS screening.
- **YouTube Resources in Schedule**: Integrates relevant tutorials directly into your 2-day study blocks.

## Project Structure

```
job-prep-server/
├── server.js          ← Express backend (all API routes + Nodemailer)
├── public/
├─── index.html     ← Frontend UI (served by Express)
├── .env               ← Your secrets (never commit this)
├── .env.example       ← Template — copy this to .env
├── package.json
└── README.md
```

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
```
Open `.env` and fill in:
- `LLM_PROVIDER` → Select `anthropic`, `gemini`, or `openai`
- Keys for your active provider:
  - `ANTHROPIC_API_KEY` (if using Anthropic, obtain from [Anthropic Console](https://console.anthropic.com))
  - `GEMINI_API_KEY` (if using Gemini, obtain from [Google AI Studio](https://aistudio.google.com))
  - `OPENAI_API_KEY` (if using OpenAI, obtain from [OpenAI Platform](https://platform.openai.com))
  - `SERPER_API_KEY` (optional, used for search grounding with OpenAI, obtain from [Serper.dev](https://serper.dev))
- `EMAIL_USER` + `EMAIL_PASS` → Gmail + App Password (for auto-sending)

### 3. Run the server
```bash
# Production
npm start

# Development (auto-restart on file changes)
npm run dev
```

### 4. Open the app
```
http://localhost:3000
```

---

## API Routes

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/health` | Server status check & active provider report |
| POST | `/api/job` | Fetch multiple job postings based on country & duration |
| POST | `/api/skills` | Extract skill keywords from the selected job posting |
| POST | `/api/youtube` | Find short YouTube learning resources for extracted skills |
| POST | `/api/plan` | Generate 2-day prep plan incorporating curated video URLs |
| POST | `/api/resume` | Analyze and tailor resume with target skills to pass ATS screening |
| POST | `/api/email` | Generate + send plan email via Gmail SMTP |

---

## Gmail Setup (for auto-sending email)

1. Enable 2-Factor Authentication on your Google account
2. Go to https://myaccount.google.com/apppasswords
3. Create a new App Password (select "Mail" + "Other")
4. Copy the 16-character password into `.env` as `EMAIL_PASS`

---

## Security Notes

- ✅ API keys live only in `.env` on your server
- ✅ Browser never sees your private API credentials
- ✅ Add `.env` to `.gitignore` before pushing to GitHub
- ✅ Set `ALLOWED_ORIGIN` to your domain in production (not `*`)
