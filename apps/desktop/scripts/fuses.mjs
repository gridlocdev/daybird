// electron-builder afterPack hook: switch off the Electron features a packaged app never needs,
// so nothing can run the app's binary as plain Node or attach an inspector to it.
// It runs before signing, so the signature covers the flipped fuses.
import path from 'node:path';
import { flipFuses, FuseV1Options, FuseVersion } from '@electron/fuses';

const EXTENSION = { darwin: '.app', mas: '.app', win32: '.exe', linux: '' };

export default async function afterPack(context) {
  const { appOutDir, electronPlatformName, packager } = context;
  const name = electronPlatformName === 'linux' ? packager.executableName : packager.appInfo.productFilename;
  await flipFuses(path.join(appOutDir, `${name}${EXTENSION[electronPlatformName]}`), {
    version: FuseVersion.V1,
    // The ad-hoc signature no longer matches once the binary changes; electron-builder signs again after this.
    resetAdHocDarwinSignature: electronPlatformName === 'darwin',
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    // electron-builder.yml packages the app as an asar.
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  });
}
