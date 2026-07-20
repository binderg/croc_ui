package main

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/schollz/croc/v10/src/croc"
	"github.com/schollz/croc/v10/src/models"
	"github.com/schollz/croc/v10/src/utils"
)

// Phase values reported to the UI.
const (
	PhaseIdle         = "idle"
	PhaseWaiting      = "waiting"
	PhaseConnecting   = "connecting"
	PhaseTransferring = "transferring"
	PhaseDone         = "done"
	PhaseError        = "error"
	PhaseCancelled    = "cancelled"
)

// Progress is the single state object the UI renders from. It is emitted on
// every change, so the frontend never has to piece state together itself.
type Progress struct {
	Active      bool    `json:"active"`
	Mode        string  `json:"mode"`
	Phase       string  `json:"phase"`
	Code        string  `json:"code"`
	Percent     float64 `json:"percent"`
	BytesDone   int64   `json:"bytesDone"`
	BytesTotal  int64   `json:"bytesTotal"`
	SpeedBps    float64 `json:"speedBps"`
	EtaSeconds  float64 `json:"etaSeconds"`
	FileIndex   int     `json:"fileIndex"`
	FileCount   int     `json:"fileCount"`
	CurrentFile string  `json:"currentFile"`
	Message     string  `json:"message"`
	Error       string  `json:"error"`
	DestFolder  string  `json:"destFolder"`
}

// Engine owns the one-at-a-time croc transfer and publishes Progress snapshots.
type Engine struct {
	emit func(Progress)

	mu      sync.Mutex
	state   Progress
	cancel  context.CancelFunc
	running bool

	// totalBytes is latched once the file list is known so the polling loop
	// never has to re-read croc's slice while croc is mutating it.
	totalBytes int64
}

func NewEngine(emit func(Progress)) *Engine {
	return &Engine{
		emit:  emit,
		state: Progress{Phase: PhaseIdle},
	}
}

func (e *Engine) snapshot() Progress {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.state
}

// update mutates state under the lock and publishes the result.
func (e *Engine) update(fn func(p *Progress)) {
	e.mu.Lock()
	fn(&e.state)
	s := e.state
	e.mu.Unlock()
	if e.emit != nil {
		e.emit(s)
	}
}

func (e *Engine) Busy() bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.running
}

