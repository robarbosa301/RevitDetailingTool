import React, { useState, useRef, useEffect, Suspense } from "react";
import {
  MapPin, LayoutGrid, Camera, RefreshCw, Wifi, WifiOff, Plus, Trash2,
  CheckCircle2, BrickWall, Building2,
  ChevronRight, ChevronDown, Pencil, Layers3,
  Smartphone, Tablet, LocateFixed, ImagePlus, Users, Copy,
  Triangle, Rotate3d, Box, Home,
  DoorOpen, Scissors
} from "lucide-react";

import { safeGet, safeSet, safeList, safeDelete, syncProjectMeta, idbGet, idbSet } from "./storage.js";
import { C, mono, heading, conditionColor } from "./theme.js";
import { toNum, uid } from "./utils.js";
import { SYMBOL_LOGO, METAL_BG, Watermark } from "./branding.jsx";
import JoinScreen from "./JoinScreen.jsx";
import VectorSketch from "./VectorSketch.jsx";
import SyncTab from "./SyncTab.jsx";
import { WALL_TYPES, DOOR_TYPES, WINDOW_TYPES, FLOOR_TYPES } from "./constants.js";
import { GRID, pointInPolygon } from "./geometry.js";
import {
  Pill, StatRow,
  WallRow, DoorRow, WindowRow, FloorRow,
} from "./ElementRows.jsx";

// Lazy-loaded: three.js (ThreeDView's only real dependency) is one of the
// largest single chunks in the bundle and is only ever needed once someone
// opens the 3D tab — no reason to ship it in the initial page load.
const ThreeDView = React.lazy(() => import("./ThreeDView.jsx"));

// C (brand palette) now lives in ./theme.js, shared with ThreeDView.jsx.

function useLoadFonts() {
  useEffect(() => {
    if (document.getElementById("braves-font-link")) return;
    try {
      const link = document.createElement("link");
      link.id = "braves-font-link";
      link.rel = "stylesheet";
      link.href = "https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap";
      document.head.appendChild(link);
    } catch (e) { /* segue com as fontes do sistema */ }
  }, []);
  useEffect(() => {
    if (document.getElementById("braves-font-inherit-style")) return;
    try {
      const style = document.createElement("style");
      style.id = "braves-font-inherit-style";
      style.textContent = ".braves-app-root button, .braves-app-root input, .braves-app-root select, .braves-app-root textarea { font-family: inherit; }";
      document.head.appendChild(style);
    } catch (e) { /* segue com as fontes do sistema */ }
  }, []);
}

