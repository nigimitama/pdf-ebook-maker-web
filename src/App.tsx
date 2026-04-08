import { useCallback, useRef, useState } from 'react'
import type { PageState, LLMSettings } from './types/ocr'
import { useOCRWorker } from './hooks/useOCRWorker'
import { useFileProcessor } from './hooks/useFileProcessor'
import { FileUpload } from './components/FileUpload'
import { Sidebar } from './components/Sidebar'
import { PageViewer } from './components/PageViewer'
import { TextEditor } from './components/TextEditor'
import { LLMSettingsModal } from './components/LLMSettings'
import { ExportPanel } from './components/ExportPanel'
import { ProgressBar } from './components/ProgressBar'
import { DEFAULT_SYSTEM_PROMPT, getDefaultModel } from './utils/llm-client'
import './App.css'

const DEFAULT_LLM_SETTINGS: LLMSettings = {
  provider: 'ollama',
  apiKey: '',
  baseUrl: 'http://localhost:11434',
  model: getDefaultModel('ollama'),
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
}

function loadLLMSettings(): LLMSettings {
  try {
    const saved = localStorage.getItem('llm_settings')
    if (saved) return { ...DEFAULT_LLM_SETTINGS, ...JSON.parse(saved) }
  } catch { /* ignore */ }
  return DEFAULT_LLM_SETTINGS
}

function saveLLMSettings(settings: LLMSettings): void {
  // API キーはセキュリティ上 localStorage には保存しない
  const toSave = { ...settings, apiKey: '' }
  localStorage.setItem('llm_settings', JSON.stringify(toSave))
}

