import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import OpenAI from "openai";

dotenv.config();
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ limit: "20mb", extended: true }));
});
const openai = new OpenAI();

app.get("/test", (req, res) => {
  res.send("GET request to the /test endpoint is successful!");
});

app.post("/analyze", upload.single("file"), async (req, res) => {
  try {
    const { fileType, base64Image } = req.body;

    if (!fileType) {
      return res.status(400).json({ error: "fileType is required" });
    }

    // const response = await openai.chat.completions.create({
    //   model: "gpt-4o",
    //   messages: [
    //     {
    //       role: "user",
    //       content: [
    //         {
    //           type: "text",
    //           text: `renvoie moi uniquement tableau json sans autre texte  avec un tableau de grilles  loto avec cette interface {
    //   numero: number;
    //   quines: TirageNumber[][];
    //   }
    // en remplissant uniquement les quines et numero de la grille si tu le trouves. Chaque plaque devrait avoir 15 nombres différents et sont répartis en 3 lignes distinctes. Chacune de ces ligne ou quine comporte exactement 5 nombres. Ordonner bien l'ordre des quiners dans lordre de l'image.  Le sens de lecture d'une grille se faite ligne par ligne de haut en bas.`,
    //         },
    //         {
    //           type: "image_url",
    //           image_url: {
    //             url: `data:image/jpeg;base64,${base64Image}`,
    //           },
    //         },
    //       ],
    //     },
    //   ],
    // });
    // const responseData = response.choices[0]?.message?.content;
    const responseData =
      '```json\n[\n  {\n    "numero": 100001,\n    "quines": [\n      [7, 13, 46, 50, 89],\n      [12, 34, 40, 51, 78],\n      [6, 23, 68, 77, 80]\n    ]\n  },\n  {\n    "numero": 100002,\n    "quines": [\n      [4, 16, 24, 67, 82],\n      [36, 48, 64, 71, 85],\n      [1, 17, 31, 59, 75]\n    ]\n  }\n]\n```';
    let cleanedJsonString = responseData?.replace(/^```json/, "").trim();
    cleanedJsonString = cleanedJsonString?.replace(/```$/, "").trim();
    const jsonResponse = cleanedJsonString ? JSON.parse(cleanedJsonString) : {};
    res.json(jsonResponse);
  } catch (error) {
    console.error("Failed to process text data:", error);
    res.status(500).send({ error: "Failed to process text data" });
  }
}

// Start server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
