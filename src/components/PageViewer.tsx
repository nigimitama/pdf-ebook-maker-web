import type { PageState } from '../types/ocr'

interface PageViewerProps {
  page: PageState
  showOverlay: boolean
}

export function PageViewer({ page, showOverlay }: PageViewerProps) {
  const { image, ocrResult } = page

  return (
    <div className="page-viewer">
      <div className="page-image-container" style={{ position: 'relative', display: 'inline-block' }}>
        <img
          src={image.dataUrl}
          alt="ページ画像"
          className="page-image"
          style={{ maxWidth: '100%', display: 'block' }}
        />

        {/* OCR 結果オーバーレイ（テキスト領域のハイライト） */}
        {showOverlay && ocrResult && ocrResult.textBlocks.length > 0 && (
          <svg
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
            }}
            viewBox={`0 0 ${image.width} ${image.height}`}
            preserveAspectRatio="none"
          >
            {ocrResult.textBlocks.map((block, i) => (
              <g key={i}>
                <rect
                  x={block.x}
                  y={block.y}
                  width={block.width}
                  height={block.height}
                  fill="rgba(59, 130, 246, 0.12)"
                  stroke="rgba(59, 130, 246, 0.5)"
                  strokeWidth="1"
                />
                <title>{block.text}</title>
              </g>
            ))}
          </svg>
        )}
      </div>
    </div>
  )
}
