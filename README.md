# NourishIQ

NourishIQ is an AI-powered clinical nutritionist web application built specifically with Indian diets and contexts in mind. It uses cutting-edge LLMs and vision models via the Groq API to provide personalized health insights, nutritional deficiency analysis, and practical dietary recommendations.

## 🌟 Key Features

- **Symptom-Based Deficiency Analysis:** Users can report symptoms, and the AI determines potential nutritional gaps and computes a personalized health score.
- **Medical Report Analysis (Vision):** Upload blood panels or other medical reports to get instant extraction of key markers and specific dietary "Dos and Don'ts".
- **Meal Photo Analysis:** Snap a picture of a meal, and the AI evaluates its nutritional content, especially focusing on how it addresses the user's specific deficiencies.
- **Contextual Chat Assistant:** An integrated chatbot that retains the context of the user's current health status and deficiencies for personalized nutrition advice.
- **Science-Backed Awareness Cards:** Generates short, actionable health insights (e.g., timing, absorption, food combinations).
- **Cart Syncing:** Recommends specific Indian food items (with prices) and allows users to sync their cart to the cloud.

## 🛠️ Tech Stack

- **Frontend:** Vanilla JS / HTML / CSS (Served statically)
- **Backend:** Node.js, Express.js
- **AI Models:** 
  - `llama-3.3-70b-versatile` (Primary for text)
  - `meta-llama/llama-4-scout-17b-16e-instruct` (Vision processing)
  - *Provided via Groq API*
- **Database:** Supabase (PostgreSQL) for user data, sessions, and cart persistence
- **Containerization:** Docker

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+ recommended)
- A Groq API Key
- (Optional) A Supabase project for database persistence

### Installation

1. Clone the repository and navigate into the directory:
   ```bash
   git clone <repository-url>
   cd charged-observatory
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

### Environment Variables

Create a `.env` file in the root directory and add the following:

```env
PORT=8080
GROQ_API_KEY=your_groq_api_key_here

# Optional: For database persistence
SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_KEY=your_supabase_service_role_key
```

### Running Locally

To start the server in production mode:
```bash
npm start
```

To start the server in development mode (with auto-reload):
```bash
npm run dev
```

The app will be available at `http://localhost:8080`.

## 🐳 Docker Deployment

The application is fully containerized and ready for cloud deployment (e.g., Google Cloud Run).

1. Build the Docker image:
   ```bash
   docker build -t nourishiq .
   ```

2. Run the container:
   ```bash
   docker run -p 8080:8080 --env-file .env nourishiq
   ```

## 📡 Core API Endpoints

- `POST /api/register`: Registers a new user.
- `POST /api/analyse`: Takes an array of symptoms and returns 3 predicted nutritional deficiencies.
- `POST /api/blood-report`: Takes a base64 image of a medical report and returns structured health insights.
- `POST /api/meal-analysis`: Evaluates a meal image against the user's known deficiencies.
- `POST /api/chat`: Context-aware chatbot endpoint.
- `POST /api/awareness`: Generates personalized science-backed health cards.
- `POST /api/cart/sync` & `GET /api/cart/:userId`: Manages the recommended food item cart.

## 🛡️ License

Private/Proprietary (or specify open-source license if applicable).
