using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Architecture;
using Autodesk.Revit.DB.Structure;

namespace BravesBimFieldImporter
{
    public class ImportResult
    {
        public int Niveis, Paredes, Portas, Janelas, Ambientes, Escadas, Luminarias, Coberturas;

        // Counts openings where no loaded Revit family/type really matched the
        // surveyed "tipo"/"folhas" — a generic stand-in was used instead. The
        // real values are never lost even then: they're written to each
        // element's "Comentários" field. See PickBestSymbol/SetSurveyComments.
        public int PortasParaRevisar, JanelasParaRevisar;

        // No lighting fixture family loaded in the project at all — the
        // luminária was skipped entirely (nothing to place it with).
        public int LuminariasIgnoradas;

        // A stair whose "nivel_destino_id" doesn't match any level in this
        // same survey (so there's no top level to build the run up to).
        public int EscadasIgnoradas;

        // How many walls/doors/windows came marked "Demolir"/"À construir" in
        // the survey and got Revit's own Phase Demolished/Phase Created set
        // accordingly. See LevantamentoImporter.ApplyReformaPhase.
        public int MarcadosDemolir, MarcadosConstruir;

        // The target project has fewer than 2 phases set up (Manage > Phases),
        // so there was no "existing" phase to assign demolished elements to
        // and no "current" phase for new ones — Demolir/À construir markers
        // from the survey were skipped instead of guessed at.
        public bool FasesIndisponiveis;

        public override string ToString()
        {
            string revisar = (PortasParaRevisar + JanelasParaRevisar) > 0
                ? $"\n\n⚠ {PortasParaRevisar + JanelasParaRevisar} porta(s)/janela(s) sem família correspondente no projeto — " +
                  "o tipo/folhas real do levantamento foi gravado no campo \"Comentários\" de cada uma; ajuste a família manualmente."
                : "";
            string luminariasMsg = LuminariasIgnoradas > 0
                ? $"\n⚠ {LuminariasIgnoradas} luminária(s) ignorada(s) — nenhuma família de luminária carregada no projeto."
                : "";
            string escadasMsg = EscadasIgnoradas > 0
                ? $"\n⚠ {EscadasIgnoradas} escada(s) ignorada(s) — nível de destino não encontrado."
                : "";
            string reformaMsg = FasesIndisponiveis
                ? "\n⚠ O projeto precisa de pelo menos 2 fases (Gerenciar → Fases) para aplicar as marcações de Demolir/À construir do levantamento — nenhuma foi aplicada."
                : (MarcadosDemolir + MarcadosConstruir) > 0
                    ? $"\n{MarcadosDemolir} elemento(s) marcado(s) para demolir e {MarcadosConstruir} para construir (fases do Revit)."
                    : "";
            return $"{Niveis} nível(is)\n{Paredes} parede(s)\n{Portas} porta(s)\n{Janelas} janela(s)\n{Ambientes} ambiente(s)\n" +
                   $"{Escadas} escada(s)\n{Luminarias} luminária(s)\n{Coberturas} cobertura(s)" + revisar + luminariasMsg + escadasMsg + reformaMsg;
        }
    }

