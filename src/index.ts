import dotenv from "dotenv";
import express from "express";
import OpenAI from "openai";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

const openai = new OpenAI();

// Middleware pour analyser le JSON
app.use(express.json({ limit: "20mb" })); // Limiter la taille du body à 20MB

const lotoPrompt =
  "Analyser cette image de grille de loto et renvoyer uniquement un tableau JSON avec les grilles trouvées. Chaque grille doit contenir 15 nombres répartis sur 3 lignes de 5 nombres chacune. Le tableau JSON doit avoir cette structure : [{numero: number, quines: [[number, number, number, number, number], [number, number, number, number, number], [number, number, number, number, number]]}]";

// Endpoint pour tester l'API
app.get("/test", (req, res) => {
  res.send("GET request to the /test endpoint is successful!");
});

app.post("/analyze", async (req, res) => {
  try {
    const { base64Image, fileType } = req.body;

    // Vérification si base64Image et fileType sont présents
    if (!base64Image || fileType !== "image") {
      return res.status(400).json({ error: "Base64 image data is required" });
    }

    // Envoyer l'image encodée en base64 et le prompt à GPT-4 pour analyse
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini", // Modèle GPT-4
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

    // Récupérer et envoyer la réponse
    const result = response.choices[0];
    res.json({ result });
  } catch (error) {
    console.error("Error processing image:", error);
    res.status(500).json({ error: "Error processing image" });
  }
});

// Démarrer le serveur
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
