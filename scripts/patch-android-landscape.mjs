import fs from 'fs';
import path from 'path';

const manifestPath = path.resolve('src-tauri/gen/android/app/src/main/AndroidManifest.xml');

if (!fs.existsSync(manifestPath)) {
  // If the directory does not exist, it just means they haven't run 'tauri android init' yet.
  // We exit gracefully without throwing an error to not break standard desktop builds.
  console.log('⚠️ [SPICE] AndroidManifest.xml not found. (If you are compiling for Android, please run "pnpm tauri android init" first to generate the Android project).');
  process.exit(0);
}

try {
  let content = fs.readFileSync(manifestPath, 'utf8');

  // Verify if landscape screenOrientation is already set
  if (content.includes('android:screenOrientation="landscape"')) {
    console.log('✅ [SPICE] Android screenOrientation is already set to landscape!');
    process.exit(0);
  }

  // Locating the main activity tag containing .MainActivity
  const activityMatch = /<activity\s+[^>]*android:name="\.MainActivity"[^>]*>/i;
  const match = content.match(activityMatch);

  if (match) {
    let activityTag = match[0];
    
    // If screenOrientation already exists but is different, replace it. Otherwise, append it.
    if (activityTag.includes('android:screenOrientation')) {
      activityTag = activityTag.replace(/android:screenOrientation="[^"]*"/, 'android:screenOrientation="landscape"');
    } else {
      activityTag = activityTag.replace(/>$/, ' android:screenOrientation="landscape">');
    }
    
    content = content.replace(match[0], activityTag);
    fs.writeFileSync(manifestPath, content, 'utf8');
    console.log('🚀 [SPICE] Successfully patched AndroidManifest.xml to force landscape orientation!');
  } else {
    console.log('❌ [SPICE] Could not find .MainActivity activity node in AndroidManifest.xml');
  }
} catch (err) {
  console.error('❌ [SPICE] Error patching AndroidManifest.xml:', err);
}
