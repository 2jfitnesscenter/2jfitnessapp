import { useStore } from '../store/useStore.js'
import CoachBoard from '../components/coach/CoachBoard.jsx'
import CoachMember from '../components/coach/CoachMember.jsx'

/* Seguimiento for the admin (mobile shell): the same board and member sheet the trainers get in their panel, with every member in scope. The data, the triage
   and the permissions live on the server (api/lib/coach-followup-routes.js); the admin sees all members, a trainer only the ones assigned to them. */
export default function AdminAttention() {
  const user = useStore(s => s.user)
  if (!user?.admin) return null
  return <CoachBoard base="/admin/attention" back="/admin" />
}
export function AdminAttentionMember() {
  const user = useStore(s => s.user)
  if (!user?.admin) return null
  return <CoachMember back="/admin/attention" />
}
