import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode
} from 'react'
import { AlertTriangle, Check, ChevronDown, Info, Inbox, Loader2, X } from 'lucide-react'
import { clamp } from '@/lib/hooks'

/* ------------------------------------------------------------------ toasts */

export type ToastTone = 'ok' | 'err' | 'info'
interface Toast {
  id: number
  message: string
  tone: ToastTone
}

interface ToastApi {
  notify: (message: string, tone?: ToastTone) => void
}

const ToastContext = createContext<ToastApi>({ notify: () => undefined })

export function useToast(): ToastApi {
  return useContext(ToastContext)
}

export function ToastProvider({ children }: { children: ReactNode }): ReactNode {
  const [toasts, setToasts] = useState<Toast[]>([])

  const notify = useCallback((message: string, tone: ToastTone = 'info') => {
    const id = Date.now() + Math.random()
    setToasts((prev) => [...prev.slice(-3), { id, message, tone }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), tone === 'err' ? 7000 : 3800)
  }, [])

  const dismiss = (id: number): void => setToasts((prev) => prev.filter((t) => t.id !== id))

  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      <div className="toasts">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast--${toast.tone === 'err' ? 'err' : toast.tone === 'ok' ? 'ok' : ''}`}>
            <span style={{ marginTop: 1, color: toast.tone === 'err' ? 'var(--err)' : toast.tone === 'ok' ? 'var(--ok)' : 'var(--accent)' }}>
              {toast.tone === 'err' ? <AlertTriangle size={15} /> : toast.tone === 'ok' ? <Check size={15} /> : <Info size={15} />}
            </span>
            <div className="toast__body">{toast.message}</div>
            <button className="btn btn--icon" onClick={() => dismiss(toast.id)} aria-label="Fermer">
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

/* ------------------------------------------------------------------ button */

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'danger' | 'ghost'
  size?: 'md' | 'sm'
  icon?: ReactNode
  loading?: boolean
}

export function Btn({ variant = 'default', size = 'md', icon, loading, children, className = '', ...rest }: BtnProps): ReactNode {
  return (
    <button
      {...rest}
      className={`btn ${variant !== 'default' ? `btn--${variant}` : ''} ${size === 'sm' ? 'btn--sm' : ''} ${className}`}
      disabled={rest.disabled || loading}
    >
      {loading ? <Loader2 size={14} className="spin" style={{ animation: 'spin 1s linear infinite' }} /> : icon}
      {children}
    </button>
  )
}

export function IconBtn({ label, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }): ReactNode {
  return (
    <button {...rest} className={`btn btn--icon ${rest.className ?? ''}`} title={label} aria-label={label}>
      {children}
    </button>
  )
}

/* ------------------------------------------------------------------- cards */

export function Card({
  title,
  subtitle,
  icon,
  actions,
  children,
  bodyClassName = '',
  className = '',
  style
}: {
  title?: ReactNode
  subtitle?: ReactNode
  icon?: ReactNode
  actions?: ReactNode
  children: ReactNode
  bodyClassName?: string
  className?: string
  style?: CSSProperties
}): ReactNode {
  return (
    <section className={`card ${className}`} style={style}>
      {(title || actions) && (
        <header className="card__head">
          {title && (
            <div className="card__title">
              {icon}
              {title}
              {subtitle && <span className="card__sub">{subtitle}</span>}
            </div>
          )}
          {actions && <div className="card__actions">{actions}</div>}
        </header>
      )}
      <div className={`card__body ${bodyClassName}`}>{children}</div>
    </section>
  )
}

/* ------------------------------------------------------------------ badges */

export type Tone = 'ok' | 'warn' | 'err' | 'muted' | 'accent'

export function Badge({ tone = 'muted', children }: { tone?: Tone; children: ReactNode }): ReactNode {
  return <span className={`badge badge--${tone}`}>{children}</span>
}

export function StatusDot({ status }: { status: string }): ReactNode {
  return <span className={`dot dot--${status}`} />
}

/* ------------------------------------------------------------------- rings */

const toneColor = (value: number): string => (value >= 90 ? 'var(--err)' : value >= 75 ? 'var(--warn)' : 'var(--accent)')

export function Ring({
  value,
  size = 68,
  stroke = 7,
  color,
  label
}: {
  value: number
  size?: number
  stroke?: number
  color?: string
  label?: string
}): ReactNode {
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const pct = clamp(Number.isFinite(value) ? value : 0)
  const strokeColor = color ?? toneColor(pct)
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={strokeColor}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - (circumference * pct) / 100}
          style={{ transition: 'stroke-dashoffset 0.5s ease, stroke 0.3s ease' }}
        />
      </svg>
      <div className="ring__center">{label ?? `${Math.round(pct)}%`}</div>
    </div>
  )
}

export function Meter({ value, color }: { value: number; color?: string }): ReactNode {
  const pct = clamp(Number.isFinite(value) ? value : 0)
  return (
    <div className="meter">
      <div className="meter__fill" style={{ width: `${pct}%`, background: color ?? toneColor(pct) }} />
    </div>
  )
}

/* ------------------------------------------------------------------- chart */

export function AreaChart({
  values,
  height = 64,
  max = 100,
  color = 'var(--accent)',
  showScale = false
}: {
  values: number[]
  height?: number
  max?: number
  color?: string
  showScale?: boolean
}): ReactNode {
  const id = useId().replace(/:/g, '')
  const width = 320
  const points = values.length ? values : [0]
  const step = points.length > 1 ? width / (points.length - 1) : width

  const y = (value: number): number => height - 3 - (Math.min(max, Math.max(0, value)) / max) * (height - 8)
  const line = points.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(2)},${y(v).toFixed(2)}`).join(' ')
  const area = `${line} L${width},${height} L0,${height} Z`

  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ height }}>
      {showScale &&
        [25, 50, 75].map((line) => (
          <line key={line} x1={0} x2={width} y1={y((max * line) / 100)} y2={y((max * line) / 100)} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
        ))}
      <defs>
        <linearGradient id={`grad-${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#grad-${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

/* ------------------------------------------------------------------- modal */

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  wide = false
}: {
  open: boolean
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}): ReactNode {
  useEffect(() => {
    if (!open) return
    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal--wide' : ''}`}>
        <header className="modal__head">
          <h3>{title}</h3>
          <IconBtn label="Fermer" onClick={onClose} style={{ marginLeft: 'auto' }}>
            <X size={15} />
          </IconBtn>
        </header>
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__foot">{footer}</footer>}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- feedback */

