import { useRef, useState } from 'react'

interface FileUploadProps {
  onFiles: (files: File[]) => void
  isLoading?: boolean
}

export function FileUpload({ onFiles, isLoading }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return
    onFiles(Array.from(files))
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    handleFiles(e.dataTransfer.files)
  }

  return (
    <div
      className={`file-upload-zone ${isDragging ? 'dragging' : ''} ${isLoading ? 'loading' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      onClick={() => !isLoading && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,image/*"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => handleFiles(e.target.files)}
      />
      {isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <>
          <div className="upload-icon">📄</div>
          <p className="upload-text">PDFまたは画像をドロップ</p>
          <p className="upload-subtext">PDF / PNG / JPG / WebP など</p>
          <button className="btn btn-primary" onClick={(e) => { e.stopPropagation(); inputRef.current?.click() }}>
            ファイルを選択
          </button>
        </>
      )}
    </div>
  )
}
