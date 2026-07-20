/**
 * AnyRealm WebUSB Data Stream Parser
 * Handles ADB/Fastboot text packet streams.
 */

export const parseAdbShellOutput = (text: string) => {
  const lines = text.split('\n');
  const result: any = {};

  lines.forEach(line => {
    if (line.includes('ro.product.device')) {
      result.device = line.split(':')[1]?.trim();
    } else if (line.includes('ro.build.version.release')) {
      result.androidVersion = line.split(':')[1]?.trim();
    }
  });

  return result;
};

export const parseFastbootOutput = (text: string) => {
  if (text.includes('current-slot')) {
    return { slot: text.split(':')[1]?.trim() };
  }
  if (text.includes('sending') || text.includes('writing')) {
    return { status: text.trim() };
  }
  return { raw: text.trim() };
};
