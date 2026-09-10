"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { NormalizedLandmark, PoseLandmarker as PoseLandmarkerType } from "@mediapipe/tasks-vision";
import { Activity, BarChart3, Camera, Check, ChevronLeft, Flower2, History, Pause, Play, RotateCcw, Settings2, Shield, Sparkles, Sprout, Star, Trophy, UserRound, Volume2, VolumeX, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

type Stage = "welcome" | "loading" | "calibrate" | "playing" | "rest" | "finished";
type View = "patient" | "history" | "therapist";
type Arm = "left" | "right";
type ExerciseId = "lateral" | "frontal" | "path" | "hold" | "goalie" | "memory" | "knee" | "march" | "step" | "squat" | "balance";
type BodyMode = "arm" | "knee" | "ankle" | "hips";
type Phase = "reach" | "return";
type WorldId = "garden" | "space" | "ocean";
type SessionMode = "single" | "circuit";
type Mechanic = "pop" | "trail" | "hold" | "rhythm" | "goalie" | "memory" | "platform";
type Point = { x: number; y: number };
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
type SessionRecord = { id: number; date: string; exercise: ExerciseId; arm: Arm; hits: number; points: number; regularity: number; control?: number; painBefore?: number; pain: number; fatigue: number; mode?: SessionMode };

const EXERCISES: Record<ExerciseId, { name: string; short: string; instruction: string; color: string; mode: BodyMode; mechanic: Mechanic; world: WorldId; holdMs?: number; family: "haut du corps" | "jambes" | "équilibre" }> = {
  lateral: { name: "Bulles du jardin", short: "Élévation latérale", instruction: "Éclatez les bulles sur le côté, puis revenez doucement.", color: "#c4ff4a", mode: "arm", mechanic: "pop", world: "garden", family: "haut du corps" },
  frontal: { name: "Luciole devant", short: "Élévation frontale", instruction: "Accompagnez la luciole devant vous sans hausser l’épaule.", color: "#7dd3fc", mode: "arm", mechanic: "trail", world: "garden", family: "haut du corps" },
  path: { name: "Chemin lumineux", short: "Trajectoire contrôlée", instruction: "Suivez les balises successives avec un mouvement fluide.", color: "#c4b5fd", mode: "arm", mechanic: "trail", world: "space", family: "haut du corps" },
  hold: { name: "Étoile stable", short: "Maintien du bras", instruction: "Atteignez l’étoile et maintenez la position une seconde.", color: "#fcd34d", mode: "arm", mechanic: "hold", world: "space", holdMs: 1000, family: "équilibre" },
  goalie: { name: "Gardien du récif", short: "Interception contrôlée", instruction: "Interceptez les perles avec la main, sans déplacer le buste.", color: "#22d3ee", mode: "arm", mechanic: "goalie", world: "ocean", family: "haut du corps" },
  memory: { name: "Constellation mémoire", short: "Séquence de gestes", instruction: "Rejoignez les étoiles dans l’ordre indiqué.", color: "#e879f9", mode: "arm", mechanic: "memory", world: "space", family: "haut du corps" },
  knee: { name: "Fusée genou", short: "Lever de genou", instruction: "Montez le genou vers la planète puis reposez le pied calmement.", color: "#fb7185", mode: "knee", mechanic: "pop", world: "space", family: "jambes" },
  march: { name: "Marche des coraux", short: "Genoux en rythme", instruction: "Levez le genou au passage de chaque vague puis reposez le pied.", color: "#38bdf8", mode: "knee", mechanic: "rhythm", world: "ocean", family: "jambes" },
  step: { name: "Pierres de rivière", short: "Pas latéraux", instruction: "Posez le pied sur la pierre lumineuse puis revenez au centre.", color: "#2dd4bf", mode: "ankle", mechanic: "platform", world: "garden", family: "jambes" },
  squat: { name: "Ascenseur sous-marin", short: "Flexion guidée", instruction: "Descendez les hanches vers le palier puis redressez-vous doucement.", color: "#fb923c", mode: "hips", mechanic: "rhythm", world: "ocean", family: "jambes" },
  balance: { name: "Île équilibre", short: "Équilibre sur une jambe", instruction: "Levez légèrement le pied et maintenez-le dans l’île lumineuse.", color: "#a78bfa", mode: "ankle", mechanic: "hold", world: "ocean", holdMs: 2000, family: "équilibre" },
};

const DEFAULT_HISTORY: SessionRecord[] = [];
const STANDING_ONLY = new Set<ExerciseId>(["step", "squat", "balance"]);
const DEFAULT_CIRCUIT: ExerciseId[] = ["lateral", "march", "balance"];
const WORLDS: Record<WorldId, { name: string; emoji: string; description: string }> = {
  garden: { name: "Jardin", emoji: "🌿", description: "Mobilité douce" },
  space: { name: "Espace", emoji: "✨", description: "Mémoire et précision" },
  ocean: { name: "Océan", emoji: "🌊", description: "Jambes et équilibre" },
};

function regularityScore(times: number[]) {
  if (times.length < 3) return times.length ? 75 : 0;
  const intervals = times.slice(1).map((time, i) => time - times[i]);
  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const variance = intervals.reduce((sum, value) => sum + (value - mean) ** 2, 0) / intervals.length;
  return Math.max(50, Math.min(99, Math.round(100 - (Math.sqrt(variance) / mean) * 70)));
}

function streakScore(history: SessionRecord[]) {
  if (!history.length) return 0;
  const days = new Set(history.map((item) => item.date.slice(0, 10)));
  const cursor = new Date();
  const key = () => cursor.toISOString().slice(0, 10);
  if (!days.has(key())) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (days.has(key())) { streak += 1; cursor.setDate(cursor.getDate() - 1); }
  return streak;
}

export default function MouveoGame() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<PoseLandmarkerType | null>(null);
  const landmarksRef = useRef<NormalizedLandmark[][]>([]);
  const anchorRef = useRef<NormalizedLandmark[]>([]);
  const frameRef = useRef<number | null>(null);
  const stageRef = useRef<Stage>("welcome");
  const phaseRef = useRef<Phase>("reach");
  const targetIndexRef = useRef(0);
  const lastHitRef = useRef(0);
  const lastInferenceRef = useRef(0);
  const dwellRef = useRef(0);
  const calibrationRef = useRef(0);
  const comboRef = useRef(0);
  const hitTimesRef = useRef<number[]>([]);
  const returnStartedRef = useRef(0);
  const controlledReturnsRef = useRef<number[]>([]);
  const circuitIndexRef = useRef(0);
  const programPlanRef = useRef<ExerciseId[]>(DEFAULT_CIRCUIT);
  const visibleRef = useRef(true);

  const [view, setView] = useState<View>("patient");
  const [stage, setStage] = useState<Stage>("welcome");
  const [phase, setPhase] = useState<Phase>("reach");
  const [exercise, setExercise] = useState<ExerciseId>("lateral");
  const [sessionMode, setSessionMode] = useState<SessionMode>("single");
  const [programPlan, setProgramPlan] = useState<ExerciseId[]>(DEFAULT_CIRCUIT);
  const [world, setWorld] = useState<WorldId>("garden");
  const [circuitIndex, setCircuitIndex] = useState(0);
  const [arm, setArm] = useState<Arm>("right");
  const [amplitude, setAmplitude] = useState(75);
  const [goal, setGoal] = useState(8);
  const [seated, setSeated] = useState(false);
  const [voice, setVoice] = useState(true);
  const settingsRef = useRef({ exercise, arm, amplitude, goal, seated, voice, sessionMode });
  settingsRef.current = { exercise, arm, amplitude, goal, seated: seated && !STANDING_ONLY.has(exercise), voice, sessionMode };
  stageRef.current = stage;

  const [status, setStatus] = useState("Choisissez votre mission");
  const [hits, setHits] = useState(0);
  const [sessionHits, setSessionHits] = useState(0);
  const [points, setPoints] = useState(0);
  const [combo, setCombo] = useState(0);
  const [seconds, setSeconds] = useState(60);
  const [bodyVisible, setBodyVisible] = useState(true);
  const [calibration, setCalibration] = useState(0);
  const [celebration, setCelebration] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState("");
  const [demo, setDemo] = useState(false);
  const [pain, setPain] = useState(0);
  const [painBefore, setPainBefore] = useState(0);
  const [fatigue, setFatigue] = useState(2);
  const [saved, setSaved] = useState(false);
  const [history, setHistory] = useState<SessionRecord[]>(DEFAULT_HISTORY);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [online, setOnline] = useState(true);
  programPlanRef.current = programPlan;

  const bestScore = useMemo(() => Math.max(0, ...history.map((item) => item.points)), [history]);
  const lifetimePoints = useMemo(() => history.reduce((sum, item) => sum + item.points, 0), [history]);
  const gardenLevel = Math.min(4, Math.floor(lifetimePoints / 150));
  const regularity = regularityScore(hitTimesRef.current);
  const control = controlledReturnsRef.current.length ? Math.round(controlledReturnsRef.current.reduce((sum, value) => sum + value, 0) / controlledReturnsRef.current.length) : 0;
  const sessionGoal = goal * (sessionMode === "circuit" ? programPlan.length : 1);
  const adaptiveLevel = Math.min(3, Math.floor(combo / 3) + 1);

  const speak = useCallback((text: string) => {
    if (!settingsRef.current.voice || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "fr-FR";
    utterance.rate = 1.02;
    window.speechSynthesis.speak(utterance);
  }, []);

  const stopCamera = useCallback(() => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    landmarkerRef.current?.close();
    landmarkerRef.current = null;
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem("mouveo-history") || "[]") as SessionRecord[];
      setHistory(Array.isArray(stored) ? stored : []);
      const config = JSON.parse(window.localStorage.getItem("mouveo-program") || "null") as (Partial<typeof settingsRef.current> & { plan?: ExerciseId[] }) | null;
      if (config) {
        if (config.exercise && EXERCISES[config.exercise]) setExercise(config.exercise);
        if (config.arm) setArm(config.arm);
        if (config.amplitude) setAmplitude(config.amplitude);
        if (config.goal) setGoal(config.goal);
        if (typeof config.seated === "boolean") setSeated(config.seated);
        if (Array.isArray(config.plan)) {
          const validPlan = config.plan.filter((id): id is ExerciseId => Boolean(EXERCISES[id])).slice(0, 4);
          if (validPlan.length) setProgramPlan(validPlan);
        }
      }
    } catch { /* Les valeurs invalides sont ignorées. */ }
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);

  useEffect(() => {
    setOnline(navigator.onLine);
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    const handleInstall = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPromptEvent); };
    window.addEventListener("online", handleOnline); window.addEventListener("offline", handleOffline); window.addEventListener("beforeinstallprompt", handleInstall);
    return () => { window.removeEventListener("online", handleOnline); window.removeEventListener("offline", handleOffline); window.removeEventListener("beforeinstallprompt", handleInstall); };
  }, []);

  const installApp = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  useEffect(() => {
    if (stage !== "playing") return;
    const timer = window.setInterval(() => {
      if (!visibleRef.current && !demo) return;
      setSeconds((value) => {
        if (value <= 1) {
          stopCamera(); setStage("finished"); return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [stage, demo, stopCamera]);

  const celebrate = useCallback((text: string) => {
    setCelebration(text);
    window.setTimeout(() => setCelebration(null), 1300);
  }, []);

  const completeReturn = useCallback(() => {
    if (returnStartedRef.current) {
      const duration = Date.now() - returnStartedRef.current;
      const score = duration >= 700 && duration <= 4000 ? 100 : duration < 500 ? 55 : 78;
      controlledReturnsRef.current.push(score);
      returnStartedRef.current = 0;
    }
    phaseRef.current = "reach";
    setPhase("reach");
    targetIndexRef.current += 1;
    dwellRef.current = 0;
    setStatus("Nouvelle cible — mouvement lent et confortable");
  }, []);

  const recordHit = useCallback(() => {
    const now = Date.now();
    if (now - lastHitRef.current < 650) return;
    lastHitRef.current = now;
    hitTimesRef.current.push(now);
    returnStartedRef.current = now;
    const nextCombo = comboRef.current + 1;
    comboRef.current = nextCombo;
    const bonus = Math.floor(nextCombo / 3) * 5;
    setSessionHits((value) => value + 1);
    setHits((value) => {
      const next = value + 1;
      if (next >= settingsRef.current.goal) {
        window.setTimeout(() => {
          if (settingsRef.current.sessionMode === "circuit" && circuitIndexRef.current < programPlanRef.current.length - 1) {
            setStage("rest");
            speak("Mission terminée. Prenez une pause avant le jeu suivant.");
          } else {
            stopCamera(); setStage("finished");
          }
        }, 500);
      }
      return next;
    });
    setCombo(nextCombo);
    setPoints((value) => value + 10 + bonus);
    phaseRef.current = "return";
    setPhase("return");
    const mode = EXERCISES[settingsRef.current.exercise].mode;
    setStatus(mode === "arm" ? "Cible atteinte — revenez près de la hanche" : mode === "knee" ? "Genou levé — reposez le pied doucement" : mode === "ankle" ? "Cible atteinte — revenez au centre" : "Descente validée — redressez-vous doucement");
    const milestones = [Math.ceil(settingsRef.current.goal * .4), Math.ceil(settingsRef.current.goal * .7), settingsRef.current.goal];
    if (milestones.includes(nextCombo)) celebrate(nextCombo === milestones[0] ? "Série lancée !" : nextCombo === milestones[1] ? "Très régulier !" : "Mission accomplie !");
    speak(nextCombo % 3 === 0 ? `Série de ${nextCombo}. Revenez doucement.` : "Bien. Revenez doucement.");
    if (navigator.vibrate) navigator.vibrate(nextCombo % 5 === 0 ? [45, 40, 45] : 45);
  }, [celebrate, speak, stopCamera]);

  const project = useCallback((point: NormalizedLandmark, width: number, height: number): Point => {
    const video = videoRef.current;
    if (!video?.videoWidth || !video.videoHeight) return { x: (1 - point.x) * width, y: point.y * height };
    const scale = Math.max(width / video.videoWidth, height / video.videoHeight);
    const cropX = (video.videoWidth * scale - width) / 2;
    const cropY = (video.videoHeight * scale - height) / 2;
    return { x: (1 - point.x) * video.videoWidth * scale - cropX, y: point.y * video.videoHeight * scale - cropY };
  }, []);

  const drawScene = useCallback((landmarks?: NormalizedLandmark[][]) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== Math.round(rect.width * ratio) || canvas.height !== Math.round(rect.height * ratio)) {
      canvas.width = Math.round(rect.width * ratio); canvas.height = Math.round(rect.height * ratio);
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    const cfg = settingsRef.current;
    const points = landmarks?.[0];
    const anchors = anchorRef.current.length ? anchorRef.current : points;
    const mode = EXERCISES[cfg.exercise].mode;
    const shoulderIndex = cfg.arm === "left" ? 11 : 12;
    const elbowIndex = cfg.arm === "left" ? 13 : 14;
    const wristIndex = cfg.arm === "left" ? 15 : 16;
    const hipIndex = cfg.arm === "left" ? 23 : 24;
    const kneeIndex = cfg.arm === "left" ? 25 : 26;
    const ankleIndex = cfg.arm === "left" ? 27 : 28;
    const side = cfg.arm === "left" ? -1 : 1;
    const fallbackOrigin = { x: rect.width / 2 + side * 42, y: rect.height * .42 };
    let origin = fallbackOrigin;
    let neutral = { x: fallbackOrigin.x, y: rect.height * .72 };
    let tracked: Point | null = null;
    let limbLength = Math.min(rect.width, rect.height) * .28;
    let isVisible = demo;
    let trunkStable = true;

    if (points && anchors) {
      const pp = (source: NormalizedLandmark[], index: number) => project(source[index], rect.width, rect.height);
      const average = (source: NormalizedLandmark[], a: number, b: number) => { const pa = pp(source, a); const pb = pp(source, b); return { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 }; };
      if (mode === "arm" && points[wristIndex] && anchors[shoulderIndex]) {
        origin = pp(anchors, shoulderIndex); neutral = pp(anchors, hipIndex); tracked = pp(points, wristIndex);
        const elbow = pp(anchors, elbowIndex); const anchorWrist = pp(anchors, wristIndex);
        limbLength = Math.hypot(origin.x - elbow.x, origin.y - elbow.y) + Math.hypot(elbow.x - anchorWrist.x, elbow.y - anchorWrist.y);
        isVisible = (points[shoulderIndex].visibility ?? 0) > .55 && (points[wristIndex].visibility ?? 0) > .45 && (points[hipIndex].visibility ?? 0) > .45;
        const anchorTorso = average(anchors, 11, 12); const currentTorso = average(points, 11, 12);
        trunkStable = Math.hypot(anchorTorso.x - currentTorso.x, anchorTorso.y - currentTorso.y) < limbLength * .2;
      } else if ((mode === "knee" || mode === "ankle") && points[ankleIndex] && anchors[hipIndex]) {
        const anchorHip = pp(anchors, hipIndex); const anchorKnee = pp(anchors, kneeIndex); const anchorAnkle = pp(anchors, ankleIndex);
        origin = anchorHip; neutral = mode === "knee" ? anchorKnee : anchorAnkle; tracked = pp(points, mode === "knee" ? kneeIndex : ankleIndex);
        limbLength = Math.hypot(anchorHip.x - anchorKnee.x, anchorHip.y - anchorKnee.y) + Math.hypot(anchorKnee.x - anchorAnkle.x, anchorKnee.y - anchorAnkle.y);
        isVisible = (points[hipIndex].visibility ?? 0) > .55 && (points[kneeIndex].visibility ?? 0) > .5 && (points[ankleIndex].visibility ?? 0) > .45;
      } else if (mode === "hips" && points[23] && points[24] && anchors[11] && anchors[12]) {
        origin = average(anchors, 23, 24); neutral = origin; tracked = average(points, 23, 24);
        const shoulders = average(anchors, 11, 12); limbLength = Math.max(100, Math.hypot(origin.x - shoulders.x, origin.y - shoulders.y));
        isVisible = [11,12,23,24,25,26].every((index) => (points[index].visibility ?? 0) > .48);
      }
    }

    if (visibleRef.current !== isVisible) { visibleRef.current = isVisible; setBodyVisible(isVisible); }
    if (stageRef.current === "calibrate") {
      if (isVisible) {
        if (!calibrationRef.current) calibrationRef.current = Date.now();
        const progress = Math.min(100, Math.round((Date.now() - calibrationRef.current) / 18));
        setCalibration(progress);
        if (progress >= 100 && points) {
          anchorRef.current = points.map((point) => ({ ...point }));
          setStage("playing"); setStatus("Atteignez la cible sans forcer"); speak("Calibration terminée. Atteignez la cible sans forcer.");
        }
      } else { calibrationRef.current = 0; setCalibration(0); }
    }

    if (points?.length) {
      const links = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28]];
      ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.lineWidth = 4; ctx.lineCap = "round";
      links.forEach(([a,b]) => { if (!points[a] || !points[b]) return; const pa = project(points[a], rect.width, rect.height); const pb = project(points[b], rect.width, rect.height); ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke(); });
    }

    if (stageRef.current !== "playing" && stageRef.current !== "calibrate") return;
    const strength = cfg.amplitude / 100;
    const step = targetIndexRef.current % 3;
    const patterns: Record<ExerciseId, Point[]> = {
      lateral: [{ x: .72, y: -.52 }, { x: .86, y: -.68 }, { x: .68, y: -.82 }],
      frontal: [{ x: .28, y: -.62 }, { x: .35, y: -.82 }, { x: .2, y: -.95 }],
      path: [{ x: .42, y: -.35 }, { x: .68, y: -.62 }, { x: .82, y: -.82 }],
      hold: [{ x: .72, y: -.65 }, { x: .72, y: -.65 }, { x: .72, y: -.65 }],
      goalie: [{ x: .68, y: -.28 }, { x: .85, y: -.62 }, { x: .55, y: -.88 }],
      memory: [{ x: .35, y: -.4 }, { x: .78, y: -.7 }, { x: .45, y: -.92 }],
      knee: [{ x: .04, y: .16 }, { x: .12, y: .12 }, { x: .02, y: .08 }],
      march: [{ x: .04, y: .18 }, { x: .1, y: .12 }, { x: .02, y: .08 }],
      step: [{ x: .38, y: .5 }, { x: .52, y: .5 }, { x: .65, y: .5 }],
      squat: [{ x: 0, y: .36 }, { x: 0, y: .46 }, { x: 0, y: .4 }],
      balance: [{ x: .25, y: .58 }, { x: .32, y: .52 }, { x: .22, y: .48 }],
    };
    const offset = patterns[cfg.exercise][step];
    const applySide = mode === "hips" ? 0 : side;
    const adaptiveReach = Math.min(1.04, 1 + Math.floor(comboRef.current / 4) * .015);
    const reachTarget = { x: origin.x + applySide * limbLength * offset.x * strength * adaptiveReach, y: origin.y + limbLength * offset.y * strength * adaptiveReach };
    const returnTarget = neutral;
    const target = phaseRef.current === "reach" ? reachTarget : returnTarget;
    const color = phaseRef.current === "reach" ? EXERCISES[cfg.exercise].color : "#7dd3fc";
    const pulse = 1 + Math.sin(Date.now() / 180) * .08;
    const targetRadius = Math.max(21, 29 - Math.floor(comboRef.current / 3) * 1.5);
    const mechanic = EXERCISES[cfg.exercise].mechanic;
    if (mechanic === "trail" || mechanic === "memory") {
      ctx.beginPath(); ctx.moveTo(origin.x, origin.y); ctx.lineTo(target.x, target.y); ctx.setLineDash([7, 12]); ctx.strokeStyle = `${color}88`; ctx.lineWidth = 4; ctx.stroke(); ctx.setLineDash([]);
    }
    if (mechanic === "rhythm") {
      ctx.beginPath(); ctx.arc(target.x, target.y, 58 + Math.sin(Date.now() / 230) * 16, 0, Math.PI * 2); ctx.strokeStyle = `${color}99`; ctx.lineWidth = 5; ctx.stroke();
    }
    ctx.beginPath();
    if (mechanic === "platform") ctx.roundRect(target.x - 48, target.y - 19, 96, 38, 16);
    else ctx.arc(target.x, target.y, 42 * pulse, 0, Math.PI * 2);
    ctx.fillStyle = `${color}2e`; ctx.fill();
    ctx.beginPath(); ctx.arc(target.x, target.y, phaseRef.current === "reach" ? targetRadius : 22, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = "rgba(255,255,255,.9)"; ctx.lineWidth = 3; ctx.stroke();
    if (mechanic === "memory" && phaseRef.current === "reach") { ctx.fillStyle = "#07111f"; ctx.font = "800 15px system-ui"; ctx.textAlign = "center"; ctx.fillText(String(step + 1), target.x, target.y + 5); }
    if (mechanic === "goalie" && phaseRef.current === "reach") { ctx.strokeStyle = "rgba(255,255,255,.75)"; ctx.lineWidth = 3; ctx.strokeRect(target.x - 38, target.y - 38, 76, 76); }
    if (phaseRef.current === "return") { ctx.fillStyle = "#07111f"; ctx.font = "700 16px system-ui"; ctx.textAlign = "center"; ctx.fillText("↙", target.x, target.y + 6); }

    if (!tracked || !isVisible || stageRef.current !== "playing") return;
    ctx.beginPath(); ctx.arc(tracked.x, tracked.y, 11, 0, Math.PI * 2); ctx.fillStyle = "#fff"; ctx.fill();
    if (!trunkStable) { setStatus("Ralentissez et gardez le buste stable"); return; }
    const distance = Math.hypot(tracked.x - target.x, tracked.y - target.y);
    if (distance < Math.max(48, limbLength * .16)) {
      if (phaseRef.current === "return") completeReturn();
      else if (EXERCISES[cfg.exercise].holdMs) {
        if (!dwellRef.current) dwellRef.current = Date.now();
        const dwell = Math.min(1, (Date.now() - dwellRef.current) / (EXERCISES[cfg.exercise].holdMs ?? 1000));
        ctx.beginPath(); ctx.arc(target.x, target.y, 35, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * dwell); ctx.strokeStyle = "white"; ctx.lineWidth = 5; ctx.stroke();
        if (dwell >= 1) { dwellRef.current = 0; recordHit(); }
      } else recordHit();
    } else if (phaseRef.current === "reach") dwellRef.current = 0;
  }, [completeReturn, demo, project, recordHit, speak]);

  const loop = useCallback(() => {
    const video = videoRef.current;
    const now = performance.now();
    if (video?.readyState && landmarkerRef.current && now - lastInferenceRef.current > 66) {
      lastInferenceRef.current = now;
      try { landmarksRef.current = landmarkerRef.current.detectForVideo(video, now).landmarks; } catch { /* La dernière pose reste affichée. */ }
    }
    drawScene(landmarksRef.current);
    frameRef.current = requestAnimationFrame(loop);
  }, [drawScene]);

  const prepareSession = () => {
    stopCamera(); anchorRef.current = []; setHits(0); setSessionHits(0); setPoints(0); setCombo(0); comboRef.current = 0; setSeconds(sessionMode === "circuit" ? 60 * programPlan.length : 60); setSaved(false); setPain(painBefore); setFatigue(2); setCalibration(0); calibrationRef.current = 0; targetIndexRef.current = 0; hitTimesRef.current = []; controlledReturnsRef.current = []; returnStartedRef.current = 0; circuitIndexRef.current = 0; setCircuitIndex(0); phaseRef.current = "reach"; setPhase("reach"); setBodyVisible(true); visibleRef.current = true;
  };

  const startCamera = async () => {
    prepareSession(); setDemo(false); setStage("loading"); setCameraError(""); setStatus("Préparation de la caméra…");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      setStatus("Chargement du suivi du mouvement…");
      const { FilesetResolver, PoseLandmarker } = await import("@mediapipe/tasks-vision");
      const vision = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
      landmarkerRef.current = await PoseLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: "/mediapipe/pose_landmarker_lite.task", delegate: "GPU" }, runningMode: "VIDEO", numPoses: 1, minPoseDetectionConfidence: .55, minTrackingConfidence: .55 });
      setStage("calibrate"); setStatus(settingsRef.current.seated ? "Asseyez-vous au centre, bras et hanches visibles" : sessionMode === "circuit" || EXERCISES[exercise].mode !== "arm" ? "Reculez : votre corps entier doit être visible" : "Reculez : tête, bras et hanches doivent être visibles");
      speak("Placez-vous au centre du cadre.");
      frameRef.current = requestAnimationFrame(loop);
    } catch (error) {
      console.error(error); stopCamera(); setStage("welcome"); setCameraError("La caméra n’a pas pu démarrer. Vérifiez l’autorisation, ou utilisez la démo.");
    }
  };

  const startDemo = () => {
    prepareSession(); setDemo(true); visibleRef.current = true; setStage("playing"); setStatus("Mode démo — touchez chaque cible puis la cible de retour");
    requestAnimationFrame(function animate() { drawScene(); frameRef.current = requestAnimationFrame(animate); });
  };

  const reset = () => { prepareSession(); setDemo(false); setStage("welcome"); setStatus("Choisissez votre mission"); };
  const demoHit = () => { if (!demo || stage !== "playing") return; if (phaseRef.current === "reach") recordHit(); else completeReturn(); };

  const continueCircuit = () => {
    const nextIndex = circuitIndexRef.current + 1;
    const nextExercise = programPlanRef.current[nextIndex];
    circuitIndexRef.current = nextIndex; setCircuitIndex(nextIndex); setExercise(nextExercise); setHits(0); targetIndexRef.current = 0; dwellRef.current = 0; returnStartedRef.current = 0; phaseRef.current = "reach"; setPhase("reach"); setStatus("Nouvelle mission — commencez lentement"); setStage("playing"); speak(`Jeu ${nextIndex + 1} sur ${programPlanRef.current.length}. ${EXERCISES[nextExercise].instruction}`);
  };

  const saveSummary = () => {
    if (saved) return;
    const record: SessionRecord = { id: Date.now(), date: new Date().toISOString(), exercise, arm, hits: sessionHits, points, regularity, control, painBefore, pain, fatigue, mode: sessionMode };
    const next = [record, ...history].slice(0, 30);
    setHistory(next); window.localStorage.setItem("mouveo-history", JSON.stringify(next)); setSaved(true); celebrate("Séance enregistrée !");
  };

  const saveProgram = () => {
    window.localStorage.setItem("mouveo-program", JSON.stringify({ exercise, arm, amplitude, goal, seated, plan: programPlan }));
    celebrate("Programme mis à jour !"); setView("patient");
  };

  useEffect(() => {
    const modelContext = (document as Document & { modelContext?: { registerTool?: (tool: unknown, options?: { signal: AbortSignal }) => void | Promise<void> } }).modelContext;
    if (!modelContext?.registerTool) return;
    const lifecycle = new AbortController();
    try { void Promise.resolve(modelContext.registerTool({ name: "start_demo_session", title: "Démarrer la séance démo", description: "Démarre le programme d’épaule configuré sans caméra.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute() { document.getElementById("start-demo")?.click(); return { status: "started", ...settingsRef.current }; } }, { signal: lifecycle.signal })).catch(() => undefined); } catch { /* WebMCP facultatif. */ }
    return () => lifecycle.abort();
  }, []);

  if (view === "history") return <HistoryView history={history} bestScore={bestScore} onBack={() => setView("patient")} />;
  if (view === "therapist") return <TherapistView history={history} exercise={exercise} setExercise={setExercise} programPlan={programPlan} setProgramPlan={setProgramPlan} arm={arm} setArm={setArm} amplitude={amplitude} setAmplitude={setAmplitude} goal={goal} setGoal={setGoal} seated={seated} setSeated={setSeated} onSave={saveProgram} onBack={() => setView("patient")} />;

  return (
    <main className="min-h-dvh bg-[#07111f] text-white">
      <Header onHistory={() => setView("history")} onTherapist={() => { setSessionMode("single"); setView("therapist"); }} voice={voice} onVoice={() => setVoice((v) => !v)} online={online} canInstall={Boolean(installPrompt)} onInstall={installApp} />
      <section className="mx-auto grid max-w-7xl gap-4 px-4 pb-6 sm:px-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="camera-shell relative min-h-[64dvh] overflow-hidden rounded-[2rem] border border-white/10 bg-[#0d1b2d] shadow-2xl">
          <video ref={videoRef} muted playsInline className={`absolute inset-0 h-full w-full scale-x-[-1] object-cover transition-opacity ${stage === "welcome" || stage === "finished" ? "opacity-0" : "opacity-100"}`} />
          <canvas ref={canvasRef} onClick={demoHit} className={`absolute inset-0 h-full w-full ${demo ? "cursor-pointer" : "pointer-events-none"}`} />
          {stage === "welcome" && <Welcome exercise={exercise} setExercise={setExercise} sessionMode={sessionMode} setSessionMode={setSessionMode} programPlan={programPlan} world={world} setWorld={setWorld} painBefore={painBefore} setPainBefore={setPainBefore} cameraError={cameraError} onCamera={startCamera} onDemo={startDemo} />}
          {stage === "loading" && <CenteredStatus icon={<Activity className="size-10 animate-pulse text-[#c4ff4a]" />} title={status} detail="La première ouverture peut prendre quelques secondes." />}
          {stage === "calibrate" && <div className="absolute inset-0 grid place-items-end bg-[#07111f]/25 p-6"><div className="w-full rounded-3xl bg-[#07111f]/90 p-5 text-center backdrop-blur"><p className="text-xl font-bold">{bodyVisible ? "Ne bougez plus, calibration…" : status}</p><Progress value={calibration} className="mx-auto mt-4 h-3 max-w-md bg-white/10 [&_[data-slot=progress-indicator]]:bg-[#c4ff4a]" /><p className="mt-2 text-sm text-slate-300">{calibration}% · aucune mesure clinique</p></div></div>}
          {stage === "playing" && <GameHud points={points} combo={combo} seconds={seconds} status={status} visible={bodyVisible || demo} phase={phase} />}
          {stage === "rest" && <RestScreen completed={circuitIndex + 1} total={programPlan.length} nextExercise={programPlan[circuitIndex + 1]} onContinue={continueCircuit} onStop={() => { stopCamera(); setStage("finished"); }} />}
          {celebration && <Celebration text={celebration} />}
          {stage === "finished" && <Summary hits={sessionHits} goal={sessionGoal} points={points} regularity={regularity} control={control} painBefore={painBefore} pain={pain} setPain={setPain} fatigue={fatigue} setFatigue={setFatigue} saved={saved} onSave={saveSummary} onReset={reset} />}
          {stage !== "welcome" && stage !== "finished" && stage !== "rest" && <button aria-label="Arrêter immédiatement la séance" onClick={reset} className="absolute right-4 top-24 z-40 rounded-full border border-red-200/30 bg-red-500/85 px-4 py-2 text-sm font-black text-white shadow-lg backdrop-blur hover:bg-red-500"><Pause className="mr-1 inline size-4" /> Arrêter</button>}
        </div>
        <aside className="flex flex-col gap-4">
          <SessionCard exercise={exercise} arm={arm} setArm={setArm} amplitude={amplitude} setAmplitude={setAmplitude} goal={goal} hits={hits} points={points} combo={combo} adaptiveLevel={adaptiveLevel} sessionMode={sessionMode} circuitIndex={circuitIndex} circuitTotal={programPlan.length} />
          <Garden level={gardenLevel} points={lifetimePoints} sessions={history.length} history={history} />
          <div className="rounded-[1.4rem] border border-sky-400/15 bg-sky-400/[.06] p-4"><p className="font-bold text-sky-200">Bougez sans douleur</p><p className="mt-1 text-sm leading-relaxed text-slate-300">Arrêtez en cas de douleur, vertige ou inconfort inhabituel.</p>{stage !== "welcome" && <Button variant="outline" onClick={reset} className="mt-3 w-full rounded-xl border-red-300/20 bg-red-400/10 text-red-100 hover:bg-red-400/20 hover:text-white"><Pause /> Arrêter la séance</Button>}</div>
          <p className="px-2 text-xs leading-relaxed text-slate-500">Prototype de coaching, sans diagnostic ni mesure clinique. Suivez les consignes de votre professionnel de santé.</p>
        </aside>
      </section>
    </main>
  );
}

function Header({ onHistory, onTherapist, voice, onVoice, online, canInstall, onInstall }: { onHistory: () => void; onTherapist: () => void; voice: boolean; onVoice: () => void; online: boolean; canInstall: boolean; onInstall: () => void }) {
  return <header className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4 sm:px-8"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-2xl bg-[#c4ff4a] text-[#07111f]"><Activity /></span><div><p className="text-lg font-black tracking-tight">MOUVÉO</p><p className="flex items-center gap-1.5 text-xs text-slate-400"><span className={`size-1.5 rounded-full ${online ? "bg-emerald-300" : "bg-amber-300"}`} />{online ? "Prêt" : "Mode hors ligne"}</p></div></div><nav className="flex items-center gap-1">{canInstall && <Button variant="outline" onClick={onInstall} className="hidden border-[#c4ff4a]/30 bg-[#c4ff4a]/10 text-[#c4ff4a] hover:bg-[#c4ff4a]/20 hover:text-[#c4ff4a] sm:inline-flex"><Sparkles /> Installer</Button>}<Button aria-label={voice ? "Désactiver la voix" : "Activer la voix"} variant="ghost" size="icon" onClick={onVoice} className="text-slate-300 hover:bg-white/10 hover:text-white">{voice ? <Volume2 /> : <VolumeX />}</Button><Button variant="ghost" onClick={onHistory} className="text-slate-300 hover:bg-white/10 hover:text-white"><History /> <span className="hidden sm:inline">Historique</span></Button><Button variant="ghost" onClick={onTherapist} className="text-slate-300 hover:bg-white/10 hover:text-white"><Settings2 /> <span className="hidden sm:inline">Thérapeute</span></Button></nav></header>;
}

function Welcome({ exercise, setExercise, sessionMode, setSessionMode, programPlan, world, setWorld, painBefore, setPainBefore, cameraError, onCamera, onDemo }: { exercise: ExerciseId; setExercise: (id: ExerciseId) => void; sessionMode: SessionMode; setSessionMode: (mode: SessionMode) => void; programPlan: ExerciseId[]; world: WorldId; setWorld: (world: WorldId) => void; painBefore: number; setPainBefore: (value: number) => void; cameraError: string; onCamera: () => void; onDemo: () => void }) {
  const chooseCircuit = () => { setSessionMode("circuit"); setExercise(programPlan[0]); };
  return <div className="absolute inset-0 overflow-y-auto p-5 sm:p-8"><div className="mx-auto max-w-2xl"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-bold uppercase tracking-[.18em] text-[#c4ff4a]">Mission du jour</p><h1 className="mt-2 text-4xl font-black leading-tight sm:text-5xl">Choisissez votre aventure.</h1></div><span className="hidden rounded-2xl bg-white/5 px-4 py-3 text-3xl sm:block">{WORLDS[world].emoji}</span></div><button onClick={chooseCircuit} className={`mt-5 w-full rounded-2xl border p-4 text-left transition ${sessionMode === "circuit" ? "border-[#c4ff4a] bg-[#c4ff4a]/12" : "border-white/10 bg-gradient-to-r from-sky-400/10 to-violet-400/10 hover:border-white/25"}`}><span className="block text-lg font-black">Mon parcours · {programPlan.length} jeu{programPlan.length === 1 ? "" : "x"}</span><span className="mt-1 block text-sm text-slate-300">{programPlan.map((id) => EXERCISES[id].name).join(" → ")}</span><span className="mt-2 inline-block rounded-full bg-white/10 px-3 py-1 text-xs font-bold">Environ {programPlan.length} minute{programPlan.length === 1 ? "" : "s"} · pauses incluses</span></button><div className="mt-5 flex gap-2 overflow-x-auto pb-1">{(Object.entries(WORLDS) as [WorldId, typeof WORLDS[WorldId]][]).map(([id, item]) => <button key={id} onClick={() => setWorld(id)} className={`shrink-0 rounded-full border px-4 py-2 text-sm font-bold ${world === id ? "border-white/40 bg-white/15 text-white" : "border-white/10 text-slate-400"}`}>{item.emoji} {item.name}</button>)}</div><p className="mt-2 text-sm text-slate-400">{WORLDS[world].description}</p><div className="mt-3 grid grid-cols-2 gap-3">{(Object.entries(EXERCISES) as [ExerciseId, typeof EXERCISES[ExerciseId]][]).filter(([, item]) => item.world === world).map(([id, item]) => <button key={id} onClick={() => { setExercise(id); setSessionMode("single"); }} className={`min-h-28 rounded-2xl border p-4 text-left transition ${sessionMode === "single" && exercise === id ? "border-[#c4ff4a] bg-[#c4ff4a]/10" : "border-white/10 bg-white/5 hover:bg-white/10"}`}><span className="mb-3 block size-3 rounded-full" style={{ background: item.color }} /><span className="block font-bold">{item.name}</span><span className="mt-1 block text-xs leading-relaxed text-slate-400">{item.short}</span></button>)}</div><label className="mt-5 block rounded-2xl border border-white/10 bg-white/5 p-4"><span className="flex justify-between font-bold"><span>Douleur avant la séance</span><span className={painBefore >= 5 ? "text-amber-300" : "text-[#c4ff4a]"}>{painBefore}/10</span></span><input aria-label="Douleur avant la séance" className="mt-3 w-full accent-[#c4ff4a]" type="range" min="0" max="10" value={painBefore} onChange={(event) => setPainBefore(Number(event.target.value))} />{painBefore >= 5 && <span className="mt-2 block text-sm text-amber-200">Choisissez une amplitude très confortable et suivez les consignes de votre professionnel.</span>}</label>{cameraError && <p role="alert" className="mt-4 rounded-xl bg-red-500/15 p-3 text-sm text-red-200">{cameraError}</p>}<div className="mt-6 flex flex-col gap-3 sm:flex-row"><Button size="lg" onClick={onCamera} className="h-13 rounded-2xl bg-[#c4ff4a] px-7 text-base font-bold text-[#07111f] hover:bg-[#d5ff7d]"><Camera /> Commencer avec la caméra</Button><Button id="start-demo" size="lg" variant="outline" onClick={onDemo} className="h-13 rounded-2xl border-white/15 bg-white/5 px-7 text-base text-white hover:bg-white/10 hover:text-white"><Sparkles /> Démo tactile</Button></div></div></div>;
}

function CenteredStatus({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) { return <div className="absolute inset-0 grid place-items-center bg-[#07111f]/88 p-6"><div className="text-center">{<span className="mx-auto mb-4 block w-fit">{icon}</span>}<p className="font-semibold">{title}</p><p className="mt-2 text-sm text-slate-400">{detail}</p></div></div>; }

function RestScreen({ completed, total, nextExercise, onContinue, onStop }: { completed: number; total: number; nextExercise: ExerciseId; onContinue: () => void; onStop: () => void }) {
  return <div className="absolute inset-0 z-30 grid place-items-center bg-[#07111f]/92 p-6 backdrop-blur"><div className="max-w-md text-center"><span className="mx-auto grid size-16 place-items-center rounded-full bg-sky-300/15 text-3xl">💧</span><p className="mt-5 text-sm font-bold uppercase tracking-[.18em] text-sky-300">Pause récupération · {completed}/{total}</p><h2 className="mt-2 text-4xl font-black">Respirez tranquillement.</h2><p className="mt-3 text-slate-300">Prochaine mission : <strong className="text-white">{EXERCISES[nextExercise].name}</strong></p><div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center"><Button size="lg" onClick={onContinue} className="h-12 rounded-xl bg-[#c4ff4a] font-bold text-[#07111f] hover:bg-[#d5ff7d]"><Play /> Je suis prêt</Button><Button size="lg" variant="outline" onClick={onStop} className="h-12 rounded-xl border-white/15 bg-white/5 text-white hover:bg-white/10 hover:text-white">Terminer ici</Button></div></div></div>;
}

function GameHud({ points, combo, seconds, status, visible, phase }: { points: number; combo: number; seconds: number; status: string; visible: boolean; phase: Phase }) {
  return <><div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between bg-gradient-to-b from-black/75 to-transparent p-5 pb-20"><div className="flex gap-3"><div><p className="text-sm text-white/70">Score</p><p className="text-4xl font-black tabular-nums">{points}</p></div>{combo >= 3 && <div className="mt-1 h-fit rounded-full border border-amber-300/30 bg-amber-300/15 px-3 py-1 text-sm font-black text-amber-200"><Zap className="mr-1 inline size-4 fill-current" /> ×{combo}</div>}</div><div className="rounded-2xl bg-black/35 px-5 py-3 text-center backdrop-blur"><p className="text-xs text-white/70">Temps actif</p><p className="text-2xl font-black tabular-nums">0:{String(seconds).padStart(2,"0")}</p></div></div><div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center px-4"><div className={`rounded-full px-5 py-3 text-center text-sm font-bold shadow-xl backdrop-blur ${visible ? "bg-[#07111f]/80 text-white" : "bg-amber-300 text-[#07111f]"}`}>{visible ? <>{phase === "reach" ? <Play className="mr-2 inline size-4" /> : <RotateCcw className="mr-2 inline size-4" />}{status}</> : <><Pause className="mr-2 inline size-4" />Repositionnez-vous — séance en pause</>}</div></div></>;
}

function Celebration({ text }: { text: string }) { return <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center overflow-hidden" aria-live="polite"><div className="reward-pop rounded-3xl border border-[#c4ff4a]/40 bg-[#07111f]/90 px-7 py-5 text-center shadow-[0_0_60px_rgba(196,255,74,.28)] backdrop-blur"><Star className="mx-auto mb-2 size-9 fill-[#c4ff4a] text-[#c4ff4a]" /><p className="text-2xl font-black">{text}</p></div>{Array.from({ length: 12 }).map((_, index) => <span key={index} className="spark" style={{ "--i": index } as CSSProperties} />)}</div>; }

function Summary({ hits, goal, points, regularity, control, painBefore, pain, setPain, fatigue, setFatigue, saved, onSave, onReset }: { hits: number; goal: number; points: number; regularity: number; control: number; painBefore: number; pain: number; setPain: (v: number) => void; fatigue: number; setFatigue: (v: number) => void; saved: boolean; onSave: () => void; onReset: () => void }) {
  const stars = hits >= goal ? 3 : hits >= goal * .65 ? 2 : hits >= goal * .35 ? 1 : 0;
  const feedback = pain - painBefore >= 2 ? "Votre douleur a augmenté : privilégiez le repos et signalez-le à votre professionnel." : control >= 85 ? "Vos retours sont bien contrôlés. Gardez cette lenteur confortable." : regularity >= 80 ? "Votre rythme est régulier. Pensez maintenant à ralentir le retour." : "Chaque mouvement compte. Cherchez surtout un geste lent et confortable.";
  return <div className="absolute inset-0 overflow-y-auto bg-[#0b1a2b] p-6"><div className="mx-auto max-w-xl text-center"><span className="mx-auto mb-4 grid size-16 place-items-center rounded-full bg-[#c4ff4a] text-[#07111f]"><Trophy className="size-8" /></span><p className="text-sm font-bold uppercase tracking-[.18em] text-[#c4ff4a]">Séance terminée</p><h2 className="mt-1 text-5xl font-black">{points} points</h2><div className="mt-3 flex justify-center gap-2">{[1,2,3].map((n) => <Star key={n} className={`size-8 ${stars >= n ? "fill-amber-300 text-amber-300" : "text-white/15"}`} />)}</div><div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4"><Metric value={String(hits)} label="mouvements" /><Metric value={`${regularity}%`} label="régularité" /><Metric value={control ? `${control}%` : "—"} label="retour contrôlé" /><Metric value={`${Math.round(points / Math.max(1, hits))}`} label="pts / mouvement" /></div><div className="mt-4 rounded-2xl border border-sky-300/15 bg-sky-300/[.07] p-4 text-left"><p className="text-sm font-bold text-sky-200">Conseil pour la prochaine séance</p><p className="mt-1 text-sm leading-relaxed text-slate-200">{feedback}</p></div><div className="mt-4 rounded-2xl bg-white/5 p-5 text-left"><label className="block font-bold">Douleur après la séance : {pain}/10 <span className="font-normal text-slate-400">(avant : {painBefore}/10)</span></label><input aria-label="Douleur après la séance" className="mt-3 w-full accent-[#c4ff4a]" type="range" min="0" max="10" value={pain} onChange={(e) => setPain(Number(e.target.value))} />{pain - painBefore >= 2 && <p className="mt-2 rounded-xl bg-amber-300/10 p-3 text-sm text-amber-200">La douleur a augmenté. Arrêtez les exercices et parlez-en à votre professionnel de santé avant la prochaine séance.</p>}<label className="mt-5 block font-bold">Fatigue : {fatigue}/10</label><input aria-label="Fatigue ressentie" className="mt-3 w-full accent-sky-300" type="range" min="0" max="10" value={fatigue} onChange={(e) => setFatigue(Number(e.target.value))} /></div><p className="mt-4 text-xs leading-relaxed text-slate-500">Les scores sont des repères de jeu approximatifs, pas des mesures cliniques.</p><div className="mt-5 flex flex-col justify-center gap-3 sm:flex-row"><Button size="lg" disabled={saved} onClick={onSave} className="h-12 rounded-xl bg-[#c4ff4a] font-bold text-[#07111f] hover:bg-[#d5ff7d]"><Check /> {saved ? "Séance enregistrée" : "Enregistrer le bilan"}</Button><Button size="lg" variant="outline" onClick={onReset} className="h-12 rounded-xl border-white/15 bg-white/5 text-white hover:bg-white/10 hover:text-white"><RotateCcw /> Nouvelle séance</Button></div></div></div>;
}

function Metric({ value, label }: { value: string; label: string }) { return <div className="rounded-xl bg-white/5 p-3 text-center"><p className="text-xl font-black">{value}</p><p className="text-xs text-slate-400">{label}</p></div>; }

function SessionCard({ exercise, arm, setArm, amplitude, setAmplitude, goal, hits, points, combo, adaptiveLevel, sessionMode, circuitIndex, circuitTotal }: { exercise: ExerciseId; arm: Arm; setArm: (v: Arm) => void; amplitude: number; setAmplitude: (v: number) => void; goal: number; hits: number; points: number; combo: number; adaptiveLevel: number; sessionMode: SessionMode; circuitIndex: number; circuitTotal: number }) {
  return <div className="rounded-[1.6rem] border border-white/10 bg-white/[.055] p-5"><div className="flex items-center justify-between gap-2"><p className="font-bold">{sessionMode === "circuit" ? `Parcours · jeu ${circuitIndex + 1}/${circuitTotal}` : "Programme du jour"}</p><span className="rounded-full bg-[#c4ff4a]/15 px-3 py-1 text-xs font-bold uppercase text-[#c4ff4a]">{EXERCISES[exercise].family}</span></div><h2 className="mt-4 text-2xl font-black">{EXERCISES[exercise].name}</h2><p className="mt-1 text-sm leading-relaxed text-slate-400">{EXERCISES[exercise].instruction}</p><div className="mt-4 flex gap-2">{(["left","right"] as Arm[]).map((value) => <button key={value} onClick={() => setArm(value)} className={`flex-1 rounded-xl border px-3 py-2 text-sm font-bold ${arm === value ? "border-sky-300 bg-sky-300/15 text-sky-200" : "border-white/10 text-slate-400"}`}>Côté {value === "left" ? "gauche" : "droit"}</button>)}</div><label className="mt-4 flex justify-between text-sm"><span className="text-slate-400">Amplitude confortable</span><span className="font-bold">{amplitude}%</span></label><input aria-label="Amplitude confortable" className="mt-2 w-full accent-[#c4ff4a]" type="range" min="55" max="95" step="10" value={amplitude} onChange={(e) => setAmplitude(Number(e.target.value))} /><div className="mt-4"><div className="mb-2 flex justify-between text-sm"><span className="text-slate-400">Objectif de ce jeu</span><span className="font-bold">{Math.min(goal, hits)}/{goal}</span></div><Progress value={Math.min(100, hits / goal * 100)} className="h-2 bg-white/10 [&_[data-slot=progress-indicator]]:bg-[#c4ff4a]" /></div><div className="mt-4 grid grid-cols-3 gap-2 text-center"><Metric value={String(points)} label="points" /><Metric value={`×${combo}`} label="série" /><Metric value={String(adaptiveLevel)} label="niveau adapté" /></div><p className="mt-3 text-xs leading-relaxed text-slate-500">La cible s’ajuste légèrement selon votre régularité, sans dépasser l’amplitude choisie.</p></div>;
}

function Garden({ level, points, sessions, history }: { level: number; points: number; sessions: number; history: SessionRecord[] }) {
  const names = ["Graine", "Pousse", "Jeune plante", "En fleurs", "Jardin lumineux"];
  const streak = streakScore(history);
  const totalMoves = history.reduce((sum, item) => sum + item.hits, 0);
  const badges = [{ icon: "🌱", label: "Premier pas", unlocked: sessions >= 1 }, { icon: "💯", label: "100 mouvements", unlocked: totalMoves >= 100 }, { icon: "🎯", label: "Geste contrôlé", unlocked: history.some((item) => (item.control ?? 0) >= 85) }, { icon: "🔥", label: "Rythme 3 jours", unlocked: streak >= 3 }];
  return <div className="rounded-[1.6rem] border border-emerald-300/15 bg-emerald-300/[.055] p-5"><div className="flex items-center justify-between"><div><p className="font-bold text-emerald-100">Jardin de mobilité</p><p className="text-xs text-slate-400">{sessions} séance{sessions === 1 ? "" : "s"} accomplie{sessions === 1 ? "" : "s"}</p></div><div className="flex items-end gap-1 text-emerald-200">{Array.from({ length: level + 1 }).map((_, i) => i >= 3 ? <Flower2 key={i} className="size-7" /> : i >= 1 ? <Sprout key={i} className="size-6" /> : <span key={i} className="size-3 rounded-full bg-emerald-300" />)}</div></div><div className="mt-4 flex justify-between text-sm"><span className="text-slate-400">{names[level]}</span><span className="font-bold text-emerald-200">{points} pts</span></div><Progress value={(points % 150) / 1.5} className="mt-2 h-2 bg-white/10 [&_[data-slot=progress-indicator]]:bg-emerald-300" /><div className="mt-4 flex items-center justify-between rounded-xl bg-black/15 px-3 py-2 text-sm"><span className="text-slate-300">Régularité douce</span><strong className="text-amber-200">🔥 {streak} jour{streak === 1 ? "" : "s"}</strong></div><div className="mt-3 grid grid-cols-4 gap-2">{badges.map((badge) => <div key={badge.label} title={badge.label} className={`grid min-h-14 place-items-center rounded-xl border text-xl ${badge.unlocked ? "border-emerald-200/20 bg-emerald-200/10" : "border-white/5 bg-black/10 grayscale opacity-30"}`}><span aria-label={badge.label}>{badge.icon}</span></div>)}</div><p className="mt-2 text-xs text-slate-500">Les jours de repos n’annulent pas vos récompenses.</p></div>;
}

function HistoryView({ history, bestScore, onBack }: { history: SessionRecord[]; bestScore: number; onBack: () => void }) {
  const average = history.length ? Math.round(history.reduce((sum, item) => sum + item.regularity, 0) / history.length) : 0;
  return <main className="min-h-dvh bg-[#07111f] p-4 text-white sm:p-8"><div className="mx-auto max-w-5xl"><Button variant="ghost" onClick={onBack} className="text-slate-300 hover:bg-white/10 hover:text-white"><ChevronLeft /> Retour</Button><div className="mt-6 flex items-end justify-between"><div><p className="text-sm font-bold uppercase tracking-[.18em] text-[#c4ff4a]">Votre progression</p><h1 className="mt-2 text-4xl font-black">Historique des séances</h1></div><BarChart3 className="hidden size-12 text-sky-300 sm:block" /></div><div className="mt-6 grid gap-3 sm:grid-cols-3"><MetricCard value={String(history.length)} label="séances" /><MetricCard value={String(bestScore)} label="record de points" /><MetricCard value={`${average}%`} label="régularité moyenne" /></div><div className="mt-6 space-y-3">{history.length === 0 ? <div className="rounded-3xl border border-dashed border-white/15 p-10 text-center text-slate-400">Votre première séance apparaîtra ici après son enregistrement.</div> : history.map((item) => <div key={item.id} className="grid gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 sm:grid-cols-[1fr_repeat(5,auto)] sm:items-center"><div><p className="font-bold">{item.mode === "circuit" ? "Parcours découverte" : EXERCISES[item.exercise]?.name ?? "Exercice"}</p><p className="text-xs text-slate-400">{new Date(item.date).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })} · côté {item.arm === "left" ? "gauche" : "droit"}</p></div><SmallValue value={`${item.hits}`} label="mouv." /><SmallValue value={`${item.regularity}%`} label="régularité" /><SmallValue value={item.control ? `${item.control}%` : "—"} label="contrôle" /><SmallValue value={`${item.pain}/10`} label="douleur" /><SmallValue value={`${item.fatigue}/10`} label="fatigue" /></div>)}</div></div></main>;
}

function MetricCard({ value, label }: { value: string; label: string }) { return <div className="rounded-2xl border border-white/10 bg-white/5 p-5"><p className="text-3xl font-black text-[#c4ff4a]">{value}</p><p className="mt-1 text-sm text-slate-400">{label}</p></div>; }
function SmallValue({ value, label }: { value: string; label: string }) { return <div className="min-w-20"><p className="font-black">{value}</p><p className="text-xs text-slate-500">{label}</p></div>; }

function TherapistView({ history, exercise, setExercise, programPlan, setProgramPlan, arm, setArm, amplitude, setAmplitude, goal, setGoal, seated, setSeated, onSave, onBack }: { history: SessionRecord[]; exercise: ExerciseId; setExercise: (v: ExerciseId) => void; programPlan: ExerciseId[]; setProgramPlan: (plan: ExerciseId[]) => void; arm: Arm; setArm: (v: Arm) => void; amplitude: number; setAmplitude: (v: number) => void; goal: number; setGoal: (v: number) => void; seated: boolean; setSeated: (v: boolean) => void; onSave: () => void; onBack: () => void }) {
  const togglePlan = (id: ExerciseId) => { if (programPlan.includes(id)) { if (programPlan.length > 1) setProgramPlan(programPlan.filter((item) => item !== id)); } else if (programPlan.length < 4) setProgramPlan([...programPlan, id]); };
  const movePlan = (index: number, direction: -1 | 1) => { const target = index + direction; if (target < 0 || target >= programPlan.length) return; const next = [...programPlan]; [next[index], next[target]] = [next[target], next[index]]; setProgramPlan(next); };
  const recent = history.slice(0, 7).reverse();
  return (
    <main className="min-h-dvh bg-[#07111f] p-4 text-white sm:p-8">
      <div className="mx-auto max-w-5xl">
        <Button variant="ghost" onClick={onBack} className="text-slate-300 hover:bg-white/10 hover:text-white"><ChevronLeft /> Retour patient</Button>
        <div className="mt-6"><p className="text-sm font-bold uppercase tracking-[.18em] text-sky-300">Espace thérapeute · prototype local</p><h1 className="mt-2 text-4xl font-black">Programme de Camille</h1><p className="mt-2 text-slate-400">Code patient MQ-4821 · les réglages restent sur cet appareil.</p></div>
        <div className="mt-6 grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
          <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-xl font-black">Prescription de séance</h2>
            <div className="mt-5 rounded-2xl border border-sky-300/15 bg-sky-300/[.06] p-4">
              <div className="flex items-center justify-between"><div><p className="font-bold text-sky-100">Parcours patient</p><p className="text-xs text-slate-400">1 à 4 jeux, dans l’ordre</p></div><span className="rounded-full bg-sky-300/10 px-3 py-1 text-xs font-bold text-sky-200">{programPlan.length} jeu{programPlan.length === 1 ? "" : "x"}</span></div>
              <div className="mt-3 space-y-2">{programPlan.map((id, index) => <div key={id} className="flex items-center gap-2 rounded-xl bg-black/15 p-2"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#c4ff4a] text-xs font-black text-[#07111f]">{index + 1}</span><span className="min-w-0 flex-1 truncate text-sm font-bold">{EXERCISES[id].name}</span><button aria-label="Monter dans le parcours" onClick={() => movePlan(index, -1)} disabled={index === 0} className="rounded-lg px-2 py-1 text-slate-300 disabled:opacity-20">↑</button><button aria-label="Descendre dans le parcours" onClick={() => movePlan(index, 1)} disabled={index === programPlan.length - 1} className="rounded-lg px-2 py-1 text-slate-300 disabled:opacity-20">↓</button></div>)}</div>
            </div>
            <label className="mt-5 block text-sm font-bold text-slate-300">Ajouter ou retirer un jeu</label>
            <div className="mt-2 grid grid-cols-2 gap-2">{(Object.keys(EXERCISES) as ExerciseId[]).map((id) => <button key={id} onClick={() => { setExercise(id); togglePlan(id); }} className={`rounded-xl border p-3 text-left text-sm font-bold ${programPlan.includes(id) ? "border-[#c4ff4a] bg-[#c4ff4a]/10" : "border-white/10"}`}><span className="block">{EXERCISES[id].short}</span><span className="mt-1 block text-xs font-normal text-slate-500">{programPlan.includes(id) ? `Position ${programPlan.indexOf(id) + 1}` : programPlan.length >= 4 ? "Maximum atteint" : "Ajouter"}</span></button>)}</div>
            <label className="mt-5 block text-sm font-bold text-slate-300">Côté travaillé</label>
            <div className="mt-2 flex gap-2">{(["left","right"] as Arm[]).map((v) => <button key={v} onClick={() => setArm(v)} className={`flex-1 rounded-xl border p-3 font-bold ${arm === v ? "border-sky-300 bg-sky-300/10" : "border-white/10"}`}>{v === "left" ? "Gauche" : "Droit"}</button>)}</div>
            <Range label="Amplitude personnalisée" value={amplitude} min={55} max={95} step={10} suffix="%" onChange={setAmplitude} />
            <Range label="Répétitions par jeu" value={goal} min={4} max={12} step={2} suffix="" onChange={setGoal} />
            <button onClick={() => setSeated(!seated)} className={`mt-5 flex w-full items-center justify-between rounded-xl border p-4 ${seated ? "border-[#c4ff4a] bg-[#c4ff4a]/10" : "border-white/10"}`}><span><span className="block text-left font-bold">Mode assis</span><span className="block text-left text-xs text-slate-400">Calibration adaptée à une séance sur chaise</span></span><span className={`h-6 w-11 rounded-full p-1 ${seated ? "bg-[#c4ff4a]" : "bg-white/15"}`}><span className={`block size-4 rounded-full bg-[#07111f] transition ${seated ? "translate-x-5" : ""}`} /></span></button>
            <Button size="lg" onClick={onSave} className="mt-6 h-12 w-full rounded-xl bg-[#c4ff4a] font-bold text-[#07111f] hover:bg-[#d5ff7d]"><Check /> Enregistrer le programme</Button>
          </section>
          <section className="space-y-4">
            <div className="rounded-3xl border border-white/10 bg-white/5 p-6"><div className="flex items-center gap-3"><UserRound className="text-sky-300" /><h2 className="text-xl font-black">Suivi patient</h2></div><div className="mt-5 grid grid-cols-2 gap-3"><MetricCard value={String(history.length)} label="séances réalisées" /><MetricCard value={history[0] ? `${history[0].regularity}%` : "—"} label="dernière régularité" /><MetricCard value={history[0]?.control ? `${history[0].control}%` : "—"} label="dernier contrôle" /><MetricCard value={history[0] ? `${history[0].pain}/10` : "—"} label="dernière douleur" /></div></div>
            <div className="rounded-3xl border border-white/10 bg-white/5 p-6"><div className="flex items-center justify-between"><h2 className="font-black">Douleur récente</h2><span className="text-xs text-slate-500">7 séances</span></div>{recent.length ? <div className="mt-5 flex h-28 items-end gap-2">{recent.map((item) => <div key={item.id} className="flex flex-1 flex-col items-center gap-2"><div className="w-full rounded-t-lg bg-gradient-to-t from-sky-400 to-[#c4ff4a]" style={{ height: `${Math.max(8, item.pain * 10)}%` }} /><span className="text-xs text-slate-500">{item.pain}</span></div>)}</div> : <p className="mt-4 text-sm text-slate-400">La tendance apparaîtra après les premières séances.</p>}</div>
            <div className="rounded-3xl border border-amber-300/15 bg-amber-300/[.06] p-5"><div className="flex gap-3"><Shield className="mt-1 shrink-0 text-amber-200" /><div><p className="font-bold text-amber-100">Données déclaratives</p><p className="mt-1 text-sm leading-relaxed text-slate-300">Les résultats de caméra sont approximatifs et ne remplacent pas une évaluation clinique.</p></div></div></div>
          </section>
        </div>
      </div>
    </main>
  );
}

function Range({ label, value, min, max, step, suffix, onChange }: { label: string; value: number; min: number; max: number; step: number; suffix: string; onChange: (v: number) => void }) { return <label className="mt-5 block"><span className="flex justify-between text-sm font-bold text-slate-300"><span>{label}</span><span>{value}{suffix}</span></span><input className="mt-3 w-full accent-[#c4ff4a]" type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} /></label>; }
