#!/usr/bin/env bash
#
# Make the Azure box a model appliance: llama-server owned by systemd, started on
# boot, restarted when it dies.
#
# Right now the model runs because someone typed the command. Reboot the VM and
# the assistant has no model, and the only clue is that answers stopped. A
# service fixes the class of problem, not the instance of it.
#
# Deliberate choices:
#
#   -t 4 matches the VM's 4 vCPUs. Oversubscribing threads makes a CPU-bound
#   generation slower, not faster.
#
#   --host 127.0.0.1, not 0.0.0.0. The app reaches this through an ssh tunnel on
#   18090; nothing outside needs to talk to the port directly, and binding it to
#   the world is an open inference endpoint on the public internet.
#
#   Restart=always with a delay: a model that fails to load (a corrupt download,
#   a missing file) would otherwise loop hard and fill the journal.
#
set -euo pipefail

MODEL="${MODEL:-/mnt/anyrealm/models/qwen2.5-coder-7b-instruct-q4_k_m.gguf}"
LLAMA_DIR="${LLAMA_DIR:-/mnt/anyrealm/llama/llama-b12553}"
PORT="${PORT:-8090}"
THREADS="${THREADS:-4}"
CTX="${CTX:-8192}"

say() { printf '\n==> %s\n' "$*"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[ -x "${LLAMA_DIR}/llama-server" ] || fail "no llama-server at ${LLAMA_DIR}/llama-server"
[ -f "$MODEL" ] || fail "no model at ${MODEL}"
say "model $(basename "$MODEL") ($(du -h "$MODEL" | cut -f1))"
say "llama-server ${LLAMA_DIR}"

say "writing /etc/systemd/system/llama-server.service"
sudo tee /etc/systemd/system/llama-server.service >/dev/null <<EOF
[Unit]
Description=llama.cpp server (Qwen coder)
After=network-online.target local-fs.target
Wants=network-online.target
# A failed load is usually a bad file; retrying forever hides it. Ten restarts in
# ten minutes means something is wrong that a restart will not fix.
# These belong in [Unit]: systemd ignores them in [Service] without saying so
# beyond one line in the journal.
StartLimitIntervalSec=600
StartLimitBurst=10

[Service]
Type=simple
User=slm015
Group=slm015
WorkingDirectory=${LLAMA_DIR}
ExecStart=${LLAMA_DIR}/llama-server \\
  --model ${MODEL} \\
  --host 127.0.0.1 \\
  --port ${PORT} \\
  --ctx-size ${CTX} \\
  --threads ${THREADS} \\
  --jinja --no-webui
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=llama-server

[Install]
WantedBy=multi-user.target
EOF

say "stopping the hand-started server, so the port is free"
# Ask nicely first: a SIGTERM lets llama.cpp free its memory mapping.
pkill -f "llama-server.*${PORT}" 2>/dev/null || true
sleep 3
pkill -9 -f "llama-server.*${PORT}" 2>/dev/null || true

say "enabling and starting"
sudo systemctl daemon-reload
sudo systemctl enable llama-server.service >/dev/null
sudo systemctl restart llama-server.service

say "waiting for it to answer"
for i in $(seq 1 60); do
  code=$(curl -s -m 2 -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/health" 2>/dev/null || echo 000)
  if [ "$code" = "200" ]; then
    say "healthy after ~$((i*2))s"
    break
  fi
  if [ "$i" = "60" ]; then
    echo
    echo "did not become healthy. The journal is the answer:"
    sudo journalctl -u llama-server -n 30 --no-pager
    exit 1
  fi
  sleep 2
done

# ---- whisper --------------------------------------------------------------
#
# whisper is a CLI, not a server: the app runs it per request. So it needs no
# unit, but it does need its binary and model to be where the app expects.

WHISPER_BIN="${WHISPER_BIN:-/mnt/anyrealm/whisper/whisper-bin-ubuntu-x64/whisper-cli}"
WHISPER_MODEL="${WHISPER_MODEL:-/mnt/anyrealm/models/ggml-base.en.bin}"
if [ -x "$WHISPER_BIN" ] && [ -f "$WHISPER_MODEL" ]; then
  say "whisper: cli and model present (nothing to run in the background)"
else
  say "whisper: MISSING ($WHISPER_BIN or $WHISPER_MODEL) -- voice input will fail"
fi

# ---- prove a generation, not just a health endpoint -----------------------
#
# /health returns 200 as soon as the model is mapped. That says nothing about
# whether it can produce a token. So ask it one and read the answer.

say "asking the model a real question"
ANSWER=$(curl -s -m 120 "http://127.0.0.1:${PORT}/v1/chat/completions" \
  -H 'Content-Type: application/json' \
  -d '{"model":"local","messages":[{"role":"user","content":"Reply with exactly: ready"}],"max_tokens":8,"temperature":0}' \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["choices"][0]["message"]["content"].strip())' 2>/dev/null || echo "")

if [ -n "$ANSWER" ]; then
  say "it answered: ${ANSWER}"
else
  fail "the server is up but produced no answer -- check 'journalctl -u llama-server'"
fi

cat <<EOF

------------------------------------------------------------------
model box ready

  service   llama-server.service (enabled: starts on boot)
  endpoint  http://127.0.0.1:${PORT}  (tunnel only, not public)
  model     $(basename "$MODEL")
  threads   ${THREADS} / $(nproc) cores
  context   ${CTX} tokens

  sudo systemctl status llama-server
  sudo journalctl -u llama-server -f

Reboot test (the point of the service):

  sudo reboot
  # then, after it comes back:
  curl -s http://127.0.0.1:${PORT}/health

That should return 200 with nobody logged in and no commands typed.
------------------------------------------------------------------
EOF