    // Shared by both the file-based and the cloud-based (Firestore) import
    // commands. Creates: Levels, Walls, Doors, Windows, Rooms (from closed
    // "ambiente" outlines drawn in the app's Croqui, also carrying their
    // floor/ceiling finish text onto the Room's own finish parameters),
    // Luminárias (lighting fixture instances), Escadas (stairs) and
    // Coberturas (roofs).
    //
    // Re-importing the same project updates existing elements in place instead
    // of duplicating them: every wall/door/window/room/luminária/roof created
    // by this add-in gets a hidden "[[categoria:id]]" token written into its
    // Comentários field (see SetToken/ExtractToken), matching the schema's own
    // stable ids. On a later import, an element whose token is found is
    // updated (position, type, dimensions) rather than recreated. Stairs are
    // the one exception — editing an existing Stairs assembly's sketched
    // geometry in place isn't practical here, so a re-import instead deletes
    // and recreates any stair it previously created (see ImportarEscadas).
    // Elements removed from the survey since the last import are NOT
    // auto-deleted from Revit — that's left to the user, to avoid silently
    // discarding anything they may have adjusted in Revit.
    public static class LevantamentoImporter
    {
        public static ImportResult Importar(Document doc, LevantamentoSchema schema)
        {
            if (schema?.niveis == null || schema.niveis.Count == 0)
                throw new InvalidOperationException("O levantamento não contém níveis para importar.");

            var result = new ImportResult { Niveis = schema.niveis.Count };
            // Declared outside the transaction below so the stairs pass, which
            // needs its own StairsEditScope (and therefore can't run inside
            // that transaction), still has the level id mapping afterwards.
            Dictionary<string, ElementId> levelIdByNivelId;

            using (Transaction tx = new Transaction(doc, "Importar levantamento Braves BIM Field"))
            {
                tx.Start();
                try
                {
                    levelIdByNivelId = MapOrCreateLevels(doc, schema.niveis);

                    // Demolir/À construir from the app become Revit's own Phase
                    // Demolished/Phase Created — the earliest project phase stands in
                    // for "existing" and the latest for "current/new work", regardless
                    // of how they're actually named (every real renovation project has
                    // at least an "Existing"-like and a "New Construction"-like phase;
                    // a project with only one phase has no meaningful "before/after" to
                    // assign, so phasing is skipped rather than guessed at — see
                    // ImportResult.FasesIndisponiveis).
                    Phase existingPhase = doc.Phases.Size > 0 ? doc.Phases.get_Item(0) : null;
                    Phase currentPhase = doc.Phases.Size > 0 ? doc.Phases.get_Item(doc.Phases.Size - 1) : null;
                    bool phasingAvailable = existingPhase != null && currentPhase != null && existingPhase.Id != currentPhase.Id;

                    ElementId defaultWallTypeId = doc.GetDefaultElementTypeId(ElementTypeGroup.WallType);
                    Dictionary<string, ElementId> wallTypesByName = new FilteredElementCollector(doc)
                        .OfClass(typeof(WallType)).Cast<WallType>()
                        .GroupBy(w => w.Name, StringComparer.OrdinalIgnoreCase)
                        .ToDictionary(g => g.Key, g => g.First().Id, StringComparer.OrdinalIgnoreCase);

                    // Cache every loaded door/window type once — each opening below picks
                    // whichever of these best matches its own "tipo"/"folhas" (e.g. a
                    // "Correr — alumínio" door with folhas=4 favors a loaded type whose
                    // family/type name mentions "correr" and "4 folhas").
                    List<FamilySymbol> doorSymbols = new FilteredElementCollector(doc)
                        .OfClass(typeof(FamilySymbol)).OfCategory(BuiltInCategory.OST_Doors)
                        .Cast<FamilySymbol>().ToList();
                    List<FamilySymbol> windowSymbols = new FilteredElementCollector(doc)
                        .OfClass(typeof(FamilySymbol)).OfCategory(BuiltInCategory.OST_Windows)
                        .Cast<FamilySymbol>().ToList();
                    List<FamilySymbol> lightingSymbols = new FilteredElementCollector(doc)
                        .OfClass(typeof(FamilySymbol)).OfCategory(BuiltInCategory.OST_LightingFixtures)
                        .Cast<FamilySymbol>().ToList();

                    // Index elements created by a previous import of this project, by the
                    // hidden id token in their Comentários — so this pass can update them
                    // in place instead of creating duplicates on top.
                    Dictionary<string, ElementId> existingWallsByToken = IndexExistingByToken(doc, BuiltInCategory.OST_Walls, "parede");
                    Dictionary<string, ElementId> existingDoorsByToken = IndexExistingByToken(doc, BuiltInCategory.OST_Doors, "porta");
                    Dictionary<string, ElementId> existingWindowsByToken = IndexExistingByToken(doc, BuiltInCategory.OST_Windows, "janela");
                    Dictionary<string, ElementId> existingRoomsByToken = IndexExistingByToken(doc, BuiltInCategory.OST_Rooms, "ambiente");
                    Dictionary<string, ElementId> existingLuminariasByToken = IndexExistingByToken(doc, BuiltInCategory.OST_LightingFixtures, "luminaria");
                    Dictionary<string, ElementId> existingRoofsByToken = IndexExistingByToken(doc, BuiltInCategory.OST_Roofs, "cobertura");

                    // Per-size duplicated door/window types created by
                    // ApplyOpeningSize below, keyed per this one import run —
                    // ElementIds aren't valid across documents, so this can't
                    // be a static/shared cache (a real type-with-this-name
                    // lookup inside GetOrCreateSizedSymbol is what actually
                    // makes duplicates persist correctly across re-imports).
                    var sizedSymbolCache = new Dictionary<string, ElementId>();

                    // Level name -> id, for coberturas (which reference a level by
                    // NAME, not id — see CoberturaInfo.level).
                    var levelIdByName = schema.niveis
                        .GroupBy(n => n.nome, StringComparer.OrdinalIgnoreCase)
                        .ToDictionary(g => g.Key, g => levelIdByNivelId[g.First().id], StringComparer.OrdinalIgnoreCase);

                    // Pass 1: walls (so pass 2 has a host wall to place doors/windows on).
                    // Also collects each level's wall endpoints, since that's the only
                    // footprint data available to approximate a roof over it later.
                    var wallIdByParedeId = new Dictionary<string, ElementId>();
                    var wallPointsByNivelId = new Dictionary<string, List<XYZ>>();
                    foreach (NivelInfo nivel in schema.niveis)
                    {
                        ElementId levelId = levelIdByNivelId[nivel.id];
                        double defaultHeightFeet = MetersToFeet(nivel.pe_direito_padrao_m > 0 ? nivel.pe_direito_padrao_m : 2.8);
                        var wallPoints = new List<XYZ>();

                        foreach (ParedeInfo parede in nivel.paredes ?? new List<ParedeInfo>())
                        {
                            XYZ p1 = new XYZ(MetersToFeet(parede.x1), MetersToFeet(parede.y1), 0);
                            XYZ p2 = new XYZ(MetersToFeet(parede.x2), MetersToFeet(parede.y2), 0);
                            if (p1.DistanceTo(p2) < 0.01) continue;
                            wallPoints.Add(p1); wallPoints.Add(p2);

                            ElementId wallTypeId = (!string.IsNullOrEmpty(parede.tipo) && wallTypesByName.TryGetValue(parede.tipo, out ElementId wtId))
                                ? wtId : defaultWallTypeId;
                            double heightFeet = parede.altura_m > 0 ? MetersToFeet(parede.altura_m) : defaultHeightFeet;

                            Wall wall = null;
                            if (!string.IsNullOrEmpty(parede.id) && existingWallsByToken.TryGetValue(parede.id, out ElementId existingWallId))
                                wall = doc.GetElement(existingWallId) as Wall;

                            if (wall != null)
                            {
                                if (wall.Location is LocationCurve lc)
                                    lc.Curve = Line.CreateBound(p1, p2);
                                if (wall.GetTypeId() != wallTypeId)
                                {
                                    ElementId changedId = wall.ChangeTypeId(wallTypeId);
                                    if (changedId != ElementId.InvalidElementId && changedId != wall.Id)
                                        wall = doc.GetElement(changedId) as Wall;
                                }
                                wall.get_Parameter(BuiltInParameter.WALL_USER_HEIGHT_PARAM)?.Set(heightFeet);
                            }
                            else
                            {
                                wall = Wall.Create(doc, Line.CreateBound(p1, p2), wallTypeId, levelId, heightFeet, 0, false, false);
                            }

                            SetMark(wall, parede.tag);
                            SetToken(wall, "parede", parede.id);
                            ApplyReformaPhase(wall, parede.demolir, parede.construir, existingPhase, currentPhase, phasingAvailable, result);
                            wallIdByParedeId[parede.id] = wall.Id;
                            result.Paredes++;
                        }

                        wallPointsByNivelId[nivel.id] = wallPoints;
                    }

                    doc.Regenerate();

                    // Pass 2: doors, windows, rooms.
                    foreach (NivelInfo nivel in schema.niveis)
                    {
                        Level level = doc.GetElement(levelIdByNivelId[nivel.id]) as Level;

                        foreach (PortaInfo porta in nivel.portas ?? new List<PortaInfo>())
                        {
                            FamilySymbol doorSymbol = PickBestSymbol(doorSymbols, porta.tipo, porta.folhas, out bool doorMatched);
                            if (doorSymbol == null || !wallIdByParedeId.TryGetValue(porta.parede_id, out ElementId hostId)) continue;
                            Wall host = doc.GetElement(hostId) as Wall;
                            XYZ pos = new XYZ(MetersToFeet(porta.x), MetersToFeet(porta.y), level.Elevation);

                            FamilyInstance inst = UpdateOrRecreateOpening(
                                doc, existingDoorsByToken, porta.id, hostId, doorSymbol,
                                () => doc.Create.NewFamilyInstance(pos, doorSymbol, host, level, StructuralType.NonStructural),
                                pos);

                            inst = ApplyOpeningSize(doc, inst,
                                new[] { "Width", "Largura", "Largura da porta" }, new[] { "Height", "Altura", "Altura da porta" },
                                porta.largura_m, porta.altura_m, sizedSymbolCache);
                            SetMark(inst, porta.tag);
                            SetSurveyComments(inst, "porta", porta.id, porta.tipo, porta.folhas, porta.largura_m, porta.altura_m, null, doorMatched);
                            ApplyReformaPhase(inst, porta.demolir, porta.construir, existingPhase, currentPhase, phasingAvailable, result);
                            if (!doorMatched) result.PortasParaRevisar++;
                            result.Portas++;
                        }

                        foreach (JanelaInfo janela in nivel.janelas ?? new List<JanelaInfo>())
                        {
                            FamilySymbol windowSymbol = PickBestSymbol(windowSymbols, janela.tipo, janela.folhas, out bool windowMatched);
                            if (windowSymbol == null || !wallIdByParedeId.TryGetValue(janela.parede_id, out ElementId hostId)) continue;
                            Wall host = doc.GetElement(hostId) as Wall;
                            double sillFeet = MetersToFeet(janela.peitoril_m);
                            XYZ pos = new XYZ(MetersToFeet(janela.x), MetersToFeet(janela.y), level.Elevation + sillFeet);

                            FamilyInstance inst = UpdateOrRecreateOpening(
                                doc, existingWindowsByToken, janela.id, hostId, windowSymbol,
                                () => doc.Create.NewFamilyInstance(pos, windowSymbol, host, level, StructuralType.NonStructural),
                                pos);

                            inst = ApplyOpeningSize(doc, inst,
                                new[] { "Width", "Largura", "Largura da janela" }, new[] { "Height", "Altura", "Altura da janela" },
                                janela.largura_m, janela.altura_m, sizedSymbolCache);
                            SetMark(inst, janela.tag);
                            SetSurveyComments(inst, "janela", janela.id, janela.tipo, janela.folhas, janela.largura_m, janela.altura_m, janela.peitoril_m, windowMatched);
                            ApplyReformaPhase(inst, janela.demolir, janela.construir, existingPhase, currentPhase, phasingAvailable, result);
                            if (!windowMatched) result.JanelasParaRevisar++;
                            result.Janelas++;
                        }

                        foreach (AmbienteCroquiInfo ambiente in nivel.ambientes_croqui ?? new List<AmbienteCroquiInfo>())
                        {
                            if (ambiente.pontos == null || ambiente.pontos.Count < 3) continue;
                            double cx = ambiente.pontos.Average(p => p.x);
                            double cy = ambiente.pontos.Average(p => p.y);
                            try
                            {
                                Room room = null;
                                if (!string.IsNullOrEmpty(ambiente.id) && existingRoomsByToken.TryGetValue(ambiente.id, out ElementId existingRoomId))
                                    room = doc.GetElement(existingRoomId) as Room;

                                // A previously-imported Room that's still validly placed tracks its
                                // host walls automatically (Revit recomputes its boundary at Regenerate
                                // when they move) — no need to recreate it. Only make a new one if it's
                                // missing (deleted in Revit) or fell outside its wall loop (Area <= 0).
                                if (room == null || room.Area <= 0)
                                    room = doc.Create.NewRoom(level, new UV(MetersToFeet(cx), MetersToFeet(cy)));

                                if (room != null)
                                {
                                    if (!string.IsNullOrEmpty(ambiente.nome))
                                        room.get_Parameter(BuiltInParameter.ROOM_NAME)?.Set(ambiente.nome);
                                    // Floor/ceiling finish are free text in the app (a pick from a fixed
                                    // list, not a real Revit Material) — written onto the Room's own
                                    // native "Floor Finish"/"Ceiling Finish" parameters, which is what
                                    // Revit itself uses for exactly this kind of descriptive finish data.
                                    if (!string.IsNullOrEmpty(ambiente.acabamento_piso) && ambiente.acabamento_piso != "A definir")
                                        room.get_Parameter(BuiltInParameter.ROOM_FINISH_FLOOR)?.Set(ambiente.acabamento_piso);
                                    if (!string.IsNullOrEmpty(ambiente.acabamento_forro) && ambiente.acabamento_forro != "A definir")
                                        room.get_Parameter(BuiltInParameter.ROOM_FINISH_CEILING)?.Set(ambiente.acabamento_forro);
                                    SetToken(room, "ambiente", ambiente.id);
                                    result.Ambientes++;
                                }
                            }
                            catch
                            {
                                // No closed wall loop at this point yet (e.g. missing wall) — skip rather than fail the whole import.
                            }
                        }

                        foreach (LuminariaInfo luminaria in nivel.luminarias ?? new List<LuminariaInfo>())
                        {
                            if (lightingSymbols.Count == 0) { result.LuminariasIgnoradas++; continue; }
                            FamilySymbol symbol = lightingSymbols[0];
                            if (!symbol.IsActive) symbol.Activate();
                            // Luminárias are drawn on the Planta de Forro (ceiling plan), so they
                            // belong at ceiling height, not floor level.
                            double ceilingElevation = level.Elevation + MetersToFeet(nivel.pe_direito_padrao_m > 0 ? nivel.pe_direito_padrao_m : 2.8);
                            XYZ pos = new XYZ(MetersToFeet(luminaria.x), MetersToFeet(luminaria.y), ceilingElevation);

                            try
                            {
                                FamilyInstance inst = null;
                                if (!string.IsNullOrEmpty(luminaria.id) && existingLuminariasByToken.TryGetValue(luminaria.id, out ElementId existingId))
                                    inst = doc.GetElement(existingId) as FamilyInstance;

                                if (inst != null)
                                {
                                    if (inst.Symbol.Id != symbol.Id)
                                    {
                                        ElementId changedId = inst.ChangeTypeId(symbol.Id);
                                        if (changedId != ElementId.InvalidElementId && changedId != inst.Id)
                                            inst = doc.GetElement(changedId) as FamilyInstance;
                                    }
                                    if (inst.Location is LocationPoint lp) lp.Point = pos;
                                }
                                else
                                {
                                    // Most lighting fixture families are standalone (placement-based),
                                    // not face-hosted — this is the common case. A family that
                                    // specifically requires a ceiling/face host will throw here and
                                    // that one luminária is skipped rather than failing the import.
                                    inst = doc.Create.NewFamilyInstance(pos, symbol, level, StructuralType.NonStructural);
                                }

                                SetMark(inst, luminaria.tag);
                                SetToken(inst, "luminaria", luminaria.id);
                                result.Luminarias++;
                            }
                            catch
                            {
                                result.LuminariasIgnoradas++;
                            }
                        }
                    }

                    // Pass 3: coberturas. No real footprint/shape is surveyed for a roof
                    // today (see CoberturaInfo) — only its name, the level it sits over,
                    // and each "água" (roof plane)'s slope/area as free text. The closest
                    // approximation available is the bounding box of that level's own
                    // walls, sloped uniformly by the first água's angle; every água's
                    // real slope/area is preserved in Comentários regardless, same as
                    // door/window "tipo" when no matching family exists.
                    ElementId defaultRoofTypeId = doc.GetDefaultElementTypeId(ElementTypeGroup.RoofType);
                    RoofType defaultRoofType = doc.GetElement(defaultRoofTypeId) as RoofType;
                    foreach (CoberturaInfo cobertura in schema.coberturas ?? new List<CoberturaInfo>())
                    {
                        if (string.IsNullOrEmpty(cobertura.level) || !levelIdByName.TryGetValue(cobertura.level, out ElementId roofLevelId))
                            continue;
                        NivelInfo roofNivel = schema.niveis.FirstOrDefault(n => levelIdByNivelId[n.id] == roofLevelId);
                        if (roofNivel == null || !wallPointsByNivelId.TryGetValue(roofNivel.id, out List<XYZ> points) || points.Count == 0)
                            continue;

                        try
                        {
                            // A previously-imported roof is always replaced fresh (see the
                            // stairs comment above the class for why edit-in-place isn't
                            // attempted for sketched/profile-based elements here).
                            if (!string.IsNullOrEmpty(cobertura.id) && existingRoofsByToken.TryGetValue(cobertura.id, out ElementId existingRoofId))
                                doc.Delete(existingRoofId);

                            double minX = points.Min(p => p.X), maxX = points.Max(p => p.X);
                            double minY = points.Min(p => p.Y), maxY = points.Max(p => p.Y);
                            if (maxX - minX < 0.01 || maxY - minY < 0.01) continue;

                            Level roofLevel = doc.GetElement(roofLevelId) as Level;
                            CurveArray footprint = new CurveArray();
                            XYZ c1 = new XYZ(minX, minY, 0), c2 = new XYZ(maxX, minY, 0), c3 = new XYZ(maxX, maxY, 0), c4 = new XYZ(minX, maxY, 0);
                            footprint.Append(Line.CreateBound(c1, c2));
                            footprint.Append(Line.CreateBound(c2, c3));
                            footprint.Append(Line.CreateBound(c3, c4));
                            footprint.Append(Line.CreateBound(c4, c1));

                            ModelCurveArray mapping = new ModelCurveArray();
                            FootPrintRoof roof = doc.Create.NewFootPrintRoof(footprint, roofLevel, defaultRoofType, out mapping);

                            AguaInfo firstAgua = cobertura.aguas?.FirstOrDefault();
                            if (firstAgua != null && TryParseNumber(firstAgua.inclinacao, out double slopeDeg) && slopeDeg > 0)
                            {
                                double slopeRatio = Math.Tan(slopeDeg * Math.PI / 180.0);
                                foreach (ModelCurve mc in mapping)
                                {
                                    roof.set_DefinesSlope(mc, true);
                                    roof.set_SlopeAngle(mc, slopeRatio);
                                }
                            }

                            if (!string.IsNullOrEmpty(cobertura.name))
                                roof.LookupParameter("Mark")?.Set(cobertura.name);

                            string aguasText = cobertura.aguas != null && cobertura.aguas.Count > 0
                                ? string.Join(" · ", cobertura.aguas.Select(a => $"{a.inclinacao}° / {a.area} m²"))
                                : "";
                            string comment = $"Levantamento: {cobertura.name} — águas: {aguasText}. " +
                                "Contorno aproximado pelo retângulo envolvente das paredes do nível — ajustar manualmente ao formato real do telhado.";
                            SetToken(roof, "cobertura", cobertura.id, comment);
                            result.Coberturas++;
                        }
                        catch
                        {
                            // Geometry that NewFootPrintRoof rejects (e.g. a degenerate footprint) —
                            // skip this one roof rather than failing the whole import.
                        }
                    }

                    tx.Commit();
                }
                catch
                {
                    tx.RollBack();
                    throw;
                }
            }

            // Stairs need their own StairsEditScope, which manages its own
            // transaction(s) internally and can't be opened while another
            // transaction (like the one above) is active — so this pass runs
            // as a separate step, after the rest of the import has committed.
            ImportarEscadas(doc, schema, levelIdByNivelId, result);

            return result;
        }

