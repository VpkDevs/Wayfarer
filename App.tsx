/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState, useEffect, useRef } from 'react';
import { Loader2, AlertTriangle, RefreshCw } from 'lucide-react';
import RoutePlanner from './components/RoutePlanner';
import StoryPlayer from './components/StoryPlayer';
import MapBackground from './components/MapBackground';
import { AppState, RouteDetails, AudioStory } from './types';
import { generateSegment, generateSegmentAudio, calculateTotalSegments, generateStoryOutline } from './services/geminiService';

declare global {
  interface Window {
    webkitAudioContext: typeof AudioContext;
    gm_authFailure?: () => void;
  }
}

const withTimeout = <T,>(promise: Promise<T>, ms: number, errorMsg: string): Promise<T> => {
    let timer: any;
    const timeoutPromise = new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(errorMsg)), ms);
    });
    return Promise.race([
        promise.then(val => { clearTimeout(timer); return val; }),
        timeoutPromise
    ]);
};

function App() {
  const [appState, setAppState] = useState<AppState>(AppState.PLANNING);
  const [route, setRoute] = useState<RouteDetails | null>(null);
  const [story, setStory] = useState<AudioStory | null>(null);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [scriptError, setScriptError] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [mapApiAvailable, setMapApiAvailable] = useState<boolean>(true);

  // --- Buffering Engine State ---
  const isGeneratingRef = useRef<boolean>(false);
  const [isBackgroundGenerating, setIsBackgroundGenerating] = useState(false);
  const [currentPlayingIndex, setCurrentPlayingIndex] = useState<number>(0);

  // --- Google Maps Bootstrap ---
  useEffect(() => {
    const SCRIPT_ID = 'google-maps-script';
    const getApiKey = () => {
        const key = process.env.API_KEY;
        if (!key) return null;
        return key.replace(/["']/g, "").trim();
    };

    const apiKey = getApiKey();
    if (!apiKey) {
        // If no key at all, we can't do anything (GenAI also needs it)
        setScriptError("API Key is missing. Please check your environment configuration.");
        return;
    }
    
    if (document.getElementById(SCRIPT_ID) || window.google?.maps) return;

    // Define auth failure handler BEFORE loading script
    window.gm_authFailure = () => {
        console.warn("Google Maps Auth Failure. Falling back to text-only mode.");
        setMapApiAvailable(false);
    };

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&loading=async&v=weekly&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
        console.warn("Google Maps script failed to load.");
        setMapApiAvailable(false);
    };
    
    document.head.appendChild(script);

    // Safety timeout: If maps doesn't load in 3s, assume unavailable/blocked
    const timeoutId = setTimeout(() => {
        if (!window.google?.maps) {
            setMapApiAvailable(false);
        }
    }, 3000);

    return () => clearTimeout(timeoutId);
  }, []);

  // --- Continuous Buffering Engine ---
  useEffect(() => {
      if (!story || !route || appState < AppState.READY_TO_PLAY) return;

      const totalGenerated = story.segments.length;
      const neededBufferIndex = currentPlayingIndex + 3; 

      if (totalGenerated < neededBufferIndex && totalGenerated < story.totalSegmentsEstimate && !isGeneratingRef.current) {
          generateNextSegment(totalGenerated + 1);
      }
  }, [story, route, appState, currentPlayingIndex]);

  const generateNextSegment = async (index: number) => {
      if (!route || !story || isGeneratingRef.current) return;
      
      try {
          isGeneratingRef.current = true;
          setIsBackgroundGenerating(true);
          console.log(`[Buffering] Starting generation for Segment ${index}...`);

          const allPreviousText = story.segments.map(s => s.text).join(" ").slice(-3000);
          const segmentOutline = story.outline[index - 1] || "Continue the journey towards the final destination.";

          const segmentData = await withTimeout(
              generateSegment(route, index, story.totalSegmentsEstimate, segmentOutline, allPreviousText),
              60000,
              `Text generation timed out for segment ${index}`
          );
          
          const AudioContextClass = window.AudioContext || window.webkitAudioContext;
          const tempCtx = new AudioContextClass();
          const audioBuffer = await withTimeout(
              generateSegmentAudio(segmentData.text, tempCtx, route.voiceName),
              100000,
              `Audio generation timed out for segment ${index}`
          );
          await tempCtx.close();

          setStory(prev => {
              if (!prev) return null;
              if (prev.segments.some(s => s.index === index)) return prev;
              return {
                  ...prev,
                  segments: [...prev.segments, { ...segmentData, audioBuffer }].sort((a, b) => a.index - b.index)
              };
          });

      } catch (e) {
          console.error(`Failed to generate segment ${index}`, e);
      } finally {
          isGeneratingRef.current = false;
          setIsBackgroundGenerating(false);
      }
  };

  const handleGenerateStory = async (details: RouteDetails) => {
    setRoute(details);
    setGenerationError(null);
    
    try {
      setAppState(AppState.GENERATING_INITIAL_SEGMENT);
      window.scrollTo({ top: 0, behavior: 'smooth' });

      const totalSegmentsEstimate = calculateTotalSegments(details.durationSeconds);
      setLoadingMessage("Mapping the narrative arc...");

      const outline = await withTimeout(
          generateStoryOutline(details, totalSegmentsEstimate),
          60000, "Story outline generation timed out"
      );

      setLoadingMessage("Writing the opening chapter...");
      const firstOutlineBeat = outline[0] || "Begin the journey.";
      const seg1Data = await withTimeout(
          generateSegment(details, 1, totalSegmentsEstimate, firstOutlineBeat, ""),
          60000, "Initial text generation timed out"
      );
      
      setLoadingMessage("Synthesizing neural voice...");
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      const tempCtx = new AudioContextClass();
      const seg1Audio = await withTimeout(
          generateSegmentAudio(seg1Data.text, tempCtx, details.voiceName),
          100000, "Initial audio generation timed out"
      );
      await tempCtx.close();

      setStory({
          totalSegmentsEstimate,
          outline,
          segments: [{ ...seg1Data, audioBuffer: seg1Audio }]
      });

      setAppState(AppState.READY_TO_PLAY);

    } catch (error: any) {
      console.error("Initial generation failed:", error);
      setAppState(AppState.PLANNING);
      
      let message = "We couldn't start the story. Please check your route.";
      if (error.message && (error.message.includes("timed out") || error.message.includes("timeout"))) {
          message = "The journey is long, and our storytellers timed out. Try a shorter segment?";
      }
      setGenerationError(message);
    }
  };

  const handleReset = () => {
      setAppState(AppState.PLANNING);
      setRoute(null);
      setStory(null);
      setCurrentPlayingIndex(0);
      setGenerationError(null);
      isGeneratingRef.current = false;
      setIsBackgroundGenerating(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Visual state helpers
  const isCompact = appState >= AppState.GENERATING_INITIAL_SEGMENT;
  const isPlaying = appState === AppState.READY_TO_PLAY || appState === AppState.PLAYING;

  if (scriptError) {
      return (
          <div className="min-h-screen bg-wayfarer-50 flex items-center justify-center p-6">
              <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md text-center space-y-4 border border-red-100">
                  <AlertTriangle size={32} className="text-red-500 mx-auto" />
                  <p className="text-wayfarer-800 font-medium">{scriptError}</p>
              </div>
          </div>
      )
  }

  return (
    <div className="min-h-screen bg-wayfarer-50 text-wayfarer-900 font-sans selection:bg-stone-200">
      
      {/* Background Map for Ambience (Fades out when playing real map) */}
      <div className={`fixed inset-0 z-0 transition-opacity duration-1000 ${isPlaying ? 'opacity-0' : 'opacity-100'}`}>
          {mapApiAvailable && <MapBackground route={route} />}
      </div>

      <main className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 pt-8 pb-32 flex flex-col items-center">
        
        {/* Header / Brand */}
        <div className={`transition-all duration-700 ease-[cubic-bezier(0.25,1,0.5,1)] mb-8 text-center ${isCompact ? 'scale-75 opacity-0 h-0 overflow-hidden' : 'scale-100 opacity-100'}`}>
            <h1 className="text-6xl md:text-8xl font-serif tracking-tighter text-wayfarer-900 mb-4">
                Wayfarer
            </h1>
            <p className="text-lg md:text-xl text-wayfarer-800/60 font-light max-w-lg mx-auto leading-relaxed">
                Generative audio storytelling that adapts to your real-world journey.
            </p>
        </div>

        {/* Input Section (Morphs into Header) */}
        <div className="w-full relative">
            <RoutePlanner 
              onRouteFound={handleGenerateStory} 
              appState={appState} 
              externalError={generationError}
              isCompact={isCompact}
              onReset={handleReset}
              mapApiAvailable={mapApiAvailable}
            />
        </div>

        {/* Loading State */}
        {appState === AppState.GENERATING_INITIAL_SEGMENT && (
            <div className="mt-24 flex flex-col items-center justify-center space-y-6 animate-fade-in text-center z-20">
                <div className="relative">
                    <div className="absolute inset-0 bg-wayfarer-200 rounded-full animate-ping opacity-25"></div>
                    <Loader2 size={40} className="animate-spin text-wayfarer-900 relative z-10" />
                </div>
                <h3 className="text-2xl font-serif text-wayfarer-900 animate-pulse">{loadingMessage}</h3>
            </div>
        )}

        {/* Player Section */}
        {isPlaying && story && route && (
            <div className="w-full mt-8 animate-slide-up">
                <StoryPlayer 
                    story={story} 
                    route={route} 
                    onSegmentChange={(index) => setCurrentPlayingIndex(index)}
                    isBackgroundGenerating={isBackgroundGenerating}
                    mapApiAvailable={mapApiAvailable}
                />
            </div>
        )}
      </main>
    </div>
  );
}

export default App;