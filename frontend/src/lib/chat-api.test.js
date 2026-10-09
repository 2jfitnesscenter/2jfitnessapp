import { describe, expect, it, vi } from 'vitest'

const calls = []
vi.mock('./api.js', () => ({ api: vi.fn(async (path, opts) => { calls.push({ path, opts }); return {} }) }))
const { fetchMessages, sendShare } = await import('./chat-api.js')

describe('chat polling cursor', () => {
  it('the first load asks for the whole thread; later polls ask only for what follows the last message held', async () => {
    calls.length = 0
    await fetchMessages('t 1')
    await fetchMessages('t 1', { after: 'm9', rev: 2 })
    await fetchMessages('t 1', { after: '', rev: 2 })
    expect(calls.map(c => c.path)).toEqual(['/api/chat/messages?threadId=t%201', '/api/chat/messages?threadId=t%201&after=m9&rev=2', '/api/chat/messages?threadId=t%201'])
  })
  it('a private snapshot goes to the chat audience, carrying the plan and nothing about a community post', async () => {
    calls.length = 0
    await sendShare({ kind: 'routine', snapshot: { name: 'x', ex: [] }, recipientId: 'u2', threadId: 't1' })
    const body = JSON.parse(calls[0].opts.body)
    expect(calls[0].path).toBe('/api/social/shares')
    expect(body).toMatchObject({ kind: 'routine', audience: 'chat', recipientId: 'u2', threadId: 't1' })
    expect(body.targetId).toBeUndefined()
  })
})
