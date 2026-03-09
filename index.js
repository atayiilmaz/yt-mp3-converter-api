const express = require("express");
const youtubedl = require("youtube-dl-exec");
const ffmpeg = require("fluent-ffmpeg");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const app = express();

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

    // 2. YOUTUBE BAN ÖNLEME: User-agent ve sleep-interval ekliyoruz
    await youtubedl(url, {
      format: "bestaudio",
      output: tempOutputFile,
      noCheckCertificates: true,
      // Ban yememek için bot gibi görünmeyi engelleyen ayarlar:
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      addHeader: ["referer:https://www.google.com/"],
      sleepInterval: 2, // İstekler arasına rastgele boşluk koyar
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
        // index.js içinde res.json kısmını şöyle güncelle:
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
    res.status(500).json({ error: "İşlem başarısız oldu" });
  }
});

app.use("/download", express.static(downloadFolder));

const PORT = 9000;
app.listen(PORT, () => console.log(`API ${PORT} portunda aktif.`));
