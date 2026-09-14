using System.Collections.Generic;
using System.Linq;
using System.Windows;
using Autodesk.Revit.DB;

namespace RevitDetailingTool.UI
{
    public partial class SheetsWindow : Window
    {
        public ElementId SelectedTitleBlockId { get; private set; } = ElementId.InvalidElementId;
        public string SheetNumber { get; private set; } = string.Empty;
        public string SheetName { get; private set; } = string.Empty;
        public int Columns { get; private set; } = 2;
        public List<View> SelectedViews { get; private set; } = new();

        public SheetsWindow(List<FamilySymbol> titleBlocks, List<View> unplacedViews)
        {
            InitializeComponent();
            TitleBlockCombo.ItemsSource = titleBlocks;
            if (titleBlocks.Count > 0) TitleBlockCombo.SelectedIndex = 0;
            ViewsList.ItemsSource = unplacedViews;
        }

        private void Create_Click(object sender, RoutedEventArgs e)
        {
            if (TitleBlockCombo.SelectedItem is not FamilySymbol titleBlock)
            {
                MessageBox.Show("Selecione um carimbo.");
                return;
            }
            if (ViewsList.SelectedItems.Count == 0)
            {
                MessageBox.Show("Selecione ao menos uma vista para posicionar.");
                return;
            }
            if (!int.TryParse(ColumnsBox.Text, out int columns) || columns < 1)
            {
                MessageBox.Show("Informe um número válido de colunas.");
                return;
            }
            if (string.IsNullOrWhiteSpace(SheetNumberBox.Text))
            {
                MessageBox.Show("Informe o número da prancha.");
                return;
            }

            SelectedTitleBlockId = titleBlock.Id;
            SheetNumber = SheetNumberBox.Text.Trim();
            SheetName = SheetNameBox.Text.Trim();
            Columns = columns;
            SelectedViews = ViewsList.SelectedItems.Cast<View>().ToList();

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
