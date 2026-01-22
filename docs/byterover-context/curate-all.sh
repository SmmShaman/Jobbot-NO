#!/usr/bin/env bash
set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  ByteRover Context Curation - JobBot NO   ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
echo ""

# Check brv command
if ! command -v brv &> /dev/null; then
    echo -e "${RED}✗ Error: brv command not found${NC}"
    echo "Please install ByteRover CLI: npm install -g @byterover/cli"
    exit 1
fi

# Navigate to project root for file references
cd "$(dirname "$0")/../.."
CONTEXT_DIR="docs/byterover-context"

TOTAL_FILES=12
CURRENT=0

curate_file() {
    local file=$1
    shift
    local code_files=("$@")
    CURRENT=$((CURRENT + 1))

    echo -e "${YELLOW}[$CURRENT/$TOTAL_FILES]${NC} Curating: ${GREEN}$file${NC}"

    if [ ${#code_files[@]} -eq 0 ]; then
        brv curate "$(cat $CONTEXT_DIR/$file)" || {
            echo -e "${RED}✗ Failed to curate $file${NC}"
            return 1
        }
    else
        # Build file arguments
        local file_args=""
        for f in "${code_files[@]}"; do
            file_args="$file_args --files $f"
        done
        brv curate "$(cat $CONTEXT_DIR/$file)" $file_args || {
            echo -e "${RED}✗ Failed to curate $file${NC}"
            return 1
        }
    fi

    echo -e "${GREEN}✓${NC} Done"
    echo ""
}

echo -e "${BLUE}══════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Architecture${NC}"
echo -e "${BLUE}══════════════════════════════════════════════${NC}"

curate_file "architecture/project-overview.md"
curate_file "architecture/database-schema.md"
curate_file "architecture/edge-functions.md" "supabase/functions/scheduled-scanner/index.ts"

echo -e "${BLUE}══════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Features${NC}"
echo -e "${BLUE}══════════════════════════════════════════════${NC}"

curate_file "features/job-management.md" "components/JobTable.tsx"
curate_file "features/finn-auto-apply.md" "supabase/functions/finn-apply/index.ts" "worker/auto_apply.py"
curate_file "features/telegram-bot.md" "supabase/functions/telegram-bot/index.ts"

echo -e "${BLUE}══════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Workers${NC}"
echo -e "${BLUE}══════════════════════════════════════════════${NC}"

curate_file "workers/skyvern-architecture.md"
curate_file "workers/auto-apply-worker.md" "worker/auto_apply.py"

echo -e "${BLUE}══════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Integrations${NC}"
echo -e "${BLUE}══════════════════════════════════════════════${NC}"

curate_file "integrations/recruitment-platforms.md"

echo -e "${BLUE}══════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Recent Changes${NC}"
echo -e "${BLUE}══════════════════════════════════════════════${NC}"

curate_file "recent-changes/2026-01-changes.md"
curate_file "recent-changes/2025-12-changes.md"

echo -e "${BLUE}══════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Debugging${NC}"
echo -e "${BLUE}══════════════════════════════════════════════${NC}"

curate_file "debugging/known-issues.md"

echo ""
echo -e "${GREEN}╔════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  ✓ Curation Complete!                      ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}✓ Successfully curated $TOTAL_FILES files${NC}"
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo "  1. Test: ${YELLOW}brv query \"How does FINN auto-apply work?\"${NC}"
echo "  2. Status: ${YELLOW}brv status${NC}"
echo "  3. Push: ${YELLOW}brv push${NC}"
