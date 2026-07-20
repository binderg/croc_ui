import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {
    ArrowsLeftRight,
    ArrowUpRight,
    CheckCircle,
    Copy,
    CopySimple,
    Files,
    FolderOpen,
    LockKey,
    Minus,
    Plus,
    ShieldCheck,
    Square,
    Trash,
    UserCircleMinus,
    Warning,
    X,
} from '@phosphor-icons/react'

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
import {
    EventsOn,
    OnFileDrop,
    OnFileDropOff,
    Quit,
    WindowIsMaximised,
    WindowMinimise,
    WindowToggleMaximise,
} from '../wailsjs/runtime/runtime'

import Lottie from './Lottie'
import logo from './assets/images/croc_ui logo.png'
import uploadAnim from './assets/lotties/upload.json'
import downloadAnim from './assets/lotties/download.json'
import loadingAnim from './assets/lotties/Loading.json'
import progressAnim from './assets/lotties/Downloading Progress.json'

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
    if (s < 60) return `${s} sec left`
    const m = Math.floor(s / 60)
    if (m < 60) return `${m} min left`
    return `${Math.floor(m / 60)} hr ${m % 60} min left`
}

export default function App() {
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

        // Must be the JS runtime's OnFileDrop, not the Go one: only this
        // attaches the DOM listeners that preventDefault the drop. Without it
        // the webview navigates to the dropped file.
        OnFileDrop((x, y, paths) => {
            dragDepth.current = 0
            setDragging(false)
            if (!paths || !paths.length) return
            Describe(paths)
                .then((entries) => {
                    if (entries?.length) setFiles((prev) => mergeFiles(prev, entries))
                })
                .catch(() => {})
        }, true)

        return () => {
            offProgress?.()
            offLog?.()
            OnFileDropOff()
        }
    }, [])

    // Wails owns the actual drop; these listeners only drive the highlight.
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
    const idle = !busy && !showResult

    const totalSize = useMemo(
        () => files.reduce((sum, f) => sum + (f.size || 0), 0),
        [files],
    )

    const flash = useCallback((msg) => {
        setBanner(msg)
        setTimeout(() => setBanner(''), 4200)
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
            setCode(await Send(files.map((f) => f.path), code.trim()))
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
            flash('Could not copy. Select the code and copy it manually.')
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

    return (
        <div className="app">
            <TitleBar
                info={info}
                updates={updates}
                onRefresh={() => CheckForUpdates(true).then(setUpdates)}
                onOpen={OpenURL}
            />

            <div className="body">
                {updates?.crocui?.available && (
                    <button
                        className="notice notice--update"
                        onClick={() => OpenURL(updates.crocui.url)}
                    >
                        <ArrowUpRight size={16} weight="bold"/>
                        <span>
                            <strong>Version {updates.crocui.latest} is ready.</strong>{' '}
                            You have {updates.crocui.current}.
                        </span>
                    </button>
                )}
                {banner && (
                    <div className="notice notice--warn">
                        <Warning size={16} weight="fill"/>
                        <span>{banner}</span>
                    </div>
                )}

                {showResult ? (
                    <div className="solo">
                        <ResultPanel
                            progress={progress}
                            onOpenFolder={() => OpenFolder(progress.destFolder)}
                            onAgain={startOver}
                        />
                    </div>
                ) : busy ? (
                    <div className="solo">
                        <ActivePanel
                            progress={progress}
                            copied={copied}
                            onCopy={copyCode}
                            onCancel={Cancel}
                        />
                    </div>
                ) : (
                    <div className="duo">
                        <SendCard
                            files={files}
                            totalSize={totalSize}
                            code={code}
                            setCode={setCode}
                            dragging={dragging}
                            onPickFiles={() => addFiles(PickFiles)}
                            onPickFolder={() => addFiles(PickFolderToSend)}
                            onRemove={(p) => setFiles((f) => f.filter((x) => x.path !== p))}
                            onClear={() => setFiles([])}
                            onStart={startSend}
                        />
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
                    </div>
                )}

                {idle && <TrustStrip/>}

                <LogPane log={log} open={showLog} onToggle={() => setShowLog((v) => !v)}/>
            </div>

            {dragging && <DropVeil/>}
        </div>
    )
}

function mergeFiles(prev, incoming) {
    const seen = new Set(prev.map((f) => f.path))
    return [...prev, ...incoming.filter((f) => !seen.has(f.path))]
}

/* -------------------------------------------------------------- title bar */

/**
 * TitleBar replaces the OS window chrome (the window is Frameless).
 *
 * The drag region is declared with --wails-draggable: drag in CSS. The
 * controls sit outside that region, otherwise dragging would swallow clicks.
 */
function TitleBar({info, updates, onRefresh, onOpen}) {
    const [open, setOpen] = useState(false)
    const [maxed, setMaxed] = useState(false)
    const has = updates?.crocui?.available

    useEffect(() => {
        if (!open) return
        const close = () => setOpen(false)
        window.addEventListener('click', close)
        return () => window.removeEventListener('click', close)
    }, [open])

    // The window can also be maximised by dragging to the screen edge or by
    // double-clicking the drag region, so the icon is polled, not toggled.
    useEffect(() => {
        let alive = true
        const sync = () => {
            WindowIsMaximised()
                .then((v) => alive && setMaxed(v))
                .catch(() => {})
        }
        sync()
        const id = setInterval(sync, 600)
        window.addEventListener('resize', sync)
        return () => {
            alive = false
            clearInterval(id)
            window.removeEventListener('resize', sync)
        }
    }, [])

    return (
        <header className="titlebar">
            <div className="titlebar__drag" onDoubleClick={WindowToggleMaximise}>
                <div className="wordmark">
                    <img className="wordmark__logo" src={logo} alt="" width="26" height="26"/>
                    <span className="wordmark__text">Croc</span>
                </div>
            </div>

            <div className="titlebar__right">
                <div className="verwrap" onClick={(e) => e.stopPropagation()}>
                    <button
                        className={`chip${has ? ' chip--alert' : ''}`}
                        onClick={() => setOpen((v) => !v)}
                        title="Version and updates"
                    >
                        {has && <span className="chip__dot"/>}
                        {info.appVersion ? `v${info.appVersion}` : '...'}
                    </button>

                    {open && (
                        <div className="vermenu">
                            <VersionRow
                                label="This app"
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
                            <button className="vermenu__refresh" onClick={onRefresh}>
                                Check again
                            </button>
                        </div>
                    )}
                </div>

                <div className="wctl">
                    <button className="wctl__b" onClick={WindowMinimise} aria-label="Minimise">
                        <Minus size={14} weight="bold"/>
                    </button>
                    <button
                        className="wctl__b"
                        onClick={WindowToggleMaximise}
                        aria-label={maxed ? 'Restore' : 'Maximise'}
                    >
                        {maxed
                            ? <CopySimple size={13} weight="bold"/>
                            : <Square size={12} weight="bold"/>}
                    </button>
                    <button className="wctl__b wctl__b--close" onClick={Quit} aria-label="Close">
                        <X size={14} weight="bold"/>
                    </button>
                </div>
            </div>
        </header>
    )
}

function VersionRow({label, current, entry, onOpen}) {
    return (
        <div className="vrow">
            <div className="vrow__top">
                <span className="vrow__label">{label}</span>
                <span className="vrow__ver">{current || '...'}</span>
            </div>
            {entry?.error ? (
                <span className="vrow__note">{entry.error}</span>
            ) : entry?.available ? (
                <button className="vrow__link" onClick={() => onOpen(entry.url)}>
                    {entry.latest} available
                </button>
            ) : entry?.latest ? (
                <span className="vrow__note">Up to date</span>
            ) : (
                <span className="vrow__note">Checking</span>
            )}
        </div>
    )
}

/* ------------------------------------------------------------ trust strip */

const TRUST = [
    {
        Icon: LockKey,
        title: 'End-to-end encrypted',
        body: 'The code creates the key.',
    },
    {
        Icon: UserCircleMinus,
        title: 'No account, ever',
        body: 'Nothing to sign up for.',
    },
    {
        Icon: ShieldCheck,
        title: 'Never stored',
        body: 'Files pass straight through.',
    },
]

function TrustStrip() {
    return (
        <ul className="trust">
            {TRUST.map(({Icon, title, body}) => (
                <li key={title}>
                    <Icon size={16} weight="bold"/>
                    <div>
                        <strong>{title}</strong>
                        <span>{body}</span>
                    </div>
                </li>
            ))}
        </ul>
    )
}

/* -------------------------------------------------------------- send card */

function SendCard({
    files, totalSize, code, setCode, dragging,
    onPickFiles, onPickFolder, onRemove, onClear, onStart,
}) {
    if (!files.length) {
        return (
            <section
                className={`card card--drop${dragging ? ' card--hot' : ''}`}
                onClick={onPickFiles}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onPickFiles()}
            >
                <div className="card__art">
                    <Lottie data={uploadAnim} className="art"/>
                </div>
                <h2>Send files</h2>
                <p className="card__sub">Drop them anywhere, or click to browse</p>
                <div className="btnrow">
                    <button
                        className="btn btn--primary"
                        onClick={(e) => {
                            e.stopPropagation()
                            onPickFiles()
                        }}
                    >
                        <Files size={17} weight="bold"/> Choose files
                    </button>
                    <button
                        className="btn"
                        onClick={(e) => {
                            e.stopPropagation()
                            onPickFolder()
                        }}
                    >
                        <FolderOpen size={17} weight="bold"/> Folder
                    </button>
                </div>
            </section>
        )
    }

    return (
        <section className="card">
            <div className="card__head">
                <h2>
                    {files.length} item{files.length > 1 ? 's' : ''}
                    <span className="card__count">{formatBytes(totalSize)}</span>
                </h2>
                <div className="btnrow">
                    <button className="btn btn--ghost" onClick={onPickFiles}>
                        <Plus size={15} weight="bold"/> Add
                    </button>
                    <button className="btn btn--ghost" onClick={onClear}>
                        <Trash size={15} weight="bold"/> Clear
                    </button>
                </div>
            </div>

            <ul className="filelist">
                {files.map((f) => (
                    <li key={f.path} className="filelist__row">
                        <span className="filelist__icon">
                            {f.isDir
                                ? <FolderOpen size={17} weight="fill"/>
                                : <Files size={17} weight="fill"/>}
                        </span>
                        <span className="filelist__name" title={f.path}>{f.name}</span>
                        <span className="filelist__size">{formatBytes(f.size)}</span>
                        <button
                            className="filelist__x"
                            onClick={() => onRemove(f.path)}
                            aria-label={`Remove ${f.name}`}
                        >
                            <X size={14} weight="bold"/>
                        </button>
                    </li>
                ))}
            </ul>

            <details className="more">
                <summary>Pick my own code word</summary>
                <input
                    className="field"
                    placeholder="Leave empty for a random one"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                />
                <p className="more__hint">
                    At least 6 characters. Anyone with this code can receive the files.
                </p>
            </details>

            <button className="btn btn--primary btn--wide" onClick={onStart}>
                <ArrowsLeftRight size={18} weight="bold"/> Start sending
            </button>
        </section>
    )
}

