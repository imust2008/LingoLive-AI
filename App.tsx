
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Blob } from '@google/genai';
import { Language, Scenario, ProficiencyLevel, Message } from './types';
import { SUPPORTED_LANGUAGES, SCENARIOS, LEVELS } from './constants';
import ScenarioCard from './components/ScenarioCard';
import SessionControls from './components/SessionControls';
import { encode, decode, decodeAudioData } from './services/audioUtils';

// --- STYLES (Animations) ---
const Waveform = ({ active }: { active: boolean }) => (
  <div className="flex items-center justify-center gap-1 h-12">
    {[...Array(8)].map((_, i) => (
      <div
        key={i}
        className={`w-1.5 bg-indigo-500 rounded-full transition-all duration-200 ${
          active ? 'animate-bounce' : 'h-2'
        }`}
        style={{
          animationDelay: `${i * 0.1}s`,
          height: active ? `${Math.random() * 40 + 10}px` : '8px'
        }}
      />
    ))}
  </div>
);

const App: React.FC = () => {
  // App state
  const [currentStep, setCurrentStep] = useState<'setup' | 'session'>('setup');
  const [selectedLang, setSelectedLang] = useState<Language>(SUPPORTED_LANGUAGES[0]);
  const [selectedLevel, setSelectedLevel] = useState<ProficiencyLevel>(LEVELS[1]);
  const [selectedScenario, setSelectedScenario] = useState<Scenario>(SCENARIOS[0]);
  
  // Session state
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  
  // Refs for Live API and Audio
  const sessionRef = useRef<any>(null);
  const audioContextInputRef = useRef<AudioContext | null>(null);
  const audioContextOutputRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const transcriptionBufferUser = useRef('');
  const transcriptionBufferModel = useRef('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const stopSession = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    if (audioContextInputRef.current) {
      audioContextInputRef.current.close();
      audioContextInputRef.current = null;
    }
    if (audioContextOutputRef.current) {
      audioContextOutputRef.current.close();
      audioContextOutputRef.current = null;
    }
    activeSourcesRef.current.forEach(source => source.stop());
    activeSourcesRef.current.clear();
    setIsConnected(false);
    setIsConnecting(false);
    setIsSpeaking(false);
  }, []);

  const startSession = async () => {
    if (!process.env.API_KEY) {
      alert("API Key missing. Please check your environment.");
      return;
    }

    setIsConnecting(true);
    setMessages([]);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      // Initialize Audio Contexts
      audioContextInputRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      audioContextOutputRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const systemInstruction = `You are a helpful and patient language learning partner. 
      The user is practicing ${selectedLang.name} at a ${selectedLevel} level.
      The scenario is: ${selectedScenario.title} - ${selectedScenario.description}.
      Keep your responses relatively short, natural, and helpful. 
      If the user makes a clear mistake, gently correct them but keep the conversation flowing.
      Start the conversation by greeting the user and setting the scene for our scenario.
      Respond ONLY in ${selectedLang.name}.`;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            setIsConnected(true);
            setIsConnecting(false);
            
            // Microphone streaming
            const source = audioContextInputRef.current!.createMediaStreamSource(stream);
            const scriptProcessor = audioContextInputRef.current!.createScriptProcessor(4096, 1, 1);
            
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const l = inputData.length;
              const int16 = new Int16Array(l);
              for (let i = 0; i < l; i++) {
                int16[i] = inputData[i] * 32768;
              }
              const pcmBlob: Blob = {
                data: encode(new Uint8Array(int16.buffer)),
                mimeType: 'audio/pcm;rate=16000',
              };
              
              sessionPromise.then((session) => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };
            
            source.connect(scriptProcessor);
            scriptProcessor.connect(audioContextInputRef.current!.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle Audio Output
            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio && audioContextOutputRef.current) {
              setIsSpeaking(true);
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, audioContextOutputRef.current.currentTime);
              const audioBuffer = await decodeAudioData(
                decode(base64Audio),
                audioContextOutputRef.current,
                24000,
                1
              );
              const source = audioContextOutputRef.current.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(audioContextOutputRef.current.destination);
              source.onended = () => {
                activeSourcesRef.current.delete(source);
                if (activeSourcesRef.current.size === 0) setIsSpeaking(false);
              };
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              activeSourcesRef.current.add(source);
            }

            // Handle Transcriptions
            if (message.serverContent?.inputTranscription) {
              transcriptionBufferUser.current += message.serverContent.inputTranscription.text;
            }
            if (message.serverContent?.outputTranscription) {
              transcriptionBufferModel.current += message.serverContent.outputTranscription.text;
            }

            // Handle Interruptions
            if (message.serverContent?.interrupted) {
              activeSourcesRef.current.forEach(s => s.stop());
              activeSourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              setIsSpeaking(false);
            }

            // Turn Completion
            if (message.serverContent?.turnComplete) {
              if (transcriptionBufferUser.current) {
                setMessages(prev => [...prev, { role: 'user', text: transcriptionBufferUser.current, timestamp: Date.now() }]);
                transcriptionBufferUser.current = '';
              }
              if (transcriptionBufferModel.current) {
                setMessages(prev => [...prev, { role: 'model', text: transcriptionBufferModel.current, timestamp: Date.now() }]);
                transcriptionBufferModel.current = '';
              }
            }
          },
          onerror: (e) => {
            console.error("Live API Error:", e);
            stopSession();
          },
          onclose: () => {
            stopSession();
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } }
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {}
        }
      });

      sessionRef.current = await sessionPromise;
    } catch (err) {
      console.error("Failed to start session:", err);
      setIsConnecting(false);
      alert("Error accessing microphone or connecting to Gemini.");
    }
  };

  const toggleSession = () => {
    if (isConnected) {
      stopSession();
    } else {
      startSession();
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-30 px-4 py-3 md:px-8">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => { stopSession(); setCurrentStep('setup'); }}>
            <div className="bg-indigo-600 p-2 rounded-xl text-white">
              <i className="fas fa-language text-xl"></i>
            </div>
            <h1 className="text-xl font-black text-indigo-950 tracking-tight">LingoLive AI</h1>
          </div>
          <div className="flex items-center gap-3">
             <div className="hidden md:flex flex-col items-end">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-tighter">Current Plan</span>
                <span className="text-sm font-semibold text-indigo-600">Premium Practice</span>
             </div>
             <img src="https://picsum.photos/seed/user123/40/40" alt="Profile" className="w-10 h-10 rounded-full border-2 border-slate-100" />
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full p-4 md:p-8">
        {currentStep === 'setup' ? (
          <div className="space-y-8 animate-in fade-in duration-500">
            {/* Intro Section */}
            <div className="text-center md:text-left">
              <h2 className="text-3xl md:text-4xl font-black text-slate-900 mb-2">Speak your way to fluency.</h2>
              <p className="text-slate-500 text-lg max-w-2xl">
                Select your target language, proficiency level, and a real-world scenario to begin your AI-powered conversation.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-8">
              {/* Left Column: Language & Level */}
              <div className="md:col-span-1 space-y-6">
                <section>
                  <label className="block text-sm font-bold text-slate-700 mb-3 uppercase tracking-wider">Target Language</label>
                  <div className="grid grid-cols-2 gap-3">
                    {SUPPORTED_LANGUAGES.map(lang => (
                      <button
                        key={lang.code}
                        onClick={() => setSelectedLang(lang)}
                        className={`flex items-center gap-2 p-3 rounded-xl border-2 transition-all ${
                          selectedLang.code === lang.code ? 'border-indigo-600 bg-indigo-50 shadow-sm' : 'border-slate-200 bg-white hover:border-indigo-200'
                        }`}
                      >
                        <span className="text-xl">{lang.flag}</span>
                        <span className="text-sm font-bold text-slate-700">{lang.name}</span>
                      </button>
                    ))}
                  </div>
                </section>

                <section>
                  <label className="block text-sm font-bold text-slate-700 mb-3 uppercase tracking-wider">Proficiency Level</label>
                  <div className="flex flex-col gap-2">
                    {LEVELS.map(level => (
                      <button
                        key={level}
                        onClick={() => setSelectedLevel(level)}
                        className={`p-3 rounded-xl border-2 text-center transition-all font-bold ${
                          selectedLevel === level ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600'
                        }`}
                      >
                        {level}
                      </button>
                    ))}
                  </div>
                </section>
              </div>

              {/* Right Column: Scenarios */}
              <div className="md:col-span-2 space-y-6">
                 <section>
                    <label className="block text-sm font-bold text-slate-700 mb-3 uppercase tracking-wider">Choose a Scenario</label>
                    <div className="grid sm:grid-cols-2 gap-4">
                      {SCENARIOS.map(scen => (
                        <ScenarioCard
                          key={scen.id}
                          scenario={scen}
                          selected={selectedScenario.id === scen.id}
                          onSelect={setSelectedScenario}
                        />
                      ))}
                    </div>
                 </section>

                 <div className="pt-4">
                    <button
                      onClick={() => setCurrentStep('session')}
                      className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-black py-4 rounded-2xl shadow-xl shadow-indigo-100 transition-all transform hover:-translate-y-1 active:scale-95 text-lg"
                    >
                      Start Conversation <i className="fas fa-arrow-right ml-2"></i>
                    </button>
                 </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col md:flex-row gap-6 animate-in slide-in-from-bottom-4 duration-500">
            {/* Conversation Area */}
            <div className="flex-1 bg-white rounded-3xl border shadow-sm flex flex-col overflow-hidden h-[75vh]">
              <div className="bg-slate-50 border-b px-6 py-4 flex justify-between items-center">
                <div className="flex items-center gap-3">
                   <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600">
                      <i className="fas fa-robot text-lg"></i>
                   </div>
                   <div>
                      <h3 className="font-bold text-slate-800">Gemini AI Partner</h3>
                      <p className="text-xs text-slate-500 flex items-center gap-1">
                        <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-slate-300'}`}></span>
                        {isConnected ? 'Real-time Voice Active' : 'Offline'}
                      </p>
                   </div>
                </div>
                <button 
                  onClick={() => { stopSession(); setCurrentStep('setup'); }}
                  className="text-slate-400 hover:text-rose-500 transition-colors"
                >
                  <i className="fas fa-times text-xl"></i>
                </button>
              </div>

              {/* Message History */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] bg-opacity-5">
                {messages.length === 0 && !isConnecting && !isConnected && (
                  <div className="h-full flex flex-col items-center justify-center text-center opacity-50 space-y-4">
                     <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center text-3xl">
                        <i className="fas fa-microphone"></i>
                     </div>
                     <p className="font-medium">Click the microphone to start speaking</p>
                  </div>
                )}
                {messages.map((msg, idx) => (
                  <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] px-4 py-3 rounded-2xl shadow-sm ${
                      msg.role === 'user' 
                        ? 'bg-indigo-600 text-white rounded-tr-none' 
                        : 'bg-white border text-slate-800 rounded-tl-none'
                    }`}>
                      <p className="text-sm md:text-base leading-relaxed">{msg.text}</p>
                      <span className={`text-[10px] mt-1 block opacity-60 ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>

              {/* Status Bar */}
              <div className="px-6 py-4 bg-slate-50 border-t flex items-center justify-between">
                <Waveform active={isConnected && !isSpeaking} />
                <div className="text-center flex-1">
                   {isConnected && (
                     <p className="text-xs font-bold text-indigo-500 animate-pulse">
                        {isSpeaking ? 'AI is speaking...' : 'Listening to you...'}
                     </p>
                   )}
                </div>
                <Waveform active={isSpeaking} />
              </div>
            </div>

            {/* Controls Side Panel */}
            <div className="w-full md:w-80 space-y-6">
               <div className="bg-white p-8 rounded-3xl border shadow-sm flex flex-col items-center">
                  <SessionControls
                    isConnected={isConnected}
                    isConnecting={isConnecting}
                    onToggle={toggleSession}
                    languageName={selectedLang.name}
                  />
               </div>

               <div className="bg-indigo-900 text-white p-6 rounded-3xl shadow-xl shadow-indigo-200">
                  <h4 className="font-bold mb-4 flex items-center gap-2">
                    <i className="fas fa-lightbulb text-yellow-400"></i> Practice Goal
                  </h4>
                  <p className="text-indigo-100 text-sm leading-relaxed mb-4">
                    In this <strong>{selectedScenario.title}</strong>, focus on using transition words and maintaining the conversation flow.
                  </p>
                  <div className="bg-indigo-800/50 p-3 rounded-xl border border-indigo-700">
                    <p className="text-xs text-indigo-200 uppercase font-black mb-1">Scenario Task</p>
                    <p className="text-sm italic">"{selectedScenario.description}"</p>
                  </div>
               </div>

               <div className="bg-white p-6 rounded-3xl border shadow-sm">
                  <h4 className="font-bold text-slate-800 mb-3 flex items-center gap-2">
                    <i className="fas fa-gear text-slate-400"></i> Settings
                  </h4>
                  <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                       <span className="text-slate-500">Language</span>
                       <span className="font-bold text-slate-700">{selectedLang.name}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                       <span className="text-slate-500">Level</span>
                       <span className="font-bold text-slate-700">{selectedLevel}</span>
                    </div>
                  </div>
               </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer / Mobile Nav (optional) */}
      {currentStep === 'setup' && (
        <footer className="py-6 border-t bg-white mt-12">
          <div className="max-w-6xl mx-auto px-4 flex justify-between items-center text-slate-400 text-sm">
            <p>© 2024 LingoLive AI • Powered by Gemini 2.5</p>
            <div className="flex gap-4">
              <a href="#" className="hover:text-indigo-600 transition-colors">Privacy</a>
              <a href="#" className="hover:text-indigo-600 transition-colors">Terms</a>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
};

export default App;
