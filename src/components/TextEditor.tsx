import { useCallback, useRef, useState } from 'react'
import type { PageState, LLMSettings } from '../types/ocr'
import { correctText } from '../utils/llm-client'

interface TextEditorProps {
  page: PageState
  llmSettings: LLMSettings
  onOCR: () => void
  onTextChange: (text: string) => void
  onCorrectedTextChange: (text: string) => void
  isOCRRunning: boolean
  hasLLMSettings: boolean
}

export function TextEditor({
  page,
  llmSettings,
  onOCR,
  onTextChange,
  onCorrectedTextChange,
  isOCRRunning,
  hasLLMSettings,
}: TextEditorProps) {
  const [isLLMRunning, setIsLLMRunning] = useState(false)
  const [llmError, setLLMError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const ocrText = page.ocrResult?.fullText ?? ''
  const correctedText = page.correctedText ?? ''
  const hasOCR = page.status === 'ocr_done' || page.status === 'llm_running' || page.status === 'llm_done'

  const handleLLMCorrect = useCallback(async () => {
    if (!ocrText || isLLMRunning) return

    const controller = new AbortController()
    abortRef.current = controller
    setIsLLMRunning(true)
    setLLMError(null)

    let accumulated = ''
    try {
      const result = await correctText(ocrText, llmSettings, {
        signal: controller.signal,
        onChunk: (chunk) => {
          accumulated += chunk
          onCorrectedTextChange(accumulated)
        },
      })
      onCorrectedTextChange(result || accumulated)
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        const msg = err instanceof Error ? err.message : 'LLM エラー'
        setLLMError(msg)
      }
    } finally {
      setIsLLMRunning(false)
      abortRef.current = null
    }
  }, [ocrText, llmSettings, isLLMRunning, onCorrectedTextChange])

  const handleStopLLM = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  return (
    <div className="text-editor">
      {/* OCRテキストパネル */}
      <div className="text-panel">
        <div className="text-panel-header">
          <h3>OCR テキスト</h3>
          <div className="text-panel-actions">
            <button
              className="btn btn-sm btn-primary"
              onClick={onOCR}
              disabled={isOCRRunning || page.status === 'ocr_running'}
            >
              {page.status === 'ocr_running' ? '実行中...' : 'OCR 実行'}
            </button>
          </div>
        </div>

        {page.status === 'idle' && (
          <div className="text-placeholder">
            <p>「OCR 実行」ボタンでテキストを認識します</p>
          </div>
        )}

        {page.status === 'ocr_running' && (
          <div className="text-placeholder">
            <div className="spinner" />
            <p>OCR 処理中...</p>
          </div>
        )}

        {hasOCR && (
          <textarea
            className="text-area"
            value={ocrText}
            onChange={(e) => onTextChange(e.target.value)}
            placeholder="OCR テキストがここに表示されます"
            spellCheck={false}
          />
        )}

        {page.error && (
          <div className="error-banner">{page.error}</div>
        )}
      </div>

      {/* LLM校正パネル */}
      <div className="text-panel">
        <div className="text-panel-header">
          <h3>LLM 校正</h3>
          <div className="text-panel-actions">
            {isLLMRunning ? (
              <button className="btn btn-sm btn-danger" onClick={handleStopLLM}>
                停止
              </button>
            ) : (
              <button
                className="btn btn-sm btn-secondary"
                onClick={handleLLMCorrect}
                disabled={!hasOCR || !ocrText || !hasLLMSettings || isLLMRunning}
                title={!hasLLMSettings ? 'LLM設定が必要です' : ''}
              >
                校正実行
              </button>
            )}
          </div>
        </div>

        {!hasLLMSettings && (
          <div className="text-placeholder muted">
            <p>LLM設定からプロバイダーを設定してください</p>
          </div>
        )}

        {hasLLMSettings && !hasOCR && (
          <div className="text-placeholder muted">
            <p>OCRを実行してから校正できます</p>
          </div>
        )}

        {llmError && (
          <div className="error-banner">{llmError}</div>
        )}

        {(hasOCR || correctedText) && hasLLMSettings && (
          <textarea
            className="text-area"
            value={correctedText}
            onChange={(e) => onCorrectedTextChange(e.target.value)}
            placeholder={isLLMRunning ? '校正中...' : '校正済みテキストがここに表示されます'}
            spellCheck={false}
          />
        )}
      </div>
    </div>
  )
}
