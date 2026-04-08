import { useState } from 'react'
import type { PageState } from '../types/ocr'
import { generateSearchablePDF, downloadPDF } from '../utils/pdf-generator'

interface ExportPanelProps {
  pages: PageState[]
  onClose: () => void
}

export function ExportPanel({ pages, onClose }: ExportPanelProps) {
  const [title, setTitle] = useState('電子書籍')
  const [author, setAuthor] = useState('')
  const [imageQuality, setImageQuality] = useState(0.85)
  const [includeTextLayer, setIncludeTextLayer] = useState(true)
  const [preferCorrected, setPreferCorrected] = useState(true)
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pagesDone = pages.filter(p =>
    p.status === 'ocr_done' || p.status === 'llm_done'
  ).length

  const handleExport = async () => {
    setIsExporting(true)
    setError(null)

    try {
      const pdfBytes = await generateSearchablePDF(pages, {
        title,
        author,
        imageQuality,
        includeTextLayer,
        preferCorrectedText: preferCorrected,
      })

      const filename = title.trim() || 'ebook'
      downloadPDF(pdfBytes, filename)
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'エクスポートに失敗しました'
      setError(msg)
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>PDF エクスポート</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <div className="export-summary">
            <p>
              <strong>{pages.length}</strong> ページ中
              <strong> {pagesDone}</strong> ページがOCR済み
            </p>
          </div>

          <div className="form-group">
            <label>タイトル</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="電子書籍のタイトル"
            />
          </div>

          <div className="form-group">
            <label>著者</label>
            <input
              type="text"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="著者名（省略可）"
            />
          </div>

          <div className="form-group">
            <label>画像品質: {Math.round(imageQuality * 100)}%</label>
            <input
              type="range"
              min={0.5}
              max={1.0}
              step={0.05}
              value={imageQuality}
              onChange={(e) => setImageQuality(Number(e.target.value))}
            />
            <p className="form-hint">高いほど高品質だがファイルサイズが大きくなります</p>
          </div>

          <div className="form-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={includeTextLayer}
                onChange={(e) => setIncludeTextLayer(e.target.checked)}
              />
              透明テキストレイヤーを追加（検索・コピー対応）
            </label>
          </div>

          {includeTextLayer && (
            <div className="form-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={preferCorrected}
                  onChange={(e) => setPreferCorrected(e.target.checked)}
                />
                LLM校正済みテキストを優先する
              </label>
            </div>
          )}

          {error && <div className="error-banner">{error}</div>}
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose}>キャンセル</button>
          <button
            className="btn btn-primary"
            onClick={handleExport}
            disabled={isExporting || pages.length === 0}
          >
            {isExporting ? 'エクスポート中...' : 'PDFをダウンロード'}
          </button>
        </div>
      </div>
    </div>
  )
}
