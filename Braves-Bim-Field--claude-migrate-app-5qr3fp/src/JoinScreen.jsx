import { useState, useEffect } from "react";
import { Tablet, Smartphone, Building2, ArrowUpRight } from "lucide-react";
import { C, mono, heading } from "./theme.js";
import { genCode } from "./utils.js";
import { idbGet } from "./storage.js";
import { SYMBOL_LOGO, METAL_BG, Watermark } from "./branding.jsx";
import { CornerBrackets } from "./ElementRows.jsx";

// The app's start screen (device role, new vs. join project) and, once
// starting a new project, its building-info step — split out of App.jsx
// since it only needs the onJoin callback from the parent.

export default function JoinScreen({ onJoin }) {
  const [role, setRole] = useState("tablet");
  const [mode, setMode] = useState("create");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("start");
  const [building, setBuilding] = useState({ name: "", street: "", number: "", neighborhood: "", cep: "", city: "", state: "", country: "Brasil", type: "Residencial", levelsCount: "1" });
  const [cepStatus, setCepStatus] = useState("");

  useEffect(() => {
    const digits = building.cep.replace(/\D/g, "");
    if (digits.length !== 8) { setCepStatus(""); return; }
    let cancelled = false;
    setCepStatus("buscando");
    fetch(`https://viacep.com.br/ws/${digits}/json/`)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        if (data.erro) { setCepStatus("nao-encontrado"); return; }
        setBuilding(b => ({
          ...b,
          street: data.logradouro || b.street,
          neighborhood: data.bairro || b.neighborhood,
          city: data.localidade || b.city,
          state: data.uf || b.state,
          country: "Brasil",
        }));
        setCepStatus("ok");
      })
      .catch(() => { if (!cancelled) setCepStatus("nao-encontrado"); });
    return () => { cancelled = true; };
  }, [building.cep]);
  const [savedProjects, setSavedProjects] = useState([]);

  useEffect(() => {
    idbGet("projects-index").then(list => setSavedProjects(list || []));
  }, []);

  function goToBuilding() {
    const finalCode = genCode();
    setCode(finalCode);
    setStep("building");
  }
  async function handleJoinExisting(codeOverride) {
    setBusy(true);
    await onJoin((codeOverride || code).trim().toUpperCase(), role, null);
    setBusy(false);
  }
  async function handleCreateBuilding() {
    setBusy(true);
    await onJoin(code, role, building);
    setBusy(false);
  }

  if (step === "building") {
    return (
      <div className="braves-app-root relative w-full min-h-screen flex flex-col items-center justify-center p-6 overflow-hidden" style={METAL_BG}>
        <Watermark />
        <div className="relative w-full max-w-sm">
          <div className="flex flex-col items-center gap-2 mb-6">
            <img src={SYMBOL_LOGO} alt="Braves BIM Field" style={{ height: 34, width: "auto" }} />
            <div style={{ ...heading, color: C.chalk, fontSize: "15px", fontWeight: 700, letterSpacing: "0.02em" }}>BRAVES BIM FIELD</div>
            <div className="text-[10px]" style={{ ...mono, color: C.mute, letterSpacing: "0.08em" }}>DADOS DA EDIFICAÇÃO</div>
          </div>
          <p className="text-[11px] mb-4" style={{ color: C.mute }}>Antes de desenhar, conte um pouco sobre o imóvel. Depois disso você vai direto para o croqui e desenha a edificação inteira, ambiente por ambiente.</p>
          <div className="space-y-2.5">
            <input placeholder="Nome do imóvel / projeto" value={building.name} onChange={e => setBuilding({ ...building, name: e.target.value })}
              className="w-full px-3 py-2.5 rounded text-sm" style={{ background: C.panel, color: C.chalk, border: `1px solid ${C.line}` }} />
            <div className="relative">
              <input placeholder="CEP" value={building.cep} onChange={e => setBuilding({ ...building, cep: e.target.value })}
                className="w-full px-3 py-2.5 rounded text-sm" style={{ background: C.panel, color: C.chalk, border: `1px solid ${C.line}` }} />
              {cepStatus === "buscando" && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px]" style={{ color: C.mute }}>buscando…</span>}
              {cepStatus === "ok" && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px]" style={{ color: C.chalk }}>✓ encontrado</span>}
              {cepStatus === "nao-encontrado" && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px]" style={{ color: C.mute }}>não encontrado — preencha à mão</span>}
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              <input placeholder="Rua" value={building.street} onChange={e => setBuilding({ ...building, street: e.target.value })}
                className="col-span-2 px-3 py-2.5 rounded text-sm" style={{ background: C.panel, color: C.chalk, border: `1px solid ${C.line}` }} />
              <input placeholder="Número" value={building.number} onChange={e => setBuilding({ ...building, number: e.target.value })}
                className="px-3 py-2.5 rounded text-sm" style={{ background: C.panel, color: C.chalk, border: `1px solid ${C.line}` }} />
            </div>
            <input placeholder="Bairro" value={building.neighborhood} onChange={e => setBuilding({ ...building, neighborhood: e.target.value })}
              className="w-full px-3 py-2.5 rounded text-sm" style={{ background: C.panel, color: C.chalk, border: `1px solid ${C.line}` }} />
            <div className="grid grid-cols-2 gap-2.5">
              <input placeholder="Cidade" value={building.city} onChange={e => setBuilding({ ...building, city: e.target.value })}
                className="px-3 py-2.5 rounded text-sm" style={{ background: C.panel, color: C.chalk, border: `1px solid ${C.line}` }} />
              <input placeholder="Estado" value={building.state} onChange={e => setBuilding({ ...building, state: e.target.value })}
                className="px-3 py-2.5 rounded text-sm" style={{ background: C.panel, color: C.chalk, border: `1px solid ${C.line}` }} />
            </div>
            <input placeholder="País" value={building.country} onChange={e => setBuilding({ ...building, country: e.target.value })}
              className="w-full px-3 py-2.5 rounded text-sm" style={{ background: C.panel, color: C.chalk, border: `1px solid ${C.line}` }} />
            <div className="grid grid-cols-2 gap-2.5">
              <select value={building.type} onChange={e => setBuilding({ ...building, type: e.target.value })}
                className="px-3 py-2.5 rounded text-sm" style={{ background: C.panel, color: C.chalk, border: `1px solid ${C.line}` }}>
                {["Residencial", "Comercial", "Industrial", "Institucional", "Misto"].map(o => <option key={o}>{o}</option>)}
              </select>
              <div className="flex items-center gap-2 px-3 py-2.5 rounded" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
                <input type="text" inputMode="numeric" value={building.levelsCount} onChange={e => setBuilding({ ...building, levelsCount: e.target.value })}
                  className="w-10 bg-transparent text-sm" style={{ color: C.chalk }} />
                <span className="text-[11px]" style={{ color: C.mute }}>nível(is)</span>
              </div>
            </div>
          </div>
          <button onClick={handleCreateBuilding} disabled={busy || !building.name.trim()}
            className="w-full py-4 rounded-2xl text-base font-semibold flex items-center justify-center gap-2 mt-5"
            style={{ background: "#F2F1ED", color: "#141311", opacity: busy || !building.name.trim() ? 0.6 : 1 }}>
            Ir para o croqui <ArrowUpRight size={18} style={{ transform: "rotate(45deg)" }} />
          </button>
          <button onClick={() => setStep("start")} className="w-full text-[11px] mt-3" style={{ color: C.muteDim }}>← Voltar</button>
        </div>
      </div>
    );
  }

  return (
    <div className="braves-app-root relative w-full min-h-screen flex flex-col items-center justify-center p-6 overflow-hidden" style={METAL_BG}>
      <Watermark />
      <div className="relative w-full max-w-sm mt-16">
        <div className="braves-anim-in flex flex-col items-center gap-4 mb-7" style={{ animationDelay: "0s" }}>
          <img src={SYMBOL_LOGO} alt="Braves BIM Field" className="braves-logo-build" style={{ height: 132, width: "auto" }} />
          <div className="text-center">
            <div style={{ ...heading, color: C.chalk, fontSize: "26px", letterSpacing: "0.01em", fontWeight: 800 }}>
              <span className="braves-text-write-wrap">
                <span className="braves-text-write">BRAVES BIM FIELD</span>
                <span className="braves-text-cursor" />
              </span>
            </div>
            <div className="text-[11px] mt-1.5" style={{ color: C.mute, letterSpacing: "0.18em" }}>PROJETOS E CONSTRUÇÕES EFICIENTES</div>
          </div>
        </div>

        <div className="braves-anim-in flex items-center gap-3 mb-7" style={{ animationDelay: "0.1s" }}>
          <div style={{ flex: 1, height: 1, background: C.line }} />
          <span className="text-sm" style={{ color: C.mute }}>Prancheta BIM de campo</span>
          <div style={{ flex: 1, height: 1, background: C.line }} />
        </div>

        <div className="braves-anim-in" style={{ animationDelay: "0.18s" }}>
          <div className="text-sm mb-3" style={{ color: C.mute }}>Este dispositivo é um</div>
          <div className="grid grid-cols-2 gap-3 mb-6">
            {[{ id: "tablet", label: "Tablet", sub: "Para visualizar plantas", Icon: Tablet }, { id: "phone", label: "Celular", sub: "Para fotos de campo", Icon: Smartphone }].map(({ id, label, sub, Icon }) => (
              <button key={id} onClick={() => setRole(id)} className="relative py-7 rounded-2xl flex flex-col items-center gap-2.5"
                style={{ background: C.panel, border: `1px solid ${role === id ? "rgba(255,255,255,0.35)" : C.line}` }}>
                <CornerBrackets active={role === id} />
                <Icon size={30} color={role === id ? C.gold : C.chalk} strokeWidth={1.5} />
                <div className="text-center">
                  <div className="text-base font-semibold" style={{ color: C.chalk }}>{label}</div>
                  <div className="text-[11px] mt-0.5" style={{ color: C.mute }}>{sub}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="braves-anim-in" style={{ animationDelay: "0.26s" }}>
          <div className="grid grid-cols-2 gap-2.5 mb-3">
            <button onClick={() => setMode("create")} className="py-3.5 rounded-xl text-sm font-medium"
              style={{ background: mode === "create" ? C.goldTint : "transparent", color: mode === "create" ? C.gold : C.chalk, border: `1px solid ${mode === "create" ? "#FFFFFF" : C.line}` }}>Novo levantamento</button>
            <button onClick={() => setMode("join")} className="py-3.5 rounded-xl text-sm font-medium"
              style={{ background: mode === "join" ? C.goldTint : "transparent", color: mode === "join" ? C.gold : C.chalk, border: `1px solid ${mode === "join" ? "#FFFFFF" : C.line}` }}>Meus Projetos</button>
          </div>
          {mode === "join" && (
            <>
              <input value={code} onChange={e => setCode(e.target.value)} placeholder="Código do projeto (ex: 7K2P)"
                className="w-full mb-3 px-3 py-2.5 rounded-xl text-sm uppercase" style={{ ...mono, background: C.panel, color: C.chalk, border: `1px solid ${C.line}` }} />
              {savedProjects.length > 0 && (
                <div className="mb-3">
                  <div className="text-[10px] mb-1.5" style={{ color: C.mute, letterSpacing: "0.06em" }}>OU ESCOLHA UM LEVANTAMENTO SALVO NESTE APARELHO</div>
                  <div className="space-y-1.5 max-h-52 overflow-y-auto">
                    {savedProjects.map(p => (
                      <button key={p.code} onClick={() => handleJoinExisting(p.code)}
                        className="w-full text-left p-2.5 rounded-xl flex items-center gap-2" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
                        <Building2 size={15} color={C.gold} />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs truncate" style={{ color: C.chalk }}>{p.name}</div>
                          <div className="text-[10px] truncate" style={{ color: C.mute }}>{p.address || "sem endereço"} · {p.roomsCount || 0} ambiente(s)</div>
                        </div>
                        <span className="text-[10px] shrink-0" style={{ ...mono, color: C.gold }}>{p.code}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
          <button onClick={mode === "create" ? goToBuilding : () => handleJoinExisting()} disabled={busy || (mode === "join" && !code.trim())}
            className="w-full py-4 rounded-2xl text-base font-semibold flex items-center justify-center gap-2 mt-2"
            style={{ background: "#F2F1ED", color: "#141311", opacity: busy || (mode === "join" && !code.trim()) ? 0.6 : 1 }}>
            Continuar <ArrowUpRight size={18} style={{ transform: "rotate(45deg)" }} />
          </button>
        </div>
      </div>
    </div>
  );
}
