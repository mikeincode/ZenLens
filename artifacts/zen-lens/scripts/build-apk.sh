#!/usr/bin/env bash
# scripts/build-apk.sh
#
# End-to-end script that builds a ZenLens Android APK via EAS Build,
# with native module integration and verification.
#
# Usage (from artifacts/zen-lens/):
#   bash scripts/build-apk.sh [--profile preview|development|production]
#
# Profiles:
#   preview     — internal APK, good for testing on devices (default)
#   development — debug APK with development client
#   production  — release AAB for Play Store

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="${1:-preview}"

# Parse --profile flag
if [[ "$1" == "--profile" && -n "${2:-}" ]]; then
  PROFILE="$2"
fi

RED='\033[0;31m'
GRN='\033[0;32m'
YLW='\033[1;33m'
BLU='\033[0;34m'
NC='\033[0m'

ok()   { echo -e "${GRN}  ✓ $*${NC}"; }
warn() { echo -e "${YLW}  ⚠  $*${NC}"; }
fail() { echo -e "${RED}  ✗ $*${NC}"; }
step() { echo -e "\n${BLU}── $*${NC}"; }

echo ""
echo "════════════════════════════════════════"
echo "  ZenLens APK Build — profile: $PROFILE"
echo "════════════════════════════════════════"

cd "$ROOT"

# ─── Step 1: Check Node.js ────────────────────────────────────────────────

step "Checking Node.js"
if ! command -v node &>/dev/null; then
  fail "Node.js not found. Install from https://nodejs.org (v18+)"
  exit 1
fi
NODE_VER=$(node -e "process.stdout.write(process.version)")
ok "Node.js $NODE_VER"

# ─── Step 2: Check EAS CLI ────────────────────────────────────────────────

step "Checking EAS CLI"
if ! command -v eas &>/dev/null; then
  warn "eas-cli not found. Installing globally..."
  npm install -g eas-cli
  if ! command -v eas &>/dev/null; then
    fail "EAS CLI install failed. Run manually: npm install -g eas-cli"
    exit 1
  fi
fi
EAS_VER=$(eas --version 2>/dev/null || echo "unknown")
ok "eas-cli $EAS_VER"

# ─── Step 3: Check EAS login ─────────────────────────────────────────────

step "Checking EAS authentication"
if ! eas whoami &>/dev/null 2>&1; then
  echo ""
  warn "Not logged in to EAS. Running 'eas login'..."
  echo "  Enter your Expo account credentials when prompted."
  eas login
fi
EAS_USER=$(eas whoami 2>/dev/null || echo "unknown")
ok "Logged in as: $EAS_USER"

# ─── Step 4: Install JS dependencies ─────────────────────────────────────

step "Installing JS dependencies"
if command -v pnpm &>/dev/null; then
  pnpm install
elif command -v npm &>/dev/null; then
  npm install
fi
ok "Dependencies installed"

# ─── Step 5: Prebuild (generate android/ directory) ──────────────────────

step "Running expo prebuild (generates android/ with config plugin)"
echo "  This copies Kotlin modules, patches AndroidManifest.xml,"
echo "  and registers ZenLensPackage — all via the config plugin."
echo ""
npx expo prebuild --platform android --clean
ok "Prebuild complete"

# ─── Step 6: Run native verification ─────────────────────────────────────

step "Verifying native module integration"
if ! node scripts/verify-native-android.js; then
  echo ""
  fail "Native verification failed. Running sync-native-android.js as fallback..."
  node scripts/sync-native-android.js
  echo ""
  echo "  Re-running verification..."
  if ! node scripts/verify-native-android.js; then
    fail "Verification still failing. Fix errors above before building."
    exit 1
  fi
fi
ok "All native module checks passed"

# ─── Step 7: Add ML Kit dependency (if missing) ──────────────────────────

step "Checking ML Kit dependency in build.gradle"
BUILD_GRADLE="$ROOT/android/app/build.gradle"
if [ -f "$BUILD_GRADLE" ] && ! grep -q "text-recognition" "$BUILD_GRADLE"; then
  warn "ML Kit not found in build.gradle — adding now..."
  # Insert after the last 'implementation' line in dependencies block
  sed -i '/dependencies {/a\    implementation "com.google.mlkit:text-recognition:16.0.1"' "$BUILD_GRADLE"
  ok "Added ML Kit text-recognition to android/app/build.gradle"
else
  ok "ML Kit dependency present"
fi

# ─── Step 8: EAS Build ───────────────────────────────────────────────────

step "Starting EAS Build (profile: $PROFILE)"
echo "  This uploads your project to EAS servers and builds the APK."
echo "  It typically takes 5-10 minutes."
echo ""
eas build --platform android --profile "$PROFILE" --non-interactive

# ─── Step 9: Print next steps ────────────────────────────────────────────

echo ""
echo "════════════════════════════════════════"
echo -e "${GRN}  ✓ EAS Build submitted successfully!${NC}"
echo "════════════════════════════════════════"
echo ""
echo "  Next steps:"
echo ""
echo "  1. Download the APK:"
echo "     → Run: eas build:list --platform android"
echo "     → Or visit: https://expo.dev/accounts/$EAS_USER/projects/zen-lens/builds"
echo ""
echo "  2. Install on device (USB):"
echo "     → adb install path/to/zen-lens.apk"
echo ""
echo "  3. Install on device (wireless):"
echo "     → Open the EAS build URL on your Android device and tap Install"
echo ""
echo "  4. Verify native modules:"
echo "     → Open ZenLens on device"
echo "     → Tap 'Device Readiness' on the home screen"
echo "     → All 4 rows should show green ✓"
echo "     → Tap 'Native Capture Test' — it should request MediaProjection permission"
echo ""
