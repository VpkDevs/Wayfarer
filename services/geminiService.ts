/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { GoogleGenAI, Modality } from "@google/genai";
import { RouteDetails, StorySegment, StoryStyle } from "../types";
import { base64ToArrayBuffer, pcmToWav } from "./audioUtils";

const RAW_API_KEY = process.env.API_KEY;
const API_KEY = RAW_API_KEY ? RAW_API_KEY.replace(/["']/g, "").trim() : "";

const ai = new GoogleGenAI({ apiKey: API_KEY });

const TARGET_SEGMENT_DURATION_SEC = 45; // Slightly shorter for snappier pacing
const WORDS_PER_MINUTE = 150;
const WORDS_PER_SEGMENT = Math.round((TARGET_SEGMENT_DURATION_SEC / 60) * WORDS_PER_MINUTE);

export const calculateTotalSegments = (durationSeconds: number): number => {
    return Math.max(1, Math.ceil(durationSeconds / TARGET_SEGMENT_DURATION_SEC));
};

const getStyleInstruction = (style: StoryStyle): string => {
    switch (style) {
        case 'NOIR':
            return "Genre: Noir. Atmosphere: Rain, neon, shadows, cynicism, jazz. Narration: First-person detective or third-person omniscient but gritty. Focus on the underbelly of the city.";
        case 'CHILDREN':
            return "Genre: Children's Fantasy. Atmosphere: Bright, colorful, magical, gentle. Narration: Warm, encouraging, wondrous. Objects (cars, trees) have personalities.";
        case 'HISTORICAL':
            return "Genre: Historical Drama. Atmosphere: Significant, weighty, timeless. Narration: Grandiose, focusing on the echoes of the past in the present landscape.";
        case 'FANTASY':
            return "Genre: High Fantasy. Atmosphere: Epic, dangerous, mystical. Narration: The modern world is a veneer over an ancient magical realm. The destination is a Quest objective.";
        default:
            return "Genre: Immersive Travelogue. Atmosphere: Observational, sensory, present.";
    }
};

export const generateStoryOutline = async (
    route: RouteDetails,
    totalSegments: number
): Promise<string[]> => {
    const styleInstruction = getStyleInstruction(route.storyStyle);
    const prompt = `
    Create a story outline for a journey from ${route.startAddress} to ${route.endAddress} (${route.travelMode}).
    Total Duration: ${route.duration}.
    Total Chapters needed: ${totalSegments}.
    
    ${styleInstruction}

    Structure:
    1. Beginning (Departure)
    2. Middle (The Journey/Obstacles/Reflections)
    3. End (Arrival/Resolution)

    Output STRICT JSON: An array of strings. Example: ["Chapter 1...", "Chapter 2...", "Chapter 3..."]
    Do not add markdown formatting.
    `;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: prompt,
            config: { 
                responseMimeType: 'application/json' 
            }
        });

        const text = response.text?.trim();
        if (!text) throw new Error("No outline generated.");
        
        let outline = JSON.parse(text);
        if (!Array.isArray(outline)) throw new Error("Invalid format.");

        // Adjust length
        if (outline.length < totalSegments) {
            const last = outline[outline.length - 1];
            while (outline.length < totalSegments) outline.push(last);
        }
        return outline.slice(0, totalSegments);

    } catch (error) {
        console.error("Outline Error:", error);
        return Array(totalSegments).fill("Continue the journey toward the destination.");
    }
};

export const generateSegment = async (
    route: RouteDetails,
    segmentIndex: number,
    totalSegmentsEstimate: number,
    segmentOutline: string,
    previousContext: string = ""
): Promise<StorySegment> => {

  const styleInstruction = getStyleInstruction(route.storyStyle);
  const contextPrompt = previousContext ? `PREVIOUSLY: ...${previousContext.slice(-1000)}` : "This is the start.";

  const prompt = `
    Write Chapter ${segmentIndex} of ${totalSegmentsEstimate} for an audio story.
    Route: ${route.startAddress} -> ${route.endAddress}.
    ${styleInstruction}
    
    Current Plot Point: ${segmentOutline}
    ${contextPrompt}

    Constraints:
    - Write EXACTLY ~${WORDS_PER_SEGMENT} words.
    - Style: Vivid, sensory, immersive. Geared for audio narration.
    - No "Chapter 1" titles. Just the text.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });

    return {
      index: segmentIndex,
      text: response.text?.trim() || "The journey continues...",
      audioBuffer: null
    };

  } catch (error) {
    console.error("Text Gen Error:", error);
    throw error;
  }
};

export const generateSegmentAudio = async (text: string, audioContext: AudioContext, voiceName: string = 'Kore'): Promise<AudioBuffer> => {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-preview-tts',
      contents: [{ parts: [{ text: text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceName } }
        }
      }
    });

    const part = response.candidates?.[0]?.content?.parts?.[0];
    const audioData = part?.inlineData?.data;
    if (!audioData) throw new Error("No audio data.");

    const sampleRate = 24000; 
    const wavArrayBuffer = await pcmToWav(base64ToArrayBuffer(audioData), sampleRate).arrayBuffer();
    return await audioContext.decodeAudioData(wavArrayBuffer);

  } catch (error) {
    console.error("Audio Gen Error:", error);
    throw error;
  }
};