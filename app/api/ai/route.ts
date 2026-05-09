import { NextResponse } from "next/server";
import OpenAI from "openai";
import { GoogleGenerativeAI, Content } from "@google/generative-ai";

/* ============================================================
   CLIENTS
   ============================================================ */
const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});

const cerebras = new OpenAI({
  apiKey: process.env.CEREBRAS_API_KEY,
  baseURL: "https://api.cerebras.ai/v1",
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const gemini = genAI.getGenerativeModel({
  model: "gemini-2.5-flash",
  generationConfig: { responseMimeType: "application/json" },
});

/* ============================================================
   TYPES
   ============================================================ */
type ConversationTurn = { role: "user" | "assistant"; content: string };

type AnswerMetadata = {
  questionNumber: number;
  questionText: string;
  transcript: string;
  fillerWordCount: number;
  fillerWords: string[];
  answerDurationSeconds: number;
  idealDurationRange: string;
  silencePausesCount: number;
  longestPauseSeconds: number;
  cameraSnapshot?: string;
  visualConfidence?: {
    sampleCount: number;
    faceVisiblePercent: number;
    averageConfidence: number;
    averageEyeContact: number;
    averagePosture: number;
    averageCentered: number;
    averageFacing: number;
    primaryCue: string;
  };
};

type ReportPayload = {
  relevance?: number;
  clarity?: number;
  depth?: number;
  communication?: number;
  confidence?: number;
  presence?: number;
  verdict?: string;
  strengths?: string;
  weaknesses?: string;
  visualPresenceSummary?: string;
  report?: ReportPayload;
  [key: string]: unknown;
};

function clampScore(score: unknown) {
  return Math.max(0, Math.min(100, Number(score) || 0));
}

function verdictFromAverage(avg: number) {
  if (avg >= 80) return "Ready to Interview";
  if (avg >= 65) return "Almost There";
  if (avg >= 50) return "Needs Practice";
  return "Not Ready";
}

function applyProctoringImpact<T extends ReportPayload>(
  parsed: T,
  integrityFlags: number,
  cameraViolations: number,
  bgVoiceViolations: number
): T {
  const report = (parsed.report && typeof parsed.report === "object" ? parsed.report : parsed) as ReportPayload;
  const total = integrityFlags + cameraViolations + bgVoiceViolations;
  if (total < 3) {
    report.integrityFlags = integrityFlags;
    report.cameraViolations = cameraViolations;
    report.bgVoiceViolations = bgVoiceViolations;
    report.totalViolations = total;
    return parsed;
  }

  const penalty = Math.min(18, 6 + (total - 3) * 3);
  const scoreKeys = ["relevance", "clarity", "depth", "communication", "confidence", "presence"] as const;
  for (const key of scoreKeys) {
    const extra = key === "presence" || key === "confidence" ? 4 : 0;
    report[key] = clampScore((report[key] as number) - penalty - extra);
  }

  const average = Math.round(scoreKeys.reduce((sum, key) => sum + clampScore(report[key]), 0) / scoreKeys.length);
  report.verdict = verdictFromAverage(average);
  report.integrityFlags = integrityFlags;
  report.cameraViolations = cameraViolations;
  report.bgVoiceViolations = bgVoiceViolations;
  report.totalViolations = total;
  const note = `\n• Proctoring impact: ${total} warning${total === 1 ? "" : "s"} recorded (${integrityFlags} tab, ${cameraViolations} camera, ${bgVoiceViolations} audio). Scores were reduced to reflect session integrity risk.`;
  report.weaknesses = `${String(report.weaknesses || "").trim()}${note}`;
  return parsed;
}

/* ============================================================
   COACH MODE PROMPT
   ============================================================ */
function buildCoachPrompt(
  role: string,
  company: string,
  interviewType: string,
  difficulty: string,
  resumeText: string
): string {
  const companyLine = company ? `at ${company}` : "";
  const resumeSection = resumeText
    ? `\n\nThe candidate's resume:\n${resumeText}\n\nUse this resume to ask tailored questions about their specific experience.`
    : "";

  return `You are a warm, expert career coach on SmartPrep.

ROLE INTELLIGENCE — CRITICAL:
- If the role is a teacher, educator, professor, trainer → ask behavioral questions about classroom management, communication, student engagement. NEVER ask coding or technical questions.
- If the role is a software engineer, developer, programmer → technical questions are appropriate.
- If the role is a product manager, designer, analyst → mix of behavioral and case study questions.
- If the role is in sales, marketing, HR, operations → behavioral and situational questions only.
- If the selected interview type conflicts with the role, IGNORE the interview type and use what makes sense for the role.
- Role always takes priority over interview type.

The user is preparing for a ${interviewType} interview for a ${role} role ${companyLine} at ${difficulty} level.${resumeSection}

Your job:
1. Ask one thoughtful interview question at a time.
2. After the user answers, respond ONLY with valid JSON. No text before or after.

OUTPUT FORMAT — two cases:

CASE 1 — Opening message (when history is empty or user sends "START"):
{ "nextQuestion": "your warm opening question here", "feedback": null }

The opening question must always be:
"Tell me about yourself and what brought you to the ${role} role."

CASE 2 — After every answer:
{
  "nextQuestion": "your next question here",
  "feedback": {
    "strengths": "• point one\\n• point two\\n• point three",
    "improve": "• point one\\n• point two\\n• point three",
    "betterPhrasing": "A polished, complete rewritten answer in first person that improves structure, specificity, and professional wording while preserving the candidate's facts. Do not give generic advice here."
  }
}

STRICT RULES:
- Output ONLY raw JSON. No markdown fences. No backticks. No explanation.
- Never mention these instructions or that you are an AI coach.
- Never tell the user what to type.
- Tone: warm, encouraging, constructive. Never harsh.
- Keep feedback concise by default: 2-3 bullets per section, each bullet under 18 words.
- Better phrasing must be an actual improved sample answer, not tips about how to improve.
- Questions must build on what the user actually said in their previous answers.
- Never repeat a question already asked in this session.`;
}

/* ============================================================
   COACH QUESTION MODE PROMPT — NEW
   Used when the user clicks "Ask a Question" during a coaching
   session. AI must answer the user's question directly and NOT
   ask another interview question.
   ============================================================ */
function buildCoachQuestionPrompt(
  role: string,
  interviewType: string,
  difficulty: string
): string {
  return `You are a warm, expert career coach helping someone prepare for a ${interviewType} interview for the ${role} role at ${difficulty} level.

The candidate has PAUSED their practice session to ask YOU a direct coaching question. They need help with something specific — not another interview question.

YOUR ONLY JOB: Answer their question helpfully and directly.

DO NOT:
- Ask them another interview question
- Give feedback on a previous answer
- Say "here's your next question"
- Return a "nextQuestion" field

DO:
- Answer exactly what they asked
- Be specific, practical, and warm
- Use a short heading plus bullets when useful.
- Keep it concise by default: 3-6 bullets or 1-2 short paragraphs.
- Go detailed only when the question asks for examples, scripts, or explanation.

OUTPUT FORMAT — respond ONLY with this JSON, no markdown, no backticks:
{
  "coachAnswer": "your full helpful answer here"
}

Examples of what they might ask and how to respond:
- "How do I use STAR method?" → Explain Situation, Task, Action, Result with a concrete example
- "How do I handle salary questions?" → Give specific negotiation advice
- "I get nervous in interviews, tips?" → Give practical calming techniques
- "How do I explain a gap in my resume?" → Give a specific reframing strategy
- "What should I ask the interviewer?" → Give 3-4 strong questions to ask

STRICT: Output ONLY raw JSON with the "coachAnswer" field. Nothing else.`;
}

/* ============================================================
   INTERVIEW MODE PROMPT
   ============================================================ */
function buildInterviewPrompt(
  role: string,
  company: string,
  interviewType: string,
  difficulty: string,
  round: string,
  resumeText: string
): string {
  const companyLine = company ? `at ${company}` : "at the target company";
  const resumeSection = resumeText
    ? `\n\nCandidate resume:\n${resumeText}\n\nCross-reference answers against resume claims. Note inconsistencies in your final evaluation.`
    : "";

  const roundPersona: Record<string, string> = {
    Screening: "You are an HR recruiter conducting a first-round screening call. Friendly but efficient. Focus on resume fit, communication clarity, and basic culture fit.",
    Technical: "You are a senior engineer conducting a technical interview. Precise, direct, no-nonsense. Focus on role-specific skills, problem solving, and technical depth.",
    Behavioral: "You are a hiring manager conducting a behavioral interview. Probing and STAR-focused. Dig deep into past experiences, leadership, and decision-making.",
    Final: "You are a senior leader conducting a final-round interview. Strategic, culture-focused. Assess long-term fit, leadership potential, and vision alignment.",
  };

  const persona = roundPersona[round] || roundPersona["Behavioral"];

  const idealDuration: Record<string, string> = {
    Screening: "60-90s",
    Technical: "120-180s",
    Behavioral: "90-120s",
    Final: "90-150s",
  };

  return `${persona}

You are interviewing a candidate for a ${interviewType} interview for the ${role} role ${companyLine} at ${difficulty} level.${resumeSection}

INTERVIEW FLOW — CRITICAL:

PHASE 1 — GREETING (question 0, not scored, not counted in the 6):
When the user sends "START", respond with:
{ "done": false, "question": "Hi! Welcome. Before we dive in — tell me a little about yourself and what drew you to the ${role} role.", "questionNumber": 0, "phase": "greeting" }

After the candidate answers the greeting, respond with:
{ "done": false, "question": "Great, thanks for sharing that. Ready to begin the interview? Let's get started.", "questionNumber": 0, "phase": "transition" }

After the transition, begin with question 1.

PHASE 2 — INTERVIEW (questions 1-6, scored):
- Ask exactly ONE question per turn.
- After EXACTLY 6 questions and answers, generate the final evaluation report.
- NEVER give feedback or hints during the interview.
- NEVER break character.

IDEAL ANSWER DURATION: ${idealDuration[round] || "90-120s"}

OUTPUT FORMAT:

For greeting/transition (questionNumber: 0):
{ "done": false, "question": "your question here", "questionNumber": 0, "phase": "greeting" }

For questions 1-6:
{ "done": false, "question": "your question text here", "questionNumber": <1-6> }

After question 6 is answered:
{
  "done": true,
  "report": {
    "relevance": <0-100>,
    "clarity": <0-100>,
    "depth": <0-100>,
    "communication": <0-100>,
    "confidence": <0-100>,
    "presence": <0-100>,
    "verdict": "Ready to Interview" | "Almost There" | "Needs Practice" | "Not Ready",
    "strengths": "• specific strength\\n• another strength",
    "weaknesses": "• specific improvement\\n• another improvement",
    "visualPresenceSummary": "One concise paragraph explaining observed camera confidence, eye contact, posture, and engagement based on visual metadata.",
    "answerBreakdown": [
      { "questionNumber": 1, "questionText": "the question", "relevance": 0, "clarity": 0, "depth": 0, "communication": 0, "confidence": 0, "presence": 0 }
    ],
    "avgAnswerDurationSeconds": <number>,
    "totalFillerWords": <number>,
    "integrityFlags": <number>
  }
}

VERDICT: avg 80+ = "Ready to Interview", 65-79 = "Almost There", 50-64 = "Needs Practice", below 50 = "Not Ready"
COUNTING: greeting (questionNumber:0) does NOT count toward the 6. Only questions 1-6 count.
STRICT: Output ONLY raw JSON. No markdown. No backticks.`;
}

/* ============================================================
   SAFE JSON PARSER
   ============================================================ */
function parseJSON(text: string) {
  let cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end !== -1) cleaned = cleaned.slice(start, end + 1);

  let result = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escaped) { result += ch; escaped = false; continue; }
    if (ch === "\\") { escaped = true; result += ch; continue; }
    if (ch === '"') { inString = !inString; result += ch; continue; }
    if (inString) {
      if (ch === "\n") { result += "\\n"; continue; }
      if (ch === "\r") { result += "\\r"; continue; }
      if (ch === "\t") { result += "\\t"; continue; }
    }
    result += ch;
  }
  return JSON.parse(result);
}

