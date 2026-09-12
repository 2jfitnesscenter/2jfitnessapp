import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { fetchThreads } from '../lib/chat-api.js'
import { newConversationSheet } from '../sheets.jsx'

export default function Chat() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const [threads, setThreads] = useState(null)
  const trainer = !!user?.trainer

  const load = () => fetchThreads().then(setThreads).catch(e => toast(e.message))
  useEffect(() => { load() }, [])

  const startNew = () => newConversationSheet(thread => { load(); nav('/chat/' + thread.id) })

  return <div className="narrow">
    <div className="hdr"><div><h1>{t('Conversations')}</h1></div></div>
    <div className="muted small" style={{ marginBottom: 16 }}>{t('See open and closed conversations, or start a new one.')}</div>

    {!trainer && <><Button variant="primary" icon="pencil" onClick={startNew}>{t('Start a new conversation')}</Button><div style={{ height: 20 }} /></>}

    {threads === null ? null : threads.length ? (
      <div className="list">
        {threads.map(th => <div key={th.id} className="item" onClick={() => nav('/chat/' + th.id)}>
          <span className="lrow-i"><Icon name="personCircle" /></span>
          <div className="grow">
            <div className="tt capitalize">{trainer ? th.memberName : t('Trainers')}</div>
            <div className="ss">{th.lastMessage ? th.lastMessage.text : t('No messages yet')}</div>
          </div>
          <span className={'tag' + (th.status === 'open' ? ' acc' : '')}>{th.status === 'open' ? t('Open') : t('Closed')}</span>
          <Icon name="chevronRight" className="chev" />
        </div>)}
      </div>
    ) : (
      <div className="empty"><div className="ico"><Icon name="personCircle" /></div>{t('No conversations yet')}</div>
    )}
  </div>
}