        // A previously-imported stair (by its hidden token) is always deleted
        // and recreated rather than edited in place — re-entering a
        // StairsEditScope on an existing sketched Stairs assembly to add/
        // replace just its run is a lot more failure-prone here (and much
        // harder to get right without ever compiling against real Revit)
        // than simply rebuilding it fresh each time, which is safe since nothing
        // else in the model hosts off of a stair the way walls host doors.
        private static void ImportarEscadas(Document doc, LevantamentoSchema schema, Dictionary<string, ElementId> levelIdByNivelId, ImportResult result)
        {
            Dictionary<string, ElementId> existingStairsByToken = IndexExistingByToken(doc, BuiltInCategory.OST_Stairs, "escada");

            foreach (NivelInfo nivel in schema.niveis)
            {
                foreach (EscadaInfo escada in nivel.escadas ?? new List<EscadaInfo>())
                {
                    if (string.IsNullOrEmpty(escada.nivel_destino_id) || !levelIdByNivelId.TryGetValue(escada.nivel_destino_id, out ElementId topLevelId))
                    {
                        result.EscadasIgnoradas++;
                        continue;
                    }
                    ElementId baseLevelId = levelIdByNivelId[nivel.id];

                    XYZ p1 = new XYZ(MetersToFeet(escada.x1), MetersToFeet(escada.y1), 0);
                    XYZ p2 = new XYZ(MetersToFeet(escada.x2), MetersToFeet(escada.y2), 0);
                    if (p1.DistanceTo(p2) < 0.01) { result.EscadasIgnoradas++; continue; }

                    if (!string.IsNullOrEmpty(escada.id) && existingStairsByToken.TryGetValue(escada.id, out ElementId existingStairsId))
                    {
                        using (Transaction delTx = new Transaction(doc, "Remover escada anterior do levantamento"))
                        {
                            delTx.Start();
                            try { doc.Delete(existingStairsId); } catch { /* already gone */ }
                            delTx.Commit();
                        }
                    }

                    // StairsEditScope has no RollBack() (unlike Transaction) — wrapping it
                    // in "using" instead means an exception thrown before Commit() still
                    // discards the in-progress edit correctly via Dispose().
                    using (StairsEditScope editScope = new StairsEditScope(doc, "Criar escada do levantamento"))
                    {
                        try
                        {
                            ElementId stairsId = editScope.Start(baseLevelId, topLevelId);
                            using (Transaction runTx = new Transaction(doc, "Criar lance de escada"))
                            {
                                runTx.Start();
                                Line locationLine = Line.CreateBound(p1, p2);
                                StairsRun.CreateStraightRun(doc, stairsId, locationLine, StairsRunJustification.Center);
                                runTx.Commit();
                            }
                            editScope.Commit(new SilentFailuresPreprocessor());

                            Stairs stairs = doc.GetElement(stairsId) as Stairs;
                            if (stairs != null)
                            {
                                using (Transaction tagTx = new Transaction(doc, "Marcar escada do levantamento"))
                                {
                                    tagTx.Start();
                                    SetMark(stairs, escada.tag);
                                    // Actual run width and the surveyed landing (position/height along
                                    // the run) aren't set on the created geometry — a real landing
                                    // needs a second run plus a turn direction the survey doesn't
                                    // capture (just one straight line), so it's recorded here instead
                                    // of guessed at.
                                    string landingInfo = escada.tem_patamar
                                        ? $" · com patamar a {escada.posicao_patamar:0.00} do trajeto, altura {escada.altura_patamar_m:0.00} m (não modelado — ajustar manualmente)"
                                        : "";
                                    string comment = $"Levantamento: largura {escada.largura_m:0.00} m{landingInfo}.";
                                    SetToken(stairs, "escada", escada.id, comment);
                                    tagTx.Commit();
                                }
                            }
                            result.Escadas++;
                        }
                        catch
                        {
                            result.EscadasIgnoradas++;
                        }
                    }
                }
            }
        }

