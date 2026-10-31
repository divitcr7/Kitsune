import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { isTV } from './tv';

let available: boolean | null = null;

// Android TV answers web links with a placeholder that only says there's no browser.
const STUBS = /^com\.android\.tv\.frameworkpackagestubs/;

/** Whether this device has a browser Kitsune can hand a page to (phones do; TVs don't). */
export async function canOpenBrowser() {
  if (Platform.OS !== 'android' || isTV) return false;
  if (available !== null) return available;
  try {
    const r = await WebBrowser.getCustomTabsSupportingBrowsersAsync();
    const real = [...r.browserPackages, r.preferredBrowserPackage, r.defaultBrowserPackage].filter((p): p is string => !!p && !STUBS.test(p));
    available = real.length > 0;
  } catch {
    available = false;
  }
  return available;
}

/** Opens a page in the phone's browser as a tab over Kitsune, in Kitsune's colours. Back returns to the app. */
export async function openInBrowser(url: string) {
  try {
    await WebBrowser.openBrowserAsync(url, { toolbarColor: '#000000', controlsColor: '#FFFFFF', showTitle: false, enableBarCollapsing: true, createTask: false });
    return true;
  } catch {
    return false;
  }
}
