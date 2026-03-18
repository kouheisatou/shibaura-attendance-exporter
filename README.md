# 芝浦工大 勤怠エクスポーター

芝浦工業大学アルバイト管理システム（STST）から、勤怠データをエクスポートするための Chrome 拡張機能です。

## 機能

- STST の対象ページで勤怠データ取得処理を実行
- 取得データをダウンロード可能な形式でエクスポート

## 動作環境

- Google Chrome（Manifest V3 対応）
- STST: `https://asrv.sic.shibaura-it.ac.jp/`

## インストール方法（開発者モード）

1. このリポジトリをローカルに配置します。
2. Chrome で `chrome://extensions` を開きます。
3. 「デベロッパー モード」を有効化します。
4. 「パッケージ化されていない拡張機能を読み込む」から本ディレクトリを選択します。

## ファイル構成（主要）

- `manifest.json`: 拡張機能定義
- `popup.html` / `popup.js`: ポップアップUIと処理
- `content-proj.js`: プロジェクト関連ページ用スクリプト
- `content-attendance.js`: 勤怠ページ用スクリプト
- `background.js`: バックグラウンド処理

## 注意事項

- 学内システム仕様変更により動作しなくなる可能性があります。
- 利用時は所属組織の規程・ポリシーに従ってください。

## リリース運用（GitHub）

- `release` ブランチは直接コミット禁止（PR経由のみ反映）で運用します。
- `release` へのPRがマージされると、`release` ブランチへのpushイベントでGitHub Actionsが実行されます。
- Actionsは拡張機能ZIPを作成し、GitHub Releasesに自動アップロードします。