// Cancel stops an in-flight transfer. Safe to call when nothing is running.
func (e *Engine) Cancel() {
	e.mu.Lock()
	cancel := e.cancel
	e.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func baseOptions(isSender bool, code string) croc.Options {
	return croc.Options{
		IsSender:      isSender,
		SharedSecret:  code,
		Debug:         false,
		RelayAddress:  models.DEFAULT_RELAY,
		RelayAddress6: models.DEFAULT_RELAY6,
		RelayPorts:    []string{"9009", "9010", "9011", "9012", "9013"},
		RelayPassword: models.DEFAULT_PASSPHRASE,
		Curve:         "p256",
		HashAlgorithm: "xxhash",

		// GUI has no terminal: never prompt, never read stdin, never touch
		// the clipboard behind the user's back.
		NoPrompt:         true,
		IgnoreStdin:      true,
		Ask:              false,
		DisableClipboard: true,
		ShowQrCode:       false,
		Stdout:           false,

		// Quiet must stay false: croc's quiet mode reassigns os.Stderr to
		// /dev/null, which would silence the pipe we read status from.
		Quiet: false,

		Overwrite: true,
	}
}

// begin claims the engine for a transfer. Returns a context whose cancellation
// aborts the transfer, plus a release func to run when it finishes.
func (e *Engine) begin(mode, code string) (context.Context, func(), error) {
	e.mu.Lock()
	if e.running {
		e.mu.Unlock()
		return nil, nil, errors.New("a transfer is already running")
	}
	ctx, cancel := context.WithCancel(context.Background())
	e.running = true
	e.cancel = cancel
	e.totalBytes = 0
	e.state = Progress{
		Active: true,
		Mode:   mode,
		Phase:  PhaseConnecting,
		Code:   code,
	}
	s := e.state
	e.mu.Unlock()

	if e.emit != nil {
		e.emit(s)
	}

	release := func() {
		cancel()
		e.mu.Lock()
		e.running = false
		e.cancel = nil
		e.state.Active = false
		s := e.state
		e.mu.Unlock()
		if e.emit != nil {
			e.emit(s)
		}
	}
	return ctx, release, nil
}

// Send shares the given paths and returns the code word immediately; the
// transfer itself continues in the background.
func (e *Engine) Send(paths []string, code string) (string, error) {
	if len(paths) == 0 {
		return "", errors.New("pick at least one file or folder to send")
	}
	for _, p := range paths {
		if _, err := os.Stat(p); err != nil {
			return "", fmt.Errorf("cannot read %q: %w", filepath.Base(p), err)
		}
	}

	code = strings.TrimSpace(code)
	if code == "" {
		code = utils.GetRandomName()
	}
	if len(code) < 6 {
		return "", errors.New("the code must be at least 6 characters")
	}

	filesInfo, emptyFolders, totalFolders, err := croc.GetFilesInfo(paths, false, false, []string{})
	if err != nil {
		return "", err
	}
	if len(filesInfo) == 0 && len(emptyFolders) == 0 {
		return "", errors.New("nothing to send: that selection is empty")
	}

	var total int64
	for _, f := range filesInfo {
		total += f.Size
	}

	ctx, release, err := e.begin("send", code)
	if err != nil {
		return "", err
	}

	e.mu.Lock()
	e.totalBytes = total
	e.mu.Unlock()

	e.update(func(p *Progress) {
		p.Phase = PhaseWaiting
		p.BytesTotal = total
		p.FileCount = len(filesInfo)
		p.Message = "Waiting for the other person to enter the code"
	})

	client, err := croc.NewCtx(ctx, baseOptions(true, code))
	if err != nil {
		release()
		return "", err
	}

	go func() {
		defer release()
		e.watch(ctx, client)
		err := client.Send(filesInfo, emptyFolders, totalFolders)
		e.finish(ctx, client, err)
	}()

	return code, nil
}

// Receive pulls a transfer into destDir.
func (e *Engine) Receive(code, destDir string) error {
	code = strings.TrimSpace(code)
	if len(code) < 6 {
		return errors.New("that code looks too short — check it and try again")
	}
	destDir = strings.TrimSpace(destDir)
	if destDir == "" {
		destDir = DefaultDownloadDir()
	}
	if err := os.MkdirAll(destDir, 0o755); err != nil {
		return fmt.Errorf("cannot use that folder: %w", err)
	}

	ctx, release, err := e.begin("receive", code)
	if err != nil {
		return err
	}

	e.update(func(p *Progress) {
		p.DestFolder = destDir
		p.Message = "Connecting to the sender"
	})

	client, err := croc.NewCtx(ctx, baseOptions(false, code))
	if err != nil {
		release()
		return err
	}

	go func() {
		defer release()

		// croc writes into the process working directory, so the receive has
		// to happen from destDir. The engine mutex guarantees one transfer at
		// a time, so this global change is safe here.
		prev, _ := os.Getwd()
		if err := os.Chdir(destDir); err != nil {
			e.finish(ctx, client, fmt.Errorf("cannot use that folder: %w", err))
			return
		}
		defer func() {
			if prev != "" {
				_ = os.Chdir(prev)
			}
		}()

		e.watch(ctx, client)
		err := client.Receive()
		e.finish(ctx, client, err)
	}()

	return nil
}

// finish maps croc's terminal error into a user-facing phase.
func (e *Engine) finish(ctx context.Context, client *croc.Client, err error) {
	switch {
	case err == nil || client.SuccessfulTransfer:
		e.update(func(p *Progress) {
			p.Phase = PhaseDone
			p.Percent = 100
			if p.BytesTotal > 0 {
				p.BytesDone = p.BytesTotal
			}
			p.Error = ""
			p.Message = "Transfer complete"
		})
	case ctx.Err() != nil:
		e.update(func(p *Progress) {
			p.Phase = PhaseCancelled
			p.Message = "Transfer cancelled"
		})
	default:
		msg := friendlyError(err)
		e.update(func(p *Progress) {
			p.Phase = PhaseError
			p.Error = msg
			p.Message = msg
		})
	}
}

// watch polls croc's exported counters and turns them into progress updates.
//
// croc has no progress callback, so this samples its public fields. TotalSent
// is a naturally-aligned int64 and the file list is only assigned once during
// the handshake, so a sample can lag by a tick but never reports a bad value.
func (e *Engine) watch(ctx context.Context, client *croc.Client) {
	go func() {
		ticker := time.NewTicker(150 * time.Millisecond)
		defer ticker.Stop()

		var (
			lastBytes int64
			lastTime  = time.Now()
			speed     float64
		)

		for {
			select {
			case <-ctx.Done():
				return
			case now := <-ticker.C:
				if client.SuccessfulTransfer {
					return
				}

				total := e.resolveTotal(client)
				done := client.TotalSent

				if elapsed := now.Sub(lastTime).Seconds(); elapsed > 0 {
					if inst := float64(done-lastBytes) / elapsed; inst >= 0 {
						if speed == 0 {
							speed = inst
						} else {
							// Smooth the readout so the number stays legible.
							speed = 0.7*speed + 0.3*inst
						}
					}
				}
				lastBytes, lastTime = done, now

				percent := 0.0
				if total > 0 {
					percent = float64(done) / float64(total) * 100
					if percent > 100 {
						percent = 100
					}
				}
				eta := 0.0
				if speed > 1 && total > done {
					eta = float64(total-done) / speed
				}

				idx := client.FilesToTransferCurrentNum
				count := client.TotalNumberOfContents

				e.update(func(p *Progress) {
					if p.Phase == PhaseWaiting || p.Phase == PhaseConnecting {
						if done > 0 || client.Step3RecipientRequestFile {
							p.Phase = PhaseTransferring
							p.Message = "Transferring"
						}
					}
					p.BytesDone = done
					p.BytesTotal = total
					p.Percent = percent
					p.SpeedBps = speed
					p.EtaSeconds = eta
					if count > 0 {
						p.FileCount = count
						p.FileIndex = idx + 1
					}
				})
			}
		}
	}()
}

// resolveTotal latches the transfer size the first time croc knows it.
func (e *Engine) resolveTotal(client *croc.Client) int64 {
	e.mu.Lock()
	cached := e.totalBytes
	e.mu.Unlock()
	if cached > 0 {
		return cached
	}
	if !client.Step2FileInfoTransferred {
		return 0
	}
	var total int64
	for _, f := range client.FilesToTransfer {
		total += f.Size
	}
	if total > 0 {
		e.mu.Lock()
		e.totalBytes = total
		e.mu.Unlock()
	}
	return total
}

var ansiRe = regexp.MustCompile(`\x1b\[[0-9;?]*[a-zA-Z]`)

// captureCrocOutput redirects croc's status writes into a channel of lines.
// croc writes exclusively to the os.Stderr package variable, so swapping it
// for a pipe is enough to intercept everything without touching croc itself.
func captureCrocOutput() <-chan string {
	r, w, err := os.Pipe()
	if err != nil {
		return nil
	}
	os.Stderr = w

	out := make(chan string, 256)
	go func() {
		defer close(out)
		sc := bufio.NewScanner(r)
		sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		sc.Split(scanLinesOrCR)
		for sc.Scan() {
			line := strings.TrimSpace(ansiRe.ReplaceAllString(sc.Text(), ""))
			if line == "" {
				continue
			}
			select {
			case out <- line:
			default: // drop rather than block croc on a slow UI
			}
		}
	}()
	return out
}

// scanLinesOrCR splits on \n or \r so progress-bar redraws surface as lines.
func scanLinesOrCR(data []byte, atEOF bool) (advance int, token []byte, err error) {
	if atEOF && len(data) == 0 {
		return 0, nil, nil
	}
	if i := bytes.IndexAny(data, "\r\n"); i >= 0 {
		return i + 1, data[:i], nil
	}
	if atEOF {
		return len(data), data, nil
	}
	return 0, nil, nil
}

// friendlyError rewrites croc's internal errors into something a non-technical
// user can act on, falling back to the raw text when there is no better match.
func friendlyError(err error) string {
	if err == nil {
		return ""
	}
	raw := err.Error()
	low := strings.ToLower(raw)

	switch {
	case strings.Contains(low, "bad password"), strings.Contains(low, "pake"),
		strings.Contains(low, "not equal"):
		return "That code did not match. Check it with the sender and try again."
	case strings.Contains(low, "no such host"), strings.Contains(low, "dial tcp"),
		strings.Contains(low, "timeout"), strings.Contains(low, "i/o timeout"),
		strings.Contains(low, "connection refused"):
		return "Could not reach the relay. Check your internet connection and try again."
	case strings.Contains(low, "room is full"):
		return "Someone else is already using that code. Ask the sender for a new one."
	case strings.Contains(low, "permission denied"), strings.Contains(low, "access is denied"):
		return "Permission denied writing to that folder. Pick a different destination."
	case strings.Contains(low, "no space"):
		return "Not enough free disk space to finish this transfer."
	case strings.Contains(low, "refusing files"):
		return "The other side cancelled the transfer."
	}
	return raw
}

// DefaultDownloadDir picks the user's Downloads folder, falling back to home.
func DefaultDownloadDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		wd, _ := os.Getwd()
		return wd
	}
	dl := filepath.Join(home, "Downloads")
	if st, err := os.Stat(dl); err == nil && st.IsDir() {
		return dl
	}
	return home
}
