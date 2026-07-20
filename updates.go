package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"runtime/debug"
	"strconv"
	"strings"
	"sync"
	"time"
)

// AppVersion is the version of this GUI. Bump it when you cut a release so the
// update check can tell an old build from a current one.
const AppVersion = "1.0.0"

// CrocUIRepo is the GitHub "owner/name" this app checks for its own updates.
// Change it to your repository before publishing a release.
const CrocUIRepo = "binderg/crocui"

// CrocRepo is upstream croc, whose library is compiled into this binary.
const CrocRepo = "schollz/croc"

// UpdateInfo describes one component the user might want to update.
type UpdateInfo struct {
	Name      string `json:"name"`
	Current   string `json:"current"`
	Latest    string `json:"latest"`
	Available bool   `json:"available"`
	URL       string `json:"url"`
	Error     string `json:"error"`
}

// UpdateStatus is the full result of a check, for both components.
type UpdateStatus struct {
	CrocUI    UpdateInfo `json:"crocui"`
	Croc      UpdateInfo `json:"croc"`
	CheckedAt string     `json:"checkedAt"`
}

var (
	updateCacheMu sync.Mutex
	updateCache   *UpdateStatus
	updateCacheAt time.Time
)

// CrocVersion reports the croc library version compiled into this binary,
// read from the module graph so it can never drift from what is actually here.
func CrocVersion() string {
	bi, ok := debug.ReadBuildInfo()
	if !ok {
		return "unknown"
	}
	for _, dep := range bi.Deps {
		if dep.Path == "github.com/schollz/croc/v10" {
			return strings.TrimPrefix(dep.Version, "v")
		}
	}
	return "unknown"
}

type ghRelease struct {
	TagName    string `json:"tag_name"`
	HTMLURL    string `json:"html_url"`
	Draft      bool   `json:"draft"`
	Prerelease bool   `json:"prerelease"`
}

func fetchLatestRelease(ctx context.Context, repo string) (ghRelease, error) {
	var rel ghRelease
	url := fmt.Sprintf("https://api.github.com/repos/%s/releases/latest", repo)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return rel, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "crocui/"+AppVersion)

	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return rel, err
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusOK:
	case http.StatusNotFound:
		return rel, fmt.Errorf("no published releases yet")
	case http.StatusForbidden:
		return rel, fmt.Errorf("GitHub rate limit reached, try again later")
	default:
		return rel, fmt.Errorf("GitHub returned %s", resp.Status)
	}

	if err := json.NewDecoder(resp.Body).Decode(&rel); err != nil {
		return rel, err
	}
	return rel, nil
}

func checkOne(ctx context.Context, name, repo, current string) UpdateInfo {
	info := UpdateInfo{
		Name:    name,
		Current: current,
		URL:     "https://github.com/" + repo + "/releases/latest",
	}
	rel, err := fetchLatestRelease(ctx, repo)
	if err != nil {
		info.Error = err.Error()
		return info
	}
	info.Latest = strings.TrimPrefix(rel.TagName, "v")
	info.URL = rel.HTMLURL
	info.Available = compareVersions(info.Latest, current) > 0
	return info
}

// CheckUpdates looks up the newest release of this GUI and of upstream croc.
// Results are cached briefly so opening the panel repeatedly is not chatty.
func CheckUpdates(ctx context.Context, force bool) UpdateStatus {
	updateCacheMu.Lock()
	if !force && updateCache != nil && time.Since(updateCacheAt) < 30*time.Minute {
		cached := *updateCache
		updateCacheMu.Unlock()
		return cached
	}
	updateCacheMu.Unlock()

	status := UpdateStatus{
		CheckedAt: time.Now().Format(time.RFC3339),
	}

	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		status.CrocUI = checkOne(ctx, "Croc Transfer", CrocUIRepo, AppVersion)
	}()
	go func() {
		defer wg.Done()
		status.Croc = checkOne(ctx, "croc engine", CrocRepo, CrocVersion())
	}()
	wg.Wait()

	updateCacheMu.Lock()
	updateCache = &status
	updateCacheAt = time.Now()
	updateCacheMu.Unlock()

	return status
}

// compareVersions returns >0 if a is newer than b, <0 if older, 0 if equal.
// Non-numeric suffixes are ignored, which is enough for the vX.Y.Z tags both
// repositories publish.
func compareVersions(a, b string) int {
	pa, pb := splitVersion(a), splitVersion(b)
	for i := 0; i < len(pa) || i < len(pb); i++ {
		var x, y int
		if i < len(pa) {
			x = pa[i]
		}
		if i < len(pb) {
			y = pb[i]
		}
		if x != y {
			if x > y {
				return 1
			}
			return -1
		}
	}
	return 0
}

func splitVersion(v string) []int {
	v = strings.TrimPrefix(strings.TrimSpace(v), "v")
	if i := strings.IndexAny(v, "-+"); i >= 0 {
		v = v[:i]
	}
	fields := strings.Split(v, ".")
	out := make([]int, 0, len(fields))
	for _, f := range fields {
		n, err := strconv.Atoi(f)
		if err != nil {
			break
		}
		out = append(out, n)
	}
	return out
}
