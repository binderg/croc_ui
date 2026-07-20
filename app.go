package main

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// App is the binding surface exposed to the frontend.
type App struct {
	ctx    context.Context
	engine *Engine
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	a.engine = NewEngine(func(p Progress) {
		wruntime.EventsEmit(ctx, "transfer:progress", p)
	})

	// Surface croc's own status writes as a log stream for the details pane.
	if lines := captureCrocOutput(); lines != nil {
		go func() {
			for line := range lines {
				wruntime.EventsEmit(ctx, "croc:log", line)
			}
		}()
	}

	// File drops are registered on the frontend instead: only the JS runtime's
	// OnFileDrop attaches the DOM listeners that stop the webview from
	// navigating to the dropped file. See App.jsx.
}

// FileEntry is a path plus the details the UI shows next to it.
type FileEntry struct {
	Path  string `json:"path"`
	Name  string `json:"name"`
	Size  int64  `json:"size"`
	IsDir bool   `json:"isDir"`
}

// Describe resolves paths into displayable entries, skipping unreadable ones.
func (a *App) Describe(paths []string) []FileEntry {
	entries := make([]FileEntry, 0, len(paths))
	for _, p := range paths {
		st, err := os.Stat(p)
		if err != nil {
			continue
		}
		entry := FileEntry{
			Path:  p,
			Name:  filepath.Base(p),
			IsDir: st.IsDir(),
		}
		if st.IsDir() {
			entry.Size = dirSize(p)
		} else {
			entry.Size = st.Size()
		}
		entries = append(entries, entry)
	}
	return entries
}

func dirSize(root string) int64 {
	var total int64
	_ = filepath.Walk(root, func(_ string, info os.FileInfo, err error) error {
		if err == nil && info != nil && !info.IsDir() {
			total += info.Size()
		}
		return nil
	})
	return total
}

// PickFiles opens the system file picker.
func (a *App) PickFiles() ([]FileEntry, error) {
	paths, err := wruntime.OpenMultipleFilesDialog(a.ctx, wruntime.OpenDialogOptions{
		Title: "Choose files to send",
	})
	if err != nil {
		return nil, err
	}
	return a.Describe(paths), nil
}

// PickFolderToSend opens the system folder picker for sending a whole folder.
func (a *App) PickFolderToSend() ([]FileEntry, error) {
	path, err := wruntime.OpenDirectoryDialog(a.ctx, wruntime.OpenDialogOptions{
		Title: "Choose a folder to send",
	})
	if err != nil || strings.TrimSpace(path) == "" {
		return nil, err
	}
	return a.Describe([]string{path}), nil
}

// PickDestination opens the system folder picker for the download location.
func (a *App) PickDestination() (string, error) {
	return wruntime.OpenDirectoryDialog(a.ctx, wruntime.OpenDialogOptions{
		Title:            "Choose where to save received files",
		DefaultDirectory: DefaultDownloadDir(),
	})
}

// Send starts sharing the given paths and returns the code to hand over.
func (a *App) Send(paths []string, code string) (string, error) {
	return a.engine.Send(paths, code)
}

// Receive starts downloading the transfer identified by code into destDir.
func (a *App) Receive(code string, destDir string) error {
	return a.engine.Receive(code, destDir)
}

// Cancel aborts the running transfer, if any.
func (a *App) Cancel() {
	a.engine.Cancel()
}

// GetProgress returns the current state, so a reloaded UI can resync.
func (a *App) GetProgress() Progress {
	return a.engine.snapshot()
}

// DefaultFolder is the initial download destination.
func (a *App) DefaultFolder() string {
	return DefaultDownloadDir()
}

// OpenFolder reveals a path in the system file manager.
func (a *App) OpenFolder(path string) error {
	if strings.TrimSpace(path) == "" {
		path = DefaultDownloadDir()
	}
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("explorer", filepath.Clean(path))
	case "darwin":
		cmd = exec.Command("open", path)
	default:
		cmd = exec.Command("xdg-open", path)
	}
	// explorer.exe reports a non-zero exit code even on success, so the
	// error here is not a reliable signal and is intentionally dropped.
	_ = cmd.Start()
	return nil
}

// OpenURL opens a link in the user's default browser.
func (a *App) OpenURL(url string) {
	wruntime.BrowserOpenURL(a.ctx, url)
}

// AppInfo reports the versions shown in the about panel.
func (a *App) AppInfo() map[string]string {
	return map[string]string{
		"appVersion":  AppVersion,
		"crocVersion": CrocVersion(),
		"platform":    runtime.GOOS,
	}
}

// CheckForUpdates queries GitHub for newer releases of this app and of croc.
func (a *App) CheckForUpdates(force bool) UpdateStatus {
	return CheckUpdates(a.ctx, force)
}
