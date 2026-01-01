/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState, useRef, useEffect } from 'react';
import { MapPin, Navigation, Sparkles, Footprints, Car, CloudRain, ScrollText, Sword, ArrowRight, X, Loader2, Clock } from 'lucide-react';
import { RouteDetails, AppState, StoryStyle } from '../types';

declare global {
  interface Window {
    google: any;
  }
}

interface Props {
  onRouteFound: (details: RouteDetails) => void;
  appState: AppState;
  externalError?: string | null;
  isCompact: boolean;
  onReset: () => void;
  mapApiAvailable: boolean;
}

type TravelMode = 'WALKING' | 'DRIVING';

const STYLES: { id: StoryStyle; label: string; icon: React.ElementType; desc: string }[] = [
    { id: 'NOIR', label: 'Noir', icon: CloudRain, desc: 'Gritty shadows & rain.' },
    { id: 'CHILDREN', label: 'Whimsy', icon: Sparkles, desc: 'Magical & light.' },
    { id: 'HISTORICAL', label: 'Epic', icon: ScrollText, desc: 'Grand & timeless.' },
    { id: 'FANTASY', label: 'Quest', icon: Sword, desc: 'Myths & legends.' },
];

const RoutePlanner: React.FC<Props> = ({ onRouteFound, appState, externalError, isCompact, onReset, mapApiAvailable }) => {
  const [startAddress, setStartAddress] = useState('');
  const [endAddress, setEndAddress] = useState('');
  const [manualDuration, setManualDuration] = useState(30); // Minutes
  const [travelMode, setTravelMode] = useState<TravelMode>('WALKING');
  const [selectedStyle, setSelectedStyle] = useState<StoryStyle>('NOIR');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const startInputRef = useRef<HTMLInputElement>(null);
  const endInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (externalError) setError(externalError);
  }, [externalError]);

  useEffect(() => {
    // Only init autocomplete if map API is available
    if (!mapApiAvailable) return;

    let isMounted = true;
    const initAutocomplete = async () => {
        if (!window.google?.maps?.places) return;
        try {
             const setupAutocomplete = (inputElement: HTMLInputElement | null, setAddress: (addr: string) => void) => {
                 if (!inputElement) return;
                 const autocomplete = new window.google.maps.places.Autocomplete(inputElement, {
                     fields: ['formatted_address', 'geometry', 'name'],
                     types: ['geocode', 'establishment']
                 });
                 autocomplete.addListener('place_changed', () => {
                     if (!isMounted) return;
                     const place = autocomplete.getPlace();
                     const address = place.formatted_address || place.name;
                     if (address) {
                        setAddress(address);
                        inputElement.value = address;
                     }
                 });
             };
             setupAutocomplete(startInputRef.current, setStartAddress);
             setupAutocomplete(endInputRef.current, setEndAddress);
        } catch (e) {
            console.error(e);
        }
    };

    if (window.google?.maps?.places) {
        initAutocomplete();
    } else {
        const interval = setInterval(() => {
            if (window.google?.maps?.places) {
                clearInterval(interval);
                initAutocomplete();
            }
        }, 300);
        return () => { isMounted = false; clearInterval(interval); };
    }
    return () => { isMounted = false; };
  }, [isCompact, mapApiAvailable]);

  const handleCalculate = () => {
    const finalStart = startInputRef.current?.value || startAddress;
    const finalEnd = endInputRef.current?.value || endAddress;

    if (!finalStart || !finalEnd) {
      setError("Please define your journey start and end.");
      return;
    }

    setError(null);
    setIsLoading(true);

    if (mapApiAvailable && window.google?.maps) {
        const directionsService = new window.google.maps.DirectionsService();
        directionsService.route(
          {
            origin: finalStart,
            destination: finalEnd,
            travelMode: window.google.maps.TravelMode[travelMode],
          },
          (result: any, status: any) => {
            setIsLoading(false);
            if (status === window.google.maps.DirectionsStatus.OK) {
              const leg = result.routes[0].legs[0];
              // Limit: 4 hours
              if (leg.duration.value > 14400) {
                setError("Journey too long. Try a route under 4 hours.");
                return;
              }

              onRouteFound({
                startAddress: leg.start_address,
                endAddress: leg.end_address,
                distance: leg.distance.text,
                duration: leg.duration.text,
                durationSeconds: leg.duration.value,
                travelMode: travelMode,
                voiceName: 'Kore', 
                storyStyle: selectedStyle
              });
            } else {
              setError("Could not find a route between these locations.");
            }
          }
        );
    } else {
        // Fallback for when API is missing
        setTimeout(() => {
            setIsLoading(false);
            onRouteFound({
                startAddress: finalStart,
                endAddress: finalEnd,
                distance: "Unknown",
                duration: `${manualDuration} mins`,
                durationSeconds: manualDuration * 60,
                travelMode: travelMode,
                voiceName: 'Kore',
                storyStyle: selectedStyle
            });
        }, 800);
    }
  };

  // --- Compact View (Header Mode) ---
  if (isCompact) {
      return (
          <div className="w-full bg-white rounded-2xl shadow-sm border border-wayfarer-200 p-4 flex flex-col md:flex-row items-center justify-between gap-4 animate-fade-in relative z-50">
              <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs font-bold text-wayfarer-800/40 uppercase tracking-widest mb-1">
                      {travelMode === 'WALKING' ? <Footprints size={12}/> : <Car size={12}/>}
                      <span>Current Journey</span>
                  </div>
                  <div className="flex items-center gap-2 text-wayfarer-900 font-medium truncate">
                      <span className="truncate max-w-[150px]">{startAddress.split(',')[0]}</span>
                      <ArrowRight size={14} className="text-wayfarer-300 shrink-0" />
                      <span className="truncate max-w-[150px]">{endAddress.split(',')[0]}</span>
                  </div>
              </div>
              
              <div className="hidden md:block w-px h-8 bg-wayfarer-100 mx-2"></div>

              <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-wayfarer-50 rounded-lg border border-wayfarer-100">
                      {STYLES.find(s => s.id === selectedStyle)?.icon({ size: 14, className: "text-wayfarer-800" })}
                      <span className="text-sm font-medium text-wayfarer-800">{STYLES.find(s => s.id === selectedStyle)?.label}</span>
                  </div>
                  <button 
                    onClick={onReset}
                    className="p-2 hover:bg-wayfarer-50 rounded-full text-wayfarer-400 hover:text-red-500 transition-colors"
                    title="End Journey"
                  >
                      <X size={18} />
                  </button>
              </div>
          </div>
      )
  }

  // --- Expanded View (Planning Mode) ---
  return (
    <div className="w-full max-w-2xl mx-auto transition-all duration-500 ease-out">
      <div className="space-y-6 bg-white p-2 md:p-4 rounded-[2rem] shadow-xl shadow-wayfarer-900/5 border border-white">
        
        {/* Manual Mode Warning */}
        {!mapApiAvailable && (
             <div className="mx-2 px-3 py-2 bg-amber-50 text-amber-700 text-xs rounded-lg flex items-center gap-2 border border-amber-100">
                 <MapPin size={12} />
                 <span>Map services unavailable. Please enter details manually.</span>
             </div>
        )}

        {/* Input Group */}
        <div className="space-y-2 bg-wayfarer-50/50 p-2 rounded-[1.5rem] border border-wayfarer-100">
            <div className="relative group z-20">
                <div className="absolute left-5 top-1/2 -translate-y-1/2 text-wayfarer-300 group-focus-within:text-wayfarer-900 transition-colors">
                    <MapPin size={20} />
                </div>
                <input
                    ref={startInputRef}
                    type="text"
                    placeholder="Where are you starting?"
                    className="w-full bg-white h-16 rounded-2xl pl-14 pr-4 text-lg text-wayfarer-900 placeholder:text-wayfarer-300 font-medium outline-none border border-transparent focus:border-wayfarer-200 transition-all shadow-sm focus:shadow-md"
                    onChange={(e) => setStartAddress(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && endInputRef.current?.focus()}
                />
            </div>
            
            <div className="relative group z-10">
                <div className="absolute left-5 top-1/2 -translate-y-1/2 text-wayfarer-300 group-focus-within:text-wayfarer-900 transition-colors">
                    <Navigation size={20} />
                </div>
                <input
                    ref={endInputRef}
                    type="text"
                    placeholder="Where are you headed?"
                    className="w-full bg-white h-16 rounded-2xl pl-14 pr-4 text-lg text-wayfarer-900 placeholder:text-wayfarer-300 font-medium outline-none border border-transparent focus:border-wayfarer-200 transition-all shadow-sm focus:shadow-md"
                    onChange={(e) => setEndAddress(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleCalculate()}
                />
            </div>
        </div>

        {/* Manual Duration Slider (Only visible if Map API is dead) */}
        {!mapApiAvailable && (
             <div className="px-4 py-2 bg-wayfarer-50 rounded-2xl border border-wayfarer-100 space-y-2">
                 <div className="flex items-center justify-between text-sm font-medium text-wayfarer-700">
                     <div className="flex items-center gap-2">
                         <Clock size={16} />
                         <span>Estimated Duration</span>
                     </div>
                     <span>{manualDuration} min</span>
                 </div>
                 <input 
                    type="range" 
                    min="5" 
                    max="180" 
                    step="5"
                    value={manualDuration}
                    onChange={(e) => setManualDuration(parseInt(e.target.value))}
                    className="w-full h-2 bg-wayfarer-200 rounded-lg appearance-none cursor-pointer accent-wayfarer-900"
                 />
             </div>
        )}

        <div className="px-2 md:px-4 grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Style Selector */}
            <div className="space-y-3">
                <label className="text-xs font-bold text-wayfarer-800/40 uppercase tracking-widest pl-1">Story Vibe</label>
                <div className="grid grid-cols-2 gap-2">
                    {STYLES.map((style) => {
                        const Icon = style.icon;
                        const isSelected = selectedStyle === style.id;
                        return (
                            <button
                                key={style.id}
                                onClick={() => setSelectedStyle(style.id)}
                                className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all duration-200 ${
                                    isSelected
                                        ? 'bg-wayfarer-900 text-white border-wayfarer-900 shadow-lg scale-[1.02]'
                                        : 'bg-white text-wayfarer-500 border-wayfarer-100 hover:border-wayfarer-300 hover:bg-wayfarer-50'
                                }`}
                            >
                                <Icon size={20} className="mb-1.5" />
                                <span className="text-sm font-medium">{style.label}</span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Travel Mode */}
            <div className="space-y-3">
                 <label className="text-xs font-bold text-wayfarer-800/40 uppercase tracking-widest pl-1">Movement</label>
                 <div className="flex gap-2 h-[calc(100%-2rem)]">
                    {(['WALKING', 'DRIVING'] as TravelMode[]).map((mode) => (
                        <button
                            key={mode}
                            onClick={() => setTravelMode(mode)}
                            className={`flex-1 flex flex-col items-center justify-center gap-2 rounded-xl border transition-all ${
                                travelMode === mode 
                                    ? 'bg-white border-wayfarer-900 text-wayfarer-900 shadow-md ring-1 ring-wayfarer-900' 
                                    : 'bg-transparent border-wayfarer-200 text-wayfarer-400 hover:bg-white'
                            }`}
                        >
                            {mode === 'WALKING' ? <Footprints size={24} /> : <Car size={24} />}
                            <span className="text-xs font-bold uppercase">{mode}</span>
                        </button>
                    ))}
                 </div>
            </div>
        </div>

        {error && (
          <div className="mx-2 p-3 bg-red-50 text-red-600 rounded-xl text-sm font-medium flex items-center gap-2 animate-fade-in border border-red-100">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0"></span>
              {error}
          </div>
        )}

        <div className="pt-2 px-2">
            <button
            onClick={handleCalculate}
            disabled={isLoading || !startAddress || !endAddress}
            className="group w-full bg-wayfarer-900 text-white h-16 rounded-2xl font-serif text-2xl hover:bg-black transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 shadow-xl shadow-wayfarer-900/20 active:scale-[0.98]"
            >
            {isLoading ? (
                <Loader2 className="animate-spin" />
            ) : (
                <>
                <span>Begin Journey</span>
                <ArrowRight className="group-hover:translate-x-1 transition-transform" />
                </>
            )}
            </button>
        </div>
      </div>
    </div>
  );
};

export default RoutePlanner;