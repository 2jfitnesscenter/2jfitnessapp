import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { TextField } from '../components/ui.jsx'
import { fetchMessages, sendMessage, setThreadStatus } from '../lib/chat-api.js'

// No websocket infra anywhere in this app — poll while the thread is actually on screen,
// cleared on unmount, same "browse-on-open" spirit as the rest of Social/Chat's REST-only API.
const POLL_MS = 4000

export default function ChatThread() {
  const { id } = useParams()
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const trainer = !!user?.trainer
  const [thread, setThread] = useState(null)
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const bottomRef = useRef(null)

  const load = () => fetchMessages(id).then(d => { setThread(d.thread); setMessages(d.messages) }).catch(e => toast(e.message))
  useEffect(() => {
    load()
    const iv = setInterval(load, POLL_MS)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])
  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }) }, [messages.length])

  const send = () => {
    const msg = text.trim()
    if (!msg) return
    setText('')
    setBusy(true)
    sendMessage(id, msg).then(load).catch(e => toast(e.message)).finally(() => setBusy(false))
  }
  const toggleStatus = () => setThreadStatus(id, thread.status === 'open' ? 'closed' : 'open').then(load).catch(e => toast(e.message))

  if (!thread) return <div className="narrow"><div className="hdr">
    <button className="iconbtn" onClick={() => nav('/chat')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
  </div></div>

  return <div className="narrow" style={{ display: 'flex', flexDirection: 'column', minHeight: '78vh' }}>
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/chat')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 style={{ fontSize: 22 }} className="capitalize">{trainer ? thread.memberName : t('Trainers')}</h1></div>
      {trainer && <button className="iconbtn" aria-label={t('Toggle status')} onClick={toggleStatus}>
        <Icon name={thread.status === 'open' ? 'checkCircle' : 'reset'} />
      </button>}
    </div>

    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 2px', overflowY: 'auto' }}>
      {messages.map(m => {
        const mine = m.authorId === user?.id
        return <div key={m.id} style={{
          alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '78%',
          background: mine ? 'var(--acc)' : 'var(--surface)', color: mine ? 'var(--on-acc)' : 'var(--label)',
          borderRadius: 16, padding: '9px 13px', fontSize: 15, lineHeight: 1.4,
        }}>{m.text}</div>
      })}
      <div ref={bottomRef} />
    </div>

    {thread.status === 'closed' ? (
      <div className="dim small" style={{ textAlign: 'center', padding: '14px 0' }}>{t('This conversation is closed.')}</div>
    ) : (
      <div className="row" style={{ gap: 8, padding: '10px 0' }}>
        <TextField style={{ flex: 1 }} placeholder={t('Type your message…')} value={text}
          onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') send() }} />
        <button className="iconbtn" style={{ background: 'var(--acc)', color: 'var(--on-acc)' }} disabled={busy || !text.trim()} onClick={send} aria-label={t('Send')}>
          <Icon name="send" />
        </button>
      </div>
    )}
  </div>
}