        // Suppresses Revit's interactive warning dialogs while a Stairs edit
        // scope commits (e.g. "stair doesn't reach the top level exactly") so
        // a scripted import never blocks on a popup — those warnings are
        // exactly the kind of thing the README already asks the user to
        // review and adjust by hand afterwards.
        private class SilentFailuresPreprocessor : IFailuresPreprocessor
        {
            public FailureProcessingResult PreprocessFailures(FailuresAccessor failuresAccessor)
            {
                foreach (FailureMessageAccessor failure in failuresAccessor.GetFailureMessages())
                    failuresAccessor.DeleteWarning(failure);
                return FailureProcessingResult.Continue;
            }
        }

        private static Dictionary<string, ElementId> MapOrCreateLevels(Document doc, List<NivelInfo> niveis)
        {
            var existing = new FilteredElementCollector(doc).OfClass(typeof(Level)).Cast<Level>().ToList();
            var result = new Dictionary<string, ElementId>();

            foreach (NivelInfo nivel in niveis)
            {
                double elevFeet = MetersToFeet(nivel.cota_m);
                double toleranceFeet = MetersToFeet(0.05);

                Level match = existing.FirstOrDefault(l =>
                    string.Equals(l.Name, nivel.nome, StringComparison.OrdinalIgnoreCase) ||
                    Math.Abs(l.Elevation - elevFeet) < toleranceFeet);

                if (match == null)
                {
                    match = Level.Create(doc, elevFeet);
                    match.Name = nivel.nome;
                    existing.Add(match);
                }

                result[nivel.id] = match.Id;
            }

            return result;
        }

