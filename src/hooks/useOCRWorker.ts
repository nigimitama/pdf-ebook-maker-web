/**
 * OCRワーカーを管理するカスタムフック
 *
 * デスクトップ: レイアウト検出ワーカー1つ + 認識ワーカー複数で並列処理
 * モバイル: OCRワーカー1つでシングルパス処理
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { OCRResult, OCRJobState, ModelProgress } from '../types/ocr'
import type { WorkerOutMessage, RecognitionWorkerOutMessage } from '../types/worker'

const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)

function getWorkerCount(): number {
  if (isMobile) return 0
  const cores = navigator.hardwareConcurrency || 4
  return Math.max(1, Math.min(cores - 1, 4))
}

export function useOCRWorker() {
  const ocrWorkerRef = useRef<Worker | null>(null)
  const recWorkersRef = useRef<Worker[]>([])

  const [jobState, setJobState] = useState<OCRJobState>({
    status: 'idle',
    currentFileIndex: 0,
    totalFiles: 0,
    stageProgress: 0,
    modelProgress: { layout: 0, rec30: 0, rec50: 0, rec100: 0 },
  })

  // ワーカー初期化
  useEffect(() => {
    const worker = new Worker(
      new URL('../worker/ocr.worker.ts', import.meta.url),
      { type: 'module' }
    )
    ocrWorkerRef.current = worker

    // 初期化中のプログレスメッセージを受け取るリスナー
    const handleInitMessage = (event: MessageEvent<WorkerOutMessage>) => {
      const msg = event.data
      if (msg.type === 'OCR_PROGRESS' && msg.stage === 'init') {
        if (msg.modelProgress) {
          setJobState(prev => ({
            ...prev,
            modelProgress: msg.modelProgress!,
          }))
        }
        if (msg.progress >= 1.0) {
          setJobState(prev => ({ ...prev, status: 'idle' }))
          worker.removeEventListener('message', handleInitMessage)
        }
      } else if (msg.type === 'OCR_ERROR' && msg.stage === 'init') {
        setJobState(prev => ({ ...prev, status: 'error', error: msg.error }))
        worker.removeEventListener('message', handleInitMessage)
      }
    }
    worker.addEventListener('message', handleInitMessage)

    // モバイルは INITIALIZE のみ（モデルロードは後回し）
    worker.postMessage({ type: 'INITIALIZE', layoutOnly: isMobile })

    setJobState(prev => ({ ...prev, status: 'loading_model' }))

    return () => {
      worker.removeEventListener('message', handleInitMessage)
      worker.postMessage({ type: 'TERMINATE' })
      worker.terminate()
      ocrWorkerRef.current = null

      recWorkersRef.current.forEach(w => {
        w.postMessage({ type: 'REC_TERMINATE' })
        w.terminate()
      })
      recWorkersRef.current = []
    }
  }, [])

  /**
   * 単一画像の OCR 処理（シングルワーカーモード）
   */
  const processImage = useCallback(
    (imageData: ImageData): Promise<OCRResult> => {
      return new Promise((resolve, reject) => {
        const worker = ocrWorkerRef.current
        if (!worker) {
          reject(new Error('OCR worker not initialized'))
          return
        }

        const jobId = `ocr_${Date.now()}_${Math.random().toString(36).slice(2)}`
        const startTime = Date.now()

        setJobState(prev => ({ ...prev, status: 'processing', stageProgress: 0 }))

        const handleMessage = (event: MessageEvent<WorkerOutMessage>) => {
          const msg = event.data

          if (msg.type === 'OCR_PROGRESS' && msg.jobId === jobId) {
            setJobState(prev => ({
              ...prev,
              stageProgress: msg.progress,
              modelProgress: msg.modelProgress ?? prev.modelProgress,
            }))
            return
          }

          if (msg.type === 'OCR_COMPLETE' && msg.jobId === jobId) {
            worker.removeEventListener('message', handleMessage)
            setJobState(prev => ({ ...prev, status: 'done', stageProgress: 1 }))
            resolve({
              id: jobId,
              textBlocks: msg.textBlocks,
              fullText: msg.fullText,
              processingTimeMs: Date.now() - startTime,
            })
            return
          }

          if (msg.type === 'OCR_ERROR' && msg.jobId === jobId) {
            worker.removeEventListener('message', handleMessage)
            setJobState(prev => ({ ...prev, status: 'error', error: msg.error }))
            reject(new Error(msg.error))
          }
        }

        worker.addEventListener('message', handleMessage)

        if (isMobile) {
          // モバイル: OCR_PROCESS で1ワーカーが全部やる
          worker.postMessage({ type: 'OCR_PROCESS', jobId, imageData })
        } else {
          // デスクトップ: LAYOUT_DETECT → 並列認識
          processWithParallelRecognition(worker, jobId, imageData, resolve, reject)
        }
      })
    },
    []
  )

  /**
   * デスクトップモード: レイアウト検出後、複数の認識ワーカーで並列処理
   */
  function processWithParallelRecognition(
    ocrWorker: Worker,
    jobId: string,
    imageData: ImageData,
    resolve: (result: OCRResult) => void,
    reject: (error: Error) => void
  ) {
    const startTime = Date.now()
    const workerCount = getWorkerCount()

    // 認識ワーカーを初期化（必要な場合）
    if (recWorkersRef.current.length === 0) {
      for (let i = 0; i < workerCount; i++) {
        const w = new Worker(
          new URL('../worker/recognition.worker.ts', import.meta.url),
          { type: 'module' }
        )
        w.postMessage({ type: 'REC_INIT', singleModelMode: false })
        recWorkersRef.current.push(w)
      }
    }

    const handleLayoutDone = (event: MessageEvent<WorkerOutMessage>) => {
      const msg = event.data
      if (msg.type !== 'LAYOUT_DONE' || msg.jobId !== jobId) return

      ocrWorker.removeEventListener('message', handleLayoutDone)

      const { lines, blocks, croppedBuffers, croppedWidths, croppedHeights } = msg

      if (lines.length === 0) {
        resolve({
          id: jobId,
          textBlocks: [],
          fullText: '',
          processingTimeMs: Date.now() - startTime,
        })
        return
      }

      // 読み順処理はメインスレッド側で行う（軽量なので）
      const pendingResults: Array<{ text: string; confidence: number; lineIndex: number }> = []
      let completedCount = 0

      const handleRecResult = (lineIndex: number, text: string, confidence: number) => {
        pendingResults.push({ text, confidence, lineIndex })
        completedCount++

        setJobState(prev => ({
          ...prev,
          stageProgress: completedCount / lines.length,
        }))

        if (completedCount === lines.length) {
          // 読み順でソート
          pendingResults.sort((a, b) => a.lineIndex - b.lineIndex)

          const textBlocks = lines.map((line, i) => {
            const result = pendingResults.find(r => r.lineIndex === i)
            return {
              ...line,
              text: result?.text ?? '',
              confidence: result?.confidence ?? 0,
              readingOrder: i,
            }
          })

          const fullText = textBlocks
            .map(b => b.text)
            .filter(t => t.length > 0)
            .join('\n')

          setJobState(prev => ({ ...prev, status: 'done', stageProgress: 1 }))

          resolve({
            id: jobId,
            textBlocks,
            fullText,
            processingTimeMs: Date.now() - startTime,
          })
        }
      }

      // 認識ワーカーにタスクを配布
      const recWorkers = recWorkersRef.current
      const workerMessageHandlers: Array<(e: MessageEvent) => void> = []

      recWorkers.forEach((w, workerIdx) => {
        const handler = (e: MessageEvent<RecognitionWorkerOutMessage>) => {
          const recMsg = e.data
          if (recMsg.type === 'REC_DONE' && recMsg.jobId === jobId) {
            handleRecResult(recMsg.regionIndex, recMsg.text, recMsg.confidence)
          } else if (recMsg.type === 'REC_ERROR' && recMsg.jobId === jobId) {
            handleRecResult(recMsg.regionIndex, '', 0)
          }
        }
        workerMessageHandlers.push(handler)
        w.addEventListener('message', handler)
      })

      // クリーンアップ関数を登録
      const originalResolve = resolve
      resolve = (result) => {
        recWorkers.forEach((w, i) => w.removeEventListener('message', workerMessageHandlers[i]))
        originalResolve(result)
      }

      // ラウンドロビンで各ワーカーにタスク配布
      for (let i = 0; i < lines.length; i++) {
        const workerIdx = i % recWorkers.length
        const buffer = croppedBuffers[i]
        recWorkers[workerIdx].postMessage(
          {
            type: 'REC_PROCESS',
            jobId,
            regionIndex: i,
            buffer,
            width: croppedWidths[i],
            height: croppedHeights[i],
            charCountCategory: lines[i].charCountCategory ?? 100,
          },
          [buffer]
        )
      }
    }

    ocrWorker.addEventListener('message', handleLayoutDone)
    ocrWorker.postMessage({ type: 'LAYOUT_DETECT', jobId, imageData })

    setJobState(prev => ({ ...prev, status: 'processing', stageProgress: 0 }))
  }

  const resetState = useCallback(() => {
    setJobState({
      status: 'idle',
      currentFileIndex: 0,
      totalFiles: 0,
      stageProgress: 0,
      modelProgress: { layout: 0, rec30: 0, rec50: 0, rec100: 0 },
    })
  }, [])

  return { jobState, processImage, resetState }
}
