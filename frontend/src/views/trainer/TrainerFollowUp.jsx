import CoachBoard from '../../components/coach/CoachBoard.jsx'
import CoachMember from '../../components/coach/CoachMember.jsx'

// Seguimiento inside the desktop trainer panel: the members an admin assigned to this trainer (an admin sees everyone).
export function TrainerFollowBoard() { return <CoachBoard base="/trainer/seguimiento" back="/trainer" /> }
export function TrainerFollowMember() { return <CoachMember back="/trainer/seguimiento" /> }
