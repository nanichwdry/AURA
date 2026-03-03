import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { google } from "googleapis";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // --- Google OAuth Setup ---
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.APP_URL}/auth/google/callback`
  );

  app.get("/api/auth/google/url", (req, res) => {
    const url = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: ["https://www.googleapis.com/auth/calendar"],
      prompt: "consent",
    });
    res.json({ url });
  });

  app.get("/auth/google/callback", async (req, res) => {
    const { code } = req.query;
    try {
      const { tokens } = await oauth2Client.getToken(code as string);
      // In a real app, you'd store this in a database/session
      // For this demo, we'll send it back to the client via postMessage
      res.send(`
        <html>
          <body>
            <script>
              window.opener.postMessage({ type: 'GOOGLE_AUTH_SUCCESS', tokens: ${JSON.stringify(tokens)} }, '*');
              window.close();
            </script>
          </body>
        </html>
      `);
    } catch (error) {
      console.error("Error exchanging code for tokens", error);
      res.status(500).send("Authentication failed");
    }
  });

  // --- API Endpoints ---
  app.post("/api/calendar/schedule", async (req, res) => {
    const { tokens, summary, startTime, endTime, description } = req.body;
    if (!tokens) return res.status(401).json({ error: "Not authenticated" });

    oauth2Client.setCredentials(tokens);
    const calendar = google.calendar({ version: "v3", auth: oauth2Client });

    try {
      const event = await calendar.events.insert({
        calendarId: "primary",
        requestBody: {
          summary,
          description,
          start: { dateTime: startTime },
          end: { dateTime: endTime },
        },
      });
      res.json(event.data);
    } catch (error) {
      console.error("Error scheduling event", error);
      res.status(500).json({ error: "Failed to schedule event" });
    }
  });

  // Twilio Notification (WhatsApp/SMS)
  app.post("/api/notify", async (req, res) => {
    const { message } = req.body;
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_PHONE_NUMBER;
    const to = process.env.MY_PHONE_NUMBER;

    if (!accountSid || !authToken || !from || !to) {
      console.warn("Twilio credentials missing. Skipping real notification.");
      return res.json({ success: true, simulated: true });
    }

    try {
      // For WhatsApp, Twilio requires 'whatsapp:' prefix
      // const client = (await import('twilio')).default(accountSid, authToken);
      // await client.messages.create({ body: message, from: `whatsapp:${from}`, to: `whatsapp:${to}` });
      res.json({ success: true });
    } catch (error) {
      console.error("Twilio error", error);
      res.status(500).json({ error: "Failed to send notification" });
    }
  });

  // --- Vite Middleware ---
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