        // Reuses a previously-imported door/window instance (matched by its hidden
        // id token) when it's still hosted on the same wall — repositioning it and
        // swapping its type in place. If the host wall changed (or nothing matched),
        // the old instance (if any) is deleted and a fresh one created via `create`,
        // since Revit doesn't support re-hosting a family instance onto another wall.
        private static FamilyInstance UpdateOrRecreateOpening(
            Document doc, Dictionary<string, ElementId> existingByToken, string id, ElementId hostId,
            FamilySymbol symbol, Func<FamilyInstance> create, XYZ pos)
        {
            FamilyInstance inst = null;
            if (!string.IsNullOrEmpty(id) && existingByToken.TryGetValue(id, out ElementId existingId))
                inst = doc.GetElement(existingId) as FamilyInstance;

            bool sameHost = inst != null && inst.Host != null && inst.Host.Id == hostId;
            if (inst != null && sameHost)
            {
                if (inst.Symbol.Id != symbol.Id)
                {
                    ElementId changedId = inst.ChangeTypeId(symbol.Id);
                    if (changedId != ElementId.InvalidElementId && changedId != inst.Id)
                        inst = doc.GetElement(changedId) as FamilyInstance;
                }
                if (inst.Location is LocationPoint lp)
                    lp.Point = pos;
                return inst;
            }

            if (inst != null)
                doc.Delete(inst.Id);
            return create();
        }

