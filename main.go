package main

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()

	err := wails.Run(&options.App{
		Title:     "Croc Transfer",
		Width:     900,
		Height:    680,
		MinWidth:  640,
		MinHeight: 560,

		// The window chrome is drawn by the frontend (see TitleBar in App.jsx)
		// so the controls match the app instead of the OS shell. DisableResize
		// must stay false or Wails will not arm the frameless resize edges.
		Frameless:     true,
		DisableResize: false,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		OnStartup: app.startup,
		Bind: []interface{}{
			app,
		},
		// Lets the user drop files straight onto the window instead of
		// hunting for a file picker.
		DragAndDrop: &options.DragAndDrop{
			EnableFileDrop: true,
		},
		Windows: &windows.Options{
			WebviewIsTransparent: false,
			WindowIsTranslucent:  false,
		},
	})
	if err != nil {
		println("Error:", err.Error())
	}
}
