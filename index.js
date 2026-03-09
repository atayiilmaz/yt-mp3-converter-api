const express = require("express");
const youtubedl = require("youtube-dl-exec");
const ffmpeg = require("fluent-ffmpeg");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const app = express();
const ytDlpOptions = {
  format: "bestaudio",
  noCheckCertificates: true,
  userAgent:
    process.env.YTDLP_USER_AGENT ||
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  addHeader: ["referer:https://www.google.com/"],
  sleepInterval: Number(process.env.YTDLP_SLEEP_INTERVAL || 2),
};

if (process.env.YTDLP_COOKIES_FILE) {
  ytDlpOptions.cookies = process.env.YTDLP_COOKIES_FILE;
}

if (process.env.YTDLP_JS_RUNTIMES) {
  ytDlpOptions.jsRuntimes = process.env.YTDLP_JS_RUNTIMES;
}

if (process.env.YTDLP_PROXY) {
  ytDlpOptions.proxy = process.env.YTDLP_PROXY;
}

// 1. RATE LIMIT: Her IP 15 dakikada en fazla 5 istek atabilir
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 dakika
  max: 5,
  message: {
    error: "Çok fazla istek attınız. Lütfen 15 dakika sonra tekrar deneyin.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(cors());
app.use(express.json());

const downloadFolder = path.join(__dirname, "downloads");
if (!fs.existsSync(downloadFolder)) fs.mkdirSync(downloadFolder);

app.post("/convert", limiter, async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "YouTube URLsi gerekli" });

  const fileId = Date.now();
  const tempOutputFile = path.join(downloadFolder, `${fileId}.raw`);
  const finalOutputFile = path.join(downloadFolder, `${fileId}.mp3`);

  try {
    console.log(`[${fileId}] İşlem başlıyor: ${url}`);

    await youtubedl(url, {
      ...ytDlpOptions,
      output: tempOutputFile,
    });

    console.log(`[${fileId}] Dönüştürme başlıyor...`);

    ffmpeg(tempOutputFile)
      .toFormat("mp3")
      .audioBitrate(192)
      .on("end", () => {
        console.log(`[${fileId}] MP3 hazır.`);

        // Ham dosyayı hemen sil
        if (fs.existsSync(tempOutputFile)) fs.unlinkSync(tempOutputFile);

        // API Cevabını Gönder
        res.json({
          success: true,
          fileUrl: `${req.protocol}://${req.get("host")}/download/${fileId}.mp3`,
          expiresIn: "10 minutes",
        });

        // 3. GECİKMELİ SİLME (2. Yöntem): 10 dakika sonra imha et
        setTimeout(
          () => {
            if (fs.existsSync(finalOutputFile)) {
              fs.unlink(finalOutputFile, (err) => {
                if (err) console.error(`[${fileId}] Silme hatası:`, err);
                else console.log(`[${fileId}] Dosya süresi doldu ve silindi.`);
              });
            }
          },
          10 * 60 * 1000,
        ); // 10 dakika
      })
      .on("error", (err) => {
        console.error("FFmpeg Hatası:", err.message);
        if (fs.existsSync(tempOutputFile)) fs.unlinkSync(tempOutputFile);
        res.status(500).json({ error: "Dönüştürme hatası" });
      })
      .save(finalOutputFile);
  } catch (error) {
    console.error("Sistem Hatası:", error);

    const stderr = error?.stderr || "";
    if (stderr.includes("No supported JavaScript runtime could be found")) {
      return res.status(500).json({
        error: "Sunucuda yt-dlp JavaScript runtime eksik.",
        details:
          "VPS ortaminda Deno/Node/Bun kurup YTDLP_JS_RUNTIMES ortam degiskenini ayarlayin. Ornek: YTDLP_JS_RUNTIMES=node",
      });
    }

    if (stderr.includes("Sign in to confirm you’re not a bot")) {
      return res.status(500).json({
        error: "YouTube sunucu IP'sini bot olarak isaretledi.",
        details:
          "YTDLP_COOKIES_FILE ile YouTube cookie dosyasi tanimlayin. Gerekirse proxy veya residential IP kullanin.",
      });
    }

    res.status(500).json({ error: "İşlem başarısız oldu" });
  }
});

app.use("/download", express.static(downloadFolder));
app.use("/yt/download", express.static(downloadFolder));

const PORT = 9000;
app.listen(PORT, () => console.log(`API ${PORT} portunda aktif.`));
