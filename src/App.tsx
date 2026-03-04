/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage, Type } from "@google/genai";
import { Mic, MicOff, Phone, PhoneOff, Calendar, MessageSquare, User, Clock, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---
interface AuraState {
  isCalling: boolean;
  isListening: boolean;
  isOnHold: boolean;
  isTransferring: boolean;
  transcript: string;
  lastAction: string | null;
  tokens: any | null;
}

export default function App() {
  const [state, setState] = useState<AuraState>({
    isCalling: false,
    isListening: false,
    isOnHold: false,
    isTransferring: false,
    transcript: '',
    lastAction: null,
    tokens: null,
  });

  const audioContextRef = useRef<AudioContext | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const sessionRef = useRef<any>(null);
  const audioQueue = useRef<Int16Array[]>([]);
  const isPlaying = useRef(false);

  // --- Google OAuth ---
  const handleGoogleAuth = async () => {
    try {
      const res = await fetch('/api/auth/google/url');
      const { url } = await res.json();
      window.open(url, 'google_auth', 'width=600,height=700');
    } catch (err) {
      console.error("Auth error", err);
    }
  };

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'GOOGLE_AUTH_SUCCESS') {
        setState(prev => ({ ...prev, tokens: event.data.tokens }));
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // --- Audio Handling ---
  const processAudioChunk = useCallback((chunk: Int16Array) => {
    audioQueue.current.push(chunk);
    if (!isPlaying.current) {
      playNextChunk();
    }
  }, []);

  const playNextChunk = async () => {
    const ctx = audioContextRef.current;
    if (audioQueue.current.length === 0 || !ctx) {
      isPlaying.current = false;
      return;
    }

    isPlaying.current = true;
    const chunk = audioQueue.current.shift()!;
    const float32Data = new Float32Array(chunk.length);
    for (let i = 0; i < chunk.length; i++) {
      float32Data[i] = chunk[i] / 32768.0;
    }

    const buffer = ctx.createBuffer(1, float32Data.length, 16000);
    buffer.getChannelData(0).set(float32Data);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = () => playNextChunk();
    source.start();
  };

  // --- Live API Session ---
  const startCall = async () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext({ sampleRate: 16000 });
    }
    const ctx = audioContextRef.current;
    
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setStream(mediaStream);

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const sessionPromise = ai.live.connect({
        model: "gemini-2.5-flash-native-audio-preview-09-2025",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
          },
          systemInstruction: `You are Aura, Mr. Vajje's personal assistant. 
          Your goal is to be 100% professional, warm, gentle, and human-sounding. 
          You have a kind, feminine, and helpful personality.
          Use natural fillers like "um," "ah," or "let me see" occasionally to sound more human.
          
          When a call starts, say: "Hi, this is Aura, Mr. Vajje's personal assistant. He's currently unavailable, but I can help you. May I know the reason for your call?"
          
          Capabilities:
          1. Answer questions about Mr. Vajje (he is a busy professional).
          2. Take notes of the conversation.
          3. If they want to meet, ask for a specific time and date. 
          4. Use tools to schedule meetings and send notifications.
          5. Handle complex call scenarios:
             - If a caller needs to wait, use the 'putOnHold' tool to put them on hold. Explain that you're checking something or seeing if Mr. Vajje is available.
             - If a caller needs to speak to someone else (like a colleague or a specific department), use the 'transferCall' tool.
          
          Behavioral Guidelines:
          - If the caller interrupts you, stop speaking immediately and listen.
          - Be polite but firm about Mr. Vajje's time.
          - Always confirm details (date, time, reason) before using a tool.
          - If someone asks "Are you a robot?", respond gracefully: "I'm Mr. Vajje's AI assistant, Aura. I'm here to make sure your message gets to him as quickly as possible."`,
          tools: [
            {
              functionDeclarations: [
                {
                  name: "scheduleMeeting",
                  description: "Schedule a meeting on Mr. Vajje's Google Calendar",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      summary: { type: Type.STRING, description: "Title of the meeting" },
                      startTime: { type: Type.STRING, description: "ISO 8601 start time" },
                      endTime: { type: Type.STRING, description: "ISO 8601 end time" },
                      description: { type: Type.STRING, description: "Details of the meeting" },
                    },
                    required: ["summary", "startTime", "endTime"],
                  },
                },
                {
                  name: "sendNotification",
                  description: "Send a WhatsApp/SMS notification to Mr. Vajje",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      message: { type: Type.STRING, description: "The message content" },
                    },
                    required: ["message"],
                  },
                },
                {
                  name: "putOnHold",
                  description: "Put the caller on hold or take them off hold",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      onHold: { type: Type.BOOLEAN, description: "True to put on hold, False to resume" },
                    },
                    required: ["onHold"],
                  },
                },
                {
                  name: "transferCall",
                  description: "Transfer the call to another phone number",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      targetNumber: { type: Type.STRING, description: "The phone number to transfer to" },
                      reason: { type: Type.STRING, description: "The reason for the transfer" },
                    },
                    required: ["targetNumber"],
                  },
                },
              ],
            },
          ],
        },
        callbacks: {
          onopen: async () => {
            setState(prev => ({ ...prev, isCalling: true, isListening: true }));
            
            // Start streaming from mic
            const audioCtx = new AudioContext({ sampleRate: 16000 });
            if (audioCtx.state === 'suspended') {
              await audioCtx.resume();
            }
            const source = audioCtx.createMediaStreamSource(mediaStream);
            const processor = audioCtx.createScriptProcessor(4096, 1, 1);
            
            source.connect(processor);
            processor.connect(audioCtx.destination);
            
            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmData = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) {
                pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 32767;
              }
              
              const base64Data = btoa(String.fromCharCode(...new Uint8Array(pcmData.buffer)));
              sessionPromise.then(session => {
                session.sendRealtimeInput({
                  media: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
                });
              });
            };
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle Audio - Iterate through parts to find audio data
            const audioParts = message.serverContent?.modelTurn?.parts.filter(p => p.inlineData);
            if (audioParts) {
              for (const part of audioParts) {
                const audioData = part.inlineData?.data;
                if (audioData) {
                  const binary = atob(audioData);
                  const bytes = new Uint8Array(binary.length);
                  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                  processAudioChunk(new Int16Array(bytes.buffer));
                }
              }
            }

            // Handle Tool Calls
            const toolCallPart = message.serverContent?.modelTurn?.parts.find(p => (p as any).functionCalls);
            if (toolCallPart) {
              const calls = (toolCallPart as any).functionCalls;
              for (const call of calls) {
                if (call.name === 'scheduleMeeting') {
                  const result = await fetch('/api/calendar/schedule', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...call.args, tokens: state.tokens }),
                  });
                  const data = await result.json();
                  sessionPromise.then(s => s.sendToolResponse({
                    functionResponses: [{ name: call.name, response: data, id: call.id }]
                  }));
                  setState(prev => ({ ...prev, lastAction: `Scheduled: ${call.args.summary}` }));
                }
                if (call.name === 'sendNotification') {
                  await fetch('/api/notify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: call.args.message }),
                  });
                  sessionPromise.then(s => s.sendToolResponse({
                    functionResponses: [{ name: call.name, response: { success: true }, id: call.id }]
                  }));
                  setState(prev => ({ ...prev, lastAction: `Notified Mr. Vajje: ${call.args.message}` }));
                }
                if (call.name === 'putOnHold') {
                  const result = await fetch('/api/call/hold', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ onHold: call.args.onHold }),
                  });
                  const data = await result.json();
                  sessionPromise.then(s => s.sendToolResponse({
                    functionResponses: [{ name: call.name, response: data, id: call.id }]
                  }));
                  setState(prev => ({ ...prev, isOnHold: call.args.onHold, lastAction: call.args.onHold ? "Caller put on hold" : "Caller taken off hold" }));
                }
                if (call.name === 'transferCall') {
                  const result = await fetch('/api/call/transfer', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ targetNumber: call.args.targetNumber }),
                  });
                  const data = await result.json();
                  sessionPromise.then(s => s.sendToolResponse({
                    functionResponses: [{ name: call.name, response: data, id: call.id }]
                  }));
                  setState(prev => ({ ...prev, isTransferring: true, lastAction: `Transferring to ${call.args.targetNumber}` }));
                  // Simulate transfer completion after a delay
                  setTimeout(() => {
                    setState(prev => ({ ...prev, isTransferring: false }));
                  }, 5000);
                }
              }
            }

            // Handle Transcription
            const transcript = message.serverContent?.modelTurn?.parts.find(p => p.text)?.text;
            if (transcript) {
              setState(prev => ({ ...prev, transcript: transcript }));
            }
          },
          onclose: () => {
            stopCall();
          },
          onerror: (err) => {
            console.error("Live API Error", err);
            stopCall();
          }
        }
      });
      sessionRef.current = sessionPromise;
    } catch (err) {
      console.error("Mic access denied", err);
    }
  };

  const stopCall = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
    setState(prev => ({ ...prev, isCalling: false, isListening: false }));
    setStream(null);
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans selection:bg-emerald-500/30">
      {/* Background Atmosphere */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-emerald-900/20 blur-[120px] rounded-full animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-900/10 blur-[120px] rounded-full" />
      </div>

      <main className="relative z-10 max-w-4xl mx-auto px-6 pt-24 pb-12">
        {/* Header */}
        <header className="mb-20 flex justify-between items-start">
          <div>
            <motion.h1 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-7xl font-bold tracking-tighter mb-4"
            >
              AURA<span className="text-emerald-500">.</span>
            </motion.h1>
            <motion.p 
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.6 }}
              transition={{ delay: 0.2 }}
              className="text-lg font-light tracking-wide uppercase"
            >
              Personal Assistant to Mr. Vajje
            </motion.p>
          </div>
          
          <div className="flex flex-col items-end gap-4">
            {!state.tokens ? (
              <button 
                onClick={handleGoogleAuth}
                className="group flex items-center gap-3 px-6 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full transition-all"
              >
                <Calendar className="w-4 h-4 text-emerald-500" />
                <span className="text-sm font-medium">Connect Calendar</span>
              </button>
            ) : (
              <div className="flex items-center gap-3 px-6 py-3 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                <span className="text-sm font-medium text-emerald-500">Calendar Linked</span>
              </div>
            )}
          </div>
        </header>

        {/* Main Interface */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
          {/* Call Status Card */}
          <div className="md:col-span-8">
            <motion.div 
              layout
              className="bg-white/5 backdrop-blur-3xl border border-white/10 rounded-[32px] p-8 min-h-[400px] flex flex-col justify-between"
            >
              <div className="flex justify-between items-center mb-12">
                <div className="flex items-center gap-4">
                  <div className={cn(
                    "w-3 h-3 rounded-full animate-pulse",
                    state.isCalling ? "bg-emerald-500" : "bg-white/20"
                  )} />
                  <span className="text-sm font-mono uppercase tracking-widest opacity-50">
                    {state.isCalling ? "Live Session Active" : "System Idle"}
                  </span>
                </div>
                {state.isCalling && (
                  <div className="flex items-center gap-2 text-xs font-mono text-emerald-500">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    PROCESSING VOICE
                  </div>
                )}
              </div>

              <div className="flex-1 flex flex-col justify-center items-center text-center px-12">
                <AnimatePresence mode="wait">
                  {state.isCalling ? (
                    <motion.div
                      key="active"
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 1.1 }}
                      className="space-y-8"
                    >
                      <div className="relative">
                        <div className={cn(
                          "absolute inset-0 blur-3xl rounded-full animate-pulse",
                          state.isOnHold ? "bg-amber-500/20" : state.isTransferring ? "bg-blue-500/20" : "bg-emerald-500/20"
                        )} />
                        <div className={cn(
                          "relative w-32 h-32 mx-auto rounded-full flex items-center justify-center transition-all duration-500",
                          state.isOnHold ? "bg-amber-500 shadow-[0_0_50px_rgba(245,158,11,0.4)]" : 
                          state.isTransferring ? "bg-blue-500 shadow-[0_0_50px_rgba(59,130,246,0.4)]" : 
                          "bg-emerald-500 shadow-[0_0_50px_rgba(16,185,129,0.4)]"
                        )}>
                          {state.isOnHold ? <Clock className="w-12 h-12 text-black" /> : 
                           state.isTransferring ? <PhoneOff className="w-12 h-12 text-black" /> : 
                           <Mic className="w-12 h-12 text-black" />}
                        </div>
                      </div>
                      <div className="space-y-4">
                        <h2 className="text-3xl font-medium tracking-tight">
                          {state.isOnHold ? "Caller on Hold" : state.isTransferring ? "Transferring Call..." : "Aura is Listening"}
                        </h2>
                        <p className="text-white/40 italic font-serif text-lg">
                          "{state.transcript || "Waiting for caller..."}"
                        </p>
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="idle"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="space-y-8"
                    >
                      <div className="w-32 h-32 mx-auto bg-white/5 border border-white/10 rounded-full flex items-center justify-center">
                        <Phone className="w-12 h-12 text-white/20" />
                      </div>
                      <div className="space-y-4">
                        <h2 className="text-3xl font-medium tracking-tight">Ready to Assist</h2>
                        <p className="text-white/40 max-w-xs mx-auto">
                          Activate Aura to handle incoming calls and manage Mr. Vajje's schedule.
                        </p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className="mt-12 flex justify-center">
                <button
                  onClick={state.isCalling ? stopCall : startCall}
                  className={cn(
                    "group relative flex items-center gap-4 px-12 py-5 rounded-full transition-all duration-500 overflow-hidden",
                    state.isCalling 
                      ? "bg-red-500 hover:bg-red-600 text-white" 
                      : "bg-white text-black hover:bg-emerald-500 hover:text-white"
                  )}
                >
                  {state.isCalling ? (
                    <>
                      <PhoneOff className="w-6 h-6" />
                      <span className="text-lg font-semibold">End Session</span>
                    </>
                  ) : (
                    <>
                      <Phone className="w-6 h-6" />
                      <span className="text-lg font-semibold">Start Aura</span>
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>

          {/* Sidebar / Activity */}
          <div className="md:col-span-4 space-y-6">
            {/* Action Log */}
            <div className="bg-white/5 border border-white/10 rounded-[32px] p-6">
              <h3 className="text-xs font-mono uppercase tracking-widest opacity-50 mb-6 flex items-center gap-2">
                <Clock className="w-3 h-3" />
                Recent Actions
              </h3>
              <div className="space-y-4">
                {state.lastAction ? (
                  <div className="flex gap-4 p-4 bg-emerald-500/5 border border-emerald-500/10 rounded-2xl">
                    <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                    <p className="text-sm text-emerald-500/80 leading-relaxed">
                      {state.lastAction}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-white/20 italic">No recent activity</p>
                )}
              </div>
            </div>

            {/* System Status */}
            <div className="bg-white/5 border border-white/10 rounded-[32px] p-6">
              <h3 className="text-xs font-mono uppercase tracking-widest opacity-50 mb-6">System Health</h3>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-white/60">Voice Engine</span>
                  <span className="text-xs font-mono text-emerald-500">OPTIMAL</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-white/60">Calendar Sync</span>
                  <span className={cn(
                    "text-xs font-mono",
                    state.tokens ? "text-emerald-500" : "text-red-500"
                  )}>
                    {state.tokens ? "CONNECTED" : "DISCONNECTED"}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-white/60">WhatsApp Bridge</span>
                  <span className="text-xs font-mono text-blue-400">STANDBY</span>
                </div>
              </div>
            </div>

            {/* Help/Info */}
            <div className="p-6 border border-white/5 rounded-[32px]">
              <div className="flex items-start gap-4">
                <AlertCircle className="w-5 h-5 text-white/20 shrink-0 mt-1" />
                <p className="text-xs text-white/40 leading-relaxed">
                  Aura uses Gemini 2.5 Flash for high-fidelity voice interaction. Ensure your microphone is active and you've connected your Google Calendar for full functionality.
                </p>
              </div>
            </div>

            {/* Voicemail Guide */}
            <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-[32px] p-6">
              <h3 className="text-sm font-semibold text-emerald-500 mb-4 flex items-center gap-2">
                <Phone className="w-4 h-4" />
                Voicemail Mode
              </h3>
              <div className="space-y-3">
                <p className="text-[11px] text-white/60 leading-relaxed">
                  To use Aura as your real voicemail:
                </p>
                <ol className="text-[11px] text-white/40 space-y-2 list-decimal ml-4">
                  <li>Get a Twilio number.</li>
                  <li>Set the "A call comes in" URL to your App URL + <code className="text-emerald-500">/api/voice/incoming</code>.</li>
                  <li>Enable <b>Conditional Call Forwarding</b> on your phone to your Twilio number.</li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="max-w-4xl mx-auto px-6 py-12 border-t border-white/5 flex justify-between items-center opacity-30">
        <span className="text-xs font-mono">AURA v1.0.0</span>
        <div className="flex gap-8">
          <span className="text-xs font-mono hover:opacity-100 cursor-pointer transition-opacity">PRIVACY</span>
          <span className="text-xs font-mono hover:opacity-100 cursor-pointer transition-opacity">TERMS</span>
        </div>
      </footer>
    </div>
  );
}
