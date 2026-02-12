#!/bin/bash
# JobBot Auto-Apply Launcher
# One-command orchestrator for Skyvern + worker
# Usage: ./start.sh [--stop] [--status]

set -euo pipefail

SKYVERN_DIR="$HOME/skyvern"
WORKER_DIR="$(cd "$(dirname "$0")" && pwd)"
SKYVERN_URL="http://localhost:8000"
MAX_WAIT=90

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log_info()  { echo -e "${CYAN}ℹ${NC}  $1"; }
log_ok()    { echo -e "${GREEN}✓${NC}  $1"; }
log_warn()  { echo -e "${YELLOW}⚠${NC}  $1"; }
log_error() { echo -e "${RED}✗${NC}  $1"; }
log_head()  { echo -e "\n${BOLD}$1${NC}"; }

# ─── Check if Docker is running ───
check_docker() {
    if ! docker info >/dev/null 2>&1; then
        log_error "Docker is not running. Start Docker Desktop first."
        exit 1
    fi
}

# ─── Check if Skyvern containers are running ───
is_skyvern_running() {
    if [ ! -d "$SKYVERN_DIR" ]; then
        return 1
    fi
    local running
    running=$(docker compose -f "$SKYVERN_DIR/docker-compose.yml" ps --status running -q 2>/dev/null | wc -l)
    [ "$running" -gt 0 ]
}

# ─── Check if Skyvern API responds ───
is_skyvern_healthy() {
    local code
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "$SKYVERN_URL/api/v1/health" 2>/dev/null || echo "000")
    [ "$code" != "000" ] && [ "$code" != "502" ] && [ "$code" != "503" ]
}

# ─── Check if worker process is running ───
is_worker_running() {
    pgrep -f "python.*auto_apply.py" >/dev/null 2>&1
}

# ─── Start Skyvern containers ───
start_skyvern() {
    if [ ! -d "$SKYVERN_DIR" ]; then
        log_error "Skyvern directory not found: $SKYVERN_DIR"
        exit 1
    fi

    if is_skyvern_running; then
        log_ok "Skyvern containers already running"
    else
        log_info "Starting Skyvern containers..."
        docker compose -f "$SKYVERN_DIR/docker-compose.yml" up -d
        log_ok "Skyvern containers started"
    fi
}

