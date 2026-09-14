using System.Collections.Generic;

namespace BravesBimFieldImporter
{
    // Mirrors the JSON produced by buildSchema()/exportJSON() in the web app
    // (Sincronização → JSON). Only the fields this add-in actually uses are
    // declared; Newtonsoft.Json ignores anything else in the file.

    public class LevantamentoSchema
    {
        public int schema_version;
        public ProjetoInfo projeto;
        public List<NivelInfo> niveis;
        public List<CoberturaInfo> coberturas;
    }

    public class ProjetoInfo
    {
        public string empresa;
        public string codigo;
        public string nome;
        public string unidade;
    }

    public class NivelInfo
    {
        public string id;
        public string nome;
        public double cota_m;
        public double pe_direito_padrao_m;
        public List<ParedeInfo> paredes;
        public List<PortaInfo> portas;
        public List<JanelaInfo> janelas;
        public List<EscadaInfo> escadas;
        public List<LuminariaInfo> luminarias;
        public List<AmbienteCroquiInfo> ambientes_croqui;
    }

    public class ParedeInfo
    {
        public string id;
        public string tag;
        public double x1, y1, x2, y2;
        public double altura_m;
        public string tipo;
        public string condicao;
        // Reforma markers from the app's Croqui (mutually exclusive there) —
        // see LevantamentoImporter.ApplyReformaPhase for how these become
        // Revit's own Phase Created/Phase Demolished parameters.
        public bool demolir;
        public bool construir;
    }

    public class PortaInfo
    {
        public string id;
        public string tag;
        public string parede_id;
        public double x, y;
        public double largura_m, altura_m;
        public int folhas;
        public string tipo;
        public bool demolir;
        public bool construir;
    }

    public class JanelaInfo
    {
        public string id;
        public string tag;
        public string parede_id;
        public double x, y;
        public double largura_m, altura_m, peitoril_m;
        public int folhas;
        public string tipo;
        public bool demolir;
        public bool construir;
    }

    public class PontoInfo
    {
        public double x, y;
    }

    public class AmbienteCroquiInfo
    {
        public string id;
        public string ambiente_id;
        public string nome;
        public double area_m2;
        public List<PontoInfo> pontos;
        public string acabamento_piso;
        public string cor_piso;
        public string acabamento_forro;
    }

    public class EscadaInfo
    {
        public string id;
        public string tag;
        public double x1, y1, x2, y2;
        public double largura_m;
        public string nivel_destino_id;
        public bool tem_patamar;
        public double posicao_patamar;
        public double altura_patamar_m;
    }

    public class LuminariaInfo
    {
        public string id;
        public string tag;
        public double x, y;
    }

    // Coberturas have no real footprint/shape in the app yet — just a name,
    // the level they sit over, and a list of "águas" (roof planes), each with
    // a slope angle and area as free text typed by the user. See the roof
    // creation code in LevantamentoImporter for how this necessarily
    // approximate data gets turned into actual Revit roof geometry.
    public class CoberturaInfo
    {
        public string id;
        public string name;
        public string level;
        public List<AguaInfo> aguas;
    }

    public class AguaInfo
    {
        public string id;
        public string inclinacao;
        public string area;
    }
}
