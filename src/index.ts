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
      model: process.env.OPENAI_MODEL || "gpt-4o", // Modèle GPT-4
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

    if (fileType === "pdf") {
      const pdfBuffer = fs.readFileSync(filePath);
      const pdfData = await pdfParse(pdfBuffer);
      extractedText = pdfData.text;

      // Tentative de parse manuel d'abord
      try {
        if (extractedText.includes("LOTOQUINE")) {
          const parsedLotoData = parseLotoQuineData(extractedText);
          if (parsedLotoData && parsedLotoData.length > 0) {
            fs.unlinkSync(filePath);
            return res.json(parsedLotoData);
          }
        } else if (extractedText.includes("WWW.CARTALOTO.NET")) {
          const parsedCartaLotoData = parseCartaLotoData(extractedText);
          if (parsedCartaLotoData && parsedCartaLotoData.cartons?.length > 0) {
            fs.unlinkSync(filePath);
            return res.json(parsedCartaLotoData);
          }
        }
      } catch (parseError) {
        console.log("Échec du parse manuel, utilisation de l'IA:", parseError);
      }

      // Si le parse manuel échoue ou ne trouve rien, on utilise l'IA
      console.log("Utilisation de l'IA pour analyser le PDF");
    } else if (fileType === "csv") {
      const csvData = fs.readFileSync(filePath);
      extractedText = (await parseCSVToText(csvData)) as string;
    } else if (fileType === "excel") {
      const workbook = xlsx.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = xlsx.utils.sheet_to_json(worksheet);
      extractedText = JSON.stringify(jsonData);
    }

    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: `${lotoPrompt}\n\nTexte extrait:\n${extractedText}`,
        },
      ],
    });

    const result = response.choices[0]?.message?.content;
    const parsedResult =
      typeof result === "string" ? JSON.parse(result) : result;
    res.send(JSON.stringify(parsedResult, null, 0));

    fs.unlinkSync(filePath);
  } catch (error) {
    console.error(
      "Erreur détaillée:",
      error instanceof Error ? error.message : error
    );
    if (req.file?.path) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({
      error: "Error processing file",
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

// Fonction pour lire un fichier CSV et retourner son contenu en tant que texte
function parseCSVToText(csvData: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    parse(csvData, { delimiter: "," }, (err, output) => {
      if (err) {
        return reject(err);
      }
      resolve(JSON.stringify(output));
    });
  });
}

function parseLotoQuineData(text: string) {
  const results = [];
  const seenNumeros = new Set();
  const sections = text.split("LOTOQUINE").slice(1);

  for (const section of sections) {
    const lines = section
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line);
    if (lines.length < 4) continue;

    const [line1, line2, line3, numeroStr] = lines;
    if (seenNumeros.has(numeroStr)) continue;
    seenNumeros.add(numeroStr);

    const quines = [line1, line2, line3].map((line) => {
      let numbers;
      if (line.length === 9) {
        const firstNum = parseInt(line[0]);
        const restOfNumbers = (line.slice(1).match(/.{2}/g) || []).map((num) =>
          parseInt(num)
        );
        numbers = [firstNum, ...restOfNumbers];
      } else {
        numbers = (line.match(/.{2}/g) || []).map((num) => parseInt(num));
      }

      if (numbers.length !== 5 || !numbers.every((n) => n >= 1 && n <= 90)) {
        console.warn(`Ligne invalide ignorée: ${line}`);
        return [];
      }
      return numbers;
    });

    if (quines.every((q) => q.length === 5)) {
      results.push({
        numero: numeroStr,
        quines,
      });
    }
  }

  console.log(`Nombre de grilles trouvées: ${results.length}`);
  return results;
}

function parseCartaLotoData(text: string) {
  const results = [];
  const cartonLines = (text.match(/528\s*\d{3}/g) || []).reverse();

  // Extraire le premier numéro seul
  const firstSingleNumber = text.match(/^\s*(\d+)\s*$/m)?.[1];

  // Extraire les nombres répétés (format: nombre\nnombre)
  const repeatedNumbers =
    text
      .match(/(\d{1,2})\n\1/g)
      ?.map((n) => parseInt(n.split("\n")[0]))
      ?.filter((n) => n >= 1 && n <= 90) || [];

  // Extraire tous les nombres qui ont au moins 9 chiffres
  const allNumbers = text.match(/\b\d{9,}\b/g) || [];
  const uniqueNumbers = [...new Set(allNumbers)];

  // Pour le premier carton (format spécial)
  if (firstSingleNumber && repeatedNumbers.length >= 15) {
    const firstCardQuines = [];
    for (let i = 0; i < 15; i += 5) {
      const quine = repeatedNumbers.slice(i, i + 5);
      if (quine.length === 5) {
        firstCardQuines.push(quine);
      }
    }
    if (firstCardQuines.length === 3) {
      results.push({
        numero: firstSingleNumber,
        quines: firstCardQuines,
      });
    }
  }

  // Nouveau format : nombres répétés suivis d'un numéro de carton
  const numbersAndCardId = text.match(/(\d+)\n\1/g);
  if (numbersAndCardId && numbersAndCardId.length >= 15) {
    // Recherche d'un numéro de carton au format "XXX XXX" ou "XXXXXX"
    const cardId = text
      .match(/(\d{3}\s*\d{3})$/)?.[0]
      ?.replace(/\s+/g, " ")
      .trim();
    if (cardId) {
      const numbers = numbersAndCardId
        .map((pair) => parseInt(pair.split("\n")[0]))
        .filter((n) => n >= 1 && n <= 90);

      // On prend exactement 15 nombres pour former 3 quines de 5
      if (numbers.length >= 15) {
        const quines = [
          numbers.slice(0, 5),
          numbers.slice(5, 10),
          numbers.slice(10, 15),
        ];

        results.push({
          numero: cardId,
          quines: quines,
        });
      }
    }
  }

  // Pour les autres cartons
  for (let i = 1; i < cartonLines.length; i++) {
    const startIndex = (i - 1) * 3;
    const quineNumbers = uniqueNumbers.slice(startIndex, startIndex + 3);

    const quines = quineNumbers
      .map((numStr) => {
        if (numStr.length === 9) {
          const firstNum = parseInt(numStr[0]);
          const restOfNumbers = (numStr.slice(1).match(/.{2}/g) || []).map(
            (num) => parseInt(num)
          );
          return [firstNum, ...restOfNumbers];
        } else {
          return (numStr.match(/.{2}/g) || []).map((num) => parseInt(num));
        }
      })
      .filter(
        (quine) => quine.length === 5 && quine.every((n) => n >= 1 && n <= 90)
      );

    if (quines.length === 3) {
      results.push({
        numero: cartonLines[i],
        quines: quines,
      });
    }
  }

  return {
    cartons: results,
    source: "cartaloto",
    totalCartons: results.length,
  };
}

// Démarrer le serveur
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
  console.log("Configuration CORS activée");
});
