import { useState, useEffect } from "react";
import { RectangleHorizontal, DoorClosed, Layers3, LayoutPanelTop, Trash2, Hammer, HardHat } from "lucide-react";
import { C, mono, heading, conditionColor } from "./theme.js";
import { WALL_TYPES, FINISH_TYPES, DOOR_TYPES, WINDOW_TYPES, FLOOR_TYPES } from "./constants.js";

// Small presentational building blocks and the per-element edit rows (one
// per wall/door/window/floor) used by the Elementos tab and Croqui's
// selected-element panel — split out of App.jsx since none of them close
// over that component's state, they only take props.

export function Pill({ active, label, Icon }) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full"
      style={{ background: active ? C.goldTint : "rgba(255,255,255,0.05)", border: `1px solid ${active ? C.gold : "rgba(255,255,255,0.15)"}` }}>
      <Icon size={12} color={active ? C.gold : C.muteDim} />
      <span className="text-[11px]" style={{ ...heading, fontWeight: 700, letterSpacing: "0.03em", color: active ? C.gold : C.muteDim }}>{label}</span>
    </div>
  );
}

export function StatRow({ label, value }) {
  return (
    <div className="flex justify-between text-xs py-1" style={{ borderBottom: `1px dashed ${C.line}` }}>
      <span style={{ color: C.mute }}>{label}</span>
      <span style={{ ...mono, color: C.chalk }}>{value}</span>
    </div>
  );
}

export function NumField({ value, onChange, onCommit, w = "w-14", unit }) {
  const [draft, setDraft] = useState(null);
  useEffect(() => { setDraft(null); }, [value]);
  const display = draft !== null ? draft : value;
  return (
    <span className="flex items-center gap-1">
      <input type="text" inputMode="decimal" value={display}
        onChange={e => { if (onCommit) setDraft(e.target.value); else onChange(e.target.value); }}
        onBlur={() => { if (onCommit && draft !== null) onCommit(draft); }}
        onKeyDown={e => { if (onCommit && e.key === "Enter") { onCommit(draft ?? display); e.target.blur(); } }}
        className={`${w} px-1.5 py-1 rounded text-[11px] text-right`} style={{ ...mono, background: "rgba(255,255,255,0.06)", color: C.chalk, border: `1px solid ${C.line}` }} />
      {unit && <span className="text-[10px]" style={{ color: C.mute }}>{unit}</span>}
    </span>
  );
}

export function TypeSelect({ value, options, onChange }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className="text-[11px] px-1.5 py-1 rounded flex-1"
      style={{ background: "rgba(255,255,255,0.06)", color: C.chalk, border: `1px solid ${C.line}` }}>
      {options.map(o => <option key={o}>{o}</option>)}
    </select>
  );
}

export function ConditionSelect({ value, onChange }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className="text-[10px] px-1 py-1 rounded"
      style={{ color: conditionColor(value), background: "rgba(255,255,255,0.06)", border: `1px solid ${C.line}` }}>
      {["Bom", "Regular", "Ruim", "A confirmar"].map(o => <option key={o}>{o}</option>)}
    </select>
  );
}

// Marks a wall/door/window as scoped for demolition in a reforma — shown as
// a red dashed outline in Croqui and a translucent red material in the 3D
// view, so the two views agree on what's coming out.
export function DemolirToggle({ checked, onChange }) {
  return (
    <label className="flex items-center gap-1 text-[10px] px-1.5 py-1 rounded cursor-pointer"
      style={{ color: checked ? C.bad : C.mute, background: checked ? "rgba(193,84,63,0.14)" : "rgba(255,255,255,0.06)", border: `1px solid ${checked ? C.bad : C.line}` }}>
      <input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} className="w-3 h-3" />
      <Hammer size={11} /> Demolir
    </label>
  );
}

// Same idea, opposite direction: marks a wall/door/window as new work to be
// built in the reforma — green instead of red, everywhere Demolir is red.
export function ConstruirToggle({ checked, onChange }) {
  return (
    <label className="flex items-center gap-1 text-[10px] px-1.5 py-1 rounded cursor-pointer"
      style={{ color: checked ? C.good : C.mute, background: checked ? "rgba(107,156,90,0.14)" : "rgba(255,255,255,0.06)", border: `1px solid ${checked ? C.good : C.line}` }}>
      <input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} className="w-3 h-3" />
      <HardHat size={11} /> À construir
    </label>
  );
}

// A wall/door/window is at most one of "existing to demolish" or "new to
// build" at a time — checking one here always clears the other.
export function PhaseToggles({ demolir, construir, onChange }) {
  return (
    <>
      <DemolirToggle checked={demolir} onChange={v => onChange({ demolir: v, construir: v ? false : construir })} />
      <ConstruirToggle checked={construir} onChange={v => onChange({ construir: v, demolir: v ? false : demolir })} />
    </>
  );
}