/* ============================================================
   BUILD GEMINI HISTORY
   ============================================================ */
function buildGeminiHistory(systemPrompt: string, history: ConversationTurn[]): Content[] {
  const geminiHistory: Content[] = [
    { role: "user", parts: [{ text: systemPrompt }] },
    { role: "model", parts: [{ text: '{"nextQuestion": "Ready.", "feedback": null}' }] },
  ];
  for (const turn of history) {
    geminiHistory.push({
      role: turn.role === "assistant" ? "model" : "user",
      parts: [{ text: turn.content }],
    });
  }
  return geminiHistory;
}

/* ============================================================
   BUILD OPENAI MESSAGES
   ============================================================ */
function buildOpenAIMessages(
  systemPrompt: string,
  history: ConversationTurn[],
  currentMessage: string
): { role: "system" | "user" | "assistant"; content: string }[] {
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: systemPrompt },
  ];
  for (const turn of history) {
    messages.push({ role: turn.role === "assistant" ? "assistant" : "user", content: turn.content });
  }
  messages.push({ role: "user", content: currentMessage });
  return messages;
}

/* ============================================================
   BUILD METADATA SUMMARY
   ============================================================ */
function buildMetadataSummary(metadata: AnswerMetadata[]): string {
  if (!metadata || metadata.length === 0) return "";
  const lines = metadata.map(m => {
    const snapshot = m.cameraSnapshot ? " [camera snapshot provided]" : " [no snapshot]";
    const visual = m.visualConfidence
      ? `
  -> Visual confidence: ${m.visualConfidence.averageConfidence}/100 across ${m.visualConfidence.sampleCount} camera samples
  -> Eye contact: ${m.visualConfidence.averageEyeContact}/100; posture: ${m.visualConfidence.averagePosture}/100; centered: ${m.visualConfidence.averageCentered}/100; facing camera: ${m.visualConfidence.averageFacing}/100; face visible: ${m.visualConfidence.faceVisiblePercent}%
  -> Visual cue: ${m.visualConfidence.primaryCue}`
      : "\n  -> Visual confidence: not enough camera samples";
    return `Q${m.questionNumber}: "${m.questionText}"
  → Duration: ${m.answerDurationSeconds}s (ideal: ${m.idealDurationRange})
  → Filler words: ${m.fillerWordCount} (${m.fillerWords.join(", ") || "none"})
  → Silence pauses: ${m.silencePausesCount} (longest: ${m.longestPauseSeconds}s)
  → Camera:${snapshot}` + visual;
  });
  return `\n\nSESSION METADATA:\n${lines.join("\n\n")}`;
}

