# PDF eBook Maker Web

スキャンした文書画像やPDFをOCRで読み取り、検索可能なPDFに変換するウェブアプリ。

[nigimitama/pdf-ebook-maker](https://github.com/nigimitama/pdf-ebook-maker) のウェブアプリ版。
OCRモデルの動作方式は [yuta1984/ndlocrlite-web](https://github.com/yuta1984/ndlocrlite-web) を参考にしています。

## 機能

- **OCR**: 国立国会図書館の NDLOCR-Lite モデルをブラウザ内で実行（CPU専用・ローカル処理）
- **LLM校正**: OCR結果をLLMで自動校正
  - Ollama（ローカルCPU LLM）対応
  - OpenAI API 対応
  - Anthropic API (Claude) 対応
  - カスタム OpenAI 互換エンドポイント対応
- **PDF生成**: 透明テキストレイヤー付きの検索可能PDFを生成
- **プライバシー**: OCR処理はすべてブラウザ内で完結（外部サーバーへの送信なし）

## セットアップ

### 1. 依存関係のインストール

```bash
npm install
```

### 2. モデルのダウンロード

OCRに使用するONNXモデルをダウンロードします。

```bash
npm run setup
```

これにより以下のファイルがダウンロードされます：
- `public/models/deim-s-1024x1024.onnx`（レイアウト検出）
- `public/models/parseq-ndl-30.onnx`（文字認識 ≤30文字）
- `public/models/parseq-ndl-50.onnx`（文字認識 ≤50文字）
- `public/models/parseq-ndl-100.onnx`（文字認識 ≤100文字）
- `public/config/NDLmoji.yaml`（文字セット設定）

> **初回ロード時のキャッシュ**: モデルは初回使用時にブラウザのIndexedDBにキャッシュされるため、2回目以降は高速に起動します。

### 3. 開発サーバーの起動

```bash
npm run dev
```

## LLM設定（CPU対応ローカルLLM）

### Ollama（推奨・無料・CPU動作）

小型モデルを使うことでCPUのみでも動作します。

```bash
# Ollamaのインストール: https://ollama.com/
ollama pull qwen2.5:1.5b   # 軽量・日本語対応
ollama pull qwen2.5:3b     # より高精度
ollama pull llama3.2:3b    # Meta Llama
```

アプリの「LLM設定」から `Ollama (ローカル)` を選択し、エンドポイント `http://localhost:11434` を設定してください。

> **注意**: ブラウザからOllamaにアクセスするには、OllamaのCORS設定が必要な場合があります:
> ```bash
> OLLAMA_ORIGINS="*" ollama serve
> ```

### OpenAI API

「LLM設定」から `OpenAI API` を選択し、APIキーを入力してください。

### Anthropic API (Claude)

「LLM設定」から `Anthropic API` を選択し、APIキーを入力してください。

## ビルド

```bash
npm run build
```

## 技術スタック

- **フロントエンド**: React 19 + TypeScript + Vite
- **OCR**: NDLOCR-Lite (ONNX Runtime Web / WASM)
  - レイアウト検出: DEIM モデル
  - 文字認識: PARSeq モデル
- **PDF読込**: pdfjs-dist
- **PDF生成**: pdf-lib
- **設定**: js-yaml

## ライセンス

MIT License

### 使用しているモデル

**NDLOCR-Lite** (CC BY 4.0)  
国立国会図書館が公開する OCR モデル。  
詳細は [NOTICE](NOTICE) を参照してください。