        // Picks whichever loaded family/type best matches the surveyed opening's
        // "tipo" (e.g. "Correr — alumínio") and panel count ("folhas"), by keyword
        // overlap against the family+type name. This is necessarily best-effort:
        // the add-in can't invent a 4-panel sliding door family that isn't loaded
        // in the target Revit project. For reliable matches, load (or rename) door/
        // window types in your template so their names mention the opening style
        // (e.g. "correr") and panel count (e.g. "4 folhas") — same idea as the
        // exact-name matching already used for wall types.
        // `matched` tells the caller whether the chosen family/type actually looks
        // like the surveyed opening (true), or is just a fallback stand-in because
        // nothing loaded in the project resembled it (false) — callers use this to
        // flag the element for manual review, since the real tipo/folhas/dimensões
        // are recorded separately (see SetSurveyComments) regardless either way.
        private static FamilySymbol PickBestSymbol(List<FamilySymbol> symbols, string tipo, int folhas, out bool matched)
        {
            matched = false;
            if (symbols.Count == 0) return null;

            FamilySymbol best = symbols[0];
            string[] keywords = ExtractKeywords(tipo);
            bool hasCriteria = keywords.Length > 0 || folhas > 0;

            if (!hasCriteria)
            {
                matched = true; // nothing specific was surveyed to compare against
            }
            else if (symbols.Count == 1)
            {
                matched = false; // only one type loaded — no way to tell if it actually fits
            }
            else
            {
                int bestScore = 0;
                foreach (FamilySymbol sym in symbols)
                {
                    string name = NormalizeForMatch(sym.Family.Name + " " + sym.Name);
                    int score = keywords.Count(kw => name.Contains(kw)) * 2;
                    if (folhas > 0 && name.Contains("folha") && name.Contains(folhas.ToString(CultureInfo.InvariantCulture)))
                        score += 3;
                    if (score > bestScore) { bestScore = score; best = sym; }
                }
                matched = bestScore > 0;
            }

            if (!best.IsActive) best.Activate();
            return best;
        }

