// Generated JSON is canonical LF, while Git on Windows may materialize the same text as CRLF.
// Normalize only line endings; content, ordering and formatting differences must still fail.
export function sameGeneratedText(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  return actual.replace(/\r\n/g, '\n') === expected.replace(/\r\n/g, '\n');
}
