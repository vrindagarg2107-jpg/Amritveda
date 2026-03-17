import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import OpenAI from "openai";

const JWT_SECRET = process.env.SESSION_SECRET || "amritveda_secret";

const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
});

function authenticateToken(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ message: "No token provided" });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(401).json({ message: "Invalid token" });
    (req as any).user = user;
    next();
  });
}

async function callOpenAI(systemPrompt: string, userMessage: string) {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    response_format: { type: "json_object" },
    temperature: 0.7,
  });
  const text = completion.choices[0].message.content || "{}";
  return JSON.parse(text);
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  // AUTH
  app.post(api.auth.register.path, async (req, res) => {
    try {
      const input = api.auth.register.input.parse(req.body);
      const existingUser = await storage.getUserByEmail(input.email);
      if (existingUser) return res.status(400).json({ message: "User already exists with this email" });
      const hashedPassword = await bcrypt.hash(input.password, 10);
      const user = await storage.createUser({ ...input, password: hashedPassword });
      res.status(201).json(user);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post(api.auth.login.path, async (req, res) => {
    try {
      const input = api.auth.login.input.parse(req.body);
      const user = await storage.getUserByEmail(input.email);
      if (!user) return res.status(401).json({ message: "Invalid email or password" });
      const validPassword = await bcrypt.compare(input.password, user.password);
      if (!validPassword) return res.status(401).json({ message: "Invalid email or password" });
      const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: "24h" });
      res.status(200).json({ user, token });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get(api.auth.profile.path, authenticateToken, async (req, res) => {
    const userId = (req as any).user.id;
    const user = await storage.getUser(userId);
    if (!user) return res.status(401).json({ message: "User not found" });
    res.status(200).json(user);
  });

  // DISEASE PREDICTION with AI
  app.post(api.disease.predict.path, authenticateToken, async (req, res) => {
    try {
      const input = api.disease.predict.input.parse(req.body);
      const symptoms = input.symptoms.join(", ");

      const systemPrompt = `You are an expert Ayurvedic physician and diagnostician with 30+ years of experience in traditional Indian medicine (Ayurveda). 
      Your task is to analyze symptoms and provide a comprehensive Ayurvedic health assessment.
      
      Ayurvedic knowledge base:
      - Vata dosha (air+ether): governs movement, nervous system. Imbalance causes anxiety, dryness, constipation, joint pain, insomnia.
      - Pitta dosha (fire+water): governs digestion, metabolism. Imbalance causes inflammation, acidity, skin rashes, anger, fever.
      - Kapha dosha (water+earth): governs structure, immunity. Imbalance causes congestion, weight gain, lethargy, depression, diabetes.
      
      Common conditions:
      - Vata imbalance: arthritis, anxiety, IBS, insomnia, dry skin
      - Pitta imbalance: acid reflux, migraines, liver disorders, inflammation
      - Kapha imbalance: respiratory issues, obesity, diabetes, depression
      - Tridoshic conditions can affect all doshas
      
      Respond ONLY in valid JSON with this structure:
      {
        "predictedDisease": "condition name",
        "doshaImbalance": "Vata/Pitta/Kapha/Tridoshic",
        "confidence": "percentage like 82%",
        "description": "2-3 sentence Ayurvedic explanation of the condition",
        "remedies": ["specific herb/remedy with usage instructions", ...at least 6 items],
        "foods": ["specific food recommendation with reason", ...at least 6 items],
        "lifestyle": ["specific lifestyle tip", ...at least 4 items],
        "yogaPoses": ["yoga pose name and benefit", ...at least 3 items],
        "avoid": ["things to avoid", ...at least 4 items]
      }`;

      const result = await callOpenAI(systemPrompt, `Patient symptoms: ${symptoms}`);
      res.status(200).json(result);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      console.error("Disease prediction error:", err);
      res.status(500).json({ message: "Failed to analyze symptoms. Please try again." });
    }
  });

  // DOSHA ANALYSIS with AI
  app.post(api.dosha.analyze.path, authenticateToken, async (req, res) => {
    try {
      const input = api.dosha.analyze.input.parse(req.body);
      const answers = input.answers;

      // Local scoring
      const scores: Record<string, number> = { vata: 0, pitta: 0, kapha: 0 };
      const doshaMap: Record<string, string> = {
        thin: "vata", dry: "vata", anxious: "vata", variable: "vata", light: "vata",
        cold: "vata", creative: "vata", fast: "vata", irregular: "vata", flexible: "vata",
        medium: "pitta", sensitive: "pitta", angry: "pitta", focused: "pitta", moderate: "pitta",
        warm: "pitta", sharp: "pitta", competitive: "pitta", oily_pitta: "pitta",
        large: "kapha", oily: "kapha", withdrawn: "kapha", steady: "kapha", deep: "kapha",
        moist: "kapha", methodical: "kapha", slow: "kapha", heavy: "kapha",
      };

      for (const val of Object.values(answers)) {
        const dosha = doshaMap[val as string];
        if (dosha) scores[dosha]++;
      }

      const primaryDosha = Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];

      const systemPrompt = `You are a master Ayurvedic practitioner. Based on the dosha constitution analysis, provide personalized comprehensive wellness advice.
      
      Respond ONLY in valid JSON with this structure:
      {
        "dosha": "dominant dosha name (capitalize first letter)",
        "description": "3-4 sentence description of this dosha personality and physical traits",
        "scores": { "vata": number, "pitta": number, "kapha": number },
        "lifestyleAdvice": ["detailed lifestyle tip", ...8 items],
        "recommendations": ["dietary recommendation with specifics", ...8 items],
        "herbsAndSupplements": ["herb name: how to use and benefit", ...6 items],
        "yogaPoses": ["pose name: benefit for this dosha", ...5 items],
        "dailyRoutine": ["morning/evening routine item", ...6 items],
        "avoid": ["foods/activities to avoid", ...5 items]
      }`;

      const aiResult = await callOpenAI(
        systemPrompt,
        `Patient's dosha scores: Vata=${scores.vata}, Pitta=${scores.pitta}, Kapha=${scores.kapha}. Primary dosha: ${primaryDosha}. Quiz answers: ${JSON.stringify(answers)}`
      );

      aiResult.dosha = primaryDosha.charAt(0).toUpperCase() + primaryDosha.slice(1);
      aiResult.scores = scores;

      const userId = (req as any).user.id;
      await storage.updateUser(userId, { dosha: aiResult.dosha });

      res.status(200).json(aiResult);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      console.error("Dosha analysis error:", err);
      res.status(500).json({ message: "Failed to analyze dosha. Please try again." });
    }
  });

  // REMEDY GENERATOR with AI
  app.post(api.remedy.generate.path, authenticateToken, async (req, res) => {
    try {
      const input = api.remedy.generate.input.parse(req.body);
      const symptoms = input.symptoms.join(", ");

      const systemPrompt = `You are a master Ayurvedic herbalist and healer with deep knowledge of traditional remedies, herbs, spices, oils, and healing foods.
      
      Provide comprehensive natural Ayurvedic remedies for the given condition/symptoms.
      Include specific preparation instructions for home remedies.
      
      Respond ONLY in valid JSON with this structure:
      {
        "condition": "name of the condition/imbalance",
        "remedies": [
          "Herb/Remedy name: specific preparation and dosage instructions",
          ...at least 8 items
        ],
        "naturalTreatments": [
          "Specific treatment with detailed instructions",
          ...at least 6 items
        ],
        "healingFoods": ["food: how it helps and how to consume", ...6 items],
        "herbalTeas": ["tea recipe: ingredients and preparation", ...4 items],
        "oilsAndMassage": ["oil name: application method and benefit", ...3 items],
        "yogaAndPranayama": ["practice name: how to do and benefit", ...4 items],
        "warnings": [
          "Important safety note or contraindication",
          ...at least 4 items
        ]
      }`;

      const result = await callOpenAI(systemPrompt, `Patient complaints/symptoms: ${symptoms}`);
      res.status(200).json(result);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      console.error("Remedy generation error:", err);
      res.status(500).json({ message: "Failed to generate remedies. Please try again." });
    }
  });

  // CHAT with AI
  app.post(api.chat.send.path, authenticateToken, async (req, res) => {
    try {
      const input = api.chat.send.input.parse(req.body);

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are Veda, a wise and compassionate Ayurvedic wellness assistant with deep knowledge of:
            - Ayurvedic medicine (Vata, Pitta, Kapha doshas)
            - Herbs: Ashwagandha, Turmeric, Tulsi, Brahmi, Triphala, Neem, Shatavari, Amalaki, Guduchi, etc.
            - Yoga, Pranayama, and meditation practices
            - Ayurvedic diet and nutrition (sattvic, rajasic, tamasic foods)
            - Panchakarma and detox therapies
            - Home remedies for common ailments
            - Seasonal routines (Ritucharya) and daily routines (Dinacharya)
            - Marma therapy and Abhyanga (oil massage)
            
            Speak warmly and knowledgeably. Start responses with "Namaste" occasionally. 
            Give practical, actionable advice. Keep responses concise but comprehensive (2-4 paragraphs max).
            Always recommend consulting a qualified Ayurvedic practitioner for serious health concerns.
            Do not diagnose or prescribe medications. Focus on wellness, prevention, and natural healing.`,
          },
          { role: "user", content: input.message },
        ],
        temperature: 0.8,
        max_tokens: 500,
      });

      const response = completion.choices[0].message.content || "I apologize, I could not process your request. Please try again.";
      res.status(200).json({ response });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      console.error("Chat error:", err);
      res.status(500).json({ message: "Failed to get AI response. Please try again." });
    }
  });

  // PRACTITIONER PATIENTS
  app.get(api.practitioner.patients.path, authenticateToken, async (req, res) => {
    try {
      const user = (req as any).user;
      if (user.role !== "practitioner") return res.status(401).json({ message: "Unauthorized" });
      const patients = await storage.getPractitionerPatients(user.id);
      res.status(200).json(patients);
    } catch (err) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  seedDatabase().catch(console.error);
  return httpServer;
}

async function seedDatabase() {
  try {
    const existing = await storage.getUserByEmail("practitioner@amritveda.com");
    if (!existing) {
      const hashedPassword = await bcrypt.hash("password123", 10);
      await storage.createUser({
        name: "Dr. Priya Sharma",
        email: "practitioner@amritveda.com",
        password: hashedPassword,
        role: "practitioner",
        contactNumber: "+91-9876543210",
        bloodGroup: "O+",
        dob: "1980-03-15",
      });
      const patient = await storage.createUser({
        name: "Rahul Kumar",
        email: "patient@example.com",
        password: hashedPassword,
        role: "patient",
        contactNumber: "+91-9123456789",
        bloodGroup: "B+",
        dob: "1995-05-15",
      });
      await storage.updateUser(patient.id, { dosha: "Vata" });
    }
  } catch (err) {
    console.error("Seed error:", err);
  }
}
