using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using Autodesk.Revit.DB;
using RevitDetailingTool.Services;

namespace RevitDetailingTool.UI
{
    public partial class ParameterExportWindow : Window
    {
        private readonly Document _doc;
        private readonly View _view;

        private static readonly Dictionary<string, BuiltInCategory> CategoryOptions = new()
        {
            ["Paredes"] = BuiltInCategory.OST_Walls,
            ["Portas"] = BuiltInCategory.OST_Doors,
            ["Janelas"] = BuiltInCategory.OST_Windows,
            ["Pisos"] = BuiltInCategory.OST_Floors,
            ["Ambientes"] = BuiltInCategory.OST_Rooms,
            ["Mobiliário"] = BuiltInCategory.OST_Furniture,
            ["Estrutura - Vigas"] = BuiltInCategory.OST_StructuralFraming,
            ["Estrutura - Pilares"] = BuiltInCategory.OST_StructuralColumns,
        };

        public string SelectedCategory { get; private set; } = string.Empty;
        public List<Element> FilteredElements { get; private set; } = new();
        public List<string> SelectedParameters { get; private set; } = new();

        public ParameterExportWindow(Document doc, View view)
        {
            InitializeComponent();
            _doc = doc;
            _view = view;
            CategoryCombo.ItemsSource = CategoryOptions.Keys;
            CategoryCombo.SelectedIndex = 0;
        }

        private void CategoryCombo_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (CategoryCombo.SelectedItem is not string key) return;
            BuiltInCategory category = CategoryOptions[key];
            List<Element> elements = ParameterExtractionService.GetElementsByCategory(_doc, category, ChkActiveViewOnly.IsChecked == true, _view);
            ParametersList.ItemsSource = ParameterExtractionService.GetAvailableParameterNames(elements);
        }

        private void Export_Click(object sender, RoutedEventArgs e)
        {
            if (CategoryCombo.SelectedItem is not string key)
            {
                MessageBox.Show("Selecione uma categoria.");
                return;
            }
            if (ParametersList.SelectedItems.Count == 0)
            {
                MessageBox.Show("Selecione ao menos um parâmetro.");
                return;
            }

            BuiltInCategory category = CategoryOptions[key];
            SelectedCategory = key;
            FilteredElements = ParameterExtractionService.GetElementsByCategory(_doc, category, ChkActiveViewOnly.IsChecked == true, _view);
            SelectedParameters = ParametersList.SelectedItems.Cast<string>().ToList();

            DialogResult = true;
            Close();
        }

        private void Cancel_Click(object sender, RoutedEventArgs e)
        {
            DialogResult = false;
            Close();
        }
    }
}
