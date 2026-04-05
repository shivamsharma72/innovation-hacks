# Canvas Chatbot

An AI-powered chatbot that answers questions about your Canvas LMS courses, assignments, and grades using Google's Gemini API.

## Features

- 💬 **Chat Interface** - Beautiful web UI to interact with your Canvas data
- 🤖 **AI-Powered** - Uses Google Gemini to provide intelligent responses
- 📚 **Canvas Integration** - Fetches real data from your Canvas instance
- 🚀 **Easy to Use** - Just visit `http://localhost:5000` in your browser

## Setup

### 1. Install Dependencies

```bash
pip install flask google-generativeai requests python-dotenv
```

### 2. Get Your API Keys

**Canvas API Token:**
1. Go to your Canvas instance (e.g., `https://canvas.asu.edu`)
2. Click your profile icon → **Settings**
3. Scroll to **"Approved Integrations"**
4. Click **"New Access Token"** and copy it

**Gemini API Key:**
1. Go to [https://ai.google.dev](https://ai.google.dev)
2. Click **"Get API Key"**
3. Create a new project and generate a key
4. Enable billing for higher quotas

### 3. Configure Environment Variables

Create a `.env` file in the `src/` directory:

```
CANVAS_URL=https://canvas.asu.edu
CANVAS_ACCESS_TOKEN=your_token_here
GEMINI_API_KEY=your_key_here
```

See `.env.example` for the template.

### 4. Run the Chatbot

```bash
cd src
python chatbot.py
```

Then open your browser to: **[http://127.0.0.1:5000](http://127.0.0.1:5000)**

## Usage

Ask the chatbot anything about your Canvas courses:

- "What are my courses?"
- "What assignments are due soon?"
- "What's my grade in CSE 463?"
- "Tell me about my courses"
- "When is my next deadline?"

## Project Structure

```
src/
├── chatbot.py              # Main Flask app
├── templates/
│   └── index.html         # Web UI
├── .env                   # Your credentials (not committed)
├── .env.example          # Template for .env
└── .gitignore            # Excluded files
```

## How It Works

1. **User asks a question** via the web chat interface
2. **Chatbot fetches Canvas data** (courses, assignments, grades, etc.)
3. **Sends data to Gemini API** with the user's question
4. **Gemini generates intelligent response** using your Canvas data
5. **Response displayed** in the chat

## Important Notes

- **Never commit `.env`** file with your credentials to GitHub
- Always use environment variables for sensitive data
- The `.gitignore` file prevents accidental commit of credentials

## License

MIT

## Author

Created with ❤️ for Canvas students
