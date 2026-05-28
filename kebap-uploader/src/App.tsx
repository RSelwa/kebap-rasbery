import { useState, useRef, useCallback } from 'react'
import { Upload, X, Film, ImageIcon } from 'lucide-react'
import { BASE_URL, CANVAS_WIDTH, CANVAS_HEIGHT, MAX_UPLOAD_MB } from '@/config'
import { cn } from '@/lib/utils'

type Status = 'idle' | 'resizing' | 'uploading' | 'success' | 'error'

interface FileState {
  file: File
  preview: string | null
  isAnimated: boolean
}

function isAnimated(file: File): boolean {
  return file.type.startsWith('video/') || file.name.toLowerCase().endsWith('.gif')
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

async function resizeToCanvas(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = CANVAS_WIDTH
      canvas.height = CANVAS_HEIGHT
      const ctx = canvas.getContext('2d')
      if (!ctx) { reject(new Error('Canvas not supported')); return }
      ctx.drawImage(img, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')) }
    img.src = url
  })
}

export default function App() {
  const [fileState, setFileState] = useState<FileState | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback(async (file: File) => {
    setMessage(null)
    setStatus('idle')

    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      setMessage(`File too large — max ${MAX_UPLOAD_MB} MB`)
      setStatus('error')
      return
    }

    const animated = isAnimated(file)
    if (!animated) {
      // Pre-resize to show exact preview
      setStatus('resizing')
      try {
        const preview = await resizeToCanvas(file)
        setFileState({ file, preview, isAnimated: false })
        setStatus('idle')
      } catch {
        setMessage('Could not load image')
        setStatus('error')
      }
    } else {
      setFileState({ file, preview: null, isAnimated: true })
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) void handleFile(file)
  }, [handleFile])

  const handleUpload = async () => {
    if (!fileState) return
    setMessage(null)

    try {
      if (fileState.isAnimated) {
        setStatus('uploading')
        const formData = new FormData()
        formData.append('file', fileState.file)
        const res = await fetch(`${BASE_URL}/api/upload`, { method: 'POST', body: formData })
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: res.statusText })) as { error: string }
          throw new Error(err.error)
        }
        const data = await res.json() as { frame_count: number; fps: number }
        setMessage(`${data.frame_count} frames @ ${data.fps} fps`)
      } else {
        // preview is the already-resized base64 from resize step
        setStatus('uploading')
        const res = await fetch(`${BASE_URL}/api/layout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            layers: [{
              id: crypto.randomUUID().slice(0, 8),
              type: 'image',
              data: fileState.preview,
              x: 0, y: 0,
              w: CANVAS_WIDTH, h: CANVAS_HEIGHT,
            }],
          }),
        })
        if (!res.ok) throw new Error('Failed to send layout')
        setMessage('Sent to screen')
      }
      setStatus('success')
    } catch (err) {
      setStatus('error')
      setMessage(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  const clear = () => {
    setFileState(null)
    setStatus('idle')
    setMessage(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const busy = status === 'uploading' || status === 'resizing'

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">

        {/* Header */}
        <div className="text-center">
          <h1 className="text-xl font-semibold text-white tracking-tight">Kebap LED</h1>
          <p className="text-zinc-500 text-xs mt-0.5">{CANVAS_WIDTH} × {CANVAS_HEIGHT} px</p>
        </div>

        {/* Card */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">

          {!fileState ? (
            /* Drop zone */
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
              onClick={() => inputRef.current?.click()}
              className={cn(
                'border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors',
                isDragOver
                  ? 'border-zinc-400 bg-zinc-800/60'
                  : 'border-zinc-700 hover:border-zinc-500 hover:bg-zinc-800/30',
              )}
            >
              <Upload className="mx-auto mb-3 text-zinc-600" size={28} />
              <p className="text-zinc-400 text-sm font-medium">Drop a file or click to browse</p>
              <p className="text-zinc-600 text-xs mt-1">
                Images · GIFs · Videos &nbsp;·&nbsp; max {MAX_UPLOAD_MB} MB
              </p>
              <input
                ref={inputRef}
                type="file"
                accept="image/*,video/*,.gif"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f) }}
              />
            </div>
          ) : (
            /* File selected */
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {fileState.isAnimated
                    ? <Film size={14} className="text-violet-400 shrink-0" />
                    : <ImageIcon size={14} className="text-sky-400 shrink-0" />
                  }
                  <div className="min-w-0">
                    <p className="text-sm text-white font-medium truncate leading-tight">
                      {fileState.file.name}
                    </p>
                    <p className="text-xs text-zinc-500 leading-tight">{formatSize(fileState.file.size)}</p>
                  </div>
                </div>
                <button
                  onClick={clear}
                  className="text-zinc-600 hover:text-zinc-300 transition-colors shrink-0"
                >
                  <X size={14} />
                </button>
              </div>

              {/* Image preview — shows exactly what'll appear on the matrix */}
              {fileState.preview && (
                <div className="rounded-lg overflow-hidden border border-zinc-800 bg-black">
                  <img
                    src={fileState.preview}
                    alt="matrix preview"
                    className="w-full h-auto"
                    style={{ imageRendering: 'pixelated', aspectRatio: `${CANVAS_WIDTH}/${CANVAS_HEIGHT}` }}
                  />
                  <p className="text-center text-zinc-600 text-xs py-1">
                    Preview at {CANVAS_WIDTH}×{CANVAS_HEIGHT}
                  </p>
                </div>
              )}

              {fileState.isAnimated && (
                <p className="text-xs text-zinc-500 bg-zinc-800/60 rounded-lg px-3 py-2 text-center">
                  Frames extracted & resized server-side
                </p>
              )}
            </div>
          )}

          {/* Status message */}
          {message && (
            <div className={cn(
              'text-xs rounded-lg px-3 py-2 text-center',
              status === 'error'
                ? 'text-red-400 bg-red-950/40 border border-red-900/50'
                : 'text-green-400 bg-green-950/40 border border-green-900/50',
            )}>
              {message}
            </div>
          )}

          {/* Send button */}
          <button
            onClick={() => void handleUpload()}
            disabled={!fileState || busy}
            className={cn(
              'w-full rounded-xl py-2.5 text-sm font-medium transition-colors',
              !fileState || busy
                ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
                : 'bg-white text-zinc-900 hover:bg-zinc-100 active:bg-zinc-200',
            )}
          >
            {status === 'resizing' ? 'Resizing…'
              : status === 'uploading' ? 'Sending…'
              : 'Send to screen'}
          </button>
        </div>

        {/* Server URL footer */}
        <p className="text-center text-xs text-zinc-700">{BASE_URL}</p>
      </div>
    </div>
  )
}
