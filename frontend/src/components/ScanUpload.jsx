import { useRef, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { resizeImageFile, scanMeasurements } from '../lib/media.js'
import { Button } from './ui.jsx'

const readAsDataUrl = file => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onerror = () => reject(new Error(t('Could not read that file')))
  reader.onload = () => resolve(reader.result)
  reader.readAsDataURL(file)
})

// Shared by Admin's BioimpedanceSheet and Measurements' own scan sheet — opens the file/camera
// picker, reads the file (downsizing a photo the same way every other upload in the app does;
// a PDF goes through as-is since a canvas can't decode one), sends it off for a one-shot AI read,
// and hands the extracted values back. Never saves anything itself — the caller always shows the
// result in an editable form first, exactly like a manual entry would be.
export default function ScanUpload({ onResult }) {
  const toast = useUI(s => s.toast)
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)

  const onFile = async e => {
    const file = e.target.files[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      const dataUrl = file.type === 'application/pdf' ? await readAsDataUrl(file) : await resizeImageFile(file)
      const values = await scanMeasurements(dataUrl)
      onResult(values)
    } catch (err) {
      toast(err.message || t('Could not read that file'))
    } finally {
      setBusy(false)
    }
  }

  return <>
    {/* No `capture` attribute on purpose — that forces iOS straight into the camera and skips
        its own picker, so there was never a way to import an existing photo or PDF (issue: iOS
        "scan report" only opened the camera). Leaving it off gets the native action sheet back
        (Take Photo / Photo Library / Browse), and a live capture is still one tap away in it. */}
    <input ref={inputRef} type="file" accept="image/*,application/pdf"
      style={{ display: 'none' }} onChange={onFile} />
    <Button size="sm" variant="tinted" icon="scan" disabled={busy} onClick={() => inputRef.current.click()}>
      {busy ? t('Reading…') : t('Scan report')}
    </Button>
  </>
}