        // The Revit family placed may not really look like what was surveyed (see
        // `matched` above) — so the actual tipo/folhas/dimensões/peitoril are always
        // written out as plain text in "Comentários" too, on every door/window,
        // so that information is never lost even when no matching family exists.
        // The hidden "[[categoria:id]]" token is prepended so a later import can
        // find this exact element again (see SetToken/IndexExistingByToken).
        private static void SetSurveyComments(FamilyInstance inst, string tokenCategory, string id, string tipo, int folhas, double larguraM, double alturaM, double? peitorilM, bool familyMatched)
        {
            var parts = new List<string>();
            if (!string.IsNullOrEmpty(tipo)) parts.Add(tipo);
            if (folhas > 0) parts.Add($"{folhas} folha(s)");
            parts.Add($"{larguraM:0.00}×{alturaM:0.00} m");
            if (peitorilM.HasValue && peitorilM.Value > 0) parts.Add($"peitoril {peitorilM.Value:0.00} m");

            string text = "Levantamento: " + string.Join(" · ", parts);
            if (!familyMatched)
                text += " — família/tipo não encontrado no projeto, AJUSTAR MANUALMENTE.";

            SetToken(inst, tokenCategory, id, text);
        }

        // Writes a hidden "[[categoria:id]]" marker (plus optional visible text)
        // into an element's Comentários field, so a later import recognizes this
        // exact element again instead of creating a duplicate. See ExtractToken.
        private static void SetToken(Element el, string tokenCategory, string id, string extraText = null)
        {
            if (string.IsNullOrEmpty(id)) return;
            string token = $"[[{tokenCategory}:{id}]]";
            string text = string.IsNullOrEmpty(extraText) ? token : $"{token} {extraText}";
            Parameter p = el.get_Parameter(BuiltInParameter.ALL_MODEL_INSTANCE_COMMENTS);
            if (p != null && !p.IsReadOnly) p.Set(text);
        }

        private static string ExtractToken(string comments, string tokenCategory)
        {
            if (string.IsNullOrEmpty(comments)) return null;
            string marker = $"[[{tokenCategory}:";
            int start = comments.IndexOf(marker, StringComparison.Ordinal);
            if (start < 0) return null;
            start += marker.Length;
            int end = comments.IndexOf("]]", start, StringComparison.Ordinal);
            return end < 0 ? null : comments.Substring(start, end - start);
        }

        // Finds elements this add-in created on a previous import of the same
        // project, by the hidden id token in their Comentários field.
        private static Dictionary<string, ElementId> IndexExistingByToken(Document doc, BuiltInCategory category, string tokenCategory)
        {
            var result = new Dictionary<string, ElementId>();
            foreach (Element el in new FilteredElementCollector(doc).OfCategory(category).WhereElementIsNotElementType())
            {
                string comments = el.get_Parameter(BuiltInParameter.ALL_MODEL_INSTANCE_COMMENTS)?.AsString();
                string id = ExtractToken(comments, tokenCategory);
                if (!string.IsNullOrEmpty(id)) result[id] = el.Id;
            }
            return result;
        }

        private static string[] ExtractKeywords(string tipo)
        {
            if (string.IsNullOrWhiteSpace(tipo)) return Array.Empty<string>();
            return NormalizeForMatch(tipo)
                .Split(new[] { ' ', '-', '(', ')', '/', ',' }, StringSplitOptions.RemoveEmptyEntries)
                .Where(w => w.Length >= 4)
                .ToArray();
        }

        // Lowercases and strips accents (á->a, í->i, ç->c, ã->a, ê->e, ...) so
        // matching doesn't depend on the loaded family's names using the exact
        // same diacritics as the app's own "tipo" strings.
        private static string NormalizeForMatch(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            string decomposed = s.Normalize(NormalizationForm.FormD);
            var sb = new StringBuilder(decomposed.Length);
            foreach (char c in decomposed)
                if (CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark)
                    sb.Append(c);
            return sb.ToString().ToLowerInvariant();
        }

        // Applies a door/window's real surveyed width/height. Brazilian
        // templates often use Portuguese parameter names, and width/height can
        // be either an Instance or a Type parameter depending on the family —
        // LookupParameter on the instance itself only ever finds
        // instance-bound ones, so trying that first and falling back to the
        // type/symbol (as this used to do unconditionally) is how you tell
        // which kind you've got.
        //
        // The bug that fix alone doesn't cover: when it's a Type parameter and
        // the project only has one door/window family loaded, every surveyed
        // door/window gets matched to that same type (see PickBestSymbol) —
        // setting the dimension there directly resizes ALL of them to
        // whichever was imported last, silently making differently-sized
        // openings identical in Revit. So when a dimension can't be set at
        // the instance level, this instance gets its own dedicated type
        // (reusing one already created for this exact size, if a previous
        // opening needed it) instead of resizing the shared one.
        private static FamilyInstance ApplyOpeningSize(Document doc, FamilyInstance inst, string[] widthNames, string[] heightNames, double widthM, double heightM, Dictionary<string, ElementId> sizedSymbolCache)
        {
            bool widthOnInstance = TrySetInstanceDimension(inst, widthNames, widthM);
            bool heightOnInstance = TrySetInstanceDimension(inst, heightNames, heightM);
            if (widthOnInstance && heightOnInstance) return inst;

            FamilySymbol sized = GetOrCreateSizedSymbol(doc, inst.Symbol, widthM, heightM, sizedSymbolCache);
            if (sized != null && sized.Id != inst.Symbol.Id)
            {
                ElementId changedId = inst.ChangeTypeId(sized.Id);
                if (changedId != ElementId.InvalidElementId && changedId != inst.Id)
                    inst = doc.GetElement(changedId) as FamilyInstance;
            }
            if (!widthOnInstance) TrySetTypeDimension(inst.Symbol, widthNames, widthM);
            if (!heightOnInstance) TrySetTypeDimension(inst.Symbol, heightNames, heightM);
            return inst;
        }

