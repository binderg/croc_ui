import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {
    AppInfo,
    Cancel,
    CheckForUpdates,
    DefaultFolder,
    Describe,
    GetProgress,
    OpenFolder,
    OpenURL,
    PickDestination,
    PickFiles,
    PickFolderToSend,
    Receive,
    Send,
} from '../wailsjs/go/main/App'
import {EventsOn, OnFileDrop, OnFileDropOff} from '../wailsjs/runtime/runtime'

const IDLE = {phase: 'idle', active: false}

function formatBytes(n) {
    if (!n || n < 0) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let i = 0
    let v = n
    while (v >= 1024 && i < units.length - 1) {
        v /= 1024
        i++
    }
    return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

function formatSpeed(bps) {
    if (!bps || bps < 1) return ''
    return `${formatBytes(bps)}/s`
}

function formatEta(seconds) {
    if (!seconds || seconds <= 0 || !isFinite(seconds)) return ''
    const s = Math.round(seconds)
    if (s < 60) return `${s}s left`
    const m = Math.floor(s / 60)
    if (m < 60) return `${m}m ${s % 60}s left`
    return `${Math.floor(m / 60)}h ${m % 60}m left`
}

export default function App() {
    const [tab, setTab] = useState('send')
    const [files, setFiles] = useState([])
    const [code, setCode] = useState('')
    const [receiveCode, setReceiveCode] = useState('')
    const [dest, setDest] = useState('')
    const [progress, setProgress] = useState(IDLE)
    const [log, setLog] = useState([])
    const [showLog, setShowLog] = useState(false)
    const [info, setInfo] = useState({})
    const [updates, setUpdates] = useState(null)
    const [banner, setBanner] = useState('')
    const [dragging, setDragging] = useState(false)
    const [copied, setCopied] = useState(false)
    const dragDepth = useRef(0)

    useEffect(() => {
        DefaultFolder().then(setDest).catch(() => {})
        AppInfo().then(setInfo).catch(() => {})
        GetProgress().then((p) => p && setProgress(p)).catch(() => {})
        CheckForUpdates(false).then(setUpdates).catch(() => {})

        const offProgress = EventsOn('transfer:progress', setProgress)
        const offLog = EventsOn('croc:log', (line) => {
            setLog((prev) => [...prev.slice(-300), line])
        })

        // This must be the JS runtime's OnFileDrop, not the Go one: only this
        // attaches the DOM listeners that preventDefault the drop. Without it
        // the webview navigates to the dropped file instead.
        OnFileDrop((x, y, paths) => {
            dragDepth.current = 0
            setDragging(false)
            if (!paths || !paths.length) return
            Describe(paths)
                .then((entries) => {
                    if (!entries?.length) return
                    setTab('send')
                    setFiles((prev) => mergeFiles(prev, entries))
                })
                .catch(() => {})
        }, true)

        return () => {
            offProgress?.()
            offLog?.()
            OnFileDropOff()
        }
    }, [])

    // The webview still fires HTML drag events; use them only for the drop
    // highlight. Wails supplies the real file paths via the files:dropped event.
    useEffect(() => {
        const onOver = (e) => e.preventDefault()
        const onEnter = (e) => {
            e.preventDefault()
            dragDepth.current++
            setDragging(true)
        }
        const onLeave = () => {
            dragDepth.current = Math.max(0, dragDepth.current - 1)
            if (dragDepth.current === 0) setDragging(false)
        }
        const onDrop = () => {
            dragDepth.current = 0
            setDragging(false)
        }
        window.addEventListener('dragover', onOver)
        window.addEventListener('dragenter', onEnter)
        window.addEventListener('dragleave', onLeave)
        window.addEventListener('drop', onDrop)
        return () => {
            window.removeEventListener('dragover', onOver)
            window.removeEventListener('dragenter', onEnter)
            window.removeEventListener('dragleave', onLeave)
            window.removeEventListener('drop', onDrop)
        }
    }, [])

    const busy = progress.active
    const phase = progress.phase || 'idle'
    const showResult = phase === 'done' || phase === 'error' || phase === 'cancelled'

    const totalSize = useMemo(
        () => files.reduce((sum, f) => sum + (f.size || 0), 0),
        [files],
    )

    const flash = useCallback((msg) => {
        setBanner(msg)
        setTimeout(() => setBanner(''), 4000)
    }, [])

    const addFiles = async (picker) => {
        try {
            const entries = await picker()
            if (entries?.length) setFiles((prev) => mergeFiles(prev, entries))
        } catch (e) {
            flash(String(e))
        }
    }

    const startSend = async () => {
        if (!files.length) return
        setLog([])
        try {
            const generated = await Send(files.map((f) => f.path), code.trim())
            setCode(generated)
        } catch (e) {
            flash(String(e))
        }
    }

    const startReceive = async () => {
        const c = receiveCode.trim()
        if (c.length < 6) {
            flash('Enter the full code the sender gave you.')
            return
        }
        setLog([])
        try {
            await Receive(c, dest)
        } catch (e) {
            flash(String(e))
        }
    }

    const copyCode = async () => {
        try {
            await navigator.clipboard.writeText(progress.code || code)
            setCopied(true)
            setTimeout(() => setCopied(false), 1800)
        } catch {
            flash('Could not copy — select the code and copy it manually.')
        }
    }

    const startOver = () => {
        setProgress(IDLE)
        setCopied(false)
        setFiles([])
        setCode('')
        setReceiveCode('')
        setLog([])
    }

    const updateAvailable = updates?.crocui?.available

    return (
        <div className={`app${dragging ? ' app--dragging' : ''}`}>
            <header className="topbar">
                <div className="brand">
                    <CrocMark/>
                    <div>
                        <h1>Croc Transfer</h1>
                        <p>Send files to anyone, end-to-end encrypted</p>
                    </div>
                </div>
                <UpdatePill
                    updates={updates}
                    info={info}
                    onRefresh={() => CheckForUpdates(true).then(setUpdates)}
                    onOpen={(url) => OpenURL(url)}
                />
            </header>

            {updateAvailable && (
                <button className="update-banner" onClick={() => OpenURL(updates.crocui.url)}>
                    <strong>Version {updates.crocui.latest} is available.</strong>
                    <span>You have {updates.crocui.current}. Click to download.</span>
                </button>
            )}

            {banner && <div className="banner">{banner}</div>}

            {!busy && !showResult && (
                <nav className="tabs" role="tablist">
                    <button
                        role="tab"
                        aria-selected={tab === 'send'}
                        className={tab === 'send' ? 'tab tab--on' : 'tab'}
                        onClick={() => setTab('send')}
                    >
                        Send
                    </button>
                    <button
                        role="tab"
                        aria-selected={tab === 'receive'}
                        className={tab === 'receive' ? 'tab tab--on' : 'tab'}
                        onClick={() => setTab('receive')}
                    >
                        Receive
                    </button>
                </nav>
            )}

            <main className="stage">
                {showResult ? (
                    <ResultCard
                        progress={progress}
                        onOpenFolder={() => OpenFolder(progress.destFolder)}
                        onAgain={startOver}
                    />
                ) : busy ? (
                    <ActiveCard
                        progress={progress}
                        copied={copied}
                        onCopy={copyCode}
                        onCancel={() => Cancel()}
                    />
                ) : tab === 'send' ? (
                    <SendCard
                        files={files}
                        totalSize={totalSize}
                        code={code}
                        setCode={setCode}
                        onPickFiles={() => addFiles(PickFiles)}
                        onPickFolder={() => addFiles(PickFolderToSend)}
                        onRemove={(path) => setFiles((prev) => prev.filter((f) => f.path !== path))}
                        onClear={() => setFiles([])}
                        onStart={startSend}
                    />
                ) : (
                    <ReceiveCard
                        code={receiveCode}
                        setCode={setReceiveCode}
                        dest={dest}
                        onPickDest={async () => {
                            const d = await PickDestination()
                            if (d) setDest(d)
                        }}
                        onStart={startReceive}
                    />
                )}
            </main>

            <LogPane log={log} open={showLog} onToggle={() => setShowLog((v) => !v)}/>

            {dragging && (
                <div className="dropveil">
                    <div className="dropveil__inner">
                        <DropIcon/>
                        <p>Drop to add files</p>
                    </div>
                </div>
            )}
        </div>
    )
}

function mergeFiles(prev, incoming) {
    const seen = new Set(prev.map((f) => f.path))
    return [...prev, ...incoming.filter((f) => !seen.has(f.path))]
}

function SendCard({
    files, totalSize, code, setCode,
    onPickFiles, onPickFolder, onRemove, onClear, onStart,
}) {
    return (
        <section className="card">
            {files.length === 0 ? (
                <div className="dropzone">
                    <DropIcon/>
                    <h2>Drag files here</h2>
                    <p>or pick them yourself</p>
                    <div className="row">
                        <button className="btn" onClick={onPickFiles}>Choose files</button>
                        <button className="btn" onClick={onPickFolder}>Choose a folder</button>
                    </div>
                </div>
            ) : (
                <>
                    <div className="listhead">
                        <h2>
                            {files.length} item{files.length > 1 ? 's' : ''} · {formatBytes(totalSize)}
                        </h2>
                        <div className="row">
                            <button className="btn btn--quiet" onClick={onPickFiles}>Add more</button>
                            <button className="btn btn--quiet" onClick={onClear}>Clear</button>
                        </div>
                    </div>

                    <ul className="filelist">
                        {files.map((f) => (
                            <li key={f.path}>
                                <span className="filelist__icon">{f.isDir ? '📁' : '📄'}</span>
                                <span className="filelist__name" title={f.path}>{f.name}</span>
                                <span className="filelist__size">{formatBytes(f.size)}</span>
                                <button
                                    className="filelist__x"
                                    onClick={() => onRemove(f.path)}
                                    aria-label={`Remove ${f.name}`}
                                >
                                    ×
                                </button>
                            </li>
                        ))}
                    </ul>

                    <details className="advanced">
                        <summary>Use my own code word</summary>
                        <input
                            className="input"
                            placeholder="Leave empty for a random code"
                            value={code}
                            onChange={(e) => setCode(e.target.value)}
                        />
                        <p className="hint">
                            At least 6 characters. Anyone with this code can receive the files.
                        </p>
                    </details>

                    <button className="btn btn--primary btn--big" onClick={onStart}>
                        Start sending
                    </button>
                </>
            )}
        </section>
    )
}

function ReceiveCard({code, setCode, dest, onPickDest, onStart}) {
    return (
        <section className="card">
            <div className="receive">
                <h2>Enter the code you were given</h2>
                <input
                    className="input input--code"
                    placeholder="e.g. 1234-word-word-word"
                    value={code}
                    autoFocus
                    spellCheck={false}
                    autoCapitalize="none"
                    autoCorrect="off"
                    onChange={(e) => setCode(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && onStart()}
                />

                <div className="destrow">
                    <div className="destrow__text">
                        <span className="destrow__label">Save to</span>
                        <span className="destrow__path" title={dest}>{dest || '…'}</span>
                    </div>
                    <button className="btn btn--quiet" onClick={onPickDest}>Change</button>
                </div>

                <button
                    className="btn btn--primary btn--big"
                    onClick={onStart}
                    disabled={code.trim().length < 6}
                >
                    Start receiving
                </button>
            </div>
        </section>
    )
}

function ActiveCard({progress, copied, onCopy, onCancel}) {
    const sending = progress.mode === 'send'
    const waiting = progress.phase === 'waiting' || progress.phase === 'connecting'
    const pct = Math.max(0, Math.min(100, progress.percent || 0))
    const showBar = !waiting || progress.bytesDone > 0

    return (
        <section className="card">
            {sending && progress.code && (
                <div className="codeblock">
                    <span className="codeblock__label">Give this code to the other person</span>
                    <div className="codeblock__value">
                        <code>{progress.code}</code>
                        <button className="btn btn--quiet" onClick={onCopy}>
                            {copied ? 'Copied' : 'Copy'}
                        </button>
                    </div>
                </div>
            )}

            <div className="status">
                {waiting && <span className="spinner"/>}
                <span>{progress.message || (sending ? 'Sending' : 'Receiving')}</span>
            </div>

            {showBar && (
                <div className="progress">
                    <div className="progress__track">
                        <div
                            className={`progress__fill${progress.bytesTotal ? '' : ' progress__fill--pulse'}`}
                            style={{width: progress.bytesTotal ? `${pct}%` : '100%'}}
                        />
                    </div>
                    <div className="progress__meta">
                        <span className="progress__pct">
                            {progress.bytesTotal ? `${pct.toFixed(0)}%` : 'Working…'}
                        </span>
                        <span>
                            {progress.bytesTotal
                                ? `${formatBytes(progress.bytesDone)} of ${formatBytes(progress.bytesTotal)}`
                                : formatBytes(progress.bytesDone)}
                        </span>
                        <span>{formatSpeed(progress.speedBps)}</span>
                        <span>{formatEta(progress.etaSeconds)}</span>
                    </div>
                    {progress.fileCount > 1 && (
                        <p className="progress__file">
                            File {progress.fileIndex} of {progress.fileCount}
                        </p>
                    )}
                </div>
            )}

            <button className="btn btn--danger" onClick={onCancel}>Cancel</button>
        </section>
    )
}

function ResultCard({progress, onOpenFolder, onAgain}) {
    const ok = progress.phase === 'done'
    const cancelled = progress.phase === 'cancelled'
    const received = progress.mode === 'receive'

    return (
        <section className="card card--center">
            <div className={`verdict verdict--${ok ? 'ok' : cancelled ? 'warn' : 'bad'}`}>
                {ok ? '✓' : cancelled ? '–' : '!'}
            </div>
            <h2>
                {ok
                    ? received ? 'Files received' : 'Files sent'
                    : cancelled ? 'Transfer cancelled' : 'Transfer failed'}
            </h2>
            {ok && progress.bytesTotal > 0 && (
                <p className="verdict__sub">{formatBytes(progress.bytesTotal)} transferred</p>
            )}
            {!ok && progress.error && <p className="verdict__err">{progress.error}</p>}

            <div className="row">
                {ok && received && (
                    <button className="btn btn--primary" onClick={onOpenFolder}>
                        Open folder
                    </button>
                )}
                <button className="btn" onClick={onAgain}>Start over</button>
            </div>
        </section>
    )
}

function UpdatePill({updates, info, onRefresh, onOpen}) {
    const [open, setOpen] = useState(false)
    const has = updates?.crocui?.available

    return (
        <div className="pillwrap">
            <button
                className={`pill${has ? ' pill--alert' : ''}`}
                onClick={() => setOpen((v) => !v)}
            >
                v{info.appVersion || '…'}{has ? ' · update' : ''}
            </button>

            {open && (
                <div className="pillmenu">
                    <VersionRow
                        label="Croc Transfer"
                        current={info.appVersion}
                        entry={updates?.crocui}
                        onOpen={onOpen}
                    />
                    <VersionRow
                        label="croc engine"
                        current={info.crocVersion}
                        entry={updates?.croc}
                        onOpen={onOpen}
                    />
                    <button className="btn btn--quiet btn--full" onClick={onRefresh}>
                        Check again
                    </button>
                </div>
            )}
        </div>
    )
}

function VersionRow({label, current, entry, onOpen}) {
    return (
        <div className="vrow">
            <div className="vrow__top">
                <span className="vrow__label">{label}</span>
                <span className="vrow__ver">{current || '…'}</span>
            </div>
            {entry?.error ? (
                <span className="vrow__note">{entry.error}</span>
            ) : entry?.available ? (
                <button className="vrow__link" onClick={() => onOpen(entry.url)}>
                    {entry.latest} available →
                </button>
            ) : entry?.latest ? (
                <span className="vrow__note">Up to date</span>
            ) : (
                <span className="vrow__note">Checking…</span>
            )}
        </div>
    )
}

function LogPane({log, open, onToggle}) {
    const ref = useRef(null)
    useEffect(() => {
        if (open && ref.current) ref.current.scrollTop = ref.current.scrollHeight
    }, [log, open])

    if (!log.length) return null
    return (
        <footer className="logpane">
            <button className="logpane__toggle" onClick={onToggle}>
                {open ? 'Hide details' : 'Show details'}
            </button>
            {open && <pre className="logpane__body" ref={ref}>{log.join('\n')}</pre>}
        </footer>
    )
}

function DropIcon() {
    return (
        <svg className="icon-drop" viewBox="0 0 48 48" fill="none" aria-hidden="true">
            <path
                d="M24 32V10m0 0-8 8m8-8 8 8"
                stroke="currentColor" strokeWidth="3"
                strokeLinecap="round" strokeLinejoin="round"
            />
            <path
                d="M8 30v4a6 6 0 0 0 6 6h20a6 6 0 0 0 6-6v-4"
                stroke="currentColor" strokeWidth="3" strokeLinecap="round"
            />
        </svg>
    )
}

function CrocMark() {
    return (
        <svg className="mark" viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <rect width="32" height="32" rx="9" fill="url(#croc-mark)"/>
            <path
                d="M10 16h12m0 0-4.5-4.5M22 16l-4.5 4.5"
                stroke="#fff" strokeWidth="2.4"
                strokeLinecap="round" strokeLinejoin="round"
            />
            <defs>
                <linearGradient id="croc-mark" x1="0" y1="0" x2="32" y2="32">
                    <stop stopColor="#3ddc97"/>
                    <stop offset="1" stopColor="#12a06b"/>
                </linearGradient>
            </defs>
        </svg>
    )
}
