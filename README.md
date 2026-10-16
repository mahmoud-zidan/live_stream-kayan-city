# Hikvision Web App

This project exposes a small Express + WebSocket dashboard that proxies a Hikvision RTSP camera stream to the browser using `rtsp-relay` and JSMpeg.

## Local run

1. Copy `.env.example` to `.env`
2. Fill in the DVR credentials
3. Install dependencies

```bash
npm install
npm start
```

Open:

```text
http://localhost:3500
```

## Important deployment note

This app runs a long-lived Node server, opens WebSocket routes, and launches FFmpeg for each RTSP stream. That is not a good fit for Vercel's serverless hosting model.

Use one of these for deployment instead:

- Render
- Railway
- a VPS / VM
- a custom Node host with a public IP and port open

Vercel can still host the GitHub repo, but the live RTSP relay should be deployed to a Node runtime that stays awake and supports long-lived WebSockets.

## Environment variables

```env
DVR_HOST=197.36.66.103
DVR_PORT=554
DVR_USER=admin
DVR_PASS=your_hikvision_password
SERVER_PORT=3500
```

## GitHub push

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin <your-github-repo-url>
git push -u origin main
```

Then import the repository into Render/Railway instead of Vercel if you need the camera stream to keep working.
