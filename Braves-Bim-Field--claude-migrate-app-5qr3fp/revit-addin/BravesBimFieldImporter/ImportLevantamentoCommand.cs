using System;
using System.IO;
using System.Windows.Forms;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Newtonsoft.Json;

namespace BravesBimFieldImporter
{
    // Imports from a levantamento_bim.json file exported via the app's
    // Sincronização → JSON button (and transferred to this PC manually).
    // For importing straight from the cloud by project name, see
    // ImportarDaNuvemCommand.
    [Transaction(TransactionMode.Manual)]
    [Regeneration(RegenerationOption.Manual)]
    public class ImportLevantamentoCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            Document doc = commandData.Application.ActiveUIDocument.Document;

            string jsonPath = PickJsonFile();
            if (string.IsNullOrEmpty(jsonPath))
                return Result.Cancelled;

            LevantamentoSchema schema;
            try
            {
                schema = JsonConvert.DeserializeObject<LevantamentoSchema>(File.ReadAllText(jsonPath));
            }
            catch (Exception ex)
            {
                message = "Não foi possível ler o arquivo JSON: " + ex.Message;
                return Result.Failed;
            }

            try
            {
                ImportResult result = LevantamentoImporter.Importar(doc, schema);
                TaskDialog.Show("Braves BIM Field", "Importação concluída:\n" + result);
                return Result.Succeeded;
            }
            catch (Exception ex)
            {
                message = "Erro ao importar: " + ex.Message;
                return Result.Failed;
            }
        }

        private static string PickJsonFile()
        {
            using (var dlg = new OpenFileDialog
            {
                Filter = "Levantamento BIM (*.json)|*.json",
                Title = "Selecione o levantamento_bim.json exportado do app",
            })
            {
                return dlg.ShowDialog() == DialogResult.OK ? dlg.FileName : null;
            }
        }
    }
}
