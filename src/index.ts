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

console.log("Configuration initiale chargée");
console.log(`Port configuré : ${port}`);
console.log(`Prompt configuré : ${lotoPrompt ? "Oui" : "Non"}`);

app.use((req, res, next) => {
  console.log(`Nouvelle requête reçue : ${req.method} ${req.path}`);
  const apiKey = req.headers["x-api-key"];
  console.log(`API Key : ${apiKey}`);
  console.log(`process API Key : ${process.env.API_SECRET}`);
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
  const currentVersion = req.query.version as string;
  const needUpdate = versions.some(
    (version) =>
      version.version === currentVersion &&
      version.minSupportedVersion !== currentVersion
  );
  res.json({ needUpdate });
});

app.post("/analyze", async (req, res) => {
  try {
    console.log("Nouvelle requête d'analyse d'image reçue");
    const { base64Image, fileType } = req.body;

    if (!base64Image || fileType !== "image") {
      console.error("Données d'image manquantes ou type de fichier incorrect");
      return res.status(400).json({ error: "Base64 image data is required" });
    }

    console.log("Envoi de la requête à OpenAI...");
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
    console.log("Réponse reçue d'OpenAI", result);

    // Si le résultat est sous forme de chaîne JSON, parser pour être sûr que c'est un objet JSON
    const parsedResult =
      typeof result === "string" ? JSON.parse(result) : result;

    // Convertir en JSON compacté (sans retours à la ligne ni espaces inutiles)
    res.send(JSON.stringify(parsedResult, null, 0)); // Compactage du JSON
  } catch (error) {
    console.error("Erreur lors du traitement de l'image:", error);
    res.status(500).json({ error: "Error processing image" });
  }
});

// Nouveau endpoint pour traiter CSV, XLS et PDF
app.post("/analyze-file", upload.single("file"), async (req, res) => {
  try {
    console.log("Nouvelle requête d'analyse de fichier reçue");
    const { fileType } = req.body;
    console.log(`Type de fichier : ${fileType}`);

    if (!req.file) {
      console.error("Aucun fichier n'a été fourni");
      return res.status(400).json({ error: "File is required" });
    }

    console.log(
      `Fichier reçu : ${req.file.originalname}, taille : ${req.file.size} bytes`
    );
    const filePath = req.file.path;
    let extractedText = "";

    // Traitement selon le type de fichier
    if (fileType === "pdf") {
      console.log("Traitement du fichier PDF...");
      const pdfBuffer = fs.readFileSync(filePath);
      const pdfData = await pdfParse(pdfBuffer);
      extractedText = pdfData.text;
    } else if (fileType === "csv") {
      console.log("Traitement du fichier CSV...");
      // Lecture du fichier CSV de manière asynchrone et stockage du contenu
      const csvData = fs.readFileSync(filePath);
      extractedText = (await parseCSVToText(csvData)) as string;
    } else if (fileType === "excel") {
      console.log("Traitement du fichier Excel...");
      const workbook = xlsx.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = xlsx.utils.sheet_to_json(worksheet);
      extractedText = JSON.stringify(jsonData);
    } else {
      return res.status(400).json({ error: "Unsupported file type" });
    }

    console.log("Envoi du texte extrait à OpenAI...");
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
    console.log("Réponse reçue d'OpenAI", result);
    // Si le résultat est sous forme de chaîne JSON, parser pour être sûr que c'est un objet JSON
    const parsedResult =
      typeof result === "string" ? JSON.parse(result) : result;

    // Convertir en JSON compacté (sans retours à la ligne ni espaces inutiles)
    res.send(JSON.stringify(parsedResult, null, 0)); // Compactage du JSON

    console.log("Suppression du fichier temporaire");
    fs.unlinkSync(filePath);
  } catch (error) {
    console.error("Erreur lors du traitement du fichier:", error);
    res.status(500).json({ error: "Error processing file" });
  }
});

// Fonction pour lire un fichier CSV et retourner son contenu en tant que texte
function parseCSVToText(csvData: any) {
  console.log("Début du parsing CSV");
  return new Promise((resolve, reject) => {
    parse(csvData, { delimiter: "," }, (err, output) => {
      if (err) {
        console.error("Erreur lors du parsing CSV:", err);
        return reject(err);
      }
      console.log(`CSV parsé avec succès, ${output.length} lignes trouvées`);
      resolve(JSON.stringify(output));
    });
  });
}

// Démarrer le serveur
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
  console.log("Configuration CORS activée");
});
