"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, Camera, Check, Hand, RotateCcw, Shield, Sparkles, Star, Trophy, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { NormalizedLandmark, PoseLandmarker as PoseLandmarkerType } from "@mediapipe/tasks-vision";

type Stage = "welcome" | "loading" | "calibrate" | "playing" | "finished";
type Point = { x: number; y: number };

const TARGETS: Point[] = [
  { x: 0.27, y: 0.34 }, { x: 0.73, y: 0.3 }, { x: 0.22, y: 0.5 },
  { x: 0.78, y: 0.46 }, { x: 0.32, y: 0.22 }, { x: 0.68, y: 0.2 },
  { x: 0.18, y: 0.38 }, { x: 0.82, y: 0.36 },
];

export default function MouveoGame() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<PoseLandmarkerType | null>(null);
  const frameRef = useRef<number | null>(null);
  const stageRef = useRef<Stage>("welcome");
  const targetIndexRef = useRef(0);
  const lastHitRef = useRef(0);
  const comboRef = useRef(0);
  const [stage, setStage] = useState<Stage>("welcome");
  const [status, setStatus] = useState("Placez le téléphone face à vous");
  const [hits, setHits] = useState(0);
  const [points, setPoints] = useState(0);
  const [combo, setCombo] = useState(0);
  const [bestScore, setBestScore] = useState(0);
  const [celebration, setCelebration] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(45);
  const [cameraError, setCameraError] = useState("");
  const [demo, setDemo] = useState(false);
  stageRef.current = stage;

  const stopCamera = useCallback(() => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  useEffect(() => {
    const saved = Number(window.localStorage.getItem("mouveo-best-score") || 0);
    setBestScore(saved);
  }, []);

  useEffect(() => {
    if (stage !== "finished" || points <= bestScore) return;
    window.localStorage.setItem("mouveo-best-score", String(points));
    setBestScore(points);
  }, [stage, points, bestScore]);

  useEffect(() => {
    if (stage !== "playing") return;
    const timer = window.setInterval(() => {
      setSeconds((value) => {
        if (value <= 1) {
          window.clearInterval(timer);
          stopCamera();
          setStage("finished");
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [stage, stopCamera]);

  const recordHit = useCallback(() => {
    const nextCombo = comboRef.current + 1;
    comboRef.current = nextCombo;
    targetIndexRef.current = (targetIndexRef.current + 1) % TARGETS.length;
    setHits((value) => value + 1);
    setCombo(nextCombo);
    setPoints((value) => value + 10 + Math.floor(nextCombo / 3) * 5);
    setStatus(nextCombo >= 3 ? `Série ×${nextCombo} — superbe régularité !` : "Bien joué ! Continuez lentement.");
    if ([3, 5, 10].includes(nextCombo)) {
      setCelebration(nextCombo === 3 ? "Série lancée !" : nextCombo === 5 ? "Mi-parcours !" : "Objectif atteint !");
      window.setTimeout(() => setCelebration(null), 1300);
    }
    if (navigator.vibrate) navigator.vibrate(nextCombo % 5 === 0 ? [45, 40, 45] : 45);
  }, []);

  const drawScene = useCallback((landmarks?: NormalizedLandmark[][]) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== rect.width * ratio || canvas.height !== rect.height * ratio) {
      canvas.width = rect.width * ratio;
      canvas.height = rect.height * ratio;
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const target = TARGETS[targetIndexRef.current];
    const tx = target.x * rect.width;
    const ty = target.y * rect.height;
    const pulse = 1 + Math.sin(Date.now() / 180) * 0.08;
    ctx.beginPath();
    ctx.arc(tx, ty, 42 * pulse, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(196, 255, 74, .18)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(tx, ty, 27, 0, Math.PI * 2);
    ctx.fillStyle = "#c4ff4a";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.92)";
    ctx.lineWidth = 3;
    ctx.stroke();

    if (!landmarks?.length) return;
    const points = landmarks[0];
    const links = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28]];
    ctx.strokeStyle = "rgba(255,255,255,.62)";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    links.forEach(([a,b]) => {
      if (!points[a] || !points[b]) return;
      ctx.beginPath();
      ctx.moveTo((1 - points[a].x) * rect.width, points[a].y * rect.height);
      ctx.lineTo((1 - points[b].x) * rect.width, points[b].y * rect.height);
      ctx.stroke();
    });
    [15,16].forEach((index) => {
      const point = points[index];
      if (!point || point.visibility < .45) return;
      const x = (1 - point.x) * rect.width;
      const y = point.y * rect.height;
      ctx.beginPath();
      ctx.arc(x, y, 11, 0, Math.PI * 2);
      ctx.fillStyle = "#7dd3fc";
      ctx.fill();
      const distance = Math.hypot(x - tx, y - ty);
      if (stageRef.current === "playing" && distance < 58 && Date.now() - lastHitRef.current > 650) {
        lastHitRef.current = Date.now();
        recordHit();
      }
    });
  }, [recordHit]);

  const loop = useCallback(() => {
    const video = videoRef.current;
    if (video?.readyState && landmarkerRef.current) {
      try {
        const result = landmarkerRef.current.detectForVideo(video, performance.now());
        drawScene(result.landmarks);
      } catch { drawScene(); }
    } else drawScene();
    frameRef.current = requestAnimationFrame(loop);
  }, [drawScene]);

  const startCamera = async () => {
    setStage("loading");
    setCameraError("");
    setStatus("Préparation de la caméra…");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setStatus("Chargement de la détection du corps…");
      const { FilesetResolver, PoseLandmarker } = await import("@mediapipe/tasks-vision");
      const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm");
      landmarkerRef.current = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task", delegate: "GPU" },
        runningMode: "VIDEO", numPoses: 1,
      });
      setStage("calibrate");
      setStatus("Reculez jusqu’à voir votre corps en entier");
      frameRef.current = requestAnimationFrame(loop);
    } catch (error) {
      console.error(error);
      stopCamera();
      setStage("welcome");
      setCameraError("La caméra ou la détection n’a pas pu démarrer. Vérifiez l’autorisation, ou essayez le mode démo.");
    }
  };

  const startGame = () => {
    setHits(0); setPoints(0); setCombo(0); comboRef.current = 0; setSeconds(45); targetIndexRef.current = 0;
    setStatus("Touchez la cible avec une main");
    setStage("playing");
  };

  const startDemo = () => {
    setDemo(true); setStage("playing"); setHits(0); setPoints(0); setCombo(0); comboRef.current = 0; setSeconds(45);
    setStatus("Mode démo — touchez les cibles à l’écran");
    requestAnimationFrame(function animate() { drawScene(); frameRef.current = requestAnimationFrame(animate); });
  };

  const reset = () => {
    stopCamera(); setDemo(false); setStage("welcome"); setHits(0); setPoints(0); setCombo(0); comboRef.current = 0; setSeconds(45);
    setStatus("Placez le téléphone face à vous");
  };

  const demoHit = () => {
    if (!demo || stage !== "playing") return;
    recordHit();
  };

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
    const modelContext = (document as Document & { modelContext?: { registerTool?: (tool: unknown, options?: { signal: AbortSignal }) => void | Promise<void> } }).modelContext;
    if (!modelContext?.registerTool) return;
    const lifecycle = new AbortController();
    try {
      void Promise.resolve(modelContext.registerTool({
        name: "start_demo_session",
        title: "Démarrer la séance démo",
        description: "Démarre une séance de mobilité de l’épaule de 45 secondes sans activer la caméra.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute() {
          setDemo(true); setStage("playing"); setHits(0); setPoints(0); setCombo(0); comboRef.current = 0; setSeconds(45);
          targetIndexRef.current = 0;
          setStatus("Mode démo — touchez les cibles à l’écran");
          return { status: "started", duration_seconds: 45, exercise: "shoulder_mobility" };
        },
      }, { signal: lifecycle.signal })).catch(() => undefined);
    } catch { /* WebMCP n’est pas disponible dans tous les navigateurs. */ }
    return () => lifecycle.abort();
  }, []);

  return (
    <main className="min-h-dvh bg-[#07111f] text-white">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-8">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-2xl bg-[#c4ff4a] text-[#07111f]"><Activity /></span>
          <div><p className="text-lg font-black tracking-tight">MOUVÉO</p><p className="text-xs text-slate-400">Mobilité guidée</p></div>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300"><Shield className="size-4 text-[#c4ff4a]" /> Vidéo traitée sur l’appareil</div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-4 px-4 pb-6 sm:px-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="camera-shell relative min-h-[64dvh] overflow-hidden rounded-[2rem] border border-white/10 bg-[#0d1b2d] shadow-2xl">
          <video ref={videoRef} muted playsInline className={`absolute inset-0 h-full w-full scale-x-[-1] object-cover transition-opacity ${stage === "welcome" || stage === "finished" ? "opacity-0" : "opacity-100"}`} />
          <canvas ref={canvasRef} onClick={demoHit} className={`absolute inset-0 h-full w-full ${demo ? "cursor-pointer" : "pointer-events-none"}`} />

          {stage === "welcome" && (
            <div className="absolute inset-0 grid place-items-center p-6">
              <div className="max-w-lg text-center">
                <span className="mx-auto mb-6 grid size-20 place-items-center rounded-[1.8rem] bg-[#163a63] text-sky-300"><Hand className="size-10" /></span>
                <p className="mb-3 text-sm font-bold uppercase tracking-[.18em] text-[#c4ff4a]">Séance épaule · 45 secondes</p>
                <h1 className="text-balance text-4xl font-black leading-tight sm:text-5xl">Touchez les cibles. Retrouvez votre mouvement.</h1>
                <p className="mx-auto mt-4 max-w-md text-base leading-relaxed text-slate-300">Posez le téléphone, reculez de deux mètres et levez les bras sans forcer.</p>
                {cameraError && <p role="alert" className="mt-4 rounded-xl bg-red-500/15 p-3 text-sm text-red-200">{cameraError}</p>}
                <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
                  <Button size="lg" onClick={startCamera} className="h-13 rounded-2xl bg-[#c4ff4a] px-7 text-base font-bold text-[#07111f] hover:bg-[#d5ff7d]"><Camera /> Activer la caméra</Button>
                  <Button size="lg" variant="outline" onClick={startDemo} className="h-13 rounded-2xl border-white/15 bg-white/5 px-7 text-base text-white hover:bg-white/10 hover:text-white"><Sparkles /> Tester sans caméra</Button>
                </div>
              </div>
            </div>
          )}

          {stage === "loading" && <div className="absolute inset-0 grid place-items-center bg-[#07111f]/85"><div className="text-center"><Activity className="mx-auto mb-4 size-10 animate-pulse text-[#c4ff4a]" /><p className="font-semibold">{status}</p><p className="mt-2 text-sm text-slate-400">La première ouverture peut prendre quelques secondes.</p></div></div>}

          {stage === "calibrate" && (
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#07111f] via-[#07111f]/85 to-transparent p-6 pt-24 text-center">
              <p className="text-xl font-bold">{status}</p><p className="mt-1 text-sm text-slate-300">Votre tête, vos mains et vos hanches doivent rester visibles.</p>
              <Button size="lg" onClick={startGame} className="mt-5 h-13 rounded-2xl bg-[#c4ff4a] px-8 font-bold text-[#07111f] hover:bg-[#d5ff7d]"><Check /> Je suis en position</Button>
            </div>
          )}

          {stage === "playing" && (
            <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between bg-gradient-to-b from-black/70 to-transparent p-5 pb-16">
              <div className="flex gap-3">
                <div><p className="text-sm text-white/70">Score</p><p className="text-4xl font-black tabular-nums">{points}</p></div>
                {combo >= 3 && <div className="mt-1 h-fit rounded-full border border-amber-300/30 bg-amber-300/15 px-3 py-1 text-sm font-black text-amber-200"><Zap className="mr-1 inline size-4 fill-current" /> ×{combo}</div>}
              </div>
              <div className="rounded-2xl bg-black/35 px-5 py-3 text-center backdrop-blur"><p className="text-xs text-white/70">Temps</p><p className="text-2xl font-black tabular-nums">0:{String(seconds).padStart(2,"0")}</p></div>
            </div>
          )}

          {celebration && stage === "playing" && (
            <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center overflow-hidden" aria-live="polite">
              <div className="reward-pop rounded-3xl border border-[#c4ff4a]/40 bg-[#07111f]/85 px-7 py-5 text-center shadow-[0_0_60px_rgba(196,255,74,.28)] backdrop-blur-md">
                <Star className="mx-auto mb-2 size-9 fill-[#c4ff4a] text-[#c4ff4a]" />
                <p className="text-2xl font-black">{celebration}</p><p className="mt-1 text-sm font-bold text-[#c4ff4a]">+ bonus de série</p>
              </div>
              {Array.from({ length: 12 }).map((_, index) => <span key={index} className="spark" style={{ "--i": index } as React.CSSProperties} />)}
            </div>
          )}

          {stage === "finished" && (
            <div className="absolute inset-0 grid place-items-center bg-[#0b1a2b] p-6 text-center">
              <div><span className="mx-auto mb-5 grid size-20 place-items-center rounded-full bg-[#c4ff4a] text-[#07111f]"><Trophy className="size-10" /></span><p className="text-sm font-bold uppercase tracking-[.18em] text-[#c4ff4a]">Séance terminée</p><h2 className="mt-2 text-5xl font-black">{points} points</h2><div className="mt-4 flex justify-center gap-2" aria-label={`${Math.min(3, hits >= 10 ? 3 : hits >= 6 ? 2 : hits >= 3 ? 1 : 0)} étoiles obtenues`}>{[3,6,10].map((goal) => <Star key={goal} className={`size-8 ${hits >= goal ? "fill-amber-300 text-amber-300" : "text-white/15"}`} />)}</div><p className="mt-3 text-slate-300">{hits} cibles touchées · meilleure série ×{combo}</p>{points >= bestScore && points > 0 && <p className="mt-2 font-bold text-amber-200">Nouveau record personnel !</p>}<Button size="lg" onClick={reset} className="mt-7 h-13 rounded-2xl bg-white px-7 font-bold text-[#07111f] hover:bg-slate-100"><RotateCcw /> Recommencer</Button></div>
            </div>
          )}
        </div>

        <aside className="flex flex-col gap-4">
          <div className="rounded-[1.6rem] border border-white/10 bg-white/[.055] p-5">
            <div className="flex items-center justify-between"><p className="font-bold">Séance du jour</p><span className="rounded-full bg-[#c4ff4a]/15 px-3 py-1 text-xs font-bold text-[#c4ff4a]">ÉPAULE</span></div>
            <h2 className="mt-5 text-2xl font-black">Bulles de mobilité</h2><p className="mt-2 text-sm leading-relaxed text-slate-400">Levez alternativement chaque bras et touchez les cibles à votre rythme.</p>
            <div className="mt-6"><div className="mb-2 flex justify-between text-sm"><span className="text-slate-400">Objectif : 10 cibles</span><span className="font-bold">{Math.min(10, hits)}/10</span></div><Progress value={Math.min(100, hits * 10)} className="h-2 bg-white/10 [&_[data-slot=progress-indicator]]:bg-[#c4ff4a]" /></div>
            <div className="mt-5 grid grid-cols-3 gap-2 text-center"><div className="rounded-xl bg-white/5 p-2"><p className="text-lg font-black text-amber-200">{points}</p><p className="text-[11px] text-slate-400">points</p></div><div className="rounded-xl bg-white/5 p-2"><p className="text-lg font-black text-sky-200">×{combo}</p><p className="text-[11px] text-slate-400">série</p></div><div className="rounded-xl bg-white/5 p-2"><p className="text-lg font-black text-[#c4ff4a]">{bestScore}</p><p className="text-[11px] text-slate-400">record</p></div></div>
          </div>
          <div className="rounded-[1.6rem] border border-amber-300/15 bg-amber-300/[.055] p-5"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-amber-300/15 text-amber-200"><Trophy className="size-5" /></span><div><p className="font-bold">Paliers de séance</p><p className="text-xs text-slate-400">Sans chronomètre de vitesse</p></div></div><div className="mt-4 flex items-center justify-between text-sm"><span className={hits >= 3 ? "text-amber-200" : "text-slate-400"}>3 · Découverte</span><span className={hits >= 6 ? "text-amber-200" : "text-slate-400"}>6 · Régulier</span><span className={hits >= 10 ? "text-amber-200" : "text-slate-400"}>10 · Étoile</span></div></div>
          <div className="rounded-[1.6rem] border border-sky-400/15 bg-sky-400/[.06] p-5"><p className="font-bold text-sky-200">Bougez sans douleur</p><p className="mt-2 text-sm leading-relaxed text-slate-300">Arrêtez immédiatement si un mouvement provoque une douleur, un vertige ou un inconfort inhabituel.</p><Button variant="outline" onClick={reset} className="mt-4 w-full rounded-xl border-red-300/20 bg-red-400/10 text-red-100 hover:bg-red-400/20 hover:text-white">Arrêter la séance</Button></div>
          <p className="px-2 text-xs leading-relaxed text-slate-500">Prototype de coaching, sans diagnostic ni mesure clinique. Suivez les consignes de votre professionnel de santé.</p>
        </aside>
      </section>
    </main>
  );
}
