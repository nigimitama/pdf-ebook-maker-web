/**
 * 読み順処理モジュール（XY-Cutアルゴリズム）
 *
 * 日本語文書の縦書き・右から左への読み順に対応する。
 * 参照: https://github.com/yuta1984/ndlocrlite-web
 */

import type { TextRegion, PageBlock, TextBlock } from '../types/ocr'

const GRID = 1000
const CONF_THRESHOLD = 0.3

interface NormalizedBox {
  x1: number
  y1: number
  x2: number
  y2: number
  originalIndex: number
}

interface XYCutNode {
  boxes: number[] // originalIndex の配列
  splitAxis?: 'x' | 'y'
  children?: XYCutNode[]
}

export class ReadingOrderProcessor {
  /**
   * テキスト領域に読み順インデックスを付与して TextBlock の配列を返す
   */
  process(lines: TextRegion[], blocks: PageBlock[]): TextBlock[] {
    if (lines.length === 0) return []

    const filtered = lines.filter(l => l.confidence >= CONF_THRESHOLD)
    if (filtered.length === 0) return []

    let ordered: number[]

    if (blocks.length > 0) {
      ordered = this.processWithBlocks(filtered, blocks)
    } else {
      ordered = this.processXYCut(
        filtered.map((_, i) => i),
        filtered,
        filtered[0] // dummy ref
      )
    }

    return ordered.map((srcIdx, readingOrder) => {
      const r = filtered[srcIdx]
      return {
        ...r,
        text: '',
        readingOrder,
      }
    })
  }

  /** DEIMのブロック情報でグループ化してから各グループにXY-Cutを適用 */
  private processWithBlocks(lines: TextRegion[], blocks: PageBlock[]): number[] {
    // 各 line を最も IoU の高い block に割り当て
    const groups: Map<number, number[]> = new Map()
    const unassigned: number[] = []

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      let bestBlock = -1
      let bestIoU = 0

      for (let b = 0; b < blocks.length; b++) {
        const iou = this.iou(line, blocks[b])
        if (iou > bestIoU) {
          bestIoU = iou
          bestBlock = b
        }
      }

      if (bestBlock >= 0 && bestIoU > 0.01) {
        if (!groups.has(bestBlock)) groups.set(bestBlock, [])
        groups.get(bestBlock)!.push(i)
      } else {
        unassigned.push(i)
      }
    }

    // 未割り当ては個別グループとして扱う
    for (const idx of unassigned) {
      groups.set(-(idx + 1), [idx])
    }

    // ブロックを大域的にXY-Cutで並び替え
    const allGroupIndices = Array.from(groups.keys())
    const blockRegions = allGroupIndices.map(key => {
      if (key >= 0) return blocks[key]
      return lines[-(key + 1)]
    })

    const blockOrder = this.processXYCut(
      allGroupIndices.map((_, i) => i),
      blockRegions as TextRegion[],
      blockRegions[0] as TextRegion
    )

    // 各グループ内もXY-Cutで並び替え
    const result: number[] = []
    for (const groupIdx of blockOrder) {
      const key = allGroupIndices[groupIdx]
      const groupLines = groups.get(key) ?? []
      if (groupLines.length <= 1) {
        result.push(...groupLines)
      } else {
        const ordered = this.processXYCut(
          groupLines,
          lines,
          lines[groupLines[0]]
        )
        result.push(...ordered)
      }
    }