// `100dvh` alone is unreliable right after load on some Android/iOS browsers
// (it can report a taller height than what's actually visible once the
// address bar settles), leaving a blank gap below the app instead of the
// bottom nav sitting flush with the real screen edge. Track the real
// visible height via visualViewport (falling back to innerHeight) and
// expose it as a CSS var so the root container always matches it exactly.
function useRealViewportHeight() {
  useEffect(() => {
    // window.innerHeight (the LAYOUT viewport) deliberately does NOT
    // shrink when the on-screen keyboard opens on iOS/Android — the
    // keyboard overlays on top instead. visualViewport.height DOES shrink
    // for that, which sounds more "accurate" but backfires badly here: it
    // made the whole app root resize to fit above the keyboard on every
    // dimension edit, and that resize wasn't landing cleanly, leaving a
    // large blank gap between the app and the keyboard. Sticking to
    // innerHeight keeps the app's layout stable while typing; the keyboard
    // just covers whatever's underneath, same as any ordinary page.
    function update() {
      document.documentElement.style.setProperty("--app-vh", `${window.innerHeight}px`);
    }
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);
}

function defaultLevels() {
  return [
    { id: uid(), name: "Térreo", elevation: "0.00", wallHeightDefault: "2.80", sketchScale: 0.5, sketchElements: [] },
    { id: uid(), name: "1º Pavimento", elevation: "3.10", wallHeightDefault: "2.80", sketchScale: 0.5, sketchElements: [] },
    { id: uid(), name: "Cobertura", elevation: "6.20", wallHeightDefault: "2.80", sketchScale: 0.5, sketchElements: [] },
  ];
}

function buildLevelsFromCount(count) {
  const n = Math.max(1, Math.min(20, parseInt(count) || 1));
  const lv = [];
  for (let i = 0; i < n; i++) {
    lv.push({ id: uid(), name: i === 0 ? "Térreo" : `${i}º Pavimento`, elevation: (i * 3).toFixed(2), wallHeightDefault: "2.80", sketchScale: 0.5, sketchElements: [] });
  }
  return lv;
}

export function composeAddress(b) {
  if (!b) return "";
  const line1 = [b.street, b.number].filter(Boolean).join(", ");
  const line2 = [b.neighborhood, b.city, b.state].filter(Boolean).join(", ");
  return [line1, line2].filter(Boolean).join(" — ");
}
async function upsertProjectIndex(code, meta) {
  const list = (await idbGet("projects-index")) || [];
  const next = [{ code, ...meta, updatedAt: Date.now() }, ...list.filter(p => p.code !== code)];
  await idbSet("projects-index", next.slice(0, 100));
  syncProjectMeta(code, meta);
}
async function removeFromProjectIndex(code) {
  const list = (await idbGet("projects-index")) || [];
  await idbSet("projects-index", list.filter(p => p.code !== code));
}

function wallRoomAdjacency(level, wall) {
  const dx = wall.x2 - wall.x1, dy = wall.y2 - wall.y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const nx = -uy, ny = ux;
  const mid = { x: (wall.x1 + wall.x2) / 2, y: (wall.y1 + wall.y2) / 2 };
  const polys = (level.sketchElements || []).filter(e => e.type === "room");
  const roomAt = (p) => { const poly = polys.find(r => pointInPolygon(p, r.points)); return poly ? (poly.name || "Ambiente sem nome") : "Externo / não identificado"; };
  return {
    faceA: roomAt({ x: mid.x + nx * 12, y: mid.y + ny * 12 }),
    faceB: roomAt({ x: mid.x - nx * 12, y: mid.y - ny * 12 }),
  };
}
export function wallToM(w, toM) {
  return {
    id: w.id, tag: w.tag || "", x1: toM(w.x1), y1: toM(w.y1), x2: toM(w.x2), y2: toM(w.y2), height: toNum(w.height, 2.8),
    wallType: w.wallType || WALL_TYPES[0], condition: w.condition || "A confirmar", demolir: !!w.demolir, construir: !!w.construir,
    finishA: w.finishA || w.finish || "A definir", paintColorA: w.paintColorA || w.paintColor || "#E8E4DA",
    finishB: w.finishB || w.finish || "A definir", paintColorB: w.paintColorB || w.paintColor || "#E8E4DA",
  };
}
export function doorToM(d, toM) {
  return {
    id: d.id, tag: d.tag || "", wallId: d.wallId, x: toM(d.x), y: toM(d.y), width: toNum(d.width, 0.8), height: toNum(d.height, 2.1),
    panels: Math.max(1, Math.round(toNum(d.panels, 1))), doorType: d.doorType || DOOR_TYPES[0], condition: d.condition || "A confirmar", demolir: !!d.demolir, construir: !!d.construir,
  };
}
export function windowToM(w, toM) {
  return {
    id: w.id, tag: w.tag || "", wallId: w.wallId, x: toM(w.x), y: toM(w.y), width: toNum(w.width, 1.2), height: toNum(w.height, 1.2), peitoril: toNum(w.peitoril, 1.0),
    panels: Math.max(1, Math.round(toNum(w.panels, 2))), windowType: w.windowType || WINDOW_TYPES[0], condition: w.condition || "A confirmar", demolir: !!w.demolir, construir: !!w.construir,
  };
}
function stairToM(s2, toM) { return { id: s2.id, tag: s2.tag || "", x1: toM(s2.x1), y1: toM(s2.y1), x2: toM(s2.x2), y2: toM(s2.y2), width: toNum(s2.width, 1.0), toLevelId: s2.toLevelId || "", hasLanding: !!s2.hasLanding, landingPos: toNum(s2.landingPos, 0.5), landingHeight: s2.landingHeight }; }
function luminariaToM(l, toM) { return { id: l.id, tag: l.tag || "", x: toM(l.x), y: toM(l.y) }; }
function roomToM(r, toM) { return { id: r.id, roomId: r.roomId || null, points: r.points.map(p => ({ x: toM(p.x), y: toM(p.y) })), area: r.area, ceilingFinish: r.ceilingFinish, floorFinish: r.floorFinish, floorColor: r.floorColor, name: r.name }; }

export function levelToMeters(level) {
  const s = toNum(level.sketchScale, 0.5);
  const toM = (px) => (px / GRID) * s;
  const els = level.sketchElements || [];
  return {
    elevation: toNum(level.elevation, 0),
    walls: els.filter(e => e.type === "wall").map(w => wallToM(w, toM)),
    doors: els.filter(e => e.type === "door").map(d => doorToM(d, toM)),
    windows: els.filter(e => e.type === "window").map(w => windowToM(w, toM)),
    stairs: els.filter(e => e.type === "stair").map(s2 => stairToM(s2, toM)),
    luminarias: els.filter(e => e.type === "luminaria").map(l => luminariaToM(l, toM)),
    rooms: els.filter(e => e.type === "room").map(r => roomToM(r, toM)),
    nextElevation: null,
  };
}
function levelToMetersForRoom(level, room) {
  const poly = (level.sketchElements || []).find(e => e.type === "room" && e.roomId === room.id);
  if (!poly) return null;
  const s = toNum(level.sketchScale, 0.5);
  const toM = (px) => (px / GRID) * s;
  const els = level.sketchElements || [];
  const inPoly = (x, y) => pointInPolygon({ x, y }, poly.points);
  return {
    elevation: toNum(level.elevation, 0),
    walls: els.filter(e => e.type === "wall" && inPoly((e.x1 + e.x2) / 2, (e.y1 + e.y2) / 2)).map(w => wallToM(w, toM)),
    doors: els.filter(e => e.type === "door" && inPoly(e.x, e.y)).map(d => doorToM(d, toM)),
    windows: els.filter(e => e.type === "window" && inPoly(e.x, e.y)).map(w => windowToM(w, toM)),
    stairs: els.filter(e => e.type === "stair" && inPoly((e.x1 + e.x2) / 2, (e.y1 + e.y2) / 2)).map(s2 => stairToM(s2, toM)),
    luminarias: els.filter(e => e.type === "luminaria" && inPoly(e.x, e.y)).map(l => luminariaToM(l, toM)),
    rooms: [roomToM(poly, toM)],
  };
}

// schema_version 1: all geometry in meters (plan X/Y + level elevation), ready
// for the Revit add-in to consume directly (via exported file or straight
// from Firestore) — no grid/pixel math needed downstream. Pure function so it
// can run both from the export button and from persist() before a cloud sync.
export function buildLevantamentoSchema({ code, buildingInfo, rooms, levels, roofs }) {
  return {
    schema_version: 1,
    projeto: { empresa: "BRAVES", codigo: code, nome: buildingInfo?.name || "", data: new Date().toISOString(), unidade: "metros" },
    niveis: (levels || []).map(l => {
      const m = levelToMeters(l);
      return {
        id: l.id, nome: l.name, cota_m: m.elevation, pe_direito_padrao_m: toNum(l.wallHeightDefault, 2.8),
        paredes: m.walls.map(w => ({
          id: w.id, tag: w.tag, x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, altura_m: w.height,
          tipo: w.wallType, condicao: w.condition, demolir: w.demolir, construir: w.construir,
          acabamento_face_a: w.finishA, cor_face_a: w.paintColorA,
          acabamento_face_b: w.finishB, cor_face_b: w.paintColorB,
        })),
        portas: m.doors.map(d => ({
          id: d.id, tag: d.tag, parede_id: d.wallId, x: d.x, y: d.y,
          largura_m: d.width, altura_m: d.height, folhas: d.panels, tipo: d.doorType, condicao: d.condition, demolir: d.demolir, construir: d.construir,
        })),
        janelas: m.windows.map(w => ({
          id: w.id, tag: w.tag, parede_id: w.wallId, x: w.x, y: w.y,
          largura_m: w.width, altura_m: w.height, peitoril_m: w.peitoril, folhas: w.panels, tipo: w.windowType, condicao: w.condition, demolir: w.demolir, construir: w.construir,
        })),
        escadas: m.stairs.map(s => ({
          id: s.id, tag: s.tag, x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, largura_m: s.width,
          nivel_destino_id: s.toLevelId, tem_patamar: s.hasLanding, posicao_patamar: s.landingPos, altura_patamar_m: s.landingHeight,
        })),
        luminarias: m.luminarias.map(lm => ({ id: lm.id, tag: lm.tag, x: lm.x, y: lm.y })),
        ambientes_croqui: m.rooms.map(r => ({
          id: r.id, ambiente_id: r.roomId, nome: r.name, area_m2: r.area,
          pontos: r.points, acabamento_piso: r.floorFinish, cor_piso: r.floorColor, acabamento_forro: r.ceilingFinish,
        })),
      };
    }),
    coberturas: roofs || [],
    ambientes: (rooms || []).map(r => ({ id: r.id, nome: r.name, nivel: r.level, area_m2: r.area, uso: r.use, condicao: r.condition, observacoes: r.notes, geo: r.geo, fotos: r.photos, pisos: r.floors })),
  };
}

// ---- brand mark -------------------------------------------------------------
function BrandMark({ size = 30 }) {
  return <img src={SYMBOL_LOGO} alt="BRAVES" style={{ height: size, width: "auto" }} />;
}

// ---- main app --------------------------------------------------------------
export default function PranchetaBIM() {
  useLoadFonts();
  useRealViewportHeight();
  const [session, setSession] = useState(null);
  const [tab, setTab] = useState("ambientes");
  const [modeloSub, setModeloSub] = useState("elementos");
  const [rooms, setRooms] = useState([]);
  const [levels, setLevels] = useState([]);
  const [buildingInfo, setBuildingInfo] = useState(null);
  const [editingCode, setEditingCode] = useState(false);
  const [codeDraft, setCodeDraft] = useState("");
  const [ambientesLevelFilter, setAmbientesLevelFilter] = useState(null);
  const [pressedRoomId, setPressedRoomId] = useState(null);
  const [confirmDeleteRoomId, setConfirmDeleteRoomId] = useState(null);
  const longPressTimer = useRef(null);
  const justLongPressed = useRef(false);
  const [roofs, setRoofs] = useState([]);
  const [activeRoomId, setActiveRoomId] = useState(null);
  const [croquiLevelId, setCroquiLevelId] = useState(null);
  const [view3dMode, setView3dMode] = useState("casa");
  const [view3dOpen, setView3dOpen] = useState(false);
  const [sectionCut, setSectionCut] = useState({ enabled: false, axis: "horizontal", position: 1.2 });
  const [view3dRoomId, setView3dRoomId] = useState(null);
  const [conn, setConn] = useState({ revit: false, cad: false });
  const [syncing, setSyncing] = useState(false);
  const [log, setLog] = useState([]);
  const [peers, setPeers] = useState(1);
  const [photoThumbs, setPhotoThumbs] = useState({});
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [pending, setPending] = useState(0);
  const lastUpdatedAt = useRef(0);
  const fileInputRef = useRef(null);
  const photoTargetRoom = useRef(null);

  useEffect(() => {
    function goOnline() { setOnline(true); flushPending(); }
    function goOffline() { setOnline(false); }
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => { window.removeEventListener("online", goOnline); window.removeEventListener("offline", goOffline); };
  }, [session]);

  useEffect(() => {
    (async () => {
      const savedLocal = await idbGet("last-session");
      const saved = savedLocal || (await safeGet("last-session", false));
      if (saved) {
        try { const s = typeof saved === "string" ? JSON.parse(saved) : saved; await joinProject(s.code, s.role, null, s.deviceId); }
        catch (e) { /* ignore */ }
      }
    })();
  }, []);

  async function joinProject(code, role, buildingInfo, existingDeviceId) {
    const deviceId = existingDeviceId || (await idbGet("device-id")) || (await safeGet("device-id", false)) || uid();
    await idbSet("device-id", deviceId);
    await idbSet("last-session", { code, role, deviceId });
    await safeSet("device-id", deviceId, false);
    await safeSet("last-session", JSON.stringify({ code, role, deviceId }), false);

    const localRaw = await idbGet(`project:${code}`);
    const cloudRaw = navigator.onLine ? await safeGet(`bim-project:${code}:data`, true) : null;
    let chosen = null;
    try { if (localRaw) chosen = localRaw; } catch (e) {}
    try {
      if (cloudRaw) {
        const cloudParsed = JSON.parse(cloudRaw);
        if (!chosen || (cloudParsed.updatedAt || 0) > (chosen.updatedAt || 0)) chosen = cloudParsed;
      }
    } catch (e) {}

    if (chosen) {
      setRooms(chosen.rooms || []); setLog(chosen.log || []);
      setLevels(chosen.levels || defaultLevels()); setRoofs(chosen.roofs || []);
      setBuildingInfo(chosen.buildingInfo || null);
      lastUpdatedAt.current = chosen.updatedAt || 0;
      await idbSet(`project:${code}`, chosen);
      await upsertProjectIndex(code, { name: chosen.buildingInfo?.name || "Sem nome", address: composeAddress(chosen.buildingInfo), roomsCount: (chosen.rooms || []).length, levelsCount: (chosen.levels || []).length });
      setCroquiLevelId((chosen.levels || [])[0]?.id || null);
    } else {
      const lv = buildLevelsFromCount(buildingInfo?.levelsCount || 1);
      const initial = {
        buildingInfo: buildingInfo || { name: "Levantamento", address: "", type: "Residencial", levelsCount: String(lv.length) },
        rooms: [],
        log: [{ id: uid(), t: new Date().toLocaleTimeString("pt-BR"), msg: `Levantamento "${buildingInfo?.name || "sem nome"}" criado neste ${role === "tablet" ? "tablet" : "celular"}.`, kind: "info" }],
        levels: lv, roofs: [], updatedAt: Date.now(),
      };
      setRooms(initial.rooms); setLog(initial.log); setLevels(initial.levels); setRoofs(initial.roofs);
      setBuildingInfo(initial.buildingInfo);
      lastUpdatedAt.current = initial.updatedAt;
      setCroquiLevelId(lv[0].id);
      await idbSet(`project:${code}`, initial);
      await safeSet(`bim-project:${code}:data`, JSON.stringify(initial), true);
      await upsertProjectIndex(code, { name: initial.buildingInfo.name, address: composeAddress(initial.buildingInfo), roomsCount: 0, levelsCount: lv.length });
    }
    setSession({ code, role, deviceId });
    setTab(buildingInfo ? "croqui" : "ambientes");
  }

  async function flushPending() {
    if (!session) return;
    const local = await idbGet(`project:${session.code}`);
    if (!local) return;
    const ok = await safeSet(`bim-project:${session.code}:data`, JSON.stringify(local), true);
    if (ok) { setPending(0); pushLog("Conexão restabelecida — alterações do dispositivo sincronizadas com o projeto.", "done"); }
  }

  async function renameProjectCode(newCodeRaw) {
    const newCode = newCodeRaw.trim().toUpperCase();
    if (!newCode || newCode === session.code) return;
    const existing = await idbGet(`project:${newCode}`);
    if (existing) { pushLog(`Já existe um levantamento salvo com o código "${newCode}". Escolha outro.`, "info"); return; }
    const oldCode = session.code;
    const current = await idbGet(`project:${oldCode}`);
    if (!current) return;
    await idbSet(`project:${newCode}`, current);
    await safeSet(`bim-project:${newCode}:data`, JSON.stringify(current), true);
    await idbSet("last-session", { code: newCode, role: session.role, deviceId: session.deviceId });
    await safeSet("last-session", JSON.stringify({ code: newCode, role: session.role, deviceId: session.deviceId }), false);
    await upsertProjectIndex(newCode, { name: buildingInfo?.name || "Sem nome", address: composeAddress(buildingInfo), roomsCount: rooms.length, levelsCount: levels.length });
    await removeFromProjectIndex(oldCode);
    await safeDelete(`bim-project:${oldCode}:data`, true);
    setSession(s => ({ ...s, code: newCode }));
    pushLog(`Código do projeto alterado de "${oldCode}" para "${newCode}".`, "info");
  }

  async function switchProject() {
    await idbSet("last-session", null);
    await safeSet("last-session", "", false);
    setSession(null);
    setRooms([]); setLevels([]); setRoofs([]); setLog([]); setBuildingInfo(null);
    setActiveRoomId(null); setCroquiLevelId(null); setTab("ambientes");
  }

  useEffect(() => {
    if (!session) return;
    let stopped = false;
    async function heartbeat() {
      if (!navigator.onLine) return;
      await safeSet(`bim-project:${session.code}:presence:${session.deviceId}`, JSON.stringify({ role: session.role, ts: Date.now() }), true);
      const keys = await safeList(`bim-project:${session.code}:presence:`, true);
      let count = 0;
      for (const k of keys) { const v = await safeGet(k, true); if (v) { try { if (Date.now() - JSON.parse(v).ts < 20000) count++; } catch (e) {} } }
      if (!stopped) setPeers(Math.max(count, 1));
    }
    async function poll() {
      if (!navigator.onLine) return;
      const raw = await safeGet(`bim-project:${session.code}:data`, true);
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw);
        if ((parsed.updatedAt || 0) > lastUpdatedAt.current) {
          lastUpdatedAt.current = parsed.updatedAt;
          const nextRooms = parsed.rooms || [], nextLog = parsed.log || [];
          const nextLevels = parsed.levels || [], nextRoofs = parsed.roofs || [];
          roomsRef.current = nextRooms; logRef.current = nextLog;
          levelsRef.current = nextLevels; roofsRef.current = nextRoofs;
          setRooms(nextRooms); setLog(nextLog);
          setLevels(nextLevels); setRoofs(nextRoofs);
          if (parsed.buildingInfo) setBuildingInfo(parsed.buildingInfo);
          idbSet(`project:${session.code}`, parsed);
        }
      } catch (e) { /* ignore */ }
    }
    heartbeat(); poll();
    const hb = setInterval(heartbeat, 6000);
    const pl = setInterval(poll, 4000);
    return () => { stopped = true; clearInterval(hb); clearInterval(pl); };
  }, [session]);

  // rooms/levels/roofs/log each get their own updateX helper below, and
  // several flows (deleting a room, naming a Croqui polygon) call two or
  // three of them back-to-back in the same handler. Each helper's persist()
  // call used to read the OTHER fields straight from this render's rooms/
  // levels/roofs/log closures — still the pre-update values, since setState
  // hasn't re-rendered yet. Two persist() calls firing that close together
  // race (both async), and whichever's write lands last would silently
  // resurrect whatever the other call just changed (a deleted room
  // reappearing after leaving and returning to the tab, for one real case).
  // These refs are updated synchronously inside each helper instead, so a
  // chained call always sees the others' just-made change immediately.
  const roomsRef = useRef(rooms);
  const levelsRef = useRef(levels);
  const roofsRef = useRef(roofs);
  const logRef = useRef(log);
  useEffect(() => { roomsRef.current = rooms; }, [rooms]);
  useEffect(() => { levelsRef.current = levels; }, [levels]);
  useEffect(() => { roofsRef.current = roofs; }, [roofs]);
  useEffect(() => { logRef.current = log; }, [log]);

  async function persist(next) {
    const updatedAt = Date.now();
    lastUpdatedAt.current = updatedAt;
    const payload = { buildingInfo, ...next, updatedAt };
    await idbSet(`project:${session.code}`, payload);
    upsertProjectIndex(session.code, { name: payload.buildingInfo?.name || "Sem nome", address: composeAddress(payload.buildingInfo), roomsCount: (payload.rooms || []).length, levelsCount: (payload.levels || []).length });
    if (navigator.onLine) {
      // schema_json rides along in the same synced document so the Revit
      // add-in can fetch a project by name/code straight from Firestore —
      // same meters-based shape as the manual "Exportar JSON" button.
      const cloudPayload = { ...payload, schema_json: JSON.stringify(buildLevantamentoSchema({ code: session.code, buildingInfo: payload.buildingInfo, rooms: payload.rooms, levels: payload.levels, roofs: payload.roofs })) };
      const ok = await safeSet(`bim-project:${session.code}:data`, JSON.stringify(cloudPayload), true);
      setPending(p => (ok ? 0 : p + 1));
    } else {
      setPending(p => p + 1);
    }
  }
  function pushLog(msg, kind = "ok") {
    setLog(l => {
      const next = [{ id: uid(), t: new Date().toLocaleTimeString("pt-BR"), msg, kind }, ...l];
      logRef.current = next;
      persist({ rooms: roomsRef.current, log: next, levels: levelsRef.current, roofs: roofsRef.current });
      return next;
    });
  }
  function updateRooms(fn) {
    setRooms(rs => {
      const next = fn(rs);
      roomsRef.current = next;
      persist({ rooms: next, log: logRef.current, levels: levelsRef.current, roofs: roofsRef.current });
      return next;
    });
  }
  function updateLevels(fn) {
    setLevels(ls => {
      const next = fn(ls);
      levelsRef.current = next;
      persist({ rooms: roomsRef.current, log: logRef.current, levels: next, roofs: roofsRef.current });
      return next;
    });
  }
  function updateRoofs(fn) {
    setRoofs(rs => {
      const next = fn(rs);
      roofsRef.current = next;
      persist({ rooms: roomsRef.current, log: logRef.current, levels: levelsRef.current, roofs: next });
      return next;
    });
  }

  const activeRoom = rooms.find(r => r.id === activeRoomId) || null;
  const croquiLevel = levels.find(l => l.id === croquiLevelId) || levels[0] || null;
  const activeRoomLevel = activeRoom ? levels.find(l => l.name === activeRoom.level) : null;
  // The room's own polygon (traced in Croqui) carries the forro/piso finish
  // chosen there; walls have no direct link to a room, so which face (and
  // therefore which finish/condition) bounds this room is worked out the
  // same way WallRow's "Face → ambiente" label already does.
  const activeRoomPolygon = activeRoomLevel ? (activeRoomLevel.sketchElements || []).find(e => e.type === "room" && e.roomId === activeRoom.id) : null;
  const activeRoomWallFaces = activeRoomLevel && activeRoom
    ? (activeRoomLevel.sketchElements || []).filter(e => e.type === "wall").flatMap(w => {
        const adj = wallRoomAdjacency(activeRoomLevel, w);
        const faces = [];
        if (adj.faceA === activeRoom.name) faces.push({ wall: w, finish: w.finishA, color: w.paintColorA });
        if (adj.faceB === activeRoom.name) faces.push({ wall: w, finish: w.finishB, color: w.paintColorB });
        return faces;
      })
    : [];
  const activeRoomWallAreaTotal = activeRoomWallFaces.reduce((s, f) => s + toNum(f.wall.length, 0) * toNum(f.wall.height, 0), 0);

  function removeRoom(id) {
    const room = rooms.find(r => r.id === id);
    if (!room) return;
    updateRooms(rs => rs.filter(r => r.id !== id));
    // A room registered by drawing its outline in Croqui (rather than typed
    // in manually here) has a polygon linked back to it via roomId — drop
    // that too, or it'd linger on the sketch pointing at a room that no
    // longer exists.
    updateLevels(ls => ls.map(l => ({ ...l, sketchElements: (l.sketchElements || []).filter(e => !(e.type === "room" && e.roomId === id)) })));
    setActiveRoomId(null);
    pushLog(`Ambiente "${room.name}" removido.`, "info");
  }
  function addFloor(roomId) {
    updateRooms(rs => rs.map(r => r.id === roomId ? { ...r, floors: [...r.floors, { id: uid(), tag: `PS-${r.floors.length + 1}`, type: FLOOR_TYPES[0], area: r.area, espessura: "0.02", condition: "A confirmar" }] } : r));
  }
  function removeFloor(roomId, id) {
    updateRooms(rs => rs.map(r => r.id === roomId ? { ...r, floors: r.floors.filter(f => f.id !== id) } : r));
  }
  function patchFloor(roomId, id, patch) {
    updateRooms(rs => rs.map(r => r.id === roomId ? { ...r, floors: r.floors.map(f => f.id === id ? { ...f, ...patch } : f) } : r));
  }

  function updateLevelSketch(levelId, newElements, newScale) {
    updateLevels(ls => ls.map(l => l.id === levelId ? { ...l, sketchElements: newElements, sketchScale: newScale ?? l.sketchScale } : l));
  }
  function updateLevelMeta(levelId, patch) {
    updateLevels(ls => ls.map(l => l.id === levelId ? { ...l, ...patch } : l));
  }
  function nameRoomPolygon(levelId, elementId, trimmed) {
    const level = levels.find(l => l.id === levelId);
    if (!level) return;
    const poly = (level.sketchElements || []).find(e => e.id === elementId);
    if (!poly) return;
    if (!trimmed) {
      updateLevels(ls => ls.map(l => l.id !== levelId ? l : { ...l, sketchElements: l.sketchElements.map(e => e.id === elementId ? { ...e, name: undefined, roomId: null } : e) }));
      return;
    }
    const existing = rooms.find(r => r.level === level.name && r.name.toLowerCase() === trimmed.toLowerCase() && r.id !== poly.roomId);
    let roomId = poly.roomId;
    if (existing) {
      roomId = existing.id;
      updateRooms(rs => rs.map(r => r.id === existing.id ? { ...r, area: String(poly.area) } : r));
    } else if (roomId) {
      updateRooms(rs => rs.map(r => r.id === roomId ? { ...r, name: trimmed, area: String(poly.area) } : r));
    } else {
      const newR = { id: uid(), name: trimmed, level: level.name, area: String(poly.area), height: String(level.wallHeightDefault || "2.80"), use: "", condition: "A confirmar", notes: "", photos: 0, geo: null, floors: [] };
      roomId = newR.id;
      updateRooms(rs => [...rs, newR]);
    }
    updateLevels(ls => ls.map(l => l.id !== levelId ? l : { ...l, sketchElements: l.sketchElements.map(e => e.id === elementId ? { ...e, name: trimmed, roomId } : e) }));
    pushLog(`Ambiente "${trimmed}" identificado no croqui (${level.name}).`, "info");
  }
  function updateLevelElement(levelId, elementId, patch) {
    updateLevels(ls => ls.map(l => l.id !== levelId ? l : { ...l, sketchElements: l.sketchElements.map(e => e.id === elementId ? { ...e, ...patch } : e) }));
  }
  function removeLevelElement(levelId, elementId) {
    updateLevels(ls => ls.map(l => l.id !== levelId ? l : { ...l, sketchElements: l.sketchElements.filter(e => e.id !== elementId) }));
  }

  function markLocation(roomId) {
    if (!navigator.geolocation) { pushLog("Dispositivo sem GPS disponível.", "info"); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const geo = { lat: pos.coords.latitude.toFixed(6), lon: pos.coords.longitude.toFixed(6) };
        updateRooms(rs => rs.map(r => r.id === roomId ? { ...r, geo } : r));
        pushLog(`Localização registrada para "${rooms.find(r => r.id === roomId)?.name}" (${geo.lat}, ${geo.lon})`, "info");
      },
      () => pushLog("Não foi possível obter a localização (permissão negada ou sem sinal de GPS).", "info")
    );
  }
  function openCamera(roomId) { photoTargetRoom.current = roomId; fileInputRef.current?.click(); }
  function handlePhotoCaptured(e) {
    const file = e.target.files?.[0];
    const roomId = photoTargetRoom.current;
    if (!file || !roomId) return;
    const url = URL.createObjectURL(file);
    setPhotoThumbs(pt => ({ ...pt, [roomId]: [...(pt[roomId] || []), url] }));
    updateRooms(rs => rs.map(r => r.id === roomId ? { ...r, photos: r.photos + 1 } : r));
    pushLog(`Foto anexada ao ambiente "${rooms.find(r => r.id === roomId)?.name}" via ${session.role === "phone" ? "celular" : "tablet"}.`, "info");
    e.target.value = "";
  }
  function addLevel() {
    updateLevels(ls => [...ls, { id: uid(), name: `Nível ${ls.length + 1}`, elevation: "0.00", wallHeightDefault: "2.80", sketchScale: 0.5, sketchElements: [] }]);
  }
  function addRoof() {
    updateRoofs(rs => [...rs, { id: uid(), name: `Cobertura ${rs.length + 1}`, level: levels[levels.length - 1]?.name || "", aguas: [{ id: uid(), inclinacao: "30", area: "" }] }]);
  }
  function addAgua(roofId) { updateRoofs(rs => rs.map(r => r.id === roofId ? { ...r, aguas: [...r.aguas, { id: uid(), inclinacao: "30", area: "" }] } : r)); }
  function removeAgua(roofId, aguaId) { updateRoofs(rs => rs.map(r => r.id === roofId ? { ...r, aguas: r.aguas.filter(a => a.id !== aguaId) } : r)); }

  function runSync() {
    setSyncing(true);
    pushLog("Iniciando sincronização com Revit e exportação CAD…", "info");
    let delay = 500;
    setConn({ revit: false, cad: false });
    levels.forEach(l => {
      delay += 300;
      setTimeout(() => { setConn(c => ({ ...c, revit: true })); pushLog(`Revit ← Level "${l.name}" (cota ${l.elevation} m)`, "revit"); }, delay);
      (l.sketchElements || []).forEach(el => {
        delay += 180;
        let msg;
        if (el.type === "wall") msg = `${el.tag} · Parede ${el.length} m × ${el.height} m → A-WALL`;
        else if (el.type === "door") msg = `${el.tag} · Porta ${el.width}×${el.height} m → A-DOOR`;
        else if (el.type === "window") msg = `${el.tag} · Janela ${el.width}×${el.height} m (peitoril ${el.peitoril} m) → A-GLAZ`;
        else if (el.type === "room") msg = `Contorno "${el.name || "sem vínculo"}" · ${el.area} m² → A-AREA`;
        if (msg) setTimeout(() => { pushLog(`CAD/Revit ← ${msg}`, "cad"); setConn(c => ({ ...c, cad: true })); }, 0);
      });
    });
    rooms.forEach(r => {
      delay += 300;
      setTimeout(() => { pushLog(`Revit ← Room "${r.name}" (Nível: ${r.level}, Área: ${r.area || "—"} m²)`, "revit"); }, delay);
      r.floors.forEach(f => { delay += 150; setTimeout(() => { pushLog(`CAD ← ${f.tag} · Piso ${f.type} · ${f.area} m² → A-FLOOR`, "cad"); }, delay); });
    });
    roofs.forEach(r => {
      delay += 350;
      setTimeout(() => { pushLog(`Revit ← Roof "${r.name}" — ${r.aguas.length} água(s): ${r.aguas.map(a => a.inclinacao + '°').join(", ")}`, "revit"); }, delay);
    });
    delay += 500;
    setTimeout(() => { pushLog("Sincronização concluída — modelo Revit e desenho CAD atualizados.", "done"); setSyncing(false); }, delay);
  }
  function buildSchema() {
    return buildLevantamentoSchema({ code: session?.code, buildingInfo, rooms, levels, roofs });
  }
  function download(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }
  function exportJSON() { download("levantamento_bim.json", JSON.stringify(buildSchema(), null, 2), "application/json"); pushLog("Arquivo levantamento_bim.json exportado.", "info"); }
  function exportCSV() {
    const rows = [["Nível/Ambiente", "Tag", "Categoria", "Tipo", "Dimensões", "Condição", "Demolir", "À construir"]];
    levels.forEach(l => (l.sketchElements || []).forEach(el => {
      if (el.type === "wall") rows.push([l.name, el.tag, "Parede", el.wallType, `${el.length}×${el.height} m`, el.condition, el.demolir ? "Sim" : "Não", el.construir ? "Sim" : "Não"]);
      if (el.type === "door") rows.push([l.name, el.tag, "Porta", el.doorType, `${el.width}×${el.height} m`, el.condition, el.demolir ? "Sim" : "Não", el.construir ? "Sim" : "Não"]);
      if (el.type === "window") rows.push([l.name, el.tag, "Janela", el.windowType, `${el.width}×${el.height} m (peit. ${el.peitoril})`, el.condition, el.demolir ? "Sim" : "Não", el.construir ? "Sim" : "Não"]);
    }));
    rooms.forEach(r => r.floors.forEach(f => rows.push([r.name, f.tag, "Piso", f.type, `${f.area} m²`, f.condition, "", ""])));
    download("levantamento_elementos.csv", rows.map(r => r.join(";")).join("\n"), "text/csv");
    pushLog("Arquivo levantamento_elementos.csv exportado.", "info");
  }

  if (!session) return <JoinScreen onJoin={joinProject} />;

  const totalArea = rooms.reduce((s, r) => s + (toNum(r.area, 0)), 0).toFixed(1);
  const allEls = levels.flatMap(l => l.sketchElements || []);
  const totalElements = allEls.length + rooms.reduce((s, r) => s + r.floors.length, 0);

  const TABS = [
    { id: "ambientes", label: "Ambientes", Icon: LayoutGrid },
    { id: "croqui", label: "Croqui", Icon: Pencil },
    { id: "modelo", label: "Modelo", Icon: Rotate3d },
    { id: "sync", label: "Sincronização", Icon: RefreshCw },
  ];

  return (
    <div className="braves-app-root relative w-full overflow-hidden flex flex-col" style={{ ...METAL_BG, height: "var(--app-vh, 100dvh)", fontFamily: "'Plus Jakarta Sans','Inter','Helvetica Neue',sans-serif" }}>
      <Watermark />
      <input ref={fileInputRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={handlePhotoCaptured} />

      <div className="relative px-4 pt-4 pb-3" style={{ borderBottom: `1px solid ${C.line}` }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <BrandMark size={30} />
            <div>
              <div className="text-base font-semibold leading-tight" style={{ ...heading, color: C.chalk, fontSize: "17px" }}>{buildingInfo?.name || "BRAVES BIM FIELD"}</div>
              <div className="text-[11px] -mt-0.5 flex items-center gap-1" style={{ color: C.mute }}>
                {session.role === "tablet" ? <Tablet size={11} /> : <Smartphone size={11} />}
                {editingCode ? (
                  <>
                    <input autoFocus value={codeDraft} onChange={e => setCodeDraft(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") { renameProjectCode(codeDraft); setEditingCode(false); } if (e.key === "Escape") setEditingCode(false); }}
                      className="w-16 px-1 rounded text-[11px] uppercase" style={{ ...mono, background: "rgba(255,255,255,0.1)", color: C.chalk, border: `1px solid ${C.gold}` }} />
                    <button onClick={() => { renameProjectCode(codeDraft); setEditingCode(false); }}><CheckCircle2 size={12} color={C.gold} /></button>
                  </>
                ) : (
                  <button onClick={() => { setCodeDraft(session.code); setEditingCode(true); }} style={{ ...heading, fontWeight: 700 }} className="underline decoration-dotted">{session.code}</button>
                )}
                <button onClick={() => navigator.clipboard?.writeText(session.code)}><Copy size={10} /></button>
                <button onClick={switchProject} className="ml-1.5 flex items-center gap-0.5" style={{ ...heading, fontWeight: 600, color: C.gold }}><Home size={10} /> Início</button>
              </div>
            </div>
          </div>
          <div className="flex gap-2 items-center">
            <div className="flex items-center gap-1 px-2 py-1 rounded-full" style={{ background: "rgba(255,255,255,0.05)", border: `1px solid ${C.line}` }}>
              <Users size={12} color={C.gold} />
              <span className="text-[11px]" style={{ ...mono, color: C.chalk }}>{peers}</span>
            </div>
            <Pill active={conn.revit} label="REVIT" Icon={conn.revit ? Wifi : WifiOff} />
            <Pill active={conn.cad} label="CAD" Icon={conn.cad ? Wifi : WifiOff} />
          </div>
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          <Pill active={online} label={online ? "ONLINE" : "SEM SINAL — SALVANDO NO APARELHO"} Icon={online ? Wifi : WifiOff} />
          {pending > 0 && <span className="text-[10px] px-2 py-1 rounded-full" style={{ ...heading, fontWeight: 600, color: C.bad, background: "rgba(193,84,63,0.14)", border: "1px solid rgba(193,84,63,0.4)" }}>{pending} pendente(s)</span>}
        </div>
        <div className="mt-3 flex gap-4 text-xs" style={{ color: C.mute }}>
          <span style={{ ...heading, fontWeight: 600 }}>{rooms.length} ambientes</span><span>·</span>
          <span style={{ ...heading, fontWeight: 600 }}>{totalArea} m²</span><span>·</span>
          <span style={{ ...heading, fontWeight: 600 }}>{totalElements} elementos</span><span>·</span>
          <span style={{ ...heading, fontWeight: 600 }}>{levels.length} níveis</span>
        </div>
      </div>

      <div className="relative flex-1 min-h-0 p-4 overflow-y-auto">
        {tab === "ambientes" && !activeRoom && !ambientesLevelFilter && (
          <div className="space-y-2">
            {levels.map(l => {
              const roomsHere = rooms.filter(r => r.level === l.name);
              const totalArea = roomsHere.reduce((s, r) => s + (toNum(r.area, 0)), 0);
              return (
                <button key={l.id} onClick={() => setAmbientesLevelFilter(l.name)}
                  className="w-full text-left p-3 rounded-lg flex items-center gap-3"
                  style={{ background: C.panel, border: `1px solid ${C.line}` }}>
                  <div className="w-9 h-9 rounded flex items-center justify-center" style={{ background: C.panelAlt }}>
                    <Layers3 size={16} color={C.gold} />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium" style={{ color: C.chalk }}>{l.name}</div>
                    <div className="text-[11px]" style={{ color: C.mute }}>{roomsHere.length} ambiente(s) · {totalArea.toFixed(1)} m² de área construída · cota {l.elevation} m</div>
                  </div>
                  <ChevronRight size={16} color={C.mute} />
                </button>
              );
            })}
            {levels.length === 0 && <div className="text-[11px] italic text-center py-6" style={{ color: C.mute }}>Nenhum nível criado ainda.</div>}
          </div>
        )}

        {tab === "ambientes" && !activeRoom && ambientesLevelFilter && (
          <div className="space-y-2">
            <button onClick={() => setAmbientesLevelFilter(null)} className="text-xs mb-1 flex items-center gap-1" style={{ color: C.mute }}>← Voltar aos níveis</button>
            <div className="text-xs font-semibold mb-1" style={{ color: C.gold }}>{ambientesLevelFilter}</div>
            {rooms.filter(r => r.level === ambientesLevelFilter).map(r => {
              const revealed = pressedRoomId === r.id;
              const confirming = confirmDeleteRoomId === r.id;
              const startPress = () => {
                longPressTimer.current = setTimeout(() => { setPressedRoomId(r.id); justLongPressed.current = true; }, 500);
              };
              const cancelPress = () => { if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; } };
              if (confirming) {
                return (
                  <div key={r.id} className="w-full p-3 rounded-lg flex items-center gap-2 flex-wrap"
                    style={{ background: "rgba(193,84,63,0.1)", border: `1px solid ${C.bad}` }}>
                    <span className="text-xs flex-1" style={{ color: C.chalk }}>Apagar "{r.name}"? Essa ação não pode ser desfeita.</span>
                    <button onClick={() => setConfirmDeleteRoomId(null)} className="text-[11px] px-2.5 py-1.5 rounded" style={{ color: C.mute, background: C.panelAlt }}>Cancelar</button>
                    <button onClick={() => { removeRoom(r.id); setConfirmDeleteRoomId(null); setPressedRoomId(null); }}
                      className="text-[11px] px-2.5 py-1.5 rounded" style={{ color: "#141311", background: C.bad }}>Apagar</button>
                  </div>
                );
              }
              return (
                <div key={r.id} role="button" tabIndex={0}
                  onClick={() => {
                    // A long press's own mouseup/touchend is still followed by a
                    // native click on release — without this, that trailing
                    // click would immediately re-toggle the just-revealed trash
                    // icon back off before anyone could tap it.
                    if (justLongPressed.current) { justLongPressed.current = false; return; }
                    if (revealed) { setPressedRoomId(null); return; }
                    setActiveRoomId(r.id);
                  }}
                  onTouchStart={startPress} onTouchEnd={cancelPress} onTouchMove={cancelPress}
                  onMouseDown={startPress} onMouseUp={cancelPress} onMouseLeave={cancelPress}
                  className="w-full text-left p-3 rounded-lg flex items-center gap-3 cursor-pointer"
                  style={{ background: C.panel, border: `1px solid ${revealed ? C.bad : C.line}` }}>
                  <div className="w-9 h-9 rounded flex items-center justify-center" style={{ background: C.panelAlt }}>
                    <Building2 size={16} color={C.gold} />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium" style={{ color: C.chalk }}>{r.name}</div>
                    <div className="text-[11px] flex items-center gap-1.5" style={{ color: C.mute }}>
                      <span>{r.area ? `${r.area} m²` : "área não definida"}</span>
                      {r.photos > 0 && <span className="flex items-center gap-0.5"><Camera size={10} />{r.photos}</span>}
                      {r.geo && <MapPin size={10} />}
                    </div>
                  </div>
                  {revealed ? (
                    <button onClick={e => { e.stopPropagation(); setConfirmDeleteRoomId(r.id); }}
                      title="Apagar ambiente" className="p-1.5 rounded shrink-0" style={{ color: C.bad, background: "rgba(193,84,63,0.14)" }}>
                      <Trash2 size={16} />
                    </button>
                  ) : (
                    <>
                      <span className="text-[10px] px-2 py-1 rounded" style={{ color: conditionColor(r.condition), background: "rgba(255,255,255,0.06)" }}>{r.condition}</span>
                      <ChevronRight size={16} color={C.mute} />
                    </>
                  )}
                </div>
              );
            })}
            {rooms.filter(r => r.level === ambientesLevelFilter).length > 0 && (
              <p className="text-[10px] text-center" style={{ color: C.muteDim }}>Segure um ambiente pra apagar.</p>
            )}

            {rooms.filter(r => r.level === ambientesLevelFilter).length === 0 && (
              <div className="text-[11px] italic text-center py-6" style={{ color: C.mute }}>Nenhum ambiente traçado ainda neste nível.</div>
            )}
            <button onClick={() => { setCroquiLevelId(levels.find(l => l.name === ambientesLevelFilter)?.id || null); setTab("croqui"); }}
              className="w-full py-3 rounded-lg flex items-center justify-center gap-2 text-sm" style={{ border: `1px dashed ${C.line}`, color: C.mute }}>
              <Pencil size={14} /> Ir ao Croqui pra desenhar um ambiente
            </button>
            <p className="text-[11px] text-center pt-1" style={{ color: C.muteDim }}>Ambientes só existem se forem desenhados na aba Croqui (ferramenta "Ambiente") — a área é medida automaticamente a partir do contorno real, sem digitar nada à mão.</p>
          </div>
        )}

        {tab === "ambientes" && activeRoom && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <button onClick={() => setActiveRoomId(null)} className="text-xs flex items-center gap-1" style={{ color: C.mute }}>← Voltar aos ambientes</button>
              <button onClick={() => { setActiveRoomId(null); setTab("ambientes"); }} className="text-xs flex items-center gap-1 px-2 py-1 rounded" style={{ color: C.gold, background: C.goldTint }}><Home size={12} /> Início</button>
            </div>
            <div className="p-3 rounded-lg mb-3" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
              <div className="text-lg font-semibold mb-2" style={{ ...heading, color: C.chalk, fontSize: "20px" }}>{activeRoom.name}</div>
              <StatRow label="Nível" value={activeRoom.level} />
              <StatRow label="Área" value={activeRoom.area ? `${activeRoom.area} m²` : "ainda não definida"} />
              <StatRow label="Área de parede" value={activeRoomWallFaces.length ? `${activeRoomWallAreaTotal.toFixed(2)} m²` : "sem parede vinculada"} />
              <StatRow label="Piso" value={activeRoomPolygon?.floorFinish || "A definir"} />
              <StatRow label="Forro" value={activeRoomPolygon?.ceilingFinish || "A definir"} />
              <StatRow label="Uso" value={activeRoom.use || "—"} />
              <StatRow label="Condição geral" value={activeRoom.condition} />
              {activeRoom.geo && <StatRow label="GPS" value={`${activeRoom.geo.lat}, ${activeRoom.geo.lon}`} />}
              <div className="mt-2">
                <div className="text-[11px] mb-1" style={{ color: C.mute }}>OBSERVAÇÕES DE CAMPO</div>
                <textarea value={activeRoom.notes} placeholder="Anotar patologias, divergências com projeto, etc."
                  onChange={e => updateRooms(rs => rs.map(r => r.id === activeRoom.id ? { ...r, notes: e.target.value } : r))}
                  className="w-full text-xs p-2 rounded" rows={2} style={{ background: C.panelAlt, color: C.chalk, border: `1px solid ${C.line}` }} />
              </div>
              <div className="flex gap-2 mt-2">
                <button onClick={() => openCamera(activeRoom.id)} className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded" style={{ background: C.panelAlt, color: C.chalk, border: `1px solid ${C.line}` }}>
                  <ImagePlus size={13} /> {activeRoom.photos} foto(s) — tirar nova
                </button>
                <button onClick={() => markLocation(activeRoom.id)} className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded" style={{ background: C.panelAlt, color: C.chalk, border: `1px solid ${C.line}` }}>
                  <LocateFixed size={13} /> Marcar local
                </button>
              </div>
              {(photoThumbs[activeRoom.id] || []).length > 0 && (
                <div className="flex gap-1.5 mt-2 overflow-x-auto">
                  {photoThumbs[activeRoom.id].map((url, i) => <img key={i} src={url} alt="" className="w-14 h-14 rounded object-cover" style={{ border: `1px solid ${C.line}` }} />)}
                </div>
              )}
            </div>

            <div className="p-3 rounded-lg mb-3 flex items-center justify-between" style={{ background: C.panelAlt, border: `1px solid ${C.line}` }}>
              <span className="text-[11px]" style={{ color: C.mute }}>Paredes, portas e janelas agora se desenham na aba Croqui (nível inteiro, geometria real).</span>
              <button onClick={() => { const lvl = levels.find(l => l.name === activeRoom.level); if (lvl) setCroquiLevelId(lvl.id); setTab("croqui"); }}
                className="text-[11px] px-2.5 py-1.5 rounded shrink-0 ml-2" style={{ background: C.goldTint, color: C.gold }}>Ir ao Croqui</button>
            </div>

            <div className="mb-3">
              <div className="text-xs font-medium mb-1.5" style={{ color: C.chalk }}>Paredes</div>
              <div className="space-y-1.5">
                {activeRoomWallFaces.length === 0 && <div className="text-[11px] italic" style={{ color: C.mute }}>Nenhuma parede vinculada a este ambiente ainda — desenhe o contorno encostado nas paredes reais no Croqui.</div>}
                {activeRoomWallFaces.map(({ wall, finish, color }, i) => (
                  <div key={`${wall.id}-${i}`} className="flex items-center gap-2 px-2.5 py-2 rounded flex-wrap" style={{ background: C.panelAlt, border: `1px solid ${C.line}` }}>
                    <BrickWall size={13} color={C.mute} />
                    <span className="text-xs font-semibold" style={{ ...mono, color: C.gold }}>{wall.tag}</span>
                    <span className="text-[11px]" style={{ color: C.mute }}>{wall.length}×{wall.height} m = {(toNum(wall.length, 0) * toNum(wall.height, 0)).toFixed(2)} m²</span>
                    <span className="text-[11px]" style={{ color: C.chalk }}>{finish || "A definir"}</span>
                    {finish === "Pintura" && color && <span className="w-3.5 h-3.5 rounded-full inline-block shrink-0" style={{ background: color, border: `1px solid ${C.line}` }} />}
                    <span className="text-[10px] px-1.5 py-0.5 rounded ml-auto shrink-0" style={{ color: conditionColor(wall.condition), background: "rgba(255,255,255,0.06)" }}>{wall.condition}</span>
                    {wall.demolir && <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ color: C.bad, background: "rgba(193,84,63,0.14)" }}>Demolir</span>}
                    {wall.construir && <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ color: C.good, background: "rgba(107,156,90,0.14)" }}>À construir</span>}
                  </div>
                ))}
                {activeRoomWallFaces.length > 0 && (
                  <div className="text-[11px] text-right pr-1" style={{ color: C.mute }}>Total de parede: {activeRoomWallAreaTotal.toFixed(2)} m²</div>
                )}
              </div>
            </div>

            <div className="mb-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium" style={{ color: C.chalk }}>Pisos</span>
                <button onClick={() => addFloor(activeRoom.id)} className="flex items-center gap-1 text-[11px] px-2 py-1 rounded" style={{ color: C.gold, background: C.goldTint }}>
                  <Plus size={11} /> adicionar
                </button>
              </div>
              <div className="space-y-1.5">
                {activeRoom.floors.length === 0 && <div className="text-[11px] italic" style={{ color: C.mute }}>Nenhum piso registrado.</div>}
                {activeRoom.floors.map(f => <FloorRow key={f.id} el={f} onPatch={p => patchFloor(activeRoom.id, f.id, p)} onDelete={() => removeFloor(activeRoom.id, f.id)} />)}
              </div>
            </div>
          </div>
        )}

        {tab === "croqui" && croquiLevel && (
          <div className="p-3 rounded-lg" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-medium" style={{ color: C.chalk }}>Croqui do nível:</span>
              <select value={croquiLevel.id} onChange={e => setCroquiLevelId(e.target.value)} className="text-xs px-2 py-1 rounded flex-1"
                style={{ background: C.panelAlt, color: C.chalk, border: `1px solid ${C.line}` }}>
                {levels.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <VectorSketch level={croquiLevel} allLevels={levels} rooms={rooms.filter(r => r.level === croquiLevel.name)}
              onChange={(els, sc) => updateLevelSketch(croquiLevel.id, els, sc)}
              onMeta={(patch) => updateLevelMeta(croquiLevel.id, patch)}
              onNameRoom={(elId, name) => nameRoomPolygon(croquiLevel.id, elId, name)} />
          </div>
        )}
        {tab === "croqui" && !croquiLevel && <div className="text-center text-sm py-10" style={{ color: C.mute }}>Crie um nível na aba Modelo → Níveis para começar a desenhar.</div>}

        {tab === "modelo" && (
          <div>
            <div className="flex gap-1.5 mb-3 flex-wrap">
              {[{ id: "elementos", label: "Elementos" }, { id: "pisos", label: "Pisos" }, { id: "coberturas", label: "Coberturas" }, { id: "niveis", label: "Níveis" }, { id: "3d", label: "3D" }].map(s => (
                <button key={s.id} onClick={() => setModeloSub(s.id)} className="px-2.5 py-1.5 rounded text-xs"
                  style={{ ...heading, fontWeight: 600, background: modeloSub === s.id ? C.goldTint : C.panelAlt, color: modeloSub === s.id ? C.gold : C.mute, border: `1px solid ${modeloSub === s.id ? "#FFFFFF" : C.line}` }}>
                  {s.label}
                </button>
              ))}
            </div>

            {modeloSub === "elementos" && (
              <div className="space-y-4">
                {levels.map(l => (
                  <div key={l.id}>
                    <div className="text-xs font-semibold mb-1.5 flex items-center gap-1.5" style={{ color: C.gold }}>
                      <ChevronDown size={12} /> {l.name.toUpperCase()} <span style={{ color: C.mute, ...mono, fontWeight: 400 }}>· cota {l.elevation} m</span>
                    </div>
                    <div className="space-y-1.5 mb-2">
                      {(l.sketchElements || []).filter(e => e.type === "wall").map(el => <WallRow key={el.id} el={el} adjacency={wallRoomAdjacency(l, el)} onPatch={p => updateLevelElement(l.id, el.id, p)} onDelete={() => removeLevelElement(l.id, el.id)} />)}
                      {(l.sketchElements || []).filter(e => e.type === "door").map(el => <DoorRow key={el.id} el={el} onPatch={p => updateLevelElement(l.id, el.id, p)} onDelete={() => removeLevelElement(l.id, el.id)} />)}
                      {(l.sketchElements || []).filter(e => e.type === "window").map(el => <WindowRow key={el.id} el={el} onPatch={p => updateLevelElement(l.id, el.id, p)} onDelete={() => removeLevelElement(l.id, el.id)} />)}
                      {(l.sketchElements || []).filter(e => e.type === "wall" || e.type === "door" || e.type === "window").length === 0 && (
                        <div className="text-[11px] italic" style={{ color: C.mute }}>Nada desenhado ainda neste nível.</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {modeloSub === "pisos" && (
              <div className="space-y-4">
                <p className="text-[11px]" style={{ color: C.mute }}>Lance o piso de cada ambiente aqui — tipo de revestimento, área e condição.</p>
                {rooms.length === 0 && (
                  <div className="text-[11px] italic p-3 rounded-lg" style={{ color: C.mute, background: C.panelAlt, border: `1px solid ${C.line}` }}>
                    Ainda não há ambientes nomeados. Vá ao Croqui, feche um contorno com a ferramenta "Ambiente" e dê um nome — ele aparece aqui na sequência.
                  </div>
                )}
                {rooms.map(r => (
                  <div key={r.id}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-medium" style={{ color: C.chalk }}>{r.name} <span style={{ color: C.mute, fontWeight: 400 }}>· {r.level}</span></span>
                      <button onClick={() => addFloor(r.id)} className="flex items-center gap-1 text-[11px] px-2 py-1 rounded" style={{ color: C.gold, background: C.goldTint }}>
                        <Plus size={11} /> novo piso
                      </button>
                    </div>
                    <div className="space-y-1.5 mb-2">
                      {r.floors.length === 0 && <div className="text-[11px] italic" style={{ color: C.mute }}>Nenhum piso registrado.</div>}
                      {r.floors.map(f => <FloorRow key={f.id} el={f} onPatch={p => patchFloor(r.id, f.id, p)} onDelete={() => removeFloor(r.id, f.id)} />)}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {modeloSub === "coberturas" && (
              <div className="space-y-3">
                <div className="p-2.5 rounded-lg text-[11px]" style={{ background: C.panelAlt, border: `1px solid ${C.line}`, color: C.mute }}>
                  Cada água vira um plano de telhado no Revit (Roof by Footprint) com a inclinação lançada aqui — e o comprimento de rufo/calha entra direto na planilha de quantitativos exportada.
                </div>
                {roofs.map(roof => {
                  const totalRoofArea = roof.aguas.reduce((s, a) => s + (toNum(a.area, 0)), 0).toFixed(1);
                  const totalRufo = roof.aguas.reduce((s, a) => s + (toNum(a.rufo, 0)), 0).toFixed(1);
                  const totalCalha = roof.aguas.reduce((s, a) => s + (toNum(a.calha, 0)), 0).toFixed(1);
                  return (
                    <div key={roof.id} className="p-3 rounded-lg" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
                      <div className="flex items-center gap-2 mb-2">
                        <Triangle size={14} color={C.gold} />
                        <input value={roof.name} onChange={e => updateRoofs(rs => rs.map(r => r.id === roof.id ? { ...r, name: e.target.value } : r))}
                          className="text-sm font-medium flex-1 bg-transparent" style={{ color: C.chalk }} />
                        <select value={roof.level} onChange={e => updateRoofs(rs => rs.map(r => r.id === roof.id ? { ...r, level: e.target.value } : r))}
                          className="text-[11px] px-2 py-1 rounded" style={{ background: C.panelAlt, color: C.mute, border: `1px solid ${C.line}` }}>
                          {levels.map(l => <option key={l.id}>{l.name}</option>)}
                        </select>
                      </div>
                      <div className="text-[11px] mb-2" style={{ color: C.mute }}>{roof.aguas.length} água(s) · {totalRoofArea} m² · {totalRufo} m de rufo · {totalCalha} m de calha</div>
                      <div className="space-y-1.5">
                        {roof.aguas.map((agua, i) => (
                          <div key={agua.id} className="p-2 rounded space-y-1.5" style={{ background: C.panelAlt, border: `1px solid ${C.line}` }}>
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] w-14" style={{ ...mono, color: C.gold }}>Água {i + 1}</span>
                              <input type="text" inputMode="decimal" value={agua.inclinacao} placeholder="Inclinação"
                                onChange={e => updateRoofs(rs => rs.map(r => r.id === roof.id ? { ...r, aguas: r.aguas.map(a => a.id === agua.id ? { ...a, inclinacao: e.target.value } : a) } : r))}
                                className="w-14 px-1.5 py-1 rounded text-xs" style={{ background: "rgba(255,255,255,0.06)", color: C.chalk, border: `1px solid ${C.line}` }} />
                              <span className="text-[10px]" style={{ color: C.mute }}>° inclin.</span>
                              <input type="text" inputMode="decimal" value={agua.area} placeholder="Área m²"
                                onChange={e => updateRoofs(rs => rs.map(r => r.id === roof.id ? { ...r, aguas: r.aguas.map(a => a.id === agua.id ? { ...a, area: e.target.value } : a) } : r))}
                                className="w-14 px-1.5 py-1 rounded text-xs ml-auto" style={{ background: "rgba(255,255,255,0.06)", color: C.chalk, border: `1px solid ${C.line}` }} />
                              <span className="text-[10px]" style={{ color: C.mute }}>m²</span>
                              <button onClick={() => removeAgua(roof.id, agua.id)}><Trash2 size={12} color={C.mute} /></button>
                            </div>
                            <div className="flex items-center gap-2 pl-16">
                              <span className="text-[10px]" style={{ color: C.mute }}>Rufo</span>
                              <input type="text" inputMode="decimal" value={agua.rufo || ""} placeholder="0"
                                onChange={e => updateRoofs(rs => rs.map(r => r.id === roof.id ? { ...r, aguas: r.aguas.map(a => a.id === agua.id ? { ...a, rufo: e.target.value } : a) } : r))}
                                className="w-14 px-1.5 py-1 rounded text-xs" style={{ background: "rgba(255,255,255,0.06)", color: C.chalk, border: `1px solid ${C.line}` }} />
                              <span className="text-[10px]" style={{ color: C.mute }}>m</span>
                              <span className="text-[10px] ml-3" style={{ color: C.mute }}>Calha</span>
                              <input type="text" inputMode="decimal" value={agua.calha || ""} placeholder="0"
                                onChange={e => updateRoofs(rs => rs.map(r => r.id === roof.id ? { ...r, aguas: r.aguas.map(a => a.id === agua.id ? { ...a, calha: e.target.value } : a) } : r))}
                                className="w-14 px-1.5 py-1 rounded text-xs" style={{ background: "rgba(255,255,255,0.06)", color: C.chalk, border: `1px solid ${C.line}` }} />
                              <span className="text-[10px]" style={{ color: C.mute }}>m</span>
                            </div>
                          </div>
                        ))}
                      </div>
                      <button onClick={() => addAgua(roof.id)} className="mt-2 flex items-center gap-1 text-[11px] px-2 py-1 rounded" style={{ color: C.gold, background: C.goldTint }}>
                        <Plus size={11} /> adicionar água
                      </button>
                    </div>
                  );
                })}
                <button onClick={addRoof} className="w-full py-3 rounded-lg flex items-center justify-center gap-2 text-sm" style={{ border: `1px dashed ${C.line}`, color: C.mute }}>
                  <Plus size={16} /> Nova cobertura
                </button>
              </div>
            )}

            {modeloSub === "niveis" && (
              <div className="space-y-2">
                {levels.map(l => (
                  <div key={l.id} className="flex items-center gap-2 p-2.5 rounded-lg" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
                    <Layers3 size={14} color={C.gold} />
                    <input value={l.name} onChange={e => updateLevels(ls => ls.map(x => x.id === l.id ? { ...x, name: e.target.value } : x))}
                      className="text-sm flex-1 bg-transparent" style={{ color: C.chalk }} />
                    <input type="text" inputMode="decimal" value={l.elevation} onChange={e => updateLevels(ls => ls.map(x => x.id === l.id ? { ...x, elevation: e.target.value } : x))}
                      className="w-20 px-2 py-1 rounded text-xs text-right" style={{ ...mono, background: C.panelAlt, color: C.chalk, border: `1px solid ${C.line}` }} />
                    <span className="text-[10px]" style={{ color: C.mute }}>m</span>
                    <button onClick={() => updateLevels(ls => ls.filter(x => x.id !== l.id))}><Trash2 size={13} color={C.mute} /></button>
                  </div>
                ))}
                <button onClick={addLevel} className="w-full py-3 rounded-lg flex items-center justify-center gap-2 text-sm" style={{ border: `1px dashed ${C.line}`, color: C.mute }}>
                  <Plus size={16} /> Novo nível
                </button>
              </div>
            )}

            {modeloSub === "3d" && (
              <div>
                <div className="flex gap-1.5 mb-3 flex-wrap">
                  <button onClick={() => setView3dMode("casa")} className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs"
                    style={{ background: view3dMode === "casa" ? C.goldTint : C.panelAlt, color: view3dMode === "casa" ? C.gold : C.mute, border: `1px solid ${view3dMode === "casa" ? "#FFFFFF" : C.line}` }}>
                    <Home size={12} /> Casa toda
                  </button>
                  <button onClick={() => setView3dMode("ambiente")} className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs"
                    style={{ background: view3dMode === "ambiente" ? C.goldTint : C.panelAlt, color: view3dMode === "ambiente" ? C.gold : C.mute, border: `1px solid ${view3dMode === "ambiente" ? "#FFFFFF" : C.line}` }}>
                    <Box size={12} /> Este ambiente
                  </button>
                  {view3dMode === "ambiente" && (
                    <select value={view3dRoomId || ""} onChange={e => setView3dRoomId(e.target.value)} className="text-xs px-2 py-1 rounded flex-1"
                      style={{ background: C.panelAlt, color: C.chalk, border: `1px solid ${C.line}` }}>
                      <option value="">Selecione um ambiente</option>
                      {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  )}
                  <button onClick={() => setView3dOpen(o => !o)} className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs ml-auto"
                    style={{ background: view3dOpen ? C.goldTint : C.panelAlt, color: view3dOpen ? C.gold : C.mute, border: `1px solid ${view3dOpen ? "#FFFFFF" : C.line}` }}>
                    <DoorOpen size={12} /> {view3dOpen ? "Portas/janelas abertas" : "Portas/janelas fechadas"}
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2 mb-3 p-2 rounded-lg" style={{ background: C.panelAlt, border: `1px solid ${C.line}` }}>
                  <button onClick={() => setSectionCut(s => ({ ...s, enabled: !s.enabled }))} className="flex items-center gap-1 px-2 py-1.5 rounded text-xs"
                    style={{ background: sectionCut.enabled ? C.goldTint : "transparent", color: sectionCut.enabled ? C.gold : C.mute, border: `1px solid ${sectionCut.enabled ? "#FFFFFF" : C.line}` }}>
                    <Scissors size={12} /> Corte de seção
                  </button>
                  {sectionCut.enabled && (
                    <>
                      <select value={sectionCut.axis} onChange={e => setSectionCut(s => ({ ...s, axis: e.target.value }))} className="text-xs px-2 py-1 rounded"
                        style={{ background: "rgba(255,255,255,0.06)", color: C.chalk, border: `1px solid ${C.line}` }}>
                        <option value="horizontal">Horizontal (planta em corte)</option>
                        <option value="vertical-x">Vertical — eixo X</option>
                        <option value="vertical-z">Vertical — eixo Z</option>
                      </select>
                      <input type="range" min={sectionCut.axis === "horizontal" ? -1 : -15} max="15" step="0.1" value={sectionCut.position}
                        onChange={e => setSectionCut(s => ({ ...s, position: toNum(e.target.value, s.position) }))} className="flex-1 min-w-[100px]" />
                      <span className="text-[10px]" style={{ ...mono, color: C.mute }}>{sectionCut.position.toFixed(1)} m</span>
                    </>
                  )}
                </div>

                {view3dMode === "casa" && (
                  <Suspense fallback={<div className="text-xs p-6 text-center" style={{ color: C.mute }}>Carregando visualização 3D…</div>}>
                    <ThreeDView buildingLevels={levels.map(levelToMeters)} elevationsById={Object.fromEntries(levels.map(l => [l.id, toNum(l.elevation, 0)]))} openState={view3dOpen ? "open" : "closed"} sectionCut={sectionCut} />
                  </Suspense>
                )}
                {view3dMode === "ambiente" && (() => {
                  const room = rooms.find(r => r.id === view3dRoomId);
                  if (!room) return <div className="text-xs p-6 text-center" style={{ color: C.mute }}>Escolha um ambiente acima.</div>;
                  const level = levels.find(l => l.name === room.level);
                  const data = level ? levelToMetersForRoom(level, room) : null;
                  if (!data) return <div className="text-xs p-6 text-center" style={{ color: C.mute }}>Este ambiente ainda não tem um contorno desenhado. Vá ao Croqui, use a ferramenta "Ambiente" e feche o contorno vinculando a este nome.</div>;
                  return (
                    <Suspense fallback={<div className="text-xs p-6 text-center" style={{ color: C.mute }}>Carregando visualização 3D…</div>}>
                      <ThreeDView buildingLevels={[data]} elevationsById={{}} openState={view3dOpen ? "open" : "closed"} sectionCut={sectionCut} />
                    </Suspense>
                  );
                })()}
              </div>
            )}
          </div>
        )}

        {tab === "sync" && (
          <SyncTab syncing={syncing} runSync={runSync} exportJSON={exportJSON} exportCSV={exportCSV} log={log} />
        )}
      </div>

      <div data-braves-bottom-nav className="relative flex shrink-0" style={{ background: "#141311", borderTop: `1px solid ${C.line}` }}>
        {TABS.map(({ id, label, Icon }) => (
          <button key={id} onClick={() => { setTab(id); if (id !== "ambientes") setActiveRoomId(null); }}
            className="flex-1 py-3 flex flex-col items-center gap-1">
            <Icon size={18} color={tab === id ? C.gold : C.muteDim} />
            <span className="text-[10px]" style={{ ...heading, fontWeight: 600, color: tab === id ? C.gold : C.muteDim }}>{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
