import { photoForGuidedProgram } from '../lib/guided-program-photo.js'
import './guided-program-photo.css'

export default function GuidedProgramPhoto({ program, children, className = '', linkedCredit = false }) {
  const photo = photoForGuidedProgram(program)
  return <div className={`gp-photo ${className}`}>
    <img src={photo.src} alt="" aria-hidden="true" loading="lazy" decoding="async" />
    <span className="gp-photo-shade" aria-hidden="true" />
    <div className="gp-photo-overlay">{children}</div>
    <span className="gp-photo-credit">
      {linkedCredit ? <><a href={photo.source} target="_blank" rel="noopener noreferrer">Foto: {photo.author}</a><span aria-hidden="true"> · </span><a href={photo.license} target="_blank" rel="noopener noreferrer">CC BY 2.0</a></> : `Foto: ${photo.author} · CC BY 2.0`}
    </span>
  </div>
}