/* ----------------------------------------------------------- receive card */

function ReceiveCard({code, setCode, dest, onPickDest, onStart}) {
    const ready = code.trim().length >= 6
    return (
        <section className="card card--receive">
            <div className="card__art">
                <Lottie data={downloadAnim} className="art"/>
            </div>
            <h2>Receive files</h2>
            <p className="card__sub">Type the code the sender gave you</p>

            <input
                className="field field--code"
                placeholder="1234-word-word-word"
                value={code}
                spellCheck={false}
                autoCapitalize="none"
                autoCorrect="off"
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && ready && onStart()}
            />

            <button className="saveto" onClick={onPickDest}>
                <FolderOpen size={17} weight="fill"/>
                <span className="saveto__text">
                    <span className="saveto__label">Save to</span>
                    <span className="saveto__path" title={dest}>{dest || '...'}</span>
                </span>
                <span className="saveto__change">Change</span>
            </button>

            <button
                className="btn btn--primary btn--wide"
                onClick={onStart}
                disabled={!ready}
            >
                Start receiving
            </button>
        </section>
    )
}

/* ----------------------------------------------------------- active panel */

function ActivePanel({progress, copied, onCopy, onCancel}) {
    const sending = progress.mode === 'send'
    const waiting = progress.phase === 'waiting' || progress.phase === 'connecting'
    const pct = Math.max(0, Math.min(100, progress.percent || 0))
    const known = progress.bytesTotal > 0

    return (
        <section className="card card--stack">
            {sending && progress.code && (
                <div className="codecard">
                    <span className="codecard__label">Give this code to the other person</span>
                    <div className="codecard__row">
                        <code>{progress.code}</code>
                        <button className="btn btn--onbrand" onClick={onCopy}>
                            {copied
                                ? <><CheckCircle size={16} weight="fill"/> Copied</>
                                : <><Copy size={16} weight="bold"/> Copy</>}
                        </button>
                    </div>
                </div>
            )}

            <div className="working">
                <Lottie data={waiting ? loadingAnim : progressAnim} className="art art--sm"/>
                <div className="working__text">
                    <strong>{progress.message || (sending ? 'Sending' : 'Receiving')}</strong>
                    {progress.fileCount > 1 && (
                        <span>File {progress.fileIndex} of {progress.fileCount}</span>
                    )}
                </div>
            </div>

            <div className="meter">
                <div className="meter__track">
                    <div
                        className={`meter__fill${known ? '' : ' meter__fill--idle'}`}
                        style={{width: known ? `${pct}%` : '100%'}}
                    />
                </div>
                <div className="meter__meta">
                    <span className="meter__pct">{known ? `${pct.toFixed(0)}%` : 'Working'}</span>
                    <span>
                        {known
                            ? `${formatBytes(progress.bytesDone)} of ${formatBytes(progress.bytesTotal)}`
                            : formatBytes(progress.bytesDone)}
                    </span>
                    <span>{formatSpeed(progress.speedBps)}</span>
                    <span>{formatEta(progress.etaSeconds)}</span>
                </div>
            </div>

            <button className="btn btn--danger" onClick={onCancel}>Cancel</button>
        </section>
    )
}

