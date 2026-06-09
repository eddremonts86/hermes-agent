#!/bin/bash
# =============================================================================
# scripts/sync-upstream.sh — sincroniza origin/main con nousresearch/main
# directamente (sin PR), para un fork personal.
#
# Uso:
#   bash scripts/sync-upstream.sh status
#       Muestra commits ahead/behind sin tocar nada.
#
#   bash scripts/sync-upstream.sh sync [--rebase|--merge] [--push]
#       Hace fetch + rebase (default) o merge de nousresearch/main
#       sobre origin/main. Con --push, sube al fork automáticamente.
#       Si hay conflictos, los resolve`ás a mano y después `git push origin main`.
#
# Por qué existe:
#   El fork diverge N commits de NousResearch. Sin sync periódico,
#   mergear cambios upstream después de varias semanas se vuelve infernal.
#   La CI corre este mismo script vía .github/workflows/sync-upstream.yml
#   cada lunes 06:00 UTC y pushea directo a main (sin PR).
#
# Variables de entorno:
#   UPSTREAM_REMOTE  (default: nousresearch)
#   UPSTREAM_BRANCH  (default: main)
#   STRATEGY         (default: rebase; alterna con --merge)
# =============================================================================

set -euo pipefail

UPSTREAM_REMOTE="${UPSTREAM_REMOTE:-nousresearch}"
UPSTREAM_BRANCH="${UPSTREAM_BRANCH:-main}"
STRATEGY="${STRATEGY:-rebase}"
DO_PUSH=0

cd "$(dirname "$0")/.."

ensure_remote() {
  if ! git remote get-url "$UPSTREAM_REMOTE" >/dev/null 2>&1; then
    echo "➕ Agregando remote $UPSTREAM_REMOTE → https://github.com/NousResearch/hermes-agent.git"
    git remote add "$UPSTREAM_REMOTE" https://github.com/NousResearch/hermes-agent.git
  fi
}

cmd_status() {
  ensure_remote
  echo "📥 Fetching $UPSTREAM_REMOTE (depth: 200)..."
  git fetch "$UPSTREAM_REMOTE" --depth=200 --quiet
  local ahead behind
  ahead=$(git rev-list --count "origin/main..$UPSTREAM_REMOTE/$UPSTREAM_BRANCH" 2>/dev/null || echo "?")
  behind=$(git rev-list --count "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH..origin/main" 2>/dev/null || echo "?")
  echo
  echo "  origin/main  vs  $UPSTREAM_REMOTE/$UPSTREAM_BRANCH"
  echo "  ahead:  $behind commits (tus cambios locales que NO están upstream)"
  echo "  behind: $ahead commits (cambios upstream que no tenés)"
  echo
  if [ "$ahead" != "0" ] && [ "$behind" != "0" ]; then
    echo "  ⚠️  Hay divergencia. Corré: make sync-upstream"
  fi
}

cmd_sync() {
  ensure_remote
  while [ $# -gt 0 ]; do
    case "$1" in
      --merge) STRATEGY="merge" ;;
      --rebase) STRATEGY="rebase" ;;
      --push) DO_PUSH=1 ;;
      *) echo "Opción desconocida: $1"; exit 2 ;;
    esac
    shift
  done

  echo "🛡️  Haciendo backup del branch actual..."
  local current_branch
  current_branch=$(git symbolic-ref --short HEAD)
  local backup_branch="backup/${current_branch}-$(date +%Y%m%d-%H%M%S)"
  git branch "$backup_branch" 2>/dev/null || true
  echo "  → $backup_branch"

  echo "📥 Fetching $UPSTREAM_REMOTE/$UPSTREAM_BRANCH..."
  git fetch "$UPSTREAM_REMOTE" --quiet

  echo "🔀 Sync vía $STRATEGY..."
  if [ "$STRATEGY" = "merge" ]; then
    if ! git merge --no-ff "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH" -m "chore(sync): merge $UPSTREAM_REMOTE/$UPSTREAM_BRANCH @ $(date +%Y-%m-%d)"; then
      echo
      echo "❌ Merge conflict. Resolvelo a mano y corré:"
      echo "   git add -A && git commit --no-edit"
      [ "$DO_PUSH" = "1" ] && echo "   git push origin main"
      exit 1
    fi
  else
    if ! git rebase "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH"; then
      echo
      echo "❌ Rebase conflict. Resolvelo a mano y corré:"
      echo "   git rebase --continue   (o --abort para volver atrás)"
      [ "$DO_PUSH" = "1" ] && echo "   git push --force-with-lease origin main"
      exit 1
    fi
  fi

  echo
  echo "✅ Sync completo en $current_branch."

  if [ "$DO_PUSH" = "1" ]; then
    if [ "$STRATEGY" = "merge" ]; then
      echo "🚀 Pushing a origin/main (merge)..."
      git push origin main
    else
      echo "🚀 Force-pushing a origin/main (rebase)..."
      git push --force-with-lease origin main
    fi
    echo "✅ Listo. La CI rebuild'eá y republicará ghcr.io/eddremonts86/hermes-agent."
  else
    echo "ℹ️  No hice push. Para subir:"
    if [ "$STRATEGY" = "merge" ]; then
      echo "   git push origin main"
    else
      echo "   git push --force-with-lease origin main"
    fi
  fi
}

case "${1:-status}" in
  status)
    cmd_status
    ;;
  sync)
    shift
    cmd_sync "$@"
    ;;
  *)
    echo "Uso: $0 {status|sync [--rebase|--merge] [--push]}"
    exit 2
    ;;
esac
