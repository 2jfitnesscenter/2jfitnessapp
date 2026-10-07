import test from 'node:test';
import assert from 'node:assert/strict';
import { sameGeneratedText } from './generated-text.js';

test('generated artifact check treats LF and CRLF as the same text', () => {
  assert.equal(sameGeneratedText('{"a":1}\n', '{"a":1}\r\n'), true);
  assert.equal(sameGeneratedText('first\r\nsecond\r\n', 'first\nsecond\n'), true);
});

test('generated artifact check still rejects content or formatting changes', () => {
  assert.equal(sameGeneratedText('{"a":1}\r\n', '{"a":2}\n'), false);
  assert.equal(sameGeneratedText('{"a":1}\r\n', '{ "a":1 }\n'), false);
  assert.equal(sameGeneratedText(null, '{"a":1}\n'), false);
});