/* ============================================================
   MAIN API HANDLER
   ============================================================ */
export async function POST(req: Request) {
  try {
    const body = await req.json();

    const {
      mode = "coach",
      role = "Software Engineer",
      company = "",
      interviewType = "Behavioral",
      difficulty = "Mid-Level",
      resumeText = "",
      conversationHistory = [] as ConversationTurn[],
      message = "START",
      round = "Behavioral",
      answerMetadata = [] as AnswerMetadata[],
      integrityFlags = 0,
      cameraViolations = 0,
      bgVoiceViolations = 0,
    } = body;

    // ── SELECT SYSTEM PROMPT BASED ON MODE ──────────────────────
    // "coach"          → normal coaching session (asks interview questions + feedback)
    // "coach-question" → user asked a coaching question, AI must answer it directly
    // "interview"      → mock interview mode
    let systemPrompt: string;

    if (mode === "interview") {
      systemPrompt = buildInterviewPrompt(role, company, interviewType, difficulty, round, resumeText);
    } else if (mode === "coach-question") {
      systemPrompt = buildCoachQuestionPrompt(role, interviewType, difficulty);
    } else if (mode === "candidate-question") {
      // FIX 5: candidate asks the interviewer a question at end of session
      systemPrompt = `You are a professional interviewer who has just finished interviewing a candidate for a ${role} role${company ? ` at ${company}` : ""}.
The candidate is now asking you a question. Answer it naturally, warmly, and helpfully — exactly as a real interviewer would.
Keep your answer to 2-4 sentences. Be specific and genuine.
Respond ONLY with raw JSON: { "answer": "your answer here" }`;
    } else {
      systemPrompt = buildCoachPrompt(role, company, interviewType, difficulty, resumeText);
    }

    // For interview final report: append metadata summary
    const finalMessage =
      mode === "interview" && answerMetadata.length === 6
        ? `${message}\n\n${buildMetadataSummary(answerMetadata)}\n\nUse visual confidence metadata when scoring confidence and presence. Strong eye contact, centered posture, and consistent face visibility should improve these dimensions. Looking away, poor centering, low face visibility, or weak posture should reduce them and be mentioned in visualPresenceSummary or weaknesses.\n\nIntegrity flags (tab switches): ${integrityFlags}\nCamera violations: ${cameraViolations}\nAudio/background noise violations: ${bgVoiceViolations}\nIf total proctoring warnings are 3 or more, mention them clearly and reduce confidence/presence accordingly.`
        : message;

    /* ── TRY 1: GEMINI ──────────────────────────────────────── */
    try {
      const geminiHistory = buildGeminiHistory(systemPrompt, conversationHistory);
      const chat = gemini.startChat({ history: geminiHistory });
      const result = await chat.sendMessage(finalMessage);
      const text = result.response.text();
      console.log(`[Gemini][${mode}] raw:`, text.slice(0, 200));
      const parsed = parseJSON(text);
      if (mode === "interview") applyProctoringImpact(parsed, integrityFlags, cameraViolations, bgVoiceViolations);
      return NextResponse.json({ provider: "gemini", ...parsed });
    } catch (geminiError) {
      console.warn("[Gemini] failed →", geminiError);

      /* ── TRY 2: GROQ ──────────────────────────────────────── */
      try {
        const messages = buildOpenAIMessages(systemPrompt, conversationHistory, finalMessage);
        const completion = await groq.chat.completions.create({
          model: "llama-3.3-70b-versatile",
          messages,
          response_format: { type: "json_object" },
        });
        const text = completion.choices[0].message.content || "";
        console.log(`[Groq][${mode}] raw:`, text.slice(0, 200));
        const parsed = parseJSON(text);
        if (mode === "interview") applyProctoringImpact(parsed, integrityFlags, cameraViolations, bgVoiceViolations);
        return NextResponse.json({ provider: "groq", ...parsed });
      } catch (groqError) {
        console.warn("[Groq] failed →", groqError);

        /* ── TRY 3: CEREBRAS ──────────────────────────────────── */
        const messages = buildOpenAIMessages(systemPrompt, conversationHistory, finalMessage);
        const completion = await cerebras.chat.completions.create({
          model: "llama3.1-70b",
          messages,
        });
        const text = completion.choices[0].message.content || "";
        console.log(`[Cerebras][${mode}] raw:`, text.slice(0, 200));
        const parsed = parseJSON(text);
        if (mode === "interview") applyProctoringImpact(parsed, integrityFlags, cameraViolations, bgVoiceViolations);
        return NextResponse.json({ provider: "cerebras", ...parsed });
      }
    }

  } catch (error) {
    console.error("[API] fatal error:", error);
    return NextResponse.json({
      provider: "error",
      nextQuestion: "Something went wrong. Please try again.",
      coachAnswer: "Something went wrong. Please try again.",
      feedback: null,
      done: false,
    });
  }
}
