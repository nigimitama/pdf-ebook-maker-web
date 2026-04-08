/**
 * PDF・画像ファイルの読み込みと処理を管理するカスタムフック
 */

import { useCallback, useState } from 'react'
import type { ProcessedImage } from '../types/ocr'

// pdfjs-dist の動的インポート（初回使用時のみロード）
async function loadPdfJs() {
  const pdfjsLib = await import('pdfjs-dist')
  const pdfjsWorker = await import('pdfjs-dist/build/pdf.worker.mjs?url')
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker.default
  return pdfjsLib
}

async function pdfToProcessedImages(
  file: File,
  onProgress?: (current: number, total: number) => void
): Promise<ProcessedImage[]> {
  const pdfjsLib = await loadPdfJs()
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  const numPages = pdf.numPages

  const images: ProcessedImage[] = []

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    onProgress?.(pageNum, numPages)

    const page = await pdf.getPage(pageNum)
    const viewport = page.getViewport({ scale: 2.0 }) // 高解像度

    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height

    const ctx = canvas.getContext('2d')!
    await page.render({ canvasContext: ctx, viewport }).promise

    const dataUrl = canvas.toDataURL('image/jpeg', 0.95)

    images.push({
      id: `${file.name}_page_${pageNum}`,
      dataUrl,
      width: viewport.width,
      height: viewport.height,
      pdfPageIndex: pageNum - 1,
    })
  }

  return images
}

async function fileToProcessedImage(file: File): Promise<ProcessedImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string
      const img = new Image()
      img.onload = () => {
        resolve({
          id: `${file.name}_${Date.now()}`,
          dataUrl,
          width: img.naturalWidth,
          height: img.naturalHeight,
        })
      }
      img.onerror = reject
      img.src = dataUrl
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function isPDF(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/tiff']

export function useFileProcessor() {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadProgress, setLoadProgress] = useState({ current: 0, total: 0 })

  const processFiles = useCallback(async (files: FileList | File[]): Promise<ProcessedImage[]> => {
    setIsLoading(true)
    setError(null)

    const fileArray = Array.from(files)
    const results: ProcessedImage[] = []

    try {
      for (const file of fileArray) {
        if (isPDF(file)) {
          const pages = await pdfToProcessedImages(file, (current, total) => {
            setLoadProgress({ current, total })
          })
          results.push(...pages)
        } else if (IMAGE_TYPES.includes(file.type) || file.name.match(/\.(jpg|jpeg|png|webp|bmp|tiff?)$/i)) {
          const img = await fileToProcessedImage(file)
          results.push(img)
        } else {
          console.warn(`Unsupported file type: ${file.type} (${file.name})`)
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'ファイルの読み込みに失敗しました'
      setError(message)
    } finally {
      setIsLoading(false)
      setLoadProgress({ current: 0, total: 0 })
    }

    return results
  }, [])

  const clearError = useCallback(() => setError(null), [])

  return { processFiles, isLoading, error, loadProgress, clearError }
}
