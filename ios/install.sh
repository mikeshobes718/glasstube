#!/bin/zsh
# Builds GlassTube and its share extension, signs them with the App Store
# Connect profiles in ios/signing/, and installs on Mike's iPhone.
#
# Xcode has no Apple ID on this Mac, so automatic signing only has the
# wildcard profile, which cannot carry Sign In with Apple. The profiles in
# signing/ were made through the ASC API (see ~/Documents/Cook/scripts/asc.py).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
DEVICE="613E0636-1C1C-559C-80D5-D49470A531B2"
IDENTITY="5F6ED60051B10C007D4F77ABB2DEC481638DA4AF"
TEAM="N7LRRN2YGY"
DD="${TMPDIR:-/tmp}/glasstube-dd"
APP="$DD/Build/Products/Release-iphoneos/GlassTube.app"
APPEX="$APP/PlugIns/GlassTubeShare.appex"

cd "$ROOT"
xcodegen generate
xcodebuild -project GlassTube.xcodeproj -scheme GlassTube -configuration Release \
  -destination "generic/platform=iOS" -sdk iphoneos \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO \
  -derivedDataPath "$DD" build | grep -E "error:|BUILD" || true
[[ -d "$APPEX" ]] || { echo "build failed" >&2; exit 1; }

entitlements() {
  local out="$1" id="$2" extra="${3:-}"
  cat > "$out" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>application-identifier</key>
	<string>$TEAM.$id</string>
	<key>com.apple.developer.team-identifier</key>
	<string>$TEAM</string>
	<key>get-task-allow</key>
	<true/>
$extra
</dict>
</plist>
EOF
}
entitlements "$DD/app.xcent" com.mikeshobes.glasstube \
  "	<key>com.apple.developer.applesignin</key>
	<array><string>Default</string></array>"
entitlements "$DD/share.xcent" com.mikeshobes.glasstube.share

xattr -cr "$APP"
cp signing/glasstube-share.mobileprovision "$APPEX/embedded.mobileprovision"
cp signing/glasstube.mobileprovision "$APP/embedded.mobileprovision"
# Inside out: the extension is sealed into the app's signature.
codesign --force --sign "$IDENTITY" --entitlements "$DD/share.xcent" --generate-entitlement-der "$APPEX"
codesign --force --sign "$IDENTITY" --entitlements "$DD/app.xcent" --generate-entitlement-der "$APP"
codesign --verify --deep --strict "$APP"

xcrun devicectl device install app --device "$DEVICE" "$APP"
echo "installed GlassTube $(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$APP/Info.plist") ($(/usr/libexec/PlistBuddy -c 'Print CFBundleVersion' "$APP/Info.plist"))"
