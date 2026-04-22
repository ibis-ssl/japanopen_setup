# Japan Open SSL Setup

RoboCup Japan Open の SSL 運営PC向けに、試合制御まわりを `docker compose` でまとめて扱うためのリポジトリです。対象は `ssl-game-controller`、`ssl-vision-client`、`ssl-status-board`、両色の `ssl-remote-control`、TIGERs / ER-Force の dual AutoRef、`ssl-auto-recorder`、`AudioRef` です。`ssl-vision` 本体とカメラ設定はこのリポジトリの管理対象に含めません。

ローカルの管理画面 `admin-ui` も含み、各 Web UI をページ内タブで切り替えながら確認できます。設定タブから `AudioRef` の出力先も変更できます。

## Requirements

- Docker Engine と Docker Compose plugin
- 運営PCから SSL の実機 multicast に到達できること
- `AudioRef` 用の音声出力デバイスがホストにあり、Docker から `/dev/snd` を利用できること

## Files

- `compose.yaml`: 運営PC向けの本番構成
- `.env.example`: 既定のイメージタグとポート設定
- `config/ssl-game-controller.yaml`: GC の本番設定
- `config/engine.yaml`: チーム名と event behavior の初期値
- `admin_server/`, `admin_web/`, `docker/admin-ui/`: 管理画面
- `docker/audioref/`: AudioRef 用ローカルイメージ
- `scripts/ops.sh`: 日常運用ラッパ

## Quick Start

必要なら `.env.example` を `.env` にコピーして値を調整します。既定値のままでよければ `.env.example` のままでも `scripts/ops.sh` は動きます。

```bash
./scripts/ops.sh pull
./scripts/ops.sh build
./scripts/ops.sh up
```

停止:

```bash
./scripts/ops.sh down
```

状態確認:

```bash
./scripts/ops.sh ps
./scripts/ops.sh logs
./scripts/ops.sh logs ssl-game-controller
```

## Included Services

| Service | Purpose | URL / Notes |
| --- | --- | --- |
| `ssl-game-controller` | 試合制御 | <http://localhost:8081> |
| `ssl-vision-client` | フィールド可視化 | <http://localhost:8082> |
| `ssl-status-board` | 状態表示 | <http://localhost:8083> |
| `ssl-remote-control-yellow` | Yellow 側の remote control | <http://localhost:8084> |
| `ssl-remote-control-blue` | Blue 側の remote control | <http://localhost:8085> |
| `admin-ui` | 運営向けメイン管理画面 | <http://127.0.0.1:8080> |
| `autoref-tigers` | TIGERs AutoRef | tracker publish source |
| `autoref-erforce` | ER-Force AutoRef | tracker publish source |
| `ssl-auto-recorder` | 公式ログの自動記録 | `data/logs/auto-recorder/` |
| `audioref` | 音声案内 | `/dev/snd` を利用 |

## Network Defaults

- Referee: `224.5.23.1:10003`
- Vision: `224.5.23.2:10006`
- Tracker: `224.5.23.2:10010`

`ssl-auto-recorder` は modern vision / tracker / referee を記録し、legacy vision は無効化しています。HTTP serving は `ssl-remote-control-yellow` の `8084` と衝突するため無効化しています。

## AudioRef

`AudioRef` は公式 Docker イメージがないため、この repo でローカルビルドします。上流ソースは `TIGERs-Mannheim/AudioRef` のコミット `27e893fc8f06801c91a49f6a03e0b6ceafd6a07f` に固定しています。

既定値では英語パック `sounds/en` を使います。必要なら `.env` で以下を調整できます。

- `AUDIOREF_PACK_DIR`
- `AUDIOREF_OUTPUT_PCM`
- `AUDIOREF_MAX_QUEUE_LEN`
- `AUDIOREF_ANTI_STANDBY_SOUND`

`AUDIOREF_OUTPUT_PCM` は既定で `default` です。管理画面の設定タブから `plughw:<card>,<device>` 形式の候補を選ぶと `.env` に保存され、`audioref` コンテナを再作成して反映します。

## Admin UI

`admin-ui` は repo を bind mount した状態で起動し、`admin_server/` の Python コードは `uvicorn --reload` で自動再読み込みされます。フロントエンドの `admin_web/` は静的配信なので、HTML/CSS/JS の変更もブラウザ再読込だけで反映されます。

`./scripts/ops.sh build` は `admin-ui` と `AudioRef` のローカルイメージをビルドします。

## Data

- GC state / trusted keys: `data/gc/`
- Official logs: `data/logs/auto-recorder/`

tracked な設定は `config/` に置き、GC の可変データは `data/` に分離しています。

`compose.yaml` の環境変数で multicast アドレスやポートを変える場合、`config/ssl-game-controller.yaml` の tracked 既定値も同じ内容にそろえておくと UI 上の表示と実際の起動引数がずれません。
