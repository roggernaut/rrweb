/**
 * Helper module to test getSetRecordingId in isolation
 */

export function getSetRecordingId(): string | null {
  const name = 'rrweb-cloud-recording-id';
  let value: string | null = null;
  try {
    value = sessionStorage.getItem(name);
    if (!value) {
      value = self.crypto.randomUUID();
      try {
        sessionStorage.setItem(name, value);
      } catch (e) {
        value = null;
      }
    }
  } catch (e) {
    value = null;
  }
  return value;
}
