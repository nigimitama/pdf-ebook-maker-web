import type { PageState } from '../types/ocr'

interface SidebarProps {
  pages: PageState[]
  selectedIdx: number
  onSelect: (idx: number) => void
  onRunOCRAll: () => void
  onAddFiles: () => void
  isOCRRunning: boolean
}

const STATUS_ICONS: Record<PageState['status'], string> = {
  idle: '⬜',
  ocr_running: '⏳',
  ocr_done: '✅',
  llm_running: '🤖',
  llm_done: '✨',
  error: '❌',
}

export function Sidebar({
  pages,
  selectedIdx,
  onSelect,
  onRunOCRAll,
  onAddFiles,
  isOCRRunning,
}: SidebarProps) {
  const canRunOCR = pages.some(p => p.status === 'idle') && !isOCRRunning

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h2>ページ一覧</h2>
        <div className="sidebar-actions">
          <button
            className="btn btn-sm"
            onClick={onAddFiles}
            title="ファイルを追加"
          >
            ＋ 追加
          </button>
          <button
            className="btn btn-sm btn-primary"
            onClick={onRunOCRAll}
            disabled={!canRunOCR}
            title="全ページのOCRを実行"
          >
            {isOCRRunning ? '実行中...' : 'OCR 全実行'}
          </button>
        </div>
      </div>

      <div className="page-list">
        {pages.length === 0 ? (
          <div className="page-list-empty">
            <p>ページがありません</p>
          </div>
        ) : (
          pages.map((page, idx) => (
            <div
              key={page.id}
              className={`page-item ${idx === selectedIdx ? 'selected' : ''}`}
              onClick={() => onSelect(idx)}
            >
              <div className="page-thumbnail">
                <img src={page.image.dataUrl} alt={`ページ ${idx + 1}`} loading="lazy" />
                <span className="page-status-badge">{STATUS_ICONS[page.status]}</span>
              </div>
              <div className="page-info">
                <span className="page-number">p.{idx + 1}</span>
                {page.status === 'error' && (
                  <span className="page-error-text" title={page.error}>エラー</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  )
}
