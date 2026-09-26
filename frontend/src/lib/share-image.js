import { MOBILE, shareImage } from './mobile.js'

export function captureDimensions(node) {
  const rect = node.getBoundingClientRect()
  return {
    width: Math.ceil(Math.max(node.scrollWidth || 0, rect.width || 0)),
    height: Math.ceil(Math.max(node.scrollHeight || 0, rect.height || 0)),
  }
}

export function captureOptions(node, pixelRatio = 4) {
  const { width, height } = captureDimensions(node)
  return {
    pixelRatio,
    cacheBust: true,
    width,
    height,
    canvasWidth: width * pixelRatio,
    canvasHeight: height * pixelRatio,
    style: { height: `${height}px`, maxHeight: 'none', overflow: 'visible' },
  }
}

export async function capturePng(node, pixelRatio = 4) {
  const { toPng } = await import('html-to-image')
  return toPng(node, captureOptions(node, pixelRatio))
}

export function downloadPng(dataUrl, filename) {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export async function sharePng(dataUrl, filename, title, text) {
  if (MOBILE) {
    await shareImage(dataUrl.split(',')[1], filename)
    return 'shared'
  }
  const blob = await (await fetch(dataUrl)).blob()
  const file = new File([blob], filename, { type: 'image/png' })
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title, ...(text ? { text } : {}) })
    return 'shared'
  }
  downloadPng(dataUrl, filename)
  return 'downloaded'
}
