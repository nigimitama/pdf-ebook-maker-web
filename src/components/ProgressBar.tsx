import type { OCRJobState } from '../types/ocr'

interface ProgressBarProps {
  jobState: OCRJobState
}

const STAGE_LABELS: Record<string, string> = {
  init: 'モデルを読み込み中...',
  layout: 'レイアウト検出中...',
  recognition: '文字認識中...',
  reading_order: '読み順処理中...',
  processing: '処理中...',
}

export function ProgressBar({ jobState }: ProgressBarProps) {
  const { status, stageProgress, modelProgress } = jobState

  if (status === 'idle' || status === 'done' || status === 'error') {
    return null
  }

  const isLoadingModel = status === 'loading_model'

  return (
    <div className="progress-overlay">
      <div className="progress-card">
        {isLoadingModel ? (
          <>
            <p className="progress-label">モデルをダウンロード中...</p>
            <p className="progress-hint">
              初回起動時にONNXモデルをダウンロードします（数百MB）。<br />
              2回目以降はキャッシュから即時読み込みされます。
            </p>
            <div className="model-progress-list">
              <ModelProgressItem label="レイアウト検出" progress={modelProgress.layout} />
              <ModelProgressItem label="認識 (30文字)" progress={modelProgress.rec30} />
              <ModelProgressItem label="認識 (50文字)" progress={modelProgress.rec50} />
              <ModelProgressItem label="認識 (100文字)" progress={modelProgress.rec100} />
            </div>
          </>
        ) : (
          <>
            <p className="progress-label">
              {STAGE_LABELS[jobState.status] ?? '処理中...'}
            </p>
            <div className="progress-bar-track">
              <div
                className="progress-bar-fill"
                style={{ width: `${Math.round(stageProgress * 100)}%` }}
              />
            </div>
            <p className="progress-pct">{Math.round(stageProgress * 100)}%</p>
          </>
        )}
      </div>
    </div>
  )
}

function ModelProgressItem({ label, progress }: { label: string; progress: number }) {
  return (
    <div className="model-progress-item">
      <span className="model-progress-label">{label}</span>
      <div className="progress-bar-track small">
        <div
          className="progress-bar-fill"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>
      <span className="model-progress-pct">
        {progress >= 1 ? '✅' : `${Math.round(progress * 100)}%`}
      </span>
    </div>
  )
}