    return result
  }

  /** XY-Cut アルゴリズムで読み順を決定 */
  private processXYCut(
    indices: number[],
    regions: (TextRegion | PageBlock)[],
    _ref: TextRegion | PageBlock
  ): number[] {
    if (indices.length <= 1) return indices

    const w = Math.max(...indices.map(i => (regions[i] as TextRegion).x + (regions[i] as TextRegion).width))
    const h = Math.max(...indices.map(i => (regions[i] as TextRegion).y + (regions[i] as TextRegion).height))
    const refW = w || 1
    const refH = h || 1

    const normalized = indices.map(i => {
      const r = regions[i] as TextRegion
      return {
        x1: Math.round((r.x / refW) * GRID),
        y1: Math.round((r.y / refH) * GRID),
        x2: Math.round(((r.x + r.width) / refW) * GRID),
        y2: Math.round(((r.y + r.height) / refH) * GRID),
        originalIndex: i,
      } as NormalizedBox
    })

    const root: XYCutNode = { boxes: normalized.map((_, i) => i) }
    this.xyCut(root, normalized)

    return this.flattenNode(root, normalized)
  }

  private xyCut(node: XYCutNode, boxes: NormalizedBox[]): void {
    if (node.boxes.length <= 1) return

    const nodeBoxes = node.boxes.map(i => boxes[i])

    // Y軸で分割を試みる
    const yGap = this.findLargestGap('y', nodeBoxes)
    // X軸で分割を試みる
    const xGap = this.findLargestGap('x', nodeBoxes)

    if (yGap === null && xGap === null) return

    // より大きいギャップで分割（Y優先：段落間の分割を優先）
    let splitAxis: 'x' | 'y'
    let splitPoint: number

    if (yGap === null) {
      splitAxis = 'x'
      splitPoint = xGap!.point
    } else if (xGap === null) {
      splitAxis = 'y'
      splitPoint = yGap.point
    } else if (yGap.size >= xGap.size) {
      splitAxis = 'y'
      splitPoint = yGap.point
    } else {
      splitAxis = 'x'
      splitPoint = xGap.point
    }

    node.splitAxis = splitAxis

    const left: number[] = []
    const right: number[] = []

    for (const idx of node.boxes) {
      const b = boxes[idx]
      const center = splitAxis === 'y'
        ? (b.y1 + b.y2) / 2
        : (b.x1 + b.x2) / 2
      if (center < splitPoint) {
        left.push(idx)
      } else {
        right.push(idx)
      }
    }

    if (left.length === 0 || right.length === 0) return

    node.children = [
      { boxes: left },
      { boxes: right },
    ]
    node.boxes = []

    this.xyCut(node.children[0], boxes)
    this.xyCut(node.children[1], boxes)
  }

  private findLargestGap(
    axis: 'x' | 'y',
    boxes: NormalizedBox[]
  ): { point: number; size: number } | null {
    // ヒストグラムを作成（占有されているグリッド位置）
    const occupied = new Uint8Array(GRID + 1)

    for (const b of boxes) {
      const start = axis === 'y' ? b.y1 : b.x1
      const end = axis === 'y' ? b.y2 : b.x2
      for (let i = Math.max(0, start); i <= Math.min(GRID, end); i++) {
        occupied[i] = 1
      }
    }

    // 最大のゼロ区間を探す
    let bestSize = 0
    let bestPoint = -1
    let gapStart = -1

    const minCoord = axis === 'y' ? Math.min(...boxes.map(b => b.y1)) : Math.min(...boxes.map(b => b.x1))
    const maxCoord = axis === 'y' ? Math.max(...boxes.map(b => b.y2)) : Math.max(...boxes.map(b => b.x2))

    for (let i = minCoord; i <= maxCoord; i++) {
      if (occupied[i] === 0) {
        if (gapStart < 0) gapStart = i
      } else {
        if (gapStart >= 0) {
          const size = i - gapStart
          if (size > bestSize) {
            bestSize = size
            bestPoint = Math.round((gapStart + i) / 2)
          }
          gapStart = -1
        }
      }
    }

    if (bestPoint < 0 || bestSize < 5) return null
    return { point: bestPoint, size: bestSize }
  }

  private flattenNode(node: XYCutNode, boxes: NormalizedBox[]): number[] {
    if (!node.children || node.children.length === 0) {
      // リーフノード: Y座標でソート
      return [...node.boxes].sort((a, b) => boxes[a].y1 - boxes[b].y1)
        .map(i => boxes[i].originalIndex)
    }

    const [first, second] = node.children
    const firstResult = this.flattenNode(first, boxes)
    const secondResult = this.flattenNode(second, boxes)

    // X軸分割の場合は右から左（縦書き日本語）
    if (node.splitAxis === 'x') {
      return [...secondResult, ...firstResult]
    }

    return [...firstResult, ...secondResult]
  }

  private iou(
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number }
  ): number {
    const ax2 = a.x + a.width, ay2 = a.y + a.height
    const bx2 = b.x + b.width, by2 = b.y + b.height
    const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x))
    const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y))
    const inter = ix * iy
    if (inter === 0) return 0
    return inter / (a.width * a.height + b.width * b.height - inter)
  }
}
