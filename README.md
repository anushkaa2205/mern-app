# MERN Blog

A small blog app built with MongoDB, Express, React (Vite), and Node.

## Features

- List, create, edit, and delete blog posts
- No authentication — single-user, open access
- REST API backend + React frontend

## Structure

```
mern-blog/
  server/   Express + Mongoose API
  client/   React (Vite) frontend
```

## Prerequisites

- Node.js 18+
- MongoDB running locally, or a MongoDB Atlas connection string

## Setup

### 1. Backend

```
cd server
npm install
cp .env.example .env
# edit .env if your MongoDB URI differs from the default
npm run dev
```

Runs on http://localhost:5000.

### 2. Frontend

In a second terminal:

```
cd client
npm install
npm run dev
```

Runs on http://localhost:5173 and proxies `/api` requests to the backend.

Open http://localhost:5173 in your browser.

## API

| Method | Route            | Description        |
|--------|------------------|---------------------|
| GET    | /api/posts       | List all posts      |
| GET    | /api/posts/:id   | Get one post        |
| POST   | /api/posts       | Create a post        |
| PUT    | /api/posts/:id   | Update a post        |
| DELETE | /api/posts/:id   | Delete a post        |

## Notes

- If you don't have MongoDB installed locally, create a free cluster at MongoDB Atlas and paste the connection string into `server/.env` as `MONGODB_URI`.