export function WallRow({ el, adjacency, onPatch, onDelete }) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-2 rounded flex-wrap" style={{ background: C.panelAlt, border: `1px solid ${C.line}` }}>
      <RectangleHorizontal size={14} color={C.mute} />
      <span className="text-xs font-semibold w-11" style={{ ...mono, color: C.gold }}>{el.tag}</span>
      <TypeSelect value={el.wallType || WALL_TYPES[0]} options={WALL_TYPES} onChange={v => onPatch({ wallType: v })} />
      <span className="text-[10px]" style={{ color: C.mute }}>{el.length} m ×</span>
      <NumField value={el.height} onChange={v => onPatch({ height: v })} unit="m altura" />
      <ConditionSelect value={el.condition} onChange={v => onPatch({ condition: v })} />
      <PhaseToggles demolir={el.demolir} construir={el.construir} onChange={onPatch} />
      <button onClick={onDelete}><Trash2 size={12} color={C.mute} /></button>
      <div className="w-full flex items-center gap-1.5 mt-1 flex-wrap">
        <span className="text-[10px] w-full" style={{ color: C.mute }}>Acabamento — visível no 3D (cada face pode ter um diferente):</span>
        <span className="text-[10px]" style={{ color: C.mute }}>Face 1 <span style={{ color: C.gold }}>→ {adjacency?.faceA}</span>:</span>
        <TypeSelect value={el.finishA || "A definir"} options={FINISH_TYPES} onChange={v => onPatch({ finishA: v })} />
        {el.finishA === "Pintura" && (
          <input type="color" value={el.paintColorA || "#E8E4DA"} onChange={e => onPatch({ paintColorA: e.target.value })}
            className="w-7 h-7 rounded" style={{ border: `1px solid ${C.line}`, background: "transparent" }} />
        )}
      </div>
      <div className="w-full flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px]" style={{ color: C.mute }}>Face 2 <span style={{ color: C.gold }}>→ {adjacency?.faceB}</span>:</span>
        <TypeSelect value={el.finishB || "A definir"} options={FINISH_TYPES} onChange={v => onPatch({ finishB: v })} />
        {el.finishB === "Pintura" && (
          <input type="color" value={el.paintColorB || "#E8E4DA"} onChange={e => onPatch({ paintColorB: e.target.value })}
            className="w-7 h-7 rounded" style={{ border: `1px solid ${C.line}`, background: "transparent" }} />
        )}
      </div>
    </div>
  );
}

export function DoorRow({ el, onPatch, onDelete }) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-2 rounded flex-wrap" style={{ background: C.panelAlt, border: `1px solid ${C.line}` }}>
      <DoorClosed size={14} color={C.mute} />
      <span className="text-xs font-semibold w-11" style={{ ...heading, fontWeight: 700, color: C.gold }}>{el.tag}</span>
      <TypeSelect value={el.doorType || DOOR_TYPES[0]} options={DOOR_TYPES} onChange={v => onPatch({ doorType: v })} />
      <NumField value={el.panels || 1} onChange={v => onPatch({ panels: v })} unit="folhas" w="w-10" />
      <NumField value={el.width} onChange={v => onPatch({ width: v })} unit="larg." />
      <NumField value={el.height} onChange={v => onPatch({ height: v })} unit="alt." />
      <ConditionSelect value={el.condition} onChange={v => onPatch({ condition: v })} />
      <PhaseToggles demolir={el.demolir} construir={el.construir} onChange={onPatch} />
      <button onClick={onDelete}><Trash2 size={12} color={C.mute} /></button>
    </div>
  );
}

export function WindowRow({ el, onPatch, onDelete }) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-2 rounded flex-wrap" style={{ background: C.panelAlt, border: `1px solid ${C.line}` }}>
      <Layers3 size={14} color={C.mute} />
      <span className="text-xs font-semibold w-11" style={{ ...heading, fontWeight: 700, color: C.gold }}>{el.tag}</span>
      <TypeSelect value={el.windowType || WINDOW_TYPES[0]} options={WINDOW_TYPES} onChange={v => onPatch({ windowType: v })} />
      <NumField value={el.panels || 2} onChange={v => onPatch({ panels: v })} unit="folhas" w="w-10" />
      <NumField value={el.width} onChange={v => onPatch({ width: v })} unit="larg." />
      <NumField value={el.height} onChange={v => onPatch({ height: v })} unit="alt." />
      <NumField value={el.peitoril} onChange={v => onPatch({ peitoril: v })} unit="peitoril" />
      <ConditionSelect value={el.condition} onChange={v => onPatch({ condition: v })} />
      <PhaseToggles demolir={el.demolir} construir={el.construir} onChange={onPatch} />
      <button onClick={onDelete}><Trash2 size={12} color={C.mute} /></button>
    </div>
  );
}

export function FloorRow({ el, onPatch, onDelete }) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-2 rounded flex-wrap" style={{ background: C.panelAlt, border: `1px solid ${C.line}` }}>
      <LayoutPanelTop size={14} color={C.mute} />
      <span className="text-xs font-semibold w-11" style={{ ...mono, color: C.gold }}>{el.tag}</span>
      <TypeSelect value={el.type} options={FLOOR_TYPES} onChange={v => onPatch({ type: v })} />
      <NumField value={el.area} onChange={v => onPatch({ area: v })} unit="m²" />
      <ConditionSelect value={el.condition} onChange={v => onPatch({ condition: v })} />
      <button onClick={onDelete}><Trash2 size={12} color={C.mute} /></button>
    </div>
  );
}

// ---- join / project screen -----------------------------------------------
export function CornerBrackets({ active }) {
  if (!active) return null;
  const s = { position: "absolute", width: 14, height: 14, borderColor: C.gold };
  return (
    <>
      <div style={{ ...s, top: 6, left: 6, borderTop: "2px solid", borderLeft: "2px solid", borderTopLeftRadius: 4 }} />
      <div style={{ ...s, top: 6, right: 6, borderTop: "2px solid", borderRight: "2px solid", borderTopRightRadius: 4 }} />
      <div style={{ ...s, bottom: 6, left: 6, borderBottom: "2px solid", borderLeft: "2px solid", borderBottomLeftRadius: 4 }} />
      <div style={{ ...s, bottom: 6, right: 6, borderBottom: "2px solid", borderRight: "2px solid", borderBottomRightRadius: 4 }} />
    </>
  );
}