/* ----------------------------------------------------------- result panel */

function ResultPanel({progress, onOpenFolder, onAgain}) {
    const ok = progress.phase === 'done'
    const cancelled = progress.phase === 'cancelled'
    const received = progress.mode === 'receive'

    return (
        <section className="card card--center">
            <div className={`seal seal--${ok ? 'ok' : cancelled ? 'warn' : 'bad'}`}>
                {ok ? <CheckCircle size={34} weight="fill"/> : <Warning size={32} weight="fill"/>}
            </div>

            <h2>
                {ok
                    ? received ? 'Files received' : 'Files sent'
                    : cancelled ? 'Transfer cancelled' : 'Transfer failed'}
            </h2>

            {ok && progress.bytesTotal > 0 && (
                <p className="seal__sub">{formatBytes(progress.bytesTotal)} transferred safely</p>
            )}
            {!ok && progress.error && <p className="seal__sub">{progress.error}</p>}

            <div className="btnrow">
                {ok && received && (
                    <button className="btn btn--primary" onClick={onOpenFolder}>
                        <FolderOpen size={17} weight="bold"/> Open folder
                    </button>
                )}
                <button className="btn" onClick={onAgain}>Start over</button>
            </div>
        </section>
    )
}

/* -------------------------------------------------------------- drop veil */

function DropVeil() {
    return (
        <div className="veil">
            <div className="veil__box">
                <Lottie data={uploadAnim} className="art"/>
                <p>Drop to add</p>
            </div>
        </div>
    )
}

/* ------------------------------------------------------------------- logs */

function LogPane({log, open, onToggle}) {
    const ref = useRef(null)
    useEffect(() => {
        if (open && ref.current) ref.current.scrollTop = ref.current.scrollHeight
    }, [log, open])

    if (!log.length) return null
    return (
        <footer className="logs">
            <button className="logs__toggle" onClick={onToggle}>
                {open ? 'Hide details' : 'Show details'}
            </button>
            {open && <pre className="logs__body" ref={ref}>{log.join('\n')}</pre>}
        </footer>
    )
}
