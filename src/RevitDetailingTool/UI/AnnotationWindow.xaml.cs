using System.Collections.Generic;
using System.Windows;
using Autodesk.Revit.DB;

namespace RevitDetailingTool.UI
{
    public partial class AnnotationWindow : Window
    {
        public List<BuiltInCategory> TagCategories { get; private set; } = new();
        public bool CreateDimensions { get; private set; }

        public AnnotationWindow() => InitializeComponent();

        private void Apply_Click(object sender, RoutedEventArgs e)
        {
            if (ChkWalls.IsChecked == true) TagCategories.Add(BuiltInCategory.OST_Walls);
            if (ChkDoors.IsChecked == true) TagCategories.Add(BuiltInCategory.OST_Doors);
            if (ChkWindows.IsChecked == true) TagCategories.Add(BuiltInCategory.OST_Windows);
            if (ChkFloors.IsChecked == true) TagCategories.Add(BuiltInCategory.OST_Floors);
            if (ChkRooms.IsChecked == true) TagCategories.Add(BuiltInCategory.OST_Rooms);
            CreateDimensions = ChkDimensions.IsChecked == true;

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
