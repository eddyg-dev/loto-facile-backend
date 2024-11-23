import cors from "cors"; // Importer le middleware CORS
import { parse } from "csv-parse"; // Pour traiter les CSV
import dotenv from "dotenv";
import express from "express";
import fs from "fs";
import multer from "multer";
import OpenAI from "openai";
import pdfParse from "pdf-parse";
import xlsx from "xlsx";
import { versions } from "./version.constant";

dotenv.config();

const app = express();
app.set("trust proxy", 1);

const port = process.env.PORT || 3000;

const openai = new OpenAI();
const upload = multer({ dest: "uploads/" });

// Middleware pour analyser le JSON
app.use(express.json({ limit: "20mb" })); // Limiter la taille du body à 20MB

// Middleware pour tout accepter avec CORS
app.use(cors()); // Accepte toutes les requêtes cross-origin

const lotoPrompt: string = process.env.LOTO_PROMPT || "";

app.use((req, res, next) => {
  const apiKey = req.headers["x-api-key"];
  if (apiKey !== process.env.API_SECRET) {
    console.warn(`Tentative d'accès non autorisée avec la clé : ${apiKey}`);
    return res.status(403).json({ error: "Forbidden: Invalid API key" });
  }
  console.log("Authentification réussie");
  next();
});

// Endpoint pour tester l'API
app.get("/test", (req, res) => {
  console.log("GET request to the /test endpoint is successful!");
  res.send("GET request to the /test endpoint is successful!");
});
// Endpoint pour tester l'API
app.get("/need-update", (req, res) => {
  const frontVersion = req.query.version as string;
  const currentFontVersion = versions.find(
    (version) => version.frontVersion === frontVersion
  );
  res.json({ needUpdate: currentFontVersion?.needUpdate });
});

app.post("/analyze", async (req, res) => {
  try {
    const { base64Image, fileType } = req.body;

    if (!base64Image || fileType !== "image") {
      return res.status(400).json({ error: "Base64 image data is required" });
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini", // Modèle GPT-4
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: lotoPrompt,
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${base64Image}`,
              },
            },
          ],
        },
      ],
    });

    const result = response.choices[0]?.message?.content;
    // Si le résultat est sous forme de chaîne JSON, parser pour être sûr que c'est un objet JSON
    const parsedResult =
      typeof result === "string" ? JSON.parse(result) : result;

    // Convertir en JSON compacté (sans retours à la ligne ni espaces inutiles)
    res.send(JSON.stringify(parsedResult, null, 0)); // Compactage du JSON
  } catch (error) {
    res.status(500).json({ error: "Error processing image" });
  }
});

// Nouveau endpoint pour traiter CSV, XLS et PDF
app.post("/analyze-file", upload.single("file"), async (req, res) => {
  try {
    const { fileType } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: "File is required" });
    }

    const filePath = req.file.path;
    let extractedText = "";

    // Traitement selon le type de fichier
    if (fileType === "pdf") {
      const pdfBuffer = fs.readFileSync(filePath);
      const pdfData = await pdfParse(pdfBuffer);
      extractedText = pdfData.text;
    } else if (fileType === "csv") {
      // Lecture du fichier CSV de manière asynchrone et stockage du contenu
      const csvData = fs.readFileSync(filePath);
      extractedText = (await parseCSVToText(csvData)) as string;
    } else if (fileType === "excel") {
      const workbook = xlsx.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = xlsx.utils.sheet_to_json(worksheet);
      extractedText = JSON.stringify(jsonData);
    } else {
      return res.status(400).json({ error: "Unsupported file type" });
    }

    // Envoyer le texte extrait et le prompt à GPT-4 pour analyse
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: `${lotoPrompt}\n\nTexte extrait:\n${extractedText}`,
        },
      ],
    });

    const result = response.choices[0]?.message?.content;
    // Si le résultat est sous forme de chaîne JSON, parser pour être sûr que c'est un objet JSON
    const parsedResult =
      typeof result === "string" ? JSON.parse(result) : result;

    // Convertir en JSON compacté (sans retours à la ligne ni espaces inutiles)
    res.send(JSON.stringify(parsedResult, null, 0)); // Compactage du JSON

    fs.unlinkSync(filePath);
  } catch (error) {
    res.status(500).json({ error: "Error processing file" });
  }
});

// Fonction pour lire un fichier CSV et retourner son contenu en tant que texte
function parseCSVToText(csvData: any) {
  return new Promise((resolve, reject) => {
    parse(csvData, { delimiter: "," }, (err, output) => {
      if (err) {
        return reject(err);
      }
      resolve(JSON.stringify(output));
    });
  });
}

// Démarrer le serveur
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
  console.log("Configuration CORS activée");
});
