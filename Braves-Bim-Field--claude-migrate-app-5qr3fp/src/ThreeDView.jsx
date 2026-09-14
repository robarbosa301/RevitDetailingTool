import { useRef, useState, useEffect } from "react";
import * as THREE from "three";
import { C } from "./theme.js";
import { toNum } from "./utils.js";

// Split out of App.jsx and lazy-loaded (see the React.lazy import there) so
// three.js — a large dependency only ever needed once someone opens the 3D
// tab — isn't part of the app's initial bundle.
const _textureCache = new Map();
function getWallTexture(finish, color) {
  const key = (finish || "A definir") + "|" + (color || "");
  if (_textureCache.has(key)) return _textureCache.get(key);
  const canvas = document.createElement("canvas");
  canvas.width = 128; canvas.height = 128;
  const ctx = canvas.getContext("2d");
  const paintish = finish === "Pintura";
  const base = paintish ? (color || "#E8E4DA") : (finish === "Porcelanato" ? "#E4E1D8" : finish === "Cerâmica" ? "#D8CFC0" : finish === "Madeira/Laminado" ? "#B08A5C" : finish === "Vinílico" ? "#C9C2B4" : "#D9D4C8");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 128, 128);

  if (finish === "Sem reboco (aparente)") {
    ctx.strokeStyle = "rgba(0,0,0,0.28)"; ctx.lineWidth = 2;
    for (let y = 0; y < 128; y += 16) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(128, y); ctx.stroke();
      const offset = (y / 16) % 2 === 0 ? 0 : 16;
      for (let x = offset; x < 128; x += 32) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 16); ctx.stroke(); }
    }
  } else if (finish === "Revestimento cerâmico" || finish === "Porcelanato" || finish === "Cerâmica") {
    const step = finish === "Cerâmica" ? 24 : 32;
    ctx.strokeStyle = "rgba(0,0,0,0.16)"; ctx.lineWidth = 2;
    for (let i = 0; i <= 128; i += step) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 128); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(128, i); ctx.stroke();
    }
  } else if (finish === "Madeira/Laminado") {
    ctx.strokeStyle = "rgba(0,0,0,0.18)"; ctx.lineWidth = 1.5;
    for (let y = 0; y < 128; y += 14) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(128, y); ctx.stroke(); }
    for (let i = 0; i < 40; i++) { ctx.strokeStyle = "rgba(0,0,0,0.06)"; ctx.beginPath(); const y = Math.random() * 128; ctx.moveTo(Math.random() * 100, y); ctx.lineTo(Math.random() * 100 + 20, y); ctx.stroke(); }
  } else if (finish === "Vinílico") {
    for (let i = 0; i < 200; i++) { ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`; ctx.fillRect(Math.random() * 128, Math.random() * 128, 3, 3); }
  } else if (finish === "Textura acrílica") {
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.15})`;
      ctx.beginPath(); ctx.arc(Math.random() * 128, Math.random() * 128, 1.4, 0, 7); ctx.fill();
    }
  } else if (finish === "Pintura") {
    const grad = ctx.createLinearGradient(0, 0, 128, 128);
    grad.addColorStop(0, "rgba(255,255,255,0.10)");
    grad.addColorStop(1, "rgba(0,0,0,0.06)");
    ctx.fillStyle = grad; ctx.fillRect(0, 0, 128, 128);
  } else if (finish === "Forro de gesso" || finish === "Forro em PVC" || finish === "Forro mineral (lay-in)") {
    ctx.strokeStyle = "rgba(0,0,0,0.12)"; ctx.lineWidth = 1.5;
    const step = finish === "Forro mineral (lay-in)" ? 32 : 64;
    for (let i = 0; i <= 128; i += step) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 128); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(128, i); ctx.stroke(); }
  } else {
    for (let i = 0; i < 420; i++) {
      ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`;
      ctx.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  _textureCache.set(key, tex);
  return tex;
}

// A painted wall face is meant to read as one flat, uniform coat of color —
// tiling getWallTexture's subtle gradient canvas across a whole wall (like
// every other finish does, to show a repeating brick/tile/wood pattern)
// instead made the paint look like a grid of visible squares. So Pintura
// skips the texture entirely and uses the color straight on the material.
function wallFaceMaterial(finish, color, segLen, segH) {
  if (finish === "Pintura") return new THREE.MeshStandardMaterial({ color: color || "#E8E4DA", roughness: 0.45 });
  const tex = getWallTexture(finish, color).clone();
  tex.needsUpdate = true;
  tex.repeat.set(Math.max(1, segLen / 1.1), Math.max(1, segH / 1.1));
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92 });
}

// ---- 3D viewer (raw three.js — no OrbitControls addon available) ----------
export default function ThreeDView({ buildingLevels, elevationsById, openState = "closed", sectionCut }) {
  const mountRef = useRef(null);
  const [ok, setOk] = useState(true);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const totalWalls = buildingLevels.reduce((s, l) => s + l.walls.length, 0);
    if (totalWalls === 0) { setEmpty(true); return; }
    setEmpty(false);

    let renderer, raf, disposed = false;
    const cleanupFns = [];
    try {
      const width = mount.clientWidth || 320, height = 340;
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.localClippingEnabled = true;
      if (sectionCut && sectionCut.enabled) {
        let plane;
        if (sectionCut.axis === "horizontal") plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), sectionCut.position);
        else if (sectionCut.axis === "vertical-x") plane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), sectionCut.position);
        else plane = new THREE.Plane(new THREE.Vector3(0, 0, -1), sectionCut.position);
        renderer.clippingPlanes = [plane];
      } else {
        renderer.clippingPlanes = [];
      }
      mount.innerHTML = "";
      mount.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 400);
      scene.add(new THREE.AmbientLight(0xffffff, 0.7));
      const dir = new THREE.DirectionalLight(0xffffff, 0.75);
      dir.position.set(10, 16, 8);
      scene.add(dir);

      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, maxY = 1;

      buildingLevels.forEach(lvl => {
        const elev = lvl.elevation;
        const levelWallHeight = lvl.walls.length ? Math.max(...lvl.walls.map(w => w.height || 2.8)) : 2.8;

        lvl.walls.forEach(w => {
          const dx = w.x2 - w.x1, dz = w.y2 - w.y1;
          const len = Math.max(0.05, Math.hypot(dx, dz));
          const angle = Math.atan2(dz, dx);
          const h = w.height || 2.8;
          const ux = dx / len, uz = dz / len;
          const thickness = 0.2;

          // The physical opening in the wall always exists — "open" only
          // changes how the door/window leaf itself is posed, never removes
          // the hole (that used to make windows vanish and doors clip through
          // solid wall when toggled open).
          const openings = [
            ...lvl.doors.filter(d => d.wallId === w.id).map(d => ({ kind: "door", ...d })),
            ...lvl.windows.filter(win => win.wallId === w.id).map(win => ({ kind: "window", ...win })),
          ].map(o => {
            const pos = (o.x - w.x1) * ux + (o.y - w.y1) * uz;
            const halfW = Math.max(0.15, o.width / 2);
            return {
              ...o, pos,
              start: Math.max(0, pos - halfW), end: Math.min(len, pos + halfW),
              yBottom: o.kind === "door" ? 0 : o.peitoril,
              yTop: o.kind === "door" ? o.height : o.peitoril + o.height,
            };
          }).sort((a, b) => a.start - b.start);

          const segs = [];
          let cursor = 0;
          openings.forEach(iv => {
            if (iv.start > cursor + 0.02) segs.push({ start: cursor, end: iv.start, yBottom: 0, yTop: h });
            if (iv.yBottom > 0.05) segs.push({ start: iv.start, end: iv.end, yBottom: 0, yTop: iv.yBottom });
            if (iv.yTop < h - 0.05) segs.push({ start: iv.start, end: iv.end, yBottom: iv.yTop, yTop: h });
            cursor = Math.max(cursor, iv.end);
          });
          if (cursor < len - 0.02) segs.push({ start: cursor, end: len, yBottom: 0, yTop: h });
          if (segs.length === 0) segs.push({ start: 0, end: len, yBottom: 0, yTop: h });

          // Walls flagged for demolition or new construction (a reforma's
          // scope) render as a translucent red/green block instead of their
          // real finish, so the 3D view calls out the same elements the
          // Croqui already marks with a dashed outline — same convention
          // (and same colors), two views.
          const demolirMat = () => new THREE.MeshStandardMaterial({ color: 0xC1543F, roughness: 0.6, transparent: true, opacity: 0.5 });
          const construirMat = () => new THREE.MeshStandardMaterial({ color: 0x6B9C5A, roughness: 0.6, transparent: true, opacity: 0.5 });
          const matNeutral = w.demolir ? demolirMat() : w.construir ? construirMat() : new THREE.MeshStandardMaterial({ color: 0xdedad0, roughness: 0.9 });
          segs.forEach(seg => {
            const segLen = seg.end - seg.start, segH = seg.yTop - seg.yBottom;
            if (segLen <= 0.02 || segH <= 0.02) return;
            let matA, matB;
            if (w.demolir) {
              matA = demolirMat(); matB = demolirMat();
            } else if (w.construir) {
              matA = construirMat(); matB = construirMat();
            } else {
              matA = wallFaceMaterial(w.finishA, w.paintColorA, segLen, segH);
              matB = wallFaceMaterial(w.finishB, w.paintColorB, segLen, segH);
            }
            const geo = new THREE.BoxGeometry(segLen, segH, thickness);
            const mesh = new THREE.Mesh(geo, [matNeutral, matNeutral, matNeutral, matNeutral, matA, matB]);
            const cx = w.x1 + ux * (seg.start + segLen / 2);
            const cz = w.y1 + uz * (seg.start + segLen / 2);
            mesh.position.set(cx, elev + seg.yBottom + segH / 2, cz);
            mesh.rotation.y = -angle;
            scene.add(mesh);
          });

          // Door/window leaves: split into their real panel ("folha") count,
          // always rotated flush with this wall's own angle so they never
          // clip through or poke out of it. Sliding ("Correr") panels slide
          // sideways in the wall plane when open; hinged panels swing on a
          // vertical hinge into the room.
          openings.forEach(o => {
            const panels = Math.max(1, o.panels || 1);
            const panelWidth = o.width / panels;
            const gap = Math.min(0.03, panelWidth * 0.08);
            const isSliding = /correr/i.test(o.doorType || o.windowType || "");
            const isDoorKind = o.kind === "door";
            const color = o.demolir ? 0xC1543F : o.construir ? 0x6B9C5A : (isDoorKind ? 0x4A4A46 : 0xC7C5BE);
            const matOpts = (o.demolir || o.construir)
              ? { roughness: 0.6, transparent: true, opacity: 0.5 }
              : isDoorKind
                ? { roughness: 0.5 }
                : { roughness: 0.2, transparent: true, opacity: 0.75 };

            for (let i = 0; i < panels; i++) {
              const segStart = o.pos - o.width / 2 + i * panelWidth;
              const segEnd = segStart + panelWidth;
              const segMid = (segStart + segEnd) / 2;
              const leafW = Math.max(0.15, panelWidth - gap);
              const leafH = Math.max(0.2, o.height - 0.04);
              let cx, cz, leafAngle = angle;

              if (openState === "open" && isSliding) {
                const slidPos = segMid + (panelWidth - gap) * 0.92;
                cx = w.x1 + ux * slidPos; cz = w.y1 + uz * slidPos;
              } else if (openState === "open") {
                const hingePos = segStart;
                leafAngle = angle + Math.PI * 0.42; // ~75° swung open
                const hx = w.x1 + ux * hingePos, hz = w.y1 + uz * hingePos;
                cx = hx + Math.cos(leafAngle) * (leafW / 2);
                cz = hz + Math.sin(leafAngle) * (leafW / 2);
              } else {
                cx = w.x1 + ux * segMid; cz = w.y1 + uz * segMid;
              }

              const mesh = new THREE.Mesh(
                new THREE.BoxGeometry(leafW, leafH, 0.05),
                new THREE.MeshStandardMaterial({ color, ...matOpts })
              );
              mesh.position.set(cx, elev + o.yBottom + o.height / 2, cz);
              mesh.rotation.y = -leafAngle;
              scene.add(mesh);
            }
          });

          minX = Math.min(minX, w.x1, w.x2); maxX = Math.max(maxX, w.x1, w.x2);
          minZ = Math.min(minZ, w.y1, w.y2); maxZ = Math.max(maxZ, w.y1, w.y2);
          maxY = Math.max(maxY, elev + h);
        });

        (lvl.rooms || []).forEach(r => {
          if (r.points.length < 3) return;
          const shape = new THREE.Shape(r.points.map(p => new THREE.Vector2(p.x, -p.y)));
          // Only render a floor/ceiling plane once that finish was actually
          // chosen in Croqui — "A definir" (the default before anyone picks
          // one) isn't real survey data, so it shouldn't show up in 3D as if
          // it were.
          if (r.floorFinish && r.floorFinish !== "A definir") {
            const floorTex = getWallTexture(r.floorFinish, r.floorColor).clone(); floorTex.needsUpdate = true; floorTex.repeat.set(3, 3);
            const floorMesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.85, side: THREE.DoubleSide }));
            floorMesh.rotation.x = -Math.PI / 2;
            floorMesh.position.y = elev + 0.01;
            scene.add(floorMesh);
          }

          if (r.ceilingFinish && r.ceilingFinish !== "A definir") {
            const ceilTex = getWallTexture(r.ceilingFinish, "#EDEBE4").clone(); ceilTex.needsUpdate = true; ceilTex.repeat.set(3, 3);
            const ceilMesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({ map: ceilTex, roughness: 0.95, side: THREE.DoubleSide }));
            ceilMesh.rotation.x = -Math.PI / 2;
            ceilMesh.position.y = elev + levelWallHeight - 0.01;
            scene.add(ceilMesh);
          }
        });

        (lvl.stairs || []).forEach(st => {
          const targetElev = (elevationsById && elevationsById[st.toLevelId] != null) ? elevationsById[st.toLevelId] : elev + 3;
          const totalRise = targetElev - elev;
          const mat = new THREE.MeshStandardMaterial({ color: 0x8A8880, roughness: 0.85 });
          const stepRiser = 0.18;
          const width = Math.max(0.6, st.width);

          function addFlightSteps(ax, az, bx, bz, aY, bY) {
            const dx = bx - ax, dz = bz - az;
            const runLen = Math.max(0.05, Math.hypot(dx, dz));
            const ux = dx / runLen, uz = dz / runLen;
            const rise = bY - aY;
            const steps = Math.max(1, Math.round(Math.abs(rise) / stepRiser));
            const stepRun = runLen / steps;
            const stepRise = rise / steps;
            const angle = Math.atan2(dz, dx);
            for (let i = 0; i < steps; i++) {
              const topY = aY + stepRise * (i + 1);
              const boxHeight = Math.max(0.03, Math.abs(topY - aY));
              const cx = ax + ux * stepRun * (i + 0.5);
              const cz = az + uz * stepRun * (i + 0.5);
              const mesh = new THREE.Mesh(new THREE.BoxGeometry(stepRun + 0.015, boxHeight, width), mat);
              mesh.position.set(cx, aY + (topY - aY) / 2, cz);
              mesh.rotation.y = -angle;
              scene.add(mesh);
            }
          }

          if (st.hasLanding) {
            const pos = Math.min(0.95, Math.max(0.05, toNum(st.landingPos, 0.5)));
            const landY = elev + toNum(st.landingHeight, totalRise * pos);
            const lx = st.x1 + (st.x2 - st.x1) * pos, lz = st.y1 + (st.y2 - st.y1) * pos;
            addFlightSteps(st.x1, st.y1, lx, lz, elev, landY);
            addFlightSteps(lx, lz, st.x2, st.y2, landY, targetElev);
            const landingMesh = new THREE.Mesh(new THREE.BoxGeometry(width, 0.12, width), mat);
            landingMesh.position.set(lx, landY, lz);
            scene.add(landingMesh);
          } else {
            addFlightSteps(st.x1, st.y1, st.x2, st.y2, elev, targetElev);
          }
        });

        (lvl.luminarias || []).forEach(lm => {
          const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 10), new THREE.MeshStandardMaterial({ color: 0xF2F1ED, emissive: 0xE5E3DD, emissiveIntensity: 0.8 }));
          mesh.position.set(lm.x, elev + levelWallHeight - 0.12, lm.y);
          scene.add(mesh);
        });

        if (lvl.walls.length) {
          const w = Math.max(2, (maxX - minX) + 1), d = Math.max(2, (maxZ - minZ) + 1);
          const floor = new THREE.Mesh(
            new THREE.PlaneGeometry(w, d),
            new THREE.MeshStandardMaterial({ color: 0x2a2822, roughness: 1, side: THREE.DoubleSide, transparent: true, opacity: 0.25 })
          );
          floor.rotation.x = -Math.PI / 2;
          floor.position.set((minX + maxX) / 2, elev, (minZ + maxZ) / 2);
          scene.add(floor);
        }
      });

      if (!isFinite(minX)) { minX = 0; maxX = 4; minZ = 0; maxZ = 4; }
      const target = new THREE.Vector3((minX + maxX) / 2, maxY / 2, (minZ + maxZ) / 2);
      let theta = Math.PI / 4, phi = Math.PI / 3.2;
      let camDist = Math.max(6, Math.hypot(maxX - minX, maxZ - minZ) * 1.25 + 3);

      function updateCamera() {
        camera.position.set(
          target.x + camDist * Math.sin(phi) * Math.cos(theta),
          target.y + camDist * Math.cos(phi),
          target.z + camDist * Math.sin(phi) * Math.sin(theta)
        );
        camera.lookAt(target);
      }
      updateCamera();

      let dragging = false, lastX = 0, lastY = 0;
      function onDown(e) { dragging = true; const p = e.touches ? e.touches[0] : e; lastX = p.clientX; lastY = p.clientY; }
      function onMove(e) {
        if (!dragging) return;
        const p = e.touches ? e.touches[0] : e;
        const dx = p.clientX - lastX, dy = p.clientY - lastY;
        lastX = p.clientX; lastY = p.clientY;
        theta -= dx * 0.008;
        phi = Math.min(Math.PI - 0.15, Math.max(0.2, phi - dy * 0.008));
        updateCamera();
      }
      function onUp() { dragging = false; }
      function onWheel(e) { e.preventDefault(); camDist = Math.min(80, Math.max(3, camDist + e.deltaY * 0.01)); updateCamera(); }

      const el = renderer.domElement;
      el.addEventListener("mousedown", onDown);
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      el.addEventListener("touchstart", onDown, { passive: true });
      el.addEventListener("touchmove", onMove, { passive: true });
      el.addEventListener("touchend", onUp);
      el.addEventListener("wheel", onWheel, { passive: false });
      cleanupFns.push(() => {
        el.removeEventListener("mousedown", onDown);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        el.removeEventListener("wheel", onWheel);
      });

      function animate() {
        if (disposed) return;
        renderer.render(scene, camera);
        raf = requestAnimationFrame(animate);
      }
      animate();
      setOk(true);
    } catch (e) {
      setOk(false);
    }

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      cleanupFns.forEach(fn => fn());
      if (renderer) {
        renderer.dispose();
        if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
      }
    };
  }, [buildingLevels, openState, sectionCut]);

  if (!ok) return <div className="text-xs p-4 text-center" style={{ color: C.mute }}>A visualização 3D não pôde ser iniciada neste navegador.</div>;
  if (empty) return <div className="text-xs p-6 text-center" style={{ color: C.mute }}>Ainda não há paredes desenhadas para mostrar em 3D. Desenhe no Croqui primeiro.</div>;
  return (
    <div>
      <div ref={mountRef} style={{ width: "100%", height: 340, borderRadius: 8, overflow: "hidden", background: "#8A8880" }} />
      <p className="text-[11px] mt-1.5 text-center" style={{ color: C.mute }}>Arraste para girar · roda do mouse (ou pinça) para zoom</p>
    </div>
  );
}
