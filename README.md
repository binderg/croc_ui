# Croc Transfer

A desktop UI for [croc](https://github.com/schollz/croc) — send files to anyone,
end-to-end encrypted, with no account and no upload limit.

croc is compiled **into** this app as a Go library. There is no separate
`croc.exe` to install, no PATH to configure, and nothing to download on first
run. One executable, double-click, done.

## For the person using it

1. Open the app.
2. **To send:** drag files onto the window (or click *Choose files*), then
   *Start sending*. A code appears — read it out or send it to the other person.
3. **To receive:** click *Receive*, type the code, pick where to save, then
   *Start receiving*.

Files go directly between the two computers whenever possible. Anything that
crosses the relay is encrypted, and the relay never has the key.

## Download

Grab the latest build from the
[releases page](https://github.com/binderg/croc_ui/releases/latest).

### Windows

Download `croc_ui.exe` and double-click it. Windows SmartScreen may warn about
an unknown publisher (the app is self-signed) — click **More info → Run anyway**.

Or install with [Scoop](https://scoop.sh):

```powershell
scoop bucket add croc_ui https://github.com/binderg/scoop-croc_ui
scoop install croc_ui/croc_ui
```

### macOS

Download `croc_ui.app.zip`, unzip, and drag **Croc Transfer** into
`/Applications`. The app is unsigned, so the first launch is blocked — right-click
the app, choose **Open**, then **Open** again. Or clear the quarantine flag:

```bash
xattr -dr com.apple.quarantine "/Applications/Croc Transfer.app"
```

### Linux

Download the AppImage, make it executable, and run it:

```bash
chmod +x croc_ui.AppImage
./croc_ui.AppImage
```

## Building

Requires [Go](https://go.dev/dl/) 1.25+, [Node.js](https://nodejs.org/) 18+, and
the Wails CLI:

```
go install github.com/wailsapp/wails/v2/cmd/wails@latest
```

Then:

```
wails build          # production binary in build/bin/
wails dev            # live-reload development
```

## Tests

```
go test ./...
```

`TestRoundTrip` performs a genuine croc transfer of a 3 MiB file and verifies
the received bytes are identical, so it needs working network access. The other
tests are offline.

## Update checking

On launch the app asks GitHub for the newest release of:

- **Croc Transfer** — this app, compared against `AppVersion` in `updates.go`.
  A newer release shows a banner across the top of the window.
- **croc engine** — upstream croc, compared against the library version actually
  compiled in (read from the Go module graph, so it can never drift). Shown in
  the version menu; a newer croc means it is worth rebuilding this app against
  it.

Results are cached for 30 minutes. Failures are non-fatal — the app works fine
offline, it just reports that it could not check.

### Before you publish a release

Edit two constants in `updates.go`:

```go
const AppVersion = "1.0.0"          // bump this each release
const CrocUIRepo = "binderg/crocui" // set to your GitHub owner/repo
```

Then set the matching `productVersion` in `wails.json` and tag the release
`v1.0.0` on GitHub. Until a release exists, the version menu reports
"no published releases yet" rather than failing.

## How it fits together

| File | Role |
| --- | --- |
| `engine.go` | Wraps the croc library: runs one transfer at a time, tracks progress, translates errors into plain English |
| `app.go` | The methods the UI can call — file pickers, send, receive, cancel, open folder |
| `updates.go` | GitHub release lookups and version comparison |
| `main.go` | Window setup and drag-and-drop |
| `frontend/src/App.jsx` | The entire interface |

Two implementation details worth knowing if you modify `engine.go`:

- croc reports status by writing to `os.Stderr`. The app swaps that for a pipe
  at startup and turns the output into the *Show details* log.
- croc exposes no progress callback, so `watch()` polls the client's public
  counters on a ticker and derives percent, speed, and ETA from them.

## Credit

The transfer protocol and all the hard parts are
[schollz/croc](https://github.com/schollz/croc), MIT licensed. This project is
only a user interface for it.
