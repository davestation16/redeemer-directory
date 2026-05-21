import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import firebaseConfig from './firebase-applet-config.json' with { type: 'json' };

// Initialize Firebase for server-side use
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Image Proxy for Optimization Tool
  app.get("/api/proxy-image", async (req, res) => {
    // Reconstruct the full URL from the query string to avoid truncation
    // req.query.url might be truncated by Express if it contains '&'
    const rawUrlPart = req.url.split('url=')[1];
    if (!rawUrlPart) {
      return res.status(400).send("Missing image URL");
    }
    
    // Decode the URL (it should be encoded when passed to the proxy)
    const url = decodeURIComponent(rawUrlPart);

    try {
      console.log(`[Proxy] Fetching: ${url.substring(0, 100)}...`);
      const response = await fetch(url, {
        headers: {
          // Send a minimal set of headers to look like a browser but avoid being blocked
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        },
        // Follow redirects
        redirect: 'follow'
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'No error body');
        console.error(`[Proxy] External fetch failed. Status: ${response.status} ${response.statusText}. URL: ${url} | Body: ${errorText.substring(0, 500)}`);
        return res.status(response.status === 403 ? 403 : 502).send(`External server responded with ${response.status} ${response.statusText}`);
      }

      const contentType = response.headers.get("content-type");
      if (contentType) res.setHeader("Content-Type", contentType);

      const cacheControl = response.headers.get("cache-control");
      if (cacheControl) res.setHeader("Cache-Control", cacheControl);

      const buffer = await response.arrayBuffer();
      res.send(Buffer.from(buffer));
    } catch (error) {
      console.error("Image Proxy Exception:", error);
      res.status(500).send("Error fetching image");
    }
  });

  // iCal Feed Endpoint
  app.get("/api/calendar/feed.ics", async (req, res) => {
    const { token } = req.query;
    
    // Security check
    if (token !== "Redeemer2026") {
      return res.status(403).send("Forbidden: Invalid search token.");
    }

    try {
      const familiesSnap = await getDocs(collection(db, 'families'));
      const families = familiesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      let ical = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Station16//Redeemer Directory//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:Redeemer Family Celebrations",
        "X-WR-TIMEZONE:UTC",
        "X-WR-CALDESC:Church Family Directory Birthday and Anniversary Feed"
      ];

      const currentYear = new Date().getFullYear();

      families.forEach((family: any) => {
        // Birthdays
        family.members?.forEach((member: any) => {
          if (member.birthday) {
            const parts = (member.birthday || '').split('-');
            const m = parts[parts.length - 2];
            const d = parts[parts.length - 1];
            
            if (m && d) {
              const eventId = `bday-${family.id}-${(member.name || '').replace(/\s+/g, '')}`;
              ical.push("BEGIN:VEVENT");
              ical.push(`UID:${eventId}@redeemerdirectory.app`);
              ical.push(`DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`);
              ical.push(`DTSTART;VALUE=DATE:${currentYear}${m}${d}`);
              ical.push(`DTEND;VALUE=DATE:${currentYear}${m}${d}`);
              ical.push(`SUMMARY:${member.name} ${family.familyName}'s Birthday`);
              ical.push("RRULE:FREQ=YEARLY");
              ical.push("DESCRIPTION:Church Family Directory");
              ical.push("TRANSP:TRANSPARENT");
              ical.push("END:VEVENT");
            }
          }
        });

        // Anniversaries
        if (family.weddingAnniversary) {
          const parts = (family.weddingAnniversary || '').split('-');
          const m = parts[parts.length - 2];
          const d = parts[parts.length - 1];

          if (m && d) {
            const eventId = `anniv-${family.id}`;
            ical.push("BEGIN:VEVENT");
            ical.push(`UID:${eventId}@redeemerdirectory.app`);
            ical.push(`DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`);
            ical.push(`DTSTART;VALUE=DATE:${currentYear}${m}${d}`);
            ical.push(`DTEND;VALUE=DATE:${currentYear}${m}${d}`);
            const summary = family.members?.length === 1 
              ? (family.members[0].name.toLowerCase().includes(family.familyName.toLowerCase())
                ? `${family.members[0].name}'s Anniversary`
                : `${family.members[0].name} ${family.familyName}'s Anniversary`)
              : `The ${family.familyName} Family Anniversary`;
            ical.push(`SUMMARY:${summary}`);
            ical.push("RRULE:FREQ=YEARLY");
            ical.push("DESCRIPTION:Church Family Directory");
            ical.push("TRANSP:TRANSPARENT");
            ical.push("END:VEVENT");
          }
        }
      });

      ical.push("END:VCALENDAR");

      res.setHeader("Content-Type", "text/calendar; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="redeemer-celebrations.ics"');
      res.setHeader("Cache-Control", "public, max-age=86400"); // 24 hours
      
      // Join with CRLF as requested
      res.send(ical.join("\r\n"));
    } catch (error) {
      console.error("iCal Generation Error:", error);
      res.status(500).send("Error generating calendar feed");
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { 
        middlewareMode: true,
        hmr: false,
      },
      appType: "spa",
      logLevel: "error",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