export default function App() {
  const [pages, setPages] = useState<PageState[]>([])
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [llmSettings, setLLMSettings] = useState<LLMSettings>(loadLLMSettings)
  const [showLLMSettings, setShowLLMSettings] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [showOverlay, setShowOverlay] = useState(true)

  const { jobState, processImage } = useOCRWorker()
  const { processFiles, isLoading: isFileLoading } = useFileProcessor()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const selectedPage = pages[selectedIdx] ?? null

  const hasLLMSettings = !!(
    (llmSettings.provider === 'ollama' && llmSettings.baseUrl) ||
    (llmSettings.provider === 'bonsai' && llmSettings.baseUrl) ||
    (llmSettings.provider === 'openai' && llmSettings.apiKey) ||
    (llmSettings.provider === 'anthropic' && llmSettings.apiKey) ||
    (llmSettings.provider === 'custom' && llmSettings.baseUrl)
  )

  // ファイルを追加
  const handleFiles = useCallback(async (files: File[]) => {
    const images = await processFiles(files)
    if (images.length === 0) return

    const newPages: PageState[] = images.map(image => ({
      id: image.id,
      image,
      status: 'idle',
    }))

    setPages(prev => {
      const updated = [...prev, ...newPages]
      // 新しく追加した最初のページを選択
      if (prev.length === 0) setSelectedIdx(0)
      else setSelectedIdx(prev.length)
      return updated
    })
  }, [processFiles])

  // 単一ページのOCR実行
  const handleOCRPage = useCallback(async (idx: number) => {
    const page = pages[idx]
    if (!page || page.status === 'ocr_running') return

    // ImageData を作成（dataUrl から）
    const imageData = await dataUrlToImageData(page.image.dataUrl)

    setPages(prev => prev.map((p, i) =>
      i === idx ? { ...p, status: 'ocr_running', error: undefined } : p
    ))

    try {
      const result = await processImage(imageData)
      setPages(prev => prev.map((p, i) =>
        i === idx ? { ...p, ocrResult: result, status: 'ocr_done' } : p
      ))
    } catch (err) {
      const error = err instanceof Error ? err.message : 'OCR エラー'
      setPages(prev => prev.map((p, i) =>
        i === idx ? { ...p, status: 'error', error } : p
      ))
    }
  }, [pages, processImage])

  // 全ページOCR
  const handleOCRAll = useCallback(async () => {
    const idlePages = pages
      .map((p, i) => ({ page: p, idx: i }))
      .filter(({ page }) => page.status === 'idle')

    for (const { idx } of idlePages) {
      await handleOCRPage(idx)
    }
  }, [pages, handleOCRPage])

  // テキスト更新
  const handleTextChange = useCallback((idx: number, text: string) => {
    setPages(prev => prev.map((p, i) =>
      i === idx
        ? { ...p, ocrResult: p.ocrResult ? { ...p.ocrResult, fullText: text } : p.ocrResult }
        : p
    ))
  }, [])

  const handleCorrectedTextChange = useCallback((idx: number, text: string) => {
    setPages(prev => prev.map((p, i) =>
      i === idx ? { ...p, correctedText: text } : p
    ))
  }, [])

  const handleSaveLLMSettings = useCallback((settings: LLMSettings) => {
    setLLMSettings(settings)
    saveLLMSettings(settings)
  }, [])

  const isOCRRunning = pages.some(p => p.status === 'ocr_running')

  return (
    <div className="app">
      {/* ヘッダー */}
      <header className="header">
        <div className="header-left">
          <h1 className="header-title">📖 PDF eBook Maker</h1>
        </div>
        <div className="header-right">
          {selectedPage?.ocrResult && (
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={showOverlay}
                onChange={(e) => setShowOverlay(e.target.checked)}
              />
              OCR枠を表示
            </label>
          )}
          <button
            className="btn btn-sm"
            onClick={() => setShowLLMSettings(true)}
            title="LLM設定"
          >
            🤖 LLM設定
          </button>
          <button
            className="btn btn-sm btn-primary"
            onClick={() => setShowExport(true)}
            disabled={pages.length === 0}
            title="PDFエクスポート"
          >
            📥 PDFエクスポート
          </button>
        </div>
      </header>

      {/* メインレイアウト */}
      <main className="main-layout">
        {pages.length === 0 ? (
          // 初期状態: アップロード画面
          <div className="upload-screen">
            <FileUpload onFiles={handleFiles} isLoading={isFileLoading} />
          </div>
        ) : (
          <>
            {/* サイドバー */}
            <Sidebar
              pages={pages}
              selectedIdx={selectedIdx}
              onSelect={setSelectedIdx}
              onRunOCRAll={handleOCRAll}
              onAddFiles={() => fileInputRef.current?.click()}
              isOCRRunning={isOCRRunning}
            />

            {/* メインエリア */}
            <div className="content-area">
              {selectedPage && (
                <>
                  <div className="viewer-panel">
                    <PageViewer page={selectedPage} showOverlay={showOverlay} />
                  </div>
                  <div className="editor-panel">
                    <TextEditor
                      page={selectedPage}
                      llmSettings={llmSettings}
                      onOCR={() => handleOCRPage(selectedIdx)}
                      onTextChange={(text) => handleTextChange(selectedIdx, text)}
                      onCorrectedTextChange={(text) => handleCorrectedTextChange(selectedIdx, text)}
                      isOCRRunning={isOCRRunning}
                      hasLLMSettings={hasLLMSettings}
                    />
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </main>

      {/* 隠しファイル入力（追加ファイル用） */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,image/*"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => e.target.files && handleFiles(Array.from(e.target.files))}
      />

      {/* モデルロードプログレス */}
      <ProgressBar jobState={jobState} />

      {/* モーダル */}
      {showLLMSettings && (
        <LLMSettingsModal
          settings={llmSettings}
          onSave={handleSaveLLMSettings}
          onClose={() => setShowLLMSettings(false)}
        />
      )}

      {showExport && (
        <ExportPanel
          pages={pages}
          onClose={() => setShowExport(false)}
        />
      )}
    </div>
  )
}

/** data URL を ImageData に変換 */
async function dataUrlToImageData(dataUrl: string): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      resolve(ctx.getImageData(0, 0, canvas.width, canvas.height))
    }
    img.onerror = reject
    img.src = dataUrl
  })
}
