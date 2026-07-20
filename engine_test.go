package main

import (
	"bytes"
	"crypto/rand"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// waitForPhase blocks until the engine reports a terminal phase.
func waitForPhase(t *testing.T, ch <-chan Progress, timeout time.Duration) Progress {
	t.Helper()
	deadline := time.After(timeout)
	var last Progress
	for {
		select {
		case p := <-ch:
			last = p
			switch p.Phase {
			case PhaseDone, PhaseError, PhaseCancelled:
				return p
			}
		case <-deadline:
			t.Fatalf("timed out waiting for transfer to finish; last phase=%q msg=%q err=%q",
				last.Phase, last.Message, last.Error)
			return last
		}
	}
}

func newTestEngine() (*Engine, chan Progress) {
	ch := make(chan Progress, 512)
	e := NewEngine(func(p Progress) {
		select {
		case ch <- p:
		default:
		}
	})
	return e, ch
}

// TestRoundTrip sends a real file through croc and receives it back, verifying
// the bytes survive and that progress reaches 100%. Requires network access to
// the public croc relay.
func TestRoundTrip(t *testing.T) {
	srcDir := t.TempDir()
	dstDir := t.TempDir()

	payload := make([]byte, 3<<20) // 3 MiB, big enough to produce real progress
	if _, err := rand.Read(payload); err != nil {
		t.Fatal(err)
	}
	srcFile := filepath.Join(srcDir, "payload.bin")
	if err := os.WriteFile(srcFile, payload, 0o644); err != nil {
		t.Fatal(err)
	}

	sender, sendCh := newTestEngine()
	receiver, recvCh := newTestEngine()

	code, err := sender.Send([]string{srcFile}, "test-croc-ui-roundtrip")
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if code == "" {
		t.Fatal("Send returned an empty code")
	}

	// Give the sender a moment to register with the relay.
	time.Sleep(2 * time.Second)

	if err := receiver.Receive(code, dstDir); err != nil {
		t.Fatalf("Receive: %v", err)
	}

	recvResult := waitForPhase(t, recvCh, 90*time.Second)
	if recvResult.Phase != PhaseDone {
		t.Fatalf("receive did not finish: phase=%q err=%q", recvResult.Phase, recvResult.Error)
	}
	sendResult := waitForPhase(t, sendCh, 30*time.Second)
	if sendResult.Phase != PhaseDone {
		t.Fatalf("send did not finish: phase=%q err=%q", sendResult.Phase, sendResult.Error)
	}

	got, err := os.ReadFile(filepath.Join(dstDir, "payload.bin"))
	if err != nil {
		t.Fatalf("received file missing: %v", err)
	}
	if !bytes.Equal(got, payload) {
		t.Fatalf("received %d bytes, want %d and identical content", len(got), len(payload))
	}

	if recvResult.Percent != 100 {
		t.Errorf("receive percent = %v, want 100", recvResult.Percent)
	}
	if sendResult.BytesTotal != int64(len(payload)) {
		t.Errorf("send BytesTotal = %d, want %d", sendResult.BytesTotal, len(payload))
	}
}

func TestSendRejectsEmptySelection(t *testing.T) {
	e, _ := newTestEngine()
	if _, err := e.Send(nil, ""); err == nil {
		t.Fatal("expected an error when sending nothing")
	}
}

func TestReceiveRejectsShortCode(t *testing.T) {
	e, _ := newTestEngine()
	if err := e.Receive("abc", t.TempDir()); err == nil {
		t.Fatal("expected an error for a too-short code")
	}
}

func TestCompareVersions(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"1.0.1", "1.0.0", 1},
		{"1.0.0", "1.0.1", -1},
		{"1.0.0", "1.0.0", 0},
		{"v10.4.14", "10.4.14", 0},
		{"10.5.0", "10.4.14", 1},
		{"2.0.0", "10.0.0", -1},
		{"1.2.3-beta", "1.2.3", 0},
	}
	for _, c := range cases {
		if got := compareVersions(c.a, c.b); got != c.want {
			t.Errorf("compareVersions(%q, %q) = %d, want %d", c.a, c.b, got, c.want)
		}
	}
}
