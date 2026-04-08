/**
 * 検索可能PDFの生成
 *
 * 各ページに画像を埋め込み、透明テキストレイヤーを追加することで
 * テキスト検索・コピーが可能な PDF を生成する。
 *
 * 参照実装: nigimitama/pdf-ebook-maker/src/pdf/builder.py
 */

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import type { PageState } from '../types/ocr'

export interface PDFExportOptions {
  /** タイトル（PDFメタデータ） */
  title?: string
  /** 著者（PDFメタデータ） */
  author?: string
  /** JPEG品質 0-1 */
  imageQuality?: number
  /** テキストレイヤーを含めるか */
  includeTextLayer?: boolean
  /** 校正済みテキストを優先するか */
  preferCorrectedText?: boolean
}

export async function generateSearchablePDF(
  pages: PageState[],
  options: PDFExportOptions = {}
): Promise<Uint8Array> {
  const {
    title = 'PDF eBook',
    author = '',
    imageQuality = 0.85,
    includeTextLayer = true,
    preferCorrectedText = true,
  } = options

  const pdfDoc = await PDFDocument.create()

  // メタデータ設定
  pdfDoc.setTitle(title)
  if (author) pdfDoc.setAuthor(author)
  pdfDoc.setCreator('PDF eBook Maker Web')
  pdfDoc.setCreationDate(new Date())

  // フォント埋め込み（透明テキストレイヤー用）
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)

  for (const page of pages) {
    if (!page.image.dataUrl) continue

    // 画像をJPEGとして埋め込み
    const imageBytes = await dataUrlToJpegBytes(page.image.dataUrl, imageQuality)
    const pdfImage = await pdfDoc.embedJpg(imageBytes)

    // ページサイズを画像サイズに合わせる（A4比率に近似）
    const imgWidth = pdfImage.width
    const imgHeight = pdfImage.height

    const pdfPage = pdfDoc.addPage([imgWidth, imgHeight])

    // 画像をページ全体に描画
    pdfPage.drawImage(pdfImage, {
      x: 0,
      y: 0,
      width: imgWidth,
      height: imgHeight,
    })

    // テキストレイヤーを追加
    if (includeTextLayer && page.ocrResult) {
      const text = preferCorrectedText && page.correctedText
        ? page.correctedText
        : page.ocrResult.fullText

      if (text) {
        // テキストを行ごとに分割して配置
        // 単純な実装: 透明テキストをページ全体に重ねる
        embedInvisibleText(pdfPage, pdfImage, text, page, font, imgWidth, imgHeight)
      }

      // テキストブロックごとに位置情報を使って透明テキストを配置
      if (page.ocrResult.textBlocks && page.ocrResult.textBlocks.length > 0) {
        for (const block of page.ocrResult.textBlocks) {
          if (!block.text) continue

          const blockText = preferCorrectedText && page.correctedText
            ? '' // 全体テキストは上で処理済み
            : block.text

          if (!blockText) continue

          // ブロックの位置に透明テキストを配置
          // PDFの座標系は左下が原点なので変換
          const pdfX = block.x
          const pdfY = imgHeight - block.y - block.height
          const fontSize = Math.max(6, Math.min(block.height * 0.8, 14))

          try {
            pdfPage.drawText(blockText, {
              x: pdfX,
              y: pdfY,
              size: fontSize,
              font,
              color: rgb(0, 0, 0),
              opacity: 0, // 透明（検索・コピー可能だが見えない）
            })
          } catch {
            // テキスト描画エラーは無視（非ASCII文字が含まれる場合など）
          }
        }
      }
    }
  }

  return pdfDoc.save()
}

function embedInvisibleText(
  pdfPage: ReturnType<PDFDocument['addPage']>,
  _pdfImage: { width: number; height: number },
  text: string,
  _page: PageState,
  font: Awaited<ReturnType<PDFDocument['embedFont']>>,
  imgWidth: number,
  imgHeight: number
): void {
  // テキスト全体を透明でページ下部に配置（フォールバック）
  const lines = text.split('\n').filter(l => l.trim())
  const fontSize = 8

  lines.forEach((line, i) => {
    const y = Math.max(0, imgHeight - 10 - i * (fontSize + 2))
    try {
      pdfPage.drawText(line, {
        x: 0,
        y,
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
        opacity: 0,
        maxWidth: imgWidth,
      })
    } catch {
      // 非ASCII文字はスキップ
    }
  })
}

async function dataUrlToJpegBytes(dataUrl: string, quality: number): Promise<Uint8Array> {
  // dataUrlが既にJPEGの場合はそのまま返す
  if (dataUrl.startsWith('data:image/jpeg')) {
    const base64 = dataUrl.split(',')[1]
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  }

  // PNG等の場合はCanvasでJPEGに変換
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')!

      // 白背景を塗ってからJPEG変換（透過PNG対応）
      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0)

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Canvas to blob failed'))
            return
          }
          blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)))
        },
        'image/jpeg',
        quality
      )
    }
    img.onerror = reject
    img.src = dataUrl
  })
}

/** PDFをダウンロードさせる */
export function downloadPDF(pdfBytes: Uint8Array, filename: string): void {
  const blob = new Blob([pdfBytes], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.pdf') ? filename : `${filename}.pdf`
  a.click()
  URL.revokeObjectURL(url)
}
