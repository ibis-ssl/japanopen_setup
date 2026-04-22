# Japan Open SSL Setup

RoboCup Japan Open の SSL 運営 PC 向け Docker Compose 構成。試合制御に必要なサービスをまとめて起動・管理します。

> `ssl-vision` 本体とカメラ設定はこのリポジトリの対象外です。

## 必要条件

- Docker Engine + Docker Compose plugin
- 運営 PC から SSL multicast に到達できるネットワーク環境
- AudioRef 用の音声出力デバイス（`/dev/snd` が Docker から利用可能であること）

## クイックスタート

```bash
# 初回のみ: イメージ取得とローカルビルド
./scripts/ops.sh pull
./scripts/ops.sh build

# 起動 / 停止
./scripts/ops.sh up
./scripts/ops.sh down

# 状態確認
./scripts/ops.sh ps
./scripts/ops.sh logs [service-name]
```

設定を変更したい場合は `.env.example` を `.env` にコピーして編集します。既定値のままでよければそのまま起動できます。

管理画面は起動後に <http://127.0.0.1:8080> で開きます。

## サービス一覧

| サービス | 役割 | URL |
|---|---|---|
| `ssl-game-controller` | 試合制御 | <http://localhost:8081> |
| `ssl-vision-client` | フィールド可視化 | <http://localhost:8082> |
| `ssl-status-board` | 状態表示 | <http://localhost:8083> |
| `ssl-remote-control-yellow` | Yellow リモコン | <http://localhost:8084> |
| `ssl-remote-control-blue` | Blue リモコン | <http://localhost:8085> |
| `admin-ui` | 管理画面 | <http://127.0.0.1:8080> |
| `autoref-tigers` | TIGERs AutoRef | — |
| `autoref-erforce` | ER-Force AutoRef | — |
| `ssl-auto-recorder` | 公式ログ自動記録 | `data/logs/auto-recorder/` |
| `audioref` | 音声案内 | `/dev/snd` 使用 |

## AudioRef

公式 Docker イメージが存在しないため、`TIGERs-Mannheim/AudioRef`（コミット `27e893fc` 固定）をローカルビルドして使用します。

出力先は `.env` の `AUDIOREF_OUTPUT_PCM` で指定します（既定: `default` = ホストの Analog/Speaker 系を自動検出）。管理画面の Settings タブから `plughw:<card>,<device>` 形式で選択・保存すると `audioref` コンテナが再作成されて即時反映されます。

その他の調整可能な変数: `AUDIOREF_PACK_DIR` / `AUDIOREF_MAX_QUEUE_LEN` / `AUDIOREF_ANTI_STANDBY_SOUND`

## ファイル構成

```
compose.yaml          本番構成
.env.example          環境変数の既定値
config/               GC・チーム設定（Git 管理）
data/                 GC state・公式ログ（Git 管理外）
scripts/ops.sh        運用ラッパ
admin_server/         管理画面バックエンド（FastAPI、uvicorn --reload）
admin_web/            管理画面フロントエンド（静的配信）
docker/               ローカルビルド用 Dockerfile
```

## ネットワーク既定値

| 用途 | アドレス |
|---|---|
| Referee | `224.5.23.1:10003` |
| Vision | `224.5.23.2:10006` |
| Tracker | `224.5.23.2:10010` |