# ─── Wait for Skyvern API health ───
wait_for_skyvern() {
    if is_skyvern_healthy; then
        log_ok "Skyvern API is ready"
        return
    fi

    log_info "Waiting for Skyvern API (up to ${MAX_WAIT}s)..."
    local elapsed=0
    local spinner='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
    while [ $elapsed -lt $MAX_WAIT ]; do
        local i=$(( elapsed % ${#spinner} ))
        printf "\r  ${CYAN}${spinner:$i:1}${NC}  Waiting... %ds / %ds" "$elapsed" "$MAX_WAIT"

        if is_skyvern_healthy; then
            printf "\r"
            log_ok "Skyvern API is ready (took ${elapsed}s)"
            return
        fi

        sleep 2
        elapsed=$((elapsed + 2))
    done

    printf "\r"
    log_error "Skyvern API did not respond within ${MAX_WAIT}s"
    log_info "Check logs: docker compose -f $SKYVERN_DIR/docker-compose.yml logs --tail=20"
    exit 1
}

# ─── Validate worker .env ───
validate_env() {
    local env_file="$WORKER_DIR/.env"

    if [ ! -f "$env_file" ]; then
        log_error ".env file not found at $env_file"
        log_info "Copy from template: cp $WORKER_DIR/.env.example $WORKER_DIR/.env"
        exit 1
    fi

    local missing=0

    for var in SUPABASE_URL SUPABASE_SERVICE_KEY SKYVERN_API_KEY; do
        if ! grep -q "^${var}=.\+" "$env_file" 2>/dev/null; then
            log_error "Missing required: $var in .env"
            missing=1
        fi
    done

    [ $missing -eq 1 ] && exit 1

    for var in FINN_EMAIL FINN_PASSWORD; do
        if ! grep -q "^${var}=.\+" "$env_file" 2>/dev/null; then
            log_warn "Missing $var — FINN auto-apply won't work"
        fi
    done

    log_ok ".env validated"
}

# ─── Stop everything ───
do_stop() {
    log_head "Stopping services..."

    if is_worker_running; then
        log_info "Stopping worker..."
        pkill -f "python.*auto_apply.py" 2>/dev/null || true
        sleep 1
        log_ok "Worker stopped"
    else
        log_info "Worker is not running"
    fi

    if docker info >/dev/null 2>&1; then
        if is_skyvern_running; then
            log_info "Stopping Skyvern containers..."
            docker compose -f "$SKYVERN_DIR/docker-compose.yml" down
            log_ok "Skyvern stopped"
        else
            log_info "Skyvern is not running"
        fi
    else
        log_warn "Docker not running — skipping Skyvern"
    fi

    echo ""
    log_ok "All services stopped"
}

# ─── Show status ───
do_status() {
    log_head "Service Status"
    echo ""

    # Docker
    if docker info >/dev/null 2>&1; then
        log_ok "Docker: running"
    else
        log_error "Docker: not running"
    fi

    # Skyvern containers
    if is_skyvern_running; then
        log_ok "Skyvern containers: running"
    else
        log_error "Skyvern containers: stopped"
    fi

    # Skyvern API
    if is_skyvern_healthy; then
        log_ok "Skyvern API: healthy"
    else
        log_error "Skyvern API: not responding"
    fi

    # Worker
    if is_worker_running; then
        local pid
        pid=$(pgrep -f "python.*auto_apply.py" | head -1)
        log_ok "Worker: running (PID $pid)"
    else
        log_error "Worker: not running"
    fi

    # .env
    if [ -f "$WORKER_DIR/.env" ]; then
        log_ok ".env: present"
    else
        log_error ".env: missing"
    fi

    echo ""
}

# ─── Ctrl+C handler ───
cleanup() {
    echo ""
    log_warn "Worker interrupted"

    echo -ne "${YELLOW}Stop Skyvern too? [y/N]:${NC} "
    # Temporarily re-enable input for read
    trap - INT
    read -r answer </dev/tty 2>/dev/null || answer="n"
    if [[ "$answer" =~ ^[Yy]$ ]]; then
        log_info "Stopping Skyvern containers..."
        docker compose -f "$SKYVERN_DIR/docker-compose.yml" down
        log_ok "Skyvern stopped"
    else
        log_info "Skyvern left running"
    fi

    exit 0
}

# ─── Main ───
main() {
    echo -e "${BOLD}🤖 JobBot Auto-Apply Launcher${NC}"
    echo ""

    check_docker

    log_head "Step 1: Skyvern"
    start_skyvern
    wait_for_skyvern

    log_head "Step 2: Worker"
    validate_env

    if is_worker_running; then
        log_warn "Worker is already running"
        echo -ne "${YELLOW}Start another instance? [y/N]:${NC} "
        read -r answer
        if [[ ! "$answer" =~ ^[Yy]$ ]]; then
            log_info "Exiting"
            exit 0
        fi
    fi

    log_head "Step 3: Launch"
    log_ok "Starting auto_apply.py..."
    echo -e "${CYAN}────────────────────────────────────────${NC}"
    echo ""

    trap cleanup INT

    source "$WORKER_DIR/venv/bin/activate"
    python "$WORKER_DIR/auto_apply.py"
}

# ─── Entry point ───
case "${1:-}" in
    --stop)
        do_stop
        ;;
    --status)
        do_status
        ;;
    --help|-h)
        echo "Usage: $0 [--stop] [--status] [--help]"
        echo ""
        echo "  (no args)   Start Skyvern + worker"
        echo "  --stop      Stop worker + Skyvern"
        echo "  --status    Show service status"
        echo "  --help      This message"
        ;;
    *)
        main
        ;;
esac