        private static FamilySymbol GetOrCreateSizedSymbol(Document doc, FamilySymbol baseSymbol, double widthM, double heightM, Dictionary<string, ElementId> sizedSymbolCache)
        {
            string sizeSuffix = $"{Math.Round(widthM * 100)}x{Math.Round(heightM * 100)}";
            // Strip a size suffix this same method added on a previous import
            // (e.g. re-matching landed on an already-duplicated "Porta - 80x210"
            // as its starting symbol) so re-importing never stacks suffixes
            // into "Porta - 80x210 - 80x210".
            string baseName = Regex.Replace(baseSymbol.Name, @"\s*-\s*\d+x\d+$", "");
            string newName = $"{baseName} - {sizeSuffix}";
            string cacheKey = $"{baseSymbol.Id.IntegerValue}|{sizeSuffix}";

            if (sizedSymbolCache.TryGetValue(cacheKey, out ElementId cachedId) && doc.GetElement(cachedId) is FamilySymbol cached)
                return cached;

            // Reuse a type a previous import already created with this exact
            // name, rather than duplicating again (Duplicate() would throw on
            // the name collision, and there's no reason to make a second one).
            FamilySymbol existing = new FilteredElementCollector(doc)
                .OfClass(typeof(FamilySymbol)).Cast<FamilySymbol>()
                .FirstOrDefault(s => s.Family.Id == baseSymbol.Family.Id && string.Equals(s.Name, newName, StringComparison.OrdinalIgnoreCase));

            FamilySymbol sized = existing ?? (baseSymbol.Duplicate(newName) as FamilySymbol);
            if (sized != null)
            {
                if (!sized.IsActive) sized.Activate();
                sizedSymbolCache[cacheKey] = sized.Id;
            }
            return sized;
        }

        private static bool TrySetInstanceDimension(FamilyInstance inst, string[] candidateNames, double meters)
        {
            if (meters <= 0) return true;
            double feet = MetersToFeet(meters);
            foreach (string name in candidateNames)
            {
                Parameter p = inst.LookupParameter(name);
                if (p != null && !p.IsReadOnly) { p.Set(feet); return true; }
            }
            return false;
        }

        private static void TrySetTypeDimension(FamilySymbol symbol, string[] candidateNames, double meters)
        {
            if (meters <= 0 || symbol == null) return;
            double feet = MetersToFeet(meters);
            foreach (string name in candidateNames)
            {
                Parameter p = symbol.LookupParameter(name);
                if (p != null && !p.IsReadOnly) { p.Set(feet); return; }
            }
        }

        private static void SetMark(Element el, string tag)
        {
            if (string.IsNullOrEmpty(tag)) return;
            el.LookupParameter("Mark")?.Set(tag);
        }

        // Marks a wall/door/window as demolished or newly built by setting
        // Revit's own Phase Created / Phase Demolished instance parameters,
        // the same ones a person would set by hand in the Properties palette —
        // so phase filters, the "Show Previous + Demo" / "Show New" view
        // settings, and each phase's graphic overrides (dashed/halftone for
        // demolished, etc.) all work exactly as they would for phasing set up
        // manually, with no extra view template work needed on the Revit side.
        // "Existing" and "current/new" here are just the project's earliest
        // and latest phases (see phasingAvailable's setup in Importar) — not
        // specific phase names, since those vary project to project.
        private static void ApplyReformaPhase(Element el, bool demolir, bool construir, Phase existingPhase, Phase currentPhase, bool phasingAvailable, ImportResult result)
        {
            if (!demolir && !construir) return;
            if (!phasingAvailable) { result.FasesIndisponiveis = true; return; }

            if (demolir)
            {
                el.get_Parameter(BuiltInParameter.PHASE_CREATED)?.Set(existingPhase.Id);
                el.get_Parameter(BuiltInParameter.PHASE_DEMOLISHED)?.Set(currentPhase.Id);
                result.MarcadosDemolir++;
            }
            else
            {
                el.get_Parameter(BuiltInParameter.PHASE_CREATED)?.Set(currentPhase.Id);
                result.MarcadosConstruir++;
            }
        }

        private static double MetersToFeet(double meters) => UnitUtils.ConvertToInternalUnits(meters, UnitTypeId.Meters);

        // The "água" slope/area fields are free-text input in the app (an
        // empty or partially-typed <input>, not a validated number), so this
        // never throws on bad input — it just reports no value found. Accepts
        // either a dot or a comma as the decimal separator.
        private static bool TryParseNumber(string s, out double value)
        {
            value = 0;
            if (string.IsNullOrWhiteSpace(s)) return false;
            return double.TryParse(s.Replace(',', '.'), NumberStyles.Any, CultureInfo.InvariantCulture, out value);
        }
    }
}
