// app/api/proctor/route.ts
// NEW FILE — Camera proctoring endpoint
// Analyzes snapshots and returns violation type
// Uses Gemini Vision (free, already in your stack)

import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

export async function POST(req: Request) {
  try {
    const { snapshot } = await req.json();

    if (!snapshot || !snapshot.startsWith("data:image")) {
      return NextResponse.json({ violation: "none" });
    }

    // Strip the data URL prefix to get raw base64
    const base64Data = snapshot.replace(/^data:image\/\w+;base64,/, "");

    const prompt = `You are a strict interview proctoring system. Analyze this webcam frame from a job interview.

Respond ONLY with a JSON object — no markdown, no explanation:

{
  "violation": "none" | "absent" | "looking_away" | "multiple_faces",
  "confidence": "high" | "medium" | "low",
  "note": "one short sentence"
}

Rules:
- "none" = person is visible, looking at camera, alone in frame
- "absent" = no face visible, or face is mostly cut off (>60% missing)  
- "looking_away" = person is clearly looking away from camera (side profile, looking down at phone, etc.)
- "multiple_faces" = more than one person visible in frame
- If the image is blurry or dark but a face is roughly visible, return "none"
- Only flag clear, obvious violations — don't be overly strict
- confidence: how certain you are of the violation`;

    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: "image/jpeg",
          data: base64Data,
        },
      },
      { text: prompt },
    ]);

    const text = result.response.text().trim();

    // Parse safely
    let parsed: any = { violation: "none" };
    try {
      const cleaned = text.replace(/```json|```/g, "").trim();
      const start = cleaned.indexOf("{");
      const end = cleaned.lastIndexOf("}");
      if (start !== -1 && end !== -1) {
        parsed = JSON.parse(cleaned.slice(start, end + 1));
      }
    } catch {
      // If parsing fails, treat as no violation — don't punish for API issues
      return NextResponse.json({ violation: "none" });
    }

    // Only return high/medium confidence violations
    // Low confidence = don't penalize
    if (parsed.confidence === "low") {
      parsed.violation = "none";
    }

    return NextResponse.json({
      violation: parsed.violation || "none",
      note: parsed.note || "",
    });

  } catch (error) {
    console.error("[Proctor] error:", error);
    // On any error, return none — never punish for API failure
    return NextResponse.json({ violation: "none" });
  }
}
