/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, Loader2, Volume2, ArrowDown, MapOff } from 'lucide-react';
import { AudioStory, RouteDetails, StorySegment } from '../types';
import InlineMap from './InlineMap';

declare global {
  interface Window {
    webkitAudioContext: typeof AudioContext;
  }
}

interface Props {
  story: AudioStory;
  route: RouteDetails;
  onSegmentChange: (index: number) => void;
  isBackgroundGenerating: boolean;
  mapApiAvailable: boolean;
}

const StoryPlayer: React.FC<Props> = ({ story, route, onSegmentChange, isBackgroundGenerating, mapApiAvailable }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0);
  const [isBuffering, setIsBuffering] = useState(false);
  
  // Audio Engine Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const startTimeRef = useRef<number>(0); 
  const segmentOffsetRef = useRef<number>(0);
  const indexRef = useRef(currentSegmentIndex);
  const textContainerRef = useRef<HTMLDivElement>(null);
  const currentSegment = story.segments[currentSegmentIndex];

  useEffect(() => { indexRef.current = currentSegmentIndex; }, [currentSegmentIndex]);

  useEffect(() => {
    return () => {
      stopAudio();
      audioContextRef.current?.close();
    };
  }, []);

  useEffect(() => {
      onSegmentChange(currentSegmentIndex);
  }, [currentSegmentIndex, onSegmentChange]);

  useEffect(() => {
      const segmentNowReady = story.segments[currentSegmentIndex];
      if (isBuffering && isPlaying && segmentNowReady?.audioBuffer) {
          setIsBuffering(false);
          playSegment(segmentNowReady, 0);
      }
  }, [story.segments, currentSegmentIndex, isBuffering, isPlaying]);

  // Auto-scroll logic
  useEffect(() => {
    if (textContainerRef.current) {
        // Only auto scroll if near bottom or if it's a new segment
        const el = textContainerRef.current;
        const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 300;
        if (isNearBottom || currentSegmentIndex > 0) {
           setTimeout(() => {
                el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
           }, 100);
        }
    }
  }, [story.segments.length, currentSegmentIndex]);

  const stopAudio = () => {
      if (sourceRef.current) {
          sourceRef.current.onended = null;
          try { sourceRef.current.stop(); } catch (e) {}
          sourceRef.current = null;
      }
  };

  const playSegment = async (segment: StorySegment, offset: number = 0) => {
      if (!segment?.audioBuffer) {
           setIsBuffering(true);
           return;
      }

      if (!audioContextRef.current) {
          const AudioContextClass = window.AudioContext || window.webkitAudioContext;
          audioContextRef.current = new AudioContextClass();
      }
      if (audioContextRef.current.state === 'suspended') {
          await audioContextRef.current.resume();
      }

      stopAudio();

      const source = audioContextRef.current.createBufferSource();
      source.buffer = segment.audioBuffer;
      source.connect(audioContextRef.current.destination);
      sourceRef.current = source;

      source.onended = () => {
          const duration = segment.audioBuffer!.duration;
          if (!audioContextRef.current) return;
          const elapsed = audioContextRef.current.currentTime - startTimeRef.current;
          if (elapsed >= duration - 0.5) { 
              handleSegmentEnd();
          }
      };

      startTimeRef.current = audioContextRef.current.currentTime - offset;
      source.start(0, offset);
  };

  const handleSegmentEnd = () => {
      const currentIndex = indexRef.current;
      const nextIndex = currentIndex + 1;
      
      setCurrentSegmentIndex(nextIndex);
      segmentOffsetRef.current = 0;

      if (story.segments[nextIndex]?.audioBuffer) {
          playSegment(story.segments[nextIndex], 0);
      } else {
          if (nextIndex >= story.totalSegmentsEstimate && !isBackgroundGenerating) {
              setIsPlaying(false);
          } else {
              setIsBuffering(true);
          }
      }
  };

  const togglePlayback = async () => {
    if (isPlaying) {
      if (audioContextRef.current && !isBuffering) {
          segmentOffsetRef.current = audioContextRef.current.currentTime - startTimeRef.current;
      }
      stopAudio();
      setIsPlaying(false);
    } else {
      setIsPlaying(true);
      if (currentSegment?.audioBuffer) {
         setIsBuffering(false);
         playSegment(currentSegment, segmentOffsetRef.current);
      } else {
          setIsBuffering(true);
      }
    }
  };

  return (
    <div className="w-full h-[calc(100vh-140px)] flex flex-col md:flex-row gap-6">
      
      {/* Visual Column (Map or Placeholder) */}
      <div className="flex-1 relative rounded-[2rem] overflow-hidden shadow-2xl border-4 border-white bg-wayfarer-100 order-1 md:order-2">
           {mapApiAvailable ? (
               <InlineMap 
                  route={route} 
                  currentSegmentIndex={currentSegmentIndex}
                  totalSegments={story.totalSegmentsEstimate}
               />
           ) : (
               <div className="w-full h-full flex flex-col items-center justify-center text-wayfarer-300 bg-wayfarer-50">
                   <MapOff size={48} className="mb-4 opacity-50"/>
                   <p className="font-serif text-xl opacity-50">Map Unavailable</p>
                   <p className="text-sm mt-2 max-w-xs text-center opacity-40">Audio playback continues normally.</p>
               </div>
           )}
           
           {/* Playback Overlay Controls */}
           <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-4 bg-wayfarer-900/90 backdrop-blur text-white p-2 pl-6 pr-2 rounded-full shadow-lg z-10 transition-transform hover:scale-105">
                <div className="flex flex-col">
                    <span className="text-[10px] uppercase tracking-widest text-wayfarer-300 font-bold">
                        {isBuffering ? 'Buffering...' : isPlaying ? 'Now Playing' : 'Paused'}
                    </span>
                    <span className="text-sm font-serif truncate max-w-[120px]">
                        Segment {currentSegmentIndex + 1}
                    </span>
                </div>
                <button
                    onClick={togglePlayback}
                    className="w-12 h-12 bg-white rounded-full flex items-center justify-center text-wayfarer-900 hover:bg-wayfarer-200 transition-colors"
                >
                    {isBuffering ? <Loader2 size={20} className="animate-spin" /> : 
                     isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ml-1"/>}
                </button>
           </div>
      </div>

      {/* Text Column (Script) */}
      <div className="h-[30vh] md:h-full md:w-[400px] shrink-0 flex flex-col order-2 md:order-1">
          <div className="bg-white rounded-[2rem] shadow-xl border border-white/50 flex-1 overflow-hidden flex flex-col relative">
              
              <div className="p-6 border-b border-wayfarer-100 bg-white z-10">
                  <h3 className="font-serif text-2xl text-wayfarer-900 leading-none">The Story Script</h3>
                  <p className="text-xs text-wayfarer-400 mt-2 font-mono uppercase tracking-wider">Generated in Real-time</p>
              </div>

              <div ref={textContainerRef} className="flex-1 overflow-y-auto p-6 space-y-8 scroll-smooth">
                  {story.segments.map((segment, idx) => (
                      <div 
                        key={segment.index} 
                        className={`transition-all duration-700 ${segment.index === currentSegmentIndex + 1 ? 'opacity-100' : 'opacity-40 grayscale blur-[1px]'}`}
                      >
                          <span className="text-xs font-mono text-wayfarer-300 mb-2 block">
                              0{segment.index}
                          </span>
                          <p className="font-serif text-lg leading-relaxed text-wayfarer-900">
                            {segment.text}
                          </p>
                      </div>
                  ))}

                  {(isBuffering || isBackgroundGenerating) && (
                      <div className="flex items-center gap-3 opacity-50 py-4 animate-pulse">
                          <div className="h-2 w-2 bg-wayfarer-400 rounded-full animate-bounce"></div>
                          <div className="h-2 w-2 bg-wayfarer-400 rounded-full animate-bounce delay-100"></div>
                          <div className="h-2 w-2 bg-wayfarer-400 rounded-full animate-bounce delay-200"></div>
                      </div>
                  )}
              </div>
              
              {/* Fade at bottom */}
              <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-white to-transparent pointer-events-none"></div>
          </div>
      </div>
    </div>
  );
};

export default StoryPlayer;