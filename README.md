# Japan Open SSL Setup

RoboCup Japan Open の SSL 運営 PC 向け Docker Compose 構成。試合制御に必要なサービスをまとめて起動・管理します。

> `ssl-vision` 本体とカメラ設定はこのリポジトリの対象外です。

[Screencast from 2026-04-23 09-23-57.webm](https://github.com/user-attachments/assets/fb351697-1ee9-49c6-afd1-2a189de46a4e)


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

設定を変更したい場合は `compose.yaml` をホスト側で編集します。既定値のままでよければそのまま起動できます。

管理画面は起動後に <http://localhost:8080> で開きます。LAN 内の別 PC から開く場合は `localhost` を運営 PC の IP（例: `http://192.168.x.y:8080`）に置き換えてアクセスしてください。

## サービス一覧

| サービス | 役割 | URL |
|---|---|---|
| `ssl-game-controller` | 試合制御 | <http://localhost:8081> |
| `ssl-vision-client` | フィールド可視化 | <http://localhost:8082> |
| `ssl-status-board` | 状態表示 | <http://localhost:8083> |
| `ssl-remote-control-yellow` | Yellow リモコン | <http://localhost:8084> |
| `ssl-remote-control-blue` | Blue リモコン | <http://localhost:8085> |
| `ssl-playback` | POSSIBLE_GOAL 判定用プレイバック | <http://localhost:8086> |
| `admin-ui` | 管理画面 | <http://localhost:8080> |
| `autoref-erforce` | ER-Force AutoRef | — |
| `ssl-auto-recorder` | 公式ログ自動記録 | `data/logs/auto-recorder/` |
| `audioref` | 音声案内 | `/dev/snd` 使用 |

## Playback

`ssl-playback` は POSSIBLE_GOAL 発生時にボール速度（6.5 m/s 上限）を確認するためのリアルタイムプレイバックサービスです。Vision/Tracker の multicast を購読し、速度グラフと軌跡を管理画面の **Playback** タブに表示します。

- **自動フリーズ**: POSSIBLE_GOAL 検知時に直前の時間窓（デフォルト 15 秒、最大 60 秒）を自動で静止表示
- **速度グラフ**: Tracker の速度 + Vision 生検出からの微分、6.5 m/s 基準線、全 GameEvent の縦線注釈
- **Re-arm**: Resume 後に Re-arm ボタンで次の POSSIBLE_GOAL でも自動フリーズを有効化

プロトコルの `.proto` ファイルは `ssl-game-controller` リポジトリ（タグ `SSL_GC_PROTO_REF`）から Docker build 時に取得します。

## AudioRef

公式 Docker イメージが存在しないため、`TIGERs-Mannheim/AudioRef`（コミット `27e893fc` 固定）をローカルビルドして使用します。

出力先は `compose.yaml` の `audioref` service にある `AUDIOREF_OUTPUT_PCM` で指定します（既定: `default` = ホストの Analog/Speaker 系を自動検出）。管理画面の Settings タブではホストから検出した `plughw:<card>,<device>` 形式の候補と現在値を確認できます。

出力先を変更した後は、ホスト側で次のように `audioref` コンテナを再作成します。

```bash
./scripts/ops.sh up --force-recreate audioref
```

その他の調整可能な変数: `AUDIOREF_PACK_DIR` / `AUDIOREF_MAX_QUEUE_LEN` / `AUDIOREF_ANTI_STANDBY_SOUND`

## ファイル構成

```
compose.yaml          本番構成
config/               GC・チーム設定（Git 管理）
data/                 GC state・公式ログ（Git 管理外）
scripts/ops.sh        運用ラッパ
admin_server/         管理画面バックエンド（FastAPI、uvicorn --reload）
admin_web/            管理画面フロントエンド（静的配信）
ssl_playback/         Playback サービス（FastAPI + WS + 静的配信）
docker/               ローカルビルド用 Dockerfile
```

## ネットワーク既定値

| 用途 | アドレス |
|---|---|
| Referee | `224.5.23.1:10003` |
| Vision | `224.5.23.2:10006` |
| Tracker | `224.5.23.2:10010` |
