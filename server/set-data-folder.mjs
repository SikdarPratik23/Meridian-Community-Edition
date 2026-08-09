// Save the storage folder chosen in the Windows picker, then migrate any
// existing journal into it. Called by "Choose Data Folder.bat" with the picked
// folder as the only argument.

import { setDataDir } from './data-location.mjs';

const dir = process.argv[2];
if (!dir || !dir.trim()) {
  console.error('No folder was given. Nothing changed.');
  process.exit(1);
}

try {
  const { newFile, migrated } = setDataDir(dir);
  console.log('');
  console.log('  Meridian will store your journal here:');
  console.log(`    ${newFile}`);
  console.log('');
  if (migrated) {
    console.log('  Your existing journal was copied into the new folder.');
  } else {
    console.log('  (A journal will be created here on the next sync.)');
  }
  console.log('');
  console.log('  Restart Meridian (or the sync server window) to use the new folder.');
  console.log('');
} catch (e) {
  console.error(`Could not set the folder: ${e.message}`);
  process.exit(1);
}
