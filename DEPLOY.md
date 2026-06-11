# Deploying Webteering

The whole game ships as one container: the Vite client builds into
`server/dist/public`, and the Express + socket.io server serves both the
static bundle and the multiplayer backend on a single port (`PORT`,
default 3001).

## Test the container locally

```sh
docker build -t webteering .
docker run -p 8080:8080 -e PORT=8080 webteering
# open http://localhost:8080
```

## Deploy to Fly.io

1. Install [flyctl](https://fly.io/docs/flyctl/install/) and `fly auth login`.
2. From the repo root:

```sh
fly launch --no-deploy   # reuse the committed fly.toml; pick a unique app name
fly deploy
```

3. Open the app: `fly open`.

### Important: single machine only

Rooms are kept **in server memory** — there is no database. Running more
than one machine would split players across instances that can't see each
other's rooms. Keep the app at one machine:

```sh
fly scale count 1
```

`auto_stop_machines` is enabled, so the machine sleeps when nobody is
playing and wakes on the next visit (in-progress rooms are lost when it
stops — acceptable for casual play).

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3001` | HTTP + websocket listen port |

No other configuration is required.