export function Empty({ title, hint, icon }: { title: string; hint?: string; icon?: ReactNode }): ReactNode {
  return (
    <div className="empty">
      <div className="empty__icon">{icon ?? <Inbox size={20} />}</div>
      <strong>{title}</strong>
      {hint && <span>{hint}</span>}
    </div>
  )
}

export function Loading({ label = 'Chargement…' }: { label?: string }): ReactNode {
  return (
    <div className="empty">
      <div className="spinner" />
      <span>{label}</span>
    </div>
  )
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }): ReactNode {
  return (
    <div className="stack">
      <div className="alert alert--err">
        <AlertTriangle size={15} />
        <span className="grow">{message}</span>
        {onRetry && (
          <Btn size="sm" variant="ghost" onClick={onRetry}>
            Réessayer
          </Btn>
        )}
      </div>
    </div>
  )
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Rechercher…'
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}): ReactNode {
  return (
    <div className="search">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.2-3.2" />
      </svg>
      <input className="input" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

export function Dropdown({
  label,
  icon,
  active,
  items
}: {
  label: string
  icon: ReactNode
  active?: boolean
  items: { key: string; label: string; icon: ReactNode; active?: boolean; onSelect: () => void }[]
}): ReactNode {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="dropdown" ref={ref}>
      <button className={`dropdown__trigger ${active ? 'dropdown__trigger--active' : ''}`} onClick={() => setOpen((v) => !v)}>
        {icon}
        {label}
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className="dropdown__panel">
          <div className="dropdown__label">Outils serveur</div>
          {items.map((item) => (
            <button
              key={item.key}
              className={`dropdown__item ${item.active ? 'dropdown__item--active' : ''}`}
              onClick={() => {
                item.onSelect()
                setOpen(false)
              }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function useCopyToClipboard(): (text: string) => void {
  const { notify } = useToast()
  return useCallback(
    (text: string) => {
      void navigator.clipboard.writeText(text).then(() => notify('Copié dans le presse-papiers', 'ok'))
    },
    [notify]
  )
}

export function KpiCard({
  icon,
  label,
  value,
  hint,
  ringValue,
  color
}: {
  icon?: ReactNode
  label: string
  value: ReactNode
  hint?: ReactNode
  ringValue?: number
  color?: string
}): ReactNode {
  return (
    <div className="kpi">
      {ringValue !== undefined ? (
        <Ring value={ringValue} color={color} />
      ) : (
        <div className="empty__icon" style={{ width: 46, height: 46, borderRadius: 12 }}>
          {icon}
        </div>
      )}
      <div className="kpi__body">
        <div className="kpi__label">{label}</div>
        <div className="kpi__value">{value}</div>
        {hint && <div className="kpi__hint">{hint}</div>}
      </div>
    </div>
  )
}
