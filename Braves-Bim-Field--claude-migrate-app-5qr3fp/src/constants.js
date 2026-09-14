// Dropdown option lists shared between App.jsx (VectorSketch's Croqui tool
// and the Elementos tab) and ElementRows.jsx (the per-element edit rows) —
// kept in their own module so neither file has to import these from the
// other.
export const WALL_TYPES = ["Alvenaria 15cm", "Alvenaria 20cm", "Concreto", "Drywall", "Vidro"];
const WALL_THICKNESS_M = { "Alvenaria 15cm": 0.15, "Alvenaria 20cm": 0.20, "Concreto": 0.20, "Drywall": 0.10, "Vidro": 0.10 };
export function wallThicknessM(wallType) { return WALL_THICKNESS_M[wallType] ?? 0.15; }
export const FINISH_TYPES = ["A definir", "Pintura", "Reboco sem pintura", "Sem reboco (aparente)", "Revestimento cerâmico", "Textura acrílica"];
export const DOOR_TYPES = ["Madeira maciça", "Madeira semi-oca", "Alumínio", "Vidro temperado", "Correr — alumínio", "Correr — vidro", "Pivotante", "Sanfonada", "Camarão", "Blindada"];
export const WINDOW_TYPES = ["Alumínio de correr", "Vidro de correr", "Basculante", "Maxim-ar", "Vidro fixo", "Guilhotina", "Veneziana", "Pivotante"];
export const FLOOR_TYPES = ["Porcelanato", "Cerâmica", "Contrapiso aparente", "Madeira/Laminado", "Vinílico", "A definir"];
export const CEILING_TYPES = ["Laje aparente", "Forro de gesso", "Forro em PVC", "Forro mineral (lay-in)", "A definir"];
