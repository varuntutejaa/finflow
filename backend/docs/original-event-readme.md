# Unlock'D Build-a-thon: Official Master Repository

Welcome to **Unlock'D**, the 24-hour progressive build-a-thon! This repository contains your initial starter code. This guide will walk you through the entire event flow, how to set up your environment, and how to submit your work for judging.

---

## 🎯 The Challenge: A Personal Finance Application
You will be building a comprehensive **personal finance and expense management application**. 

- **Creative Freedom:** You have full control over the branding, the name of your product, and the UI/UX design. Get creative!
- **Secret Features:** The specific core features you must implement are currently classified. You will receive your product roadmap progressively, with new features being revealed as you successfully pass each judging gate.

---

## 🏆 1. The Event Workflow

Unlock'D is a unique **24-hour progressive build-a-thon**. You will work in teams, receiving a secret product roadmap and starter code. 

- **Progressive Gates:** You must complete timed development sprints.
- **Deployment & Validation:** After each sprint, you must package your code and clear a "live judging gate" to unlock the next round.
- **Exclusive Communication:** All updates, guidelines, and announcements will happen exclusively through our **Discord server**. Keep an eye on the announcements channel!

---

## 💻 2. Tech Stack Freedom & The Backend

- **Frontend:** Provided as a React + TypeScript + Vite application.
- **Backend:** **You have COMPLETE FREEDOM to use any backend language or framework.** Whether you prefer Node.js, Python (FastAPI/Flask), Go, Java, or anything else—it is entirely up to you.
- **Databases:** You can also add any database you prefer (PostgreSQL, MongoDB, MySQL, etc.) by defining it in the provided `docker-compose.yml`.

---

## 🐳 3. Mandatory Docker Requirement (Crucial)

**The Dockerfile Rule:** To ensure our judges can run your application locally without dealing with dependency hell, **your submission MUST be fully Dockerized.** 

If the judge cannot build and run your containers, your submission will automatically fail the judgement, and you will not **unlock** the next task!

### How the project is currently Dockerized:
We have provided a boilerplate Docker setup for you:
1. **Root `docker-compose.yml`**: Orchestrates both the frontend, backend, and any databases you choose to add.
2. **`frontend/Dockerfile`**: Already configured to serve your Vite React app on port `5173`.
3. **`backend/Dockerfile`**: A placeholder. **You must update this file** with the instructions for whatever backend language you choose to build with.

### How to Run the Product:
To spin up the entire application (both frontend and backend), open your terminal in the root directory and run:

```bash
docker-compose up -d --build
```
*This command will build the images and run your containers in detached mode. You can view your frontend in your browser at `http://localhost:5173`.*

---

## 🚀 4. Integrations, Databases & Bonus Features

We encourage you to go above and beyond the baseline requirements! As long as you successfully complete the core sprint tasks, you have complete freedom to integrate extra features to "wow" the judges:

- **Databases:** You can integrate ANY database (PostgreSQL, MySQL, MongoDB, Redis, etc.). 
- **Advanced Tech:** Feel free to implement WebSockets for real-time updates, Redis for caching, or integrate AI/ML APIs (like OCR for receipt scanning or LLMs for spending insights).
- **External APIs:** You can connect to third-party services, webhooks, or open APIs.

**Crucial Docker Rule for Integrations:** If your integration requires a local service (like a database or Redis cache), **you must not run it separately**. Instead, add it as an additional service in the provided `docker-compose.yml` file. We have left commented-out examples in the `docker-compose.yml` file to show you exactly how to do this.

---

## 🛠️ 5. Installation & Setup (Fork & Clone)

To keep the main repository pristine and track your team's progress securely, we are using a **Fork-and-Pull Request workflow**.

### Step 1: Fork the Repository
Navigate to the main UnlockD Repository on GitHub and click the **"Fork"** button in the top right corner. This creates a personal copy of the project under your team's/personal GitHub account.

### Step 2: Clone Your Fork
Open your terminal and clone your newly created fork onto your local machine:
```bash
git clone https://github.com/YOUR_GITHUB_USERNAME/UnlockD-Master-Repo.git
cd UnlockD-Master-Repo
```

### Step 3: Start the Docker Environment
Ensure you have **Docker Desktop** installed and running on your machine. Then, execute:
```bash
docker-compose up -d --build
```

---

## 📤 6. Submission & Judging Process

We are not just judging code; we are judging **functionality**.

### The PR Submission Workflow:
When you finish a sprint, you must submit a Pull Request (PR) to the main UnlockD repository.

1. **Create a Feature Branch:** Never work directly on `main`. Always branch off for a sprint.
   ```bash
   git checkout -b feature/your-sprint-name
   ```
2. **Commit your work:**
   ```bash
   git add .
   git commit -m "feat: completed sprint 1"
   ```
3. **Push to your Fork:**
   ```bash
   git push origin feature/your-sprint-name
   ```
4. **Open a PR:** Go to the main project repository on GitHub and open a Pull Request comparing your feature branch against the main repo.

### The PR Template
You **must** fill out the provided PR template when submitting (Team Name, Features Added, Known Bugs). Incomplete PRs will not be judged.

### Local Judging Process
- **No Cloud Deployment Required:** You are not required to host your app on AWS, Heroku, or Vercel. 
- Our judges will pull your PR locally, run `docker-compose up --build`, and test your application directly on their machines.
- **Standardized Ports:** Ensure your application is configured to expose its web server on the ports specified in your configuration. If you change ports, document it in your PR or README!

> **Brutally Honest Reminder:** If your submission does not follow these technical guidelines, it will fail the automated "gate check," and your team will not unlock the next task. If you experience technical setup issues, reach out to the organizers on Discord immediately!

Good luck, and Happy Building!
